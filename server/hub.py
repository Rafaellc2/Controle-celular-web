"""Sala de jogadores: cada celular conectado vira um JOYSTICK-N.

O Hub guarda quem está em cada slot, cria os controles virtuais sob demanda
e avisa o painel (admin) sempre que algo muda.
"""

import asyncio
import logging
import time

from gamepad import backend_name, create_gamepad

log = logging.getLogger("hub")

MAX_SLOTS = 8
RESERVE_SECONDS = 60  # slot de quem caiu fica guardado para voltar no mesmo número

# Códigos de fechamento do WebSocket entendidos pelo app do celular
CLOSE_REPLACED = 4000  # mesmo celular abriu o controle em outra aba
CLOSE_DISABLED = 4001  # acesso desligado no painel
CLOSE_FULL = 4002      # todos os slots ocupados
CLOSE_KICKED = 4003    # removido pelo painel
CLOSE_BAD_PIN = 4004   # PIN ausente ou errado
CLOSE_LOCKED = 4005    # muitas tentativas de PIN erradas deste aparelho


class Player:
    def __init__(self, cid, slot, ip, device):
        self.cid = cid
        self.slot = slot
        self.ip = ip
        self.device = device
        self.name = ""
        self.ws = None
        self.connected_at = time.time()
        self.disconnected_at = None
        self.rtt = None
        self.last_input = 0.0
        self.held = set()
        self.stick = (0.0, 0.0)
        self.rstick = (0.0, 0.0)
        self.rumble = 0.0

    @property
    def online(self):
        return self.ws is not None and not self.ws.closed

    def snapshot(self, now):
        reserve_left = None
        if not self.online and self.disconnected_at:
            reserve_left = max(0, round(RESERVE_SECONDS - (now - self.disconnected_at)))
        return {
            "name": self.name,
            "device": self.device,
            "ip": self.ip,
            "online": self.online,
            "rtt": self.rtt,
            "since": self.connected_at,
            "held": sorted(self.held),
            "stick": self.stick,
            "rstick": self.rstick,
            "rumble": self.rumble,
            "reserve_left": reserve_left,
        }


class Hub:
    def __init__(self, dry_run=False, max_players=4):
        self.forced_dry_run = dry_run
        self.dry_run = dry_run
        self.backend = "dry-run" if dry_run else backend_name()
        self.backend_error = None
        self.enabled = True
        self.max_players = max(1, min(MAX_SLOTS, max_players))
        self.players = {}  # slot -> Player
        self.pads = {}     # slot -> gamepad; criado sob demanda e mantido até encerrar
        self.admins = set()
        self.extra_state = {}  # url, firewall etc., preenchido pelo servidor
        self._dirty = True

    # ---------- Controles virtuais ----------
    def pad(self, slot):
        # Cria os slots menores antes, para o sistema numerar os controles na ordem certa.
        for n in range(1, slot + 1):
            if n in self.pads:
                continue
            try:
                self.pads[n] = self._new_pad(n, self.dry_run)
            except Exception as exc:
                log.error("Could not create the virtual controller: %s", exc)
                log.error("Falling back to dry-run (see the panel / README.md).")
                self.backend_error = str(exc)
                self.dry_run = True
                self.backend = "dry-run"
                self.pads[n] = self._new_pad(n, True)
            self.changed()
        return self.pads[slot]

    def _new_pad(self, slot, dry_run):
        pad = create_gamepad(slot, dry_run)
        try:
            pad.attach_rumble(asyncio.get_running_loop(), lambda v, ms: self._rumble(slot, v, ms))
        except Exception as exc:  # vibração é extra: o controle funciona sem ela
            log.warning("JOYSTICK-%d has no game rumble: %s", slot, exc)
        return pad

    def _rumble(self, slot, strength, ms):
        """Jogo pediu vibração no JOYSTICK-N: repassa para o celular desse slot."""
        player = self.players.get(slot)
        if player is None:
            return
        strength = round(max(0.0, min(1.0, strength)), 2)
        if ms is None and strength == player.rumble:
            return  # ViGEmBus repete o mesmo estado várias vezes
        player.rumble = strength
        self.changed()
        if player.online:
            asyncio.create_task(self._send(player, {"t": "rumble", "v": strength, "ms": ms}))

    async def _send(self, player, msg):
        ws = player.ws
        if ws is not None and not ws.closed:
            try:
                await ws.send_json(msg)
            except ConnectionError:
                pass

    def retry_backend(self):
        """Tenta de novo o backend real (ex.: depois de liberar /dev/uinput)."""
        if self.forced_dry_run or not self.backend_error:
            return
        try:
            first = self._new_pad(1, False)
        except Exception as exc:
            self.backend_error = str(exc)
            self.changed()
            return
        old, self.pads = self.pads, {1: first}
        for p in old.values():
            p.close()
        self.dry_run = False
        self.backend = backend_name()
        self.backend_error = None
        for slot in sorted(self.players):
            self.pad(slot)
        log.info("Backend %s active.", self.backend)
        self.changed()

    def close_pads(self):
        for p in self.pads.values():
            p.close()
        self.pads.clear()

    # ---------- Jogadores ----------
    def join(self, cid, ip, device):
        """Retorna (player, None) ou (None, código de fechamento)."""
        if not self.enabled:
            return None, CLOSE_DISABLED
        player = next((p for p in self.players.values() if p.cid == cid), None)
        if player is None:
            slot = next((n for n in range(1, self.max_players + 1) if n not in self.players), None)
            if slot is None:
                # Sala cheia: libera a reserva mais antiga de quem caiu, se houver.
                idle = [p for p in self.players.values() if not p.online]
                if not idle:
                    return None, CLOSE_FULL
                slot = min(idle, key=lambda p: p.disconnected_at or 0).slot
                del self.players[slot]
            player = Player(cid, slot, ip, device)
            self.players[slot] = player
        player.ip = ip
        player.device = device or player.device
        self.pad(player.slot)
        self.changed()
        return player, None

    def attach(self, player, ws):
        player.ws = ws
        player.connected_at = time.time()
        player.disconnected_at = None
        self._release(player)
        log.info("JOYSTICK-%d connected: %s (%s)", player.slot, player.device, player.ip)

    def leave(self, player, ws):
        if player.ws is not ws:
            return  # já substituído por outra conexão do mesmo celular
        player.ws = None
        player.disconnected_at = time.time()
        if self.players.get(player.slot) is player:
            self._release(player)
        log.info("JOYSTICK-%d disconnected", player.slot)
        self.changed()

    def handle_input(self, player, msg):
        if "b" in msg:
            if msg.get("s"):
                player.held.add(str(msg["b"]))
            else:
                player.held.discard(str(msg["b"]))
        elif "a" in msg and msg.get("a") in ("L", "R"):
            try:
                value = (round(float(msg.get("x", 0)), 2), round(float(msg.get("y", 0)), 2))
            except (TypeError, ValueError):
                return
            if msg["a"] == "L":
                player.stick = value
            else:
                player.rstick = value
        elif "r" in msg:
            player.held.clear()
            player.stick = (0.0, 0.0)
            player.rstick = (0.0, 0.0)
        player.last_input = time.monotonic()
        self.pads[player.slot].apply(msg)
        self.changed()

    def _release(self, player):
        player.held.clear()
        player.stick = (0.0, 0.0)
        player.rstick = (0.0, 0.0)
        player.rumble = 0.0
        if player.slot in self.pads:
            self.pads[player.slot].reset()

    async def _drop(self, player, code):
        """Remove o jogador do slot e fecha a conexão dele."""
        if self.players.get(player.slot) is player:
            del self.players[player.slot]
        self._release(player)
        ws, player.ws = player.ws, None
        if ws is not None and not ws.closed:
            await ws.close(code=code)
        self.changed()

    # ---------- Comandos do painel ----------
    async def set_enabled(self, enabled):
        self.enabled = bool(enabled)
        log.info("Access %s", "ON" if self.enabled else "OFF")
        if not self.enabled:
            await asyncio.gather(*(self._drop(p, CLOSE_DISABLED) for p in list(self.players.values())))
        self.changed()

    async def set_max_players(self, n):
        self.max_players = max(1, min(MAX_SLOTS, int(n)))
        extra = [p for p in self.players.values() if p.slot > self.max_players]
        await asyncio.gather(*(self._drop(p, CLOSE_FULL) for p in extra))
        self.changed()

    async def kick(self, slot):
        player = self.players.get(slot)
        if player:
            log.info("JOYSTICK-%d removed from the panel", slot)
            await self._drop(player, CLOSE_KICKED)

    async def move(self, slot, to):
        if slot == to or slot not in self.players or not 1 <= to <= self.max_players:
            return
        a = self.players.pop(slot)
        b = self.players.pop(to, None)
        for p in (a, b):
            if p:
                self._release(p)
        a.slot = to
        self.players[to] = a
        if b:
            b.slot = slot
            self.players[slot] = b
        self.pad(max(slot, to))
        for p in (a, b):
            if p and p.online:
                await p.ws.send_json({"t": "slot", "slot": p.slot})
        log.info("JOYSTICK-%d moved to JOYSTICK-%d", slot, to)
        self.changed()

    async def find(self, slot):
        """Faz o celular do JOYSTICK-N vibrar e piscar, para o jogador se achar."""
        player = self.players.get(slot)
        if player and player.online:
            await self._send(player, {"t": "find", "slot": slot})

    async def rename(self, slot, name):
        player = self.players.get(slot)
        if not player:
            return
        player.name = str(name).strip()[:24]
        if player.online:
            await player.ws.send_json({"t": "name", "name": player.name})
        self.changed()

    # ---------- Estado para o painel ----------
    def changed(self):
        self._dirty = True

    def state(self):
        now = time.time()
        mono = time.monotonic()
        slots = []
        for n in range(1, self.max_players + 1):
            p = self.players.get(n)
            snap = None
            if p:
                snap = p.snapshot(now)
                snap["active"] = mono - p.last_input < 0.3
            slots.append({"slot": n, "player": snap})
        return {
            "t": "state",
            "enabled": self.enabled,
            "max_players": self.max_players,
            "max_slots": MAX_SLOTS,
            "backend": self.backend,
            "backend_error": self.backend_error,
            "online": sum(1 for p in self.players.values() if p.online),
            "slots": slots,
            **self.extra_state,
        }

    async def admin_loop(self):
        """Envia o estado ao painel no máximo 10x/s, só quando algo mudou."""
        while True:
            await asyncio.sleep(0.1)
            if not self._dirty or not self.admins:
                continue
            self._dirty = False
            state = self.state()
            for ws in list(self.admins):
                try:
                    await ws.send_json(state)
                except ConnectionError:
                    self.admins.discard(ws)

    async def housekeeping_loop(self, refresh_extra):
        """Expira reservas e atualiza informações lentas (firewall, IP) a cada 2 s."""
        while True:
            await asyncio.sleep(2)
            now = time.time()
            for p in list(self.players.values()):
                if not p.online and p.disconnected_at and now - p.disconnected_at > RESERVE_SECONDS:
                    log.info("JOYSTICK-%d reservation expired", p.slot)
                    del self.players[p.slot]
            refresh_extra()
            self.changed()  # atualiza contadores (tempo de reserva, ping)
