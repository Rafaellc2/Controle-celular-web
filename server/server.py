"""Servidor do Controle Web.

- Celulares (rede local): app do controle em / e WebSocket em /ws.
  Cada celular recebe um slot próprio (JOYSTICK-1, JOYSTICK-2, ...).
- Painel (somente neste computador): http://localhost:PORTA/admin
  liga/desliga o acesso, mostra o link/QR e os controles conectados.

Uso:
    python server/server.py [--port 8080] [--max-players 4] [--dry-run] [--verbose]
"""

import argparse
import asyncio
import ipaddress
import json
import logging
import os
import re
import signal
import socket
import sys
from pathlib import Path
from urllib.parse import urlparse

from aiohttp import WSMsgType, web

from hub import Hub

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DIR = ROOT / "public"
ADMIN_DIR = ROOT / "admin"
log = logging.getLogger("server")

HUB = web.AppKey("hub", Hub)
PORT = web.AppKey("port", int)
TASKS = web.AppKey("tasks", list)


def local_ip():
    """Descobre o IP da interface usada para sair para a rede (nenhum pacote é enviado)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def qr_svg(url):
    try:
        import qrcode
        import qrcode.image.svg
    except ImportError:
        return ""
    img = qrcode.make(url, image_factory=qrcode.image.svg.SvgPathImage, border=2)
    svg = img.to_string(encoding="unicode")
    return re.sub(r' (width|height)="[^"]*"', "", svg, count=2)


def print_qr(url):
    try:
        import qrcode

        qr = qrcode.QRCode(border=1)
        qr.add_data(url)
        qr.make(fit=True)
        qr.print_ascii(invert=True)
    except ImportError:
        pass


def firewall_status(port):
    """True/False se o ufw está ativo e a porta liberada/bloqueada; None se não há ufw."""
    try:
        with open("/etc/ufw/ufw.conf") as f:
            if "ENABLED=yes" not in f.read():
                return None
        with open("/etc/ufw/user.rules") as f:
            rules = f.read()
    except OSError:
        return None
    pattern = re.compile(rf"^-A ufw-user-input -p tcp .*--dport {port}\b.*-j ACCEPT", re.M)
    return bool(pattern.search(rules))


# ---------- Acesso restrito ao painel ----------
def is_local_request(request):
    """Painel só pode ser aberto neste computador (e não por outro site no navegador)."""
    try:
        if not ipaddress.ip_address(request.remote or "").is_loopback:
            return False
    except ValueError:
        return False
    if request.host.rsplit(":", 1)[0] not in ("localhost", "127.0.0.1"):
        return False
    origin = request.headers.get("Origin")
    return origin is None or urlparse(origin).hostname in ("localhost", "127.0.0.1")


def local_only(handler):
    async def wrapper(request):
        if not is_local_request(request):
            raise web.HTTPForbidden(text="Painel disponível apenas em http://localhost neste computador.")
        return await handler(request)

    return wrapper


# ---------- Rotas ----------
async def index(request):
    return web.FileResponse(PUBLIC_DIR / "index.html")


async def ping(request):
    return web.Response(text="ok")


@local_only
async def admin_page(request):
    return web.FileResponse(ADMIN_DIR / "index.html", headers={"Cache-Control": "no-store"})


@local_only
async def admin_static(request):
    name = request.match_info["name"]
    if name not in ("admin.js", "admin.css"):
        raise web.HTTPNotFound()
    return web.FileResponse(ADMIN_DIR / name, headers={"Cache-Control": "no-store"})


async def ws_player(request):
    hub = request.app[HUB]
    ws = web.WebSocketResponse(heartbeat=5, max_msg_size=4096)
    await ws.prepare(request)

    cid = request.query.get("cid", "")[:64] or f"anon-{id(ws)}"
    device = request.query.get("dev", "")[:40]
    player, refused = hub.join(cid, request.remote, device)
    if refused:
        await ws.close(code=refused)
        return ws

    # Mesmo celular reconectando (ou em outra aba): a conexão nova assume o slot.
    old = player.ws
    hub.attach(player, ws)
    if old is not None and not old.closed:
        await old.close(code=4000, message=b"replaced")
    await ws.send_json({"t": "hello", "slot": player.slot, "name": player.name})
    hub.changed()

    try:
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                continue
            try:
                data = json.loads(msg.data)
            except ValueError:
                continue
            if not isinstance(data, dict):
                continue
            if "p" in data:
                await ws.send_str(msg.data)  # eco para medir latência
                rtt = data.get("rtt")
                if isinstance(rtt, (int, float)):
                    player.rtt = round(rtt)
                continue
            if hub.players.get(player.slot) is player:
                hub.handle_input(player, data)
    finally:
        hub.leave(player, ws)

    return ws


@local_only
async def ws_admin(request):
    hub = request.app[HUB]
    ws = web.WebSocketResponse(heartbeat=10)
    await ws.prepare(request)
    hub.admins.add(ws)
    await ws.send_json(hub.state())

    try:
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                continue
            try:
                cmd = json.loads(msg.data)
                await run_admin_command(request.app, cmd)
            except (ValueError, TypeError, KeyError) as exc:
                log.warning("Comando inválido do painel: %s (%s)", msg.data[:200], exc)
    finally:
        hub.admins.discard(ws)
    return ws


async def run_admin_command(app, cmd):
    hub = app[HUB]
    action = cmd["cmd"]
    if action == "enabled":
        await hub.set_enabled(cmd["value"])
    elif action == "max_players":
        await hub.set_max_players(int(cmd["value"]))
    elif action == "kick":
        await hub.kick(int(cmd["slot"]))
    elif action == "move":
        await hub.move(int(cmd["slot"]), int(cmd["to"]))
    elif action == "rename":
        await hub.rename(int(cmd["slot"]), cmd["name"])
    elif action == "retry_backend":
        hub.retry_backend()
    elif action == "shutdown":
        log.info("Encerrando pelo painel.")
        # Deixa a resposta sair antes; o run_app trata SIGINT com desligamento limpo.
        asyncio.get_running_loop().call_later(0.2, os.kill, os.getpid(), signal.SIGINT)


# ---------- Ciclo de vida ----------
def refresh_extra(app):
    port = app[PORT]
    url = f"http://{local_ip()}:{port}"
    hub = app[HUB]
    if hub.extra_state.get("url") != url:
        hub.extra_state["url"] = url
        hub.extra_state["qr"] = qr_svg(url)
    hub.extra_state["firewall"] = firewall_status(port)
    lan = ipaddress.ip_network(f"{local_ip()}/24", strict=False)
    hub.extra_state["firewall_cmd"] = f"sudo ufw allow from {lan} to any port {port} proto tcp"
    hub.extra_state["port"] = port
    hub.extra_state["platform"] = sys.platform


async def on_startup(app):
    hub = app[HUB]
    refresh_extra(app)
    hub.pad(1)  # cria o JOYSTICK-1 já na abertura e detecta problema de driver/permissão
    app[TASKS].append(asyncio.create_task(hub.admin_loop()))
    app[TASKS].append(asyncio.create_task(hub.housekeeping_loop(lambda: refresh_extra(app))))


async def on_shutdown(app):
    hub = app[HUB]
    for ws in list(hub.admins):
        await ws.close(code=1001, message=b"shutdown")
    for p in list(hub.players.values()):
        if p.online:
            await p.ws.close(code=1001, message=b"shutdown")
    for t in app[TASKS]:
        t.cancel()


async def on_cleanup(app):
    app[HUB].close_pads()


def main():
    parser = argparse.ArgumentParser(description="Controle Web: celulares como gamepads Xbox 360")
    parser.add_argument("--port", type=int, default=int(os.environ.get("CONTROLE_WEB_PORT", "8080")))
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--max-players", type=int, default=4)
    parser.add_argument("--dry-run", action="store_true", help="não cria controles virtuais, só loga")
    parser.add_argument("--verbose", action="store_true", help="loga também o movimento dos analógicos")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
    )
    logging.getLogger("aiohttp.access").setLevel(logging.WARNING)

    app = web.Application()
    app[HUB] = Hub(dry_run=args.dry_run, max_players=args.max_players)
    app[PORT] = args.port
    app[TASKS] = []
    app.on_startup.append(on_startup)
    app.on_shutdown.append(on_shutdown)
    app.on_cleanup.append(on_cleanup)

    app.router.add_get("/", index)
    app.router.add_get("/ws", ws_player)
    app.router.add_get("/api/ping", ping)
    app.router.add_get("/admin", admin_page)
    app.router.add_get("/admin/ws", ws_admin)
    app.router.add_get("/admin/{name}", admin_static)
    app.router.add_static("/", PUBLIC_DIR)

    url = f"http://{local_ip()}:{args.port}"
    print()
    print("=" * 56)
    print("  Controle Web rodando!")
    print(f"  Celulares (mesma Wi-Fi): {url}")
    print(f"  Painel (este PC):        http://localhost:{args.port}/admin")
    print("=" * 56)
    print_qr(url)
    web.run_app(app, host=args.host, port=args.port, print=None)


if __name__ == "__main__":
    main()
