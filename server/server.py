"""Web Controller server.

- Phones (local network): controller app at / and WebSocket at /ws.
  Each phone gets its own slot (JOYSTICK-1, JOYSTICK-2, ...).
- Panel (this computer only): http://localhost:PORT/admin
  turns access on/off, shows the link/QR code and the connected controllers.
- Fixed network link: http://controle.local:PORT (mDNS), does not change with the IP.
- Optional HTTPS (self-signed certificate) on --https-port, required for the
  phone's gyroscope.

Usage:
    python server/server.py [--port 8080] [--https-port 8443] [--name controle]
                            [--max-players 4] [--no-pin] [--dry-run] [--verbose]
"""

import argparse
import asyncio
import hmac
import ipaddress
import json
import logging
import os
import re
import secrets
import socket
import ssl
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

from aiohttp import WSMsgType, web

from hub import CLOSE_BAD_PIN, CLOSE_LOCKED, Hub
from screen import Screen

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DIR = ROOT / "public"
ADMIN_DIR = ROOT / "admin"
log = logging.getLogger("server")

HUB = web.AppKey("hub", Hub)
PORT = web.AppKey("port", int)
TASKS = web.AppKey("tasks", list)
STOP = web.AppKey("stop", asyncio.Event)
NET = web.AppKey("net", dict)  # nome mDNS, porta HTTPS, zeroconf
SCREEN = web.AppKey("screen", Screen)
PIN = web.AppKey("pin", dict)  # {"value": "123456" ou None se desligado, "fails": {ip: (erros, bloqueado_até)}}

CERT_DIR = Path.home() / ".controle-web"
PIN_FILE = CERT_DIR / "pin"
PIN_MAX_FAILS = 5        # erros seguidos antes de bloquear o aparelho
PIN_LOCK_SECONDS = 300
SCREEN_CONFIG = CERT_DIR / "screen.json"
SCREEN_DEFAULTS = {"width": 1920, "fps": 60, "quality": 6}


def new_pin():
    """PIN de 6 dígitos guardado em ~/.controle-web/pin (o celular não precisa digitar de novo a cada início)."""
    pin = f"{secrets.randbelow(10**6):06d}"
    try:
        CERT_DIR.mkdir(parents=True, exist_ok=True)
        PIN_FILE.touch(mode=0o600)
        PIN_FILE.write_text(pin)
    except OSError as exc:
        log.warning("Could not save the PIN: %s", exc)
    return pin


def load_pin():
    try:
        pin = PIN_FILE.read_text().strip()
    except OSError:
        pin = ""
    return pin if re.fullmatch(r"\d{6}", pin) else new_pin()


def check_pin(app, ip, given):
    """None se o PIN confere (ou está desligado); senão o código de fechamento do WebSocket."""
    pin = app[PIN]
    if pin["value"] is None:
        return None
    fails = pin["fails"]
    count, until = fails.get(ip, (0, 0.0))
    if until > time.monotonic():
        return CLOSE_LOCKED
    if not given:
        return CLOSE_BAD_PIN  # celular sem PIN guardado ainda: não conta como tentativa errada
    if hmac.compare_digest(given.encode(), pin["value"].encode()):
        fails.pop(ip, None)
        return None
    count += 1
    fails[ip] = (0, time.monotonic() + PIN_LOCK_SECONDS) if count >= PIN_MAX_FAILS else (count, 0.0)
    log.warning("Wrong PIN from %s (%d/%d)", ip, count, PIN_MAX_FAILS)
    return CLOSE_LOCKED if count >= PIN_MAX_FAILS else CLOSE_BAD_PIN


def with_pin(url, app):
    """Link com o PIN embutido (usado só no QR Code: escanear já entra)."""
    pin = app[PIN]["value"]
    return f"{url}/?pin={pin}" if pin else url


def load_screen_config():
    try:
        saved = json.loads(SCREEN_CONFIG.read_text())
    except (OSError, ValueError):
        return {}
    return {k: saved[k] for k in SCREEN_DEFAULTS if isinstance(saved.get(k), int)}


def save_screen_config(screen):
    try:
        CERT_DIR.mkdir(parents=True, exist_ok=True)
        SCREEN_CONFIG.write_text(json.dumps({"width": screen.width, "fps": screen.fps, "quality": screen.quality}))
    except OSError as exc:
        log.warning("Could not save the screen quality: %s", exc)


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


def firewall_status(port, ip=None):
    """True/False se o ufw está ativo e a porta liberada/bloqueada; None se não há ufw.

    Com `ip`, só conta a regra que vale para a rede atual (regra "from 192.168.0.0/24"
    não libera quem está na 192.168.1.x)."""
    try:
        with open("/etc/ufw/ufw.conf") as f:
            if "ENABLED=yes" not in f.read():
                return None
        with open("/etc/ufw/user.rules") as f:
            rules = f.read()
    except OSError:
        return None
    for line in rules.splitlines():
        if not line.startswith("-A ufw-user-input -p tcp") or not line.endswith("-j ACCEPT"):
            continue
        if not re.search(rf"--dports? ([\d,:]+,)?{port}\b|--dport {port}\b", line):
            continue
        src = re.search(r" -s (\S+)", line)
        if not src or not ip:
            return True
        try:
            if ipaddress.ip_address(ip) in ipaddress.ip_network(src.group(1), strict=False):
                return True
        except ValueError:
            continue
    return False


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
            raise web.HTTPForbidden(text="The panel is only available at http://localhost on this computer.")
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

    refused_pin = check_pin(request.app, request.remote, request.query.get("pin", "")[:16])
    if refused_pin:
        await ws.close(code=refused_pin)
        return ws

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
    links = hub.extra_state.get("links", {})
    screen = request.app[SCREEN]
    await ws.send_json({"t": "hello", "slot": player.slot, "name": player.name, "https": links.get("https"),
                        "screen": screen.enabled and screen.available})
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


async def ws_screen(request):
    """Quadros JPEG da tela do PC, só para celulares já conectados como jogador."""
    hub, screen = request.app[HUB], request.app[SCREEN]
    cid = request.query.get("cid", "")
    if not (screen.enabled and screen.available) or not any(p.cid == cid and p.online for p in hub.players.values()):
        raise web.HTTPForbidden()
    ws = web.WebSocketResponse(heartbeat=10, max_msg_size=1024)
    await ws.prepare(request)
    viewer = screen.add()

    sock = request.transport.get_extra_info("socket")
    if sock is not None:
        try:  # buffer pequeno no kernel: fila grande de quadros na rede vira atraso
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 262144)
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        except OSError:
            pass

    async def pump():
        while True:
            await ws.send_bytes(await viewer.next_frame())

    sender = asyncio.create_task(pump())
    try:
        async for msg in ws:
            if msg.type == WSMsgType.TEXT and msg.data == "a":
                viewer.ack()
    finally:
        sender.cancel()
        screen.remove(viewer)
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
                log.warning("Invalid panel command: %s (%s)", msg.data[:200], exc)
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
    elif action == "find":
        await hub.find(int(cmd["slot"]))
    elif action == "new_pin":
        if app[PIN]["value"] is not None:
            app[PIN]["value"] = new_pin()
            app[PIN]["fails"].clear()
            log.info("New PIN generated; connected phones must join again.")
            await asyncio.gather(*(hub._drop(p, CLOSE_BAD_PIN) for p in list(hub.players.values())))
            refresh_extra(app)
    elif action == "screen":
        await set_screen_enabled(app, bool(cmd["value"]))
    elif action == "screen_config":
        screen = app[SCREEN]
        await screen.configure(cmd["width"], cmd["fps"], cmd["quality"])
        save_screen_config(screen)
    elif action == "retry_backend":
        hub.retry_backend()
    elif action == "shutdown":
        log.info("Shutting down from the panel.")
        # Deixa a resposta sair antes de desligar.
        asyncio.get_running_loop().call_later(0.2, app[STOP].set)


async def set_screen_enabled(app, enabled):
    hub, screen = app[HUB], app[SCREEN]
    screen.enabled = enabled
    log.info("Screen streaming %s", "ON" if enabled else "OFF")
    if not enabled:
        await screen.stop()
    for p in hub.players.values():
        await hub._send(p, {"t": "screen", "on": enabled and screen.available})
    sync_screen_state(app)


def sync_screen_state(app):
    hub = app[HUB]
    hub.extra_state["screen"] = app[SCREEN].info()
    hub.changed()


# ---------- HTTPS (certificado próprio) ----------
def ensure_cert(ip, names):
    """Gera (ou reaproveita) um certificado autoassinado para o IP e nomes atuais."""
    try:
        import datetime

        from cryptography import x509
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.x509.oid import NameOID
    except ImportError:
        log.warning("Package 'cryptography' missing: HTTPS (gyroscope) is off.")
        return None

    cert_file, key_file = CERT_DIR / "cert.pem", CERT_DIR / "key.pem"
    ips = {ipaddress.ip_address(ip), ipaddress.ip_address("127.0.0.1")}
    if cert_file.exists() and key_file.exists():
        cert = x509.load_pem_x509_certificate(cert_file.read_bytes())
        san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
        still_valid = cert.not_valid_after_utc > datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=7)
        if still_valid and ips <= set(san.get_values_for_type(x509.IPAddress)) and set(names) <= set(san.get_values_for_type(x509.DNSName)):
            return cert_file, key_file

    key = ec.generate_private_key(ec.SECP256R1())
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Controle Web")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=825))
        .add_extension(
            x509.SubjectAlternativeName([x509.DNSName(n) for n in names] + [x509.IPAddress(i) for i in ips]),
            critical=False,
        )
        .sign(key, hashes.SHA256())
    )
    CERT_DIR.mkdir(parents=True, exist_ok=True)
    key_file.write_bytes(key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    os.chmod(key_file, 0o600)
    cert_file.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    log.info("HTTPS certificate generated in %s", CERT_DIR)
    return cert_file, key_file


def make_ssl_context(ip, names):
    files = ensure_cert(ip, names)
    if not files:
        return None
    ctx = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
    ctx.load_cert_chain(*map(str, files))
    return ctx


# ---------- Nome fixo na rede (mDNS) ----------
async def start_mdns(app):
    """Anuncia NOME.local apontando para este PC (funciona sem avahi/Bonjour)."""
    net = app[NET]
    try:
        from zeroconf import ServiceInfo
        from zeroconf.asyncio import AsyncZeroconf
    except ImportError:
        log.warning("Package 'zeroconf' missing: fixed link %s.local is off.", net["name"])
        return
    ip = local_ip()
    info = ServiceInfo(
        "_http._tcp.local.",
        f"Controle Web ({net['name']})._http._tcp.local.",
        addresses=[socket.inet_aton(ip)],
        port=app[PORT],
        server=f"{net['name']}.local.",
    )
    try:
        zc = AsyncZeroconf()
        await zc.async_register_service(info, allow_name_change=True)
    except Exception as exc:
        log.warning("Could not announce %s.local: %s", net["name"], exc)
        return
    net.update(zc=zc, info=info, mdns_ip=ip)
    log.info("Fixed link: http://%s.local:%d", net["name"], app[PORT])


async def update_mdns(app):
    net = app[NET]
    ip = local_ip()
    if "zc" not in net or net.get("mdns_ip") == ip:
        return
    net["info"].addresses = [socket.inet_aton(ip)]
    net["mdns_ip"] = ip
    await net["zc"].async_update_service(net["info"])
    log.info("IP changed: %s.local now points to %s", net["name"], ip)


async def stop_mdns(app):
    net = app[NET]
    if "zc" in net:
        await net["zc"].async_unregister_service(net["info"])
        await net["zc"].async_close()


# ---------- Ciclo de vida ----------
def refresh_extra(app):
    port = app[PORT]
    net = app[NET]
    ip = local_ip()
    hub = app[HUB]
    links = {"ip": f"http://{ip}:{port}"}
    if "zc" in net:
        links["fixed"] = f"http://{net['name']}.local:{port}"
    if net.get("https_port"):
        links["https"] = f"https://{ip}:{net['https_port']}"
    pin = app[PIN]["value"]
    if hub.extra_state.get("links") != links or hub.extra_state.get("pin") != pin:
        hub.extra_state["links"] = links
        hub.extra_state["pin"] = pin
        hub.extra_state["qrs"] = {k: qr_svg(with_pin(v, app)) for k, v in links.items()}
        hub.extra_state["url"] = links["ip"]
    ports = [port] + ([net["https_port"]] if net.get("https_port") else [])
    hub.extra_state["firewall"] = all(firewall_status(p, ip) is not False for p in ports) if firewall_status(port, ip) is not None else None
    hub.extra_state["lan_ip"] = ip
    lan = ipaddress.ip_network(f"{ip}/24", strict=False)
    port_spec = f"port {port}" if len(ports) == 1 else f"port {','.join(map(str, ports))}"
    hub.extra_state["firewall_cmd"] = f"sudo ufw allow from {lan} to any {port_spec} proto tcp"
    hub.extra_state["port"] = port
    hub.extra_state["platform"] = sys.platform


async def housekeeping_extra(app):
    refresh_extra(app)
    try:
        await update_mdns(app)
    except Exception as exc:
        log.warning("Failed to update mDNS: %s", exc)


async def on_startup(app):
    hub = app[HUB]
    await start_mdns(app)
    refresh_extra(app)
    sync_screen_state(app)
    hub.pad(1)  # cria o JOYSTICK-1 já na abertura e detecta problema de driver/permissão
    app[TASKS].append(asyncio.create_task(hub.admin_loop()))
    app[TASKS].append(asyncio.create_task(hub.housekeeping_loop(lambda: asyncio.create_task(housekeeping_extra(app)))))


async def on_shutdown(app):
    hub = app[HUB]
    for ws in list(hub.admins):
        await ws.close(code=1001, message=b"shutdown")
    for p in list(hub.players.values()):
        if p.online:
            await p.ws.close(code=1001, message=b"shutdown")
    for t in app[TASKS]:
        t.cancel()
    await app[SCREEN].stop()
    await stop_mdns(app)


async def on_cleanup(app):
    app[HUB].close_pads()


async def run_server(app, host, port, https_port, ssl_ctx):
    runner = web.AppRunner(app, handle_signals=True)
    await runner.setup()
    try:
        await web.TCPSite(runner, host, port).start()
        if ssl_ctx:
            try:
                await web.TCPSite(runner, host, https_port, ssl_context=ssl_ctx).start()
            except OSError as exc:
                log.warning("HTTPS on port %d unavailable: %s", https_port, exc)
                app[NET]["https_port"] = None
                refresh_extra(app)
        await app[STOP].wait()
    finally:
        await runner.cleanup()


def main():
    parser = argparse.ArgumentParser(description="Web Controller: phones as Xbox 360 gamepads")
    parser.add_argument("--port", type=int, default=int(os.environ.get("CONTROLE_WEB_PORT", "8080")))
    parser.add_argument("--https-port", type=int, default=int(os.environ.get("CONTROLE_WEB_HTTPS_PORT", "8443")),
                        help="HTTPS port for the gyroscope (0 turns it off)")
    parser.add_argument("--name", default=os.environ.get("CONTROLE_WEB_NAME", "controle"),
                        help="network name: http://NAME.local")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--max-players", type=int, default=4)
    parser.add_argument("--screen-width", type=int, help="width of the image sent to the phone (default 1920; the panel also adjusts it)")
    parser.add_argument("--screen-fps", type=int, help="frames per second of the stream (default 60)")
    parser.add_argument("--screen-quality", type=int, help="JPEG quality: 2 (best) to 31 (worst) (default 6)")
    parser.add_argument("--screen-monitor", default=None, help="monitor to stream (e.g. eDP-1); default: the first one")
    parser.add_argument("--no-pin", action="store_true", help="do not ask for a PIN (trusted networks only)")
    parser.add_argument("--dry-run", action="store_true", help="do not create virtual controllers, only log")
    parser.add_argument("--verbose", action="store_true", help="also log analog stick movement")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
    )
    logging.getLogger("aiohttp.access").setLevel(logging.WARNING)

    ip = local_ip()
    ssl_ctx = None
    if args.https_port:
        ssl_ctx = make_ssl_context(ip, [f"{args.name}.local", "localhost", f"{socket.gethostname()}.local"])

    app = web.Application()
    app[HUB] = Hub(dry_run=args.dry_run, max_players=args.max_players)
    app[PORT] = args.port
    app[PIN] = {"value": None if args.no_pin else load_pin(), "fails": {}}
    cfg = {**SCREEN_DEFAULTS, **load_screen_config()}
    cfg.update({k: v for k, v in (("width", args.screen_width), ("fps", args.screen_fps), ("quality", args.screen_quality)) if v})
    app[SCREEN] = Screen(width=cfg["width"], fps=cfg["fps"], quality=cfg["quality"],
                         monitor=args.screen_monitor, on_change=lambda: sync_screen_state(app))
    app[TASKS] = []
    app[STOP] = asyncio.Event()
    app[NET] = {"name": args.name, "https_port": args.https_port if ssl_ctx else None}
    app.on_startup.append(on_startup)
    app.on_shutdown.append(on_shutdown)
    app.on_cleanup.append(on_cleanup)

    app.router.add_get("/", index)
    app.router.add_get("/ws", ws_player)
    app.router.add_get("/screen", ws_screen)
    app.router.add_get("/api/ping", ping)
    app.router.add_get("/admin", admin_page)
    app.router.add_get("/admin/ws", ws_admin)
    app.router.add_get("/admin/{name}", admin_static)
    app.router.add_static("/", PUBLIC_DIR)

    url = f"http://{ip}:{args.port}"
    print()
    print("=" * 60)
    print("  Web Controller is running!")
    print(f"  Phones (same Wi-Fi):     {url}")
    print(f"  Fixed link:              http://{args.name}.local:{args.port}")
    if ssl_ctx:
        print(f"  With gyroscope (HTTPS):  https://{ip}:{args.https_port}")
    print(f"  Panel (this PC):         http://localhost:{args.port}/admin")
    print(f"  Phone PIN:               {app[PIN]['value'] or 'off (--no-pin)'}")
    print("=" * 60)
    print_qr(with_pin(url, app))
    try:
        asyncio.run(run_server(app, args.host, args.port, args.https_port, ssl_ctx))
    except (web.GracefulExit, KeyboardInterrupt):
        pass


if __name__ == "__main__":
    main()
