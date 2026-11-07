# Web Controller — turn phones into Xbox 360 gamepads on your PC

[English](README.md) · [Português (Brasil)](README.pt-BR.md)

Use your smartphone's screen (in the browser, on the same Wi-Fi) as a gamepad to
play emulators such as **PCSX2** and **PPSSPP** on Windows or Linux.
Several phones at once: each one becomes **JOYSTICK-1, 2, 3...**

A Python server creates a **virtual Xbox 360 controller** (through the
**ViGEmBus** driver on Windows, or the kernel's `uinput` on Linux). To the
operating system and the emulator it looks exactly like a physical controller.

```
Phone (browser)  --WebSocket/Wi-Fi-->  server.py  --vgamepad/uinput-->  Virtual Xbox 360  -->  Emulator
```

**Features:** multi-touch gamepad · customizable HUD with profiles per game
(position, size, opacity, invisible-but-working buttons) · right stick · floating stick ·
gyroscope steering · game rumble on the phone · optional live PC screen as the
controller background · PIN protection · admin panel with QR code · fixed
`controle.local` link.

## Structure

```
controle-web     # launcher: starts the server (if needed) and opens the panel
server/
  server.py      # HTTP + WebSockets (/ws phones, /screen video, /admin/ws panel), IP and QR code
  screen.py      # PC screen streaming (MJPEG) to the controller background
  hub.py         # JOYSTICK-N slots, reservations, panel commands
  gamepad.py     # virtual controller per slot (ViGEmBus, uinput, or log-only with --dry-run)
admin/           # panel (only opens at http://localhost on this PC)
public/
  index.html     # controller layout
  style.css
  i18n.js        # English and Portuguese texts (browser language, or ?lang=en|pt)
  app.js         # multi-touch, optimized sending, automatic reconnection
requirements.txt
```

## 1. Installation on Windows

### 1.1 Python
Install **Python 3.10 or newer** from <https://www.python.org/downloads/>.
In the installer, check **"Add python.exe to PATH"**.

### 1.2 ViGEmBus driver
1. Download the latest installer from
   <https://github.com/nefarius/ViGEmBus/releases>
   (`ViGEmBus_1.22.0_x64_x86_arm64.exe` or newer).
2. Run it and finish the installation.
3. Restart the computer.

> Running `pip install vgamepad` on Windows may also launch the ViGEmBus
> installer automatically. If it is already installed, just close it.

### 1.3 Project dependencies
Open PowerShell in the project folder:

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## 2. Run

```powershell
python server/server.py
```

The terminal shows the address (e.g. `http://192.168.0.15:8080`), a 6-digit **PIN**
and a **QR code**. Scanning the QR code joins right away (it carries the PIN); if you
open the link by hand, the phone asks for the PIN once. The PIN is also shown in the
panel, with a **New PIN** button.

> **Security:** only use this on networks you trust. Without the PIN, any device on the
> same Wi-Fi would become a controller (and, with PC Screen on, could see your screen).
> The PIN locks a device out for 5 minutes after 5 wrong attempts. Traffic is not
> encrypted (HTTP), so do not use it on public Wi-Fi.

Options:

| Option | Effect |
|--------|--------|
| `--port N` | Changes the port (default `8080`, or `CONTROLE_WEB_PORT`) |
| `--https-port N` | HTTPS port for the gyroscope (default `8443`; `0` turns it off) |
| `--name NAME` | Fixed link `http://NAME.local` (default `controle`) |
| `--max-players N` | Initial number of controllers (default 4, max 8; changeable in the panel) |
| `--screen-width N`, `--screen-fps N`, `--screen-quality N`, `--screen-monitor NAME` | Width (default 1920), fps (60), JPEG quality 2–31 (6) and monitor of the screen stream. The panel also adjusts them and saves to `~/.controle-web/screen.json` |
| `--no-pin` | Do not ask for a PIN (trusted networks only) |
| `--dry-run` | Do not create the virtual controller; only log the inputs |
| `--verbose` | Also log analog stick movement |

### Firewall
On first run Windows asks whether Python may access the network: allow it on
**Private networks**. Also make sure your Wi-Fi connection is set to the **Private**
profile (Settings → Network & Internet → Wi-Fi → properties).
On Linux with ufw, open both ports (the panel shows the command):
`sudo ufw allow from 192.168.0.0/24 to any port 8080,8443 proto tcp`.
The rule is per network: if you move to another network (e.g. `192.168.1.x`), the panel
warns you and shows the command for the new one.

### Links
The panel shows three links (with a QR code):

| Link | When to use |
|------|-------------|
| **Fixed link** `http://controle.local:8080` | Default. Does not change when the PC's IP changes, so the layout saved on the phone stays. iPhone and Android 12+. |
| **By IP** `http://192.168.x.x:8080` | Phones that can't open `.local`. |
| **With gyroscope** `https://192.168.x.x:8443` | To use the gyroscope (browsers only expose the sensor over HTTPS). The first time a certificate warning appears: **Advanced → Continue**. |

The HTTPS certificate is generated automatically in `~/.controle-web/`. Each link keeps
its own profiles on the phone (the browser separates them by address).

## 3. Connect the phone

1. Phone and PC on the **same Wi-Fi network**.
2. Scan the QR code (or type the address in Chrome/Safari).
3. Turn the phone to **landscape** and tap **⛶ Fullscreen**.
4. The indicator at the top shows the status and latency (round-trip ping).

To open it faster later, use "Add to home screen" in the browser.

## 3b. Panel and multiple players

Open **http://localhost:8080/admin** on the PC (it only works on this computer).
On Linux, the **Web Controller** app in the launcher starts the server and opens the
panel directly.

- **Access on/off:** when off, nobody can join and everyone connected is dropped.
  Phones keep waiting and rejoin by themselves when you turn it back on.
- **PC screen:** turns the screen stream on/off and sets resolution, FPS and quality.
- **PIN** with a **New PIN** button (disconnects the phones).
- **Link and QR code** to share with friends, with a copy button.
- **Controllers:** one card per JOYSTICK-N with the device, IP, ping, pressed buttons,
  both analog sticks and the game's rumble live (good for testing). You can name the
  player, **find** (their phone flashes in the JOYSTICK color and vibrates), **move** to
  another number (swaps with whoever is there) or **remove**.
- **Players:** how many controllers exist (1 to 8).
- **Warnings:** firewall blocking the port on the current network, or the virtual
  controller in test mode (no driver/permission), with the command to fix it.
- **Shut down server:** turns everything off (click twice).

Each phone stores an ID in the browser. If it drops, its number stays reserved for 60 s
and it returns to the same JOYSTICK. With a full room, a new phone takes the slot of
whoever dropped longest ago.

Virtual controllers are created in order (JOYSTICK-1 first) and stay until the server
shuts down, so the emulator does not lose its mapping.

### Launcher shortcut (Linux)

Create `~/.local/share/applications/controle-web.desktop` pointing to the launcher:

```ini
[Desktop Entry]
Type=Application
Name=Web Controller
Comment=Phones as game controllers to play with friends
Exec=/path/to/controle_celular_web/controle-web
Icon=input-gaming
Terminal=false
Categories=Game;Utility;
```

The server log is at `$XDG_RUNTIME_DIR/controle-web.log`.

## 4. Layout and mapping

| Screen (PlayStation) | Virtual controller (Xbox 360) |
|----------------------|-------------------------------|
| ✕ | A |
| ○ | B |
| □ | X |
| △ | Y |
| L1 / R1 | LB / RB |
| L2 / R2 | LT / RT (full trigger) |
| SELECT / START | Back / Start |
| D-pad | D-pad (with diagonals) |
| Left / right stick | Left / right stick |
| L3 / R3 (disabled by default) | Stick clicks |

Multi-touch: you can hold R1 (run) and press ✕/○/□ at the same time, and slide a finger
from one action button to another without lifting it.

### Settings on the phone (☰)

- **HUD profiles:** a layout and settings per game (e.g. "Racing", "Fighting").
  **+ New** copies the current profile. Everything is saved on the phone.
- **Edit HUD:** drag to move, pinch with two fingers (or − / +) to resize, **◐ − / +**
  for transparency (with no button selected it changes all of them at once),
  **Disable/Enable** buttons (L3/R3 start disabled) and **Invisible/Visible**: the
  button disappears from the screen but keeps working. While editing, a green border
  = shown on screen, red (and transparent) = invisible, dashed = disabled.
- **PC screen as background:** shows your computer's screen behind the controller.
  First turn on **PC screen** in the panel (it is off by default for security), then
  enable it in the phone's menu. On Linux/Wayland it uses `gpu-screen-recorder` +
  `ffmpeg` (both must be installed); on Windows it only needs `ffmpeg`. Exclusive
  fullscreen games may show up black: use windowed/borderless mode. The server sends at
  most 2 unacknowledged frames, so a slow network lowers the FPS instead of adding delay.
- **Floating stick:** the left stick appears wherever your finger touches the left side
  of the screen.
- **Vibration on press:** off, low, medium or strong, with a test button.
- **Game vibration:** the phone vibrates when the game rumbles the controller (Linux and
  Windows).
- **Gyroscope** (needs the HTTPS link): **Steering** drives the left stick by turning
  the phone; **Tilt** also uses forward/back. **Center** sets the neutral position;
  **Invert** flips the direction. **Turn for full range** (10° to 90°, default 28°) sets
  how far to turn for the stick to reach the end: lower = more sensitive. **Dead zone**
  (0° to 15°) is the rotation ignored near the center. Both are per profile. Touching
  the stick takes priority over the gyroscope.
- **Language:** the interface follows the browser language (English or Portuguese). Add
  `?lang=en` or `?lang=pt` to the address to force one.

## 5. Configure the emulator

Leave the server running **and the phone connected** before opening the emulator, so the
virtual controller already exists.

### PCSX2 (2.x)
1. **Settings → Controllers**.
2. **Controller Port 1** → type **DualShock 2**.
3. Click **Automatic Mapping** and choose **XInput-0** (or SDL-0 "Xbox 360 Controller").
4. Done: ✕ = Cross, ○ = Circle, □ = Square, △ = Triangle, L1/R1/L2/R2 the same.

### PPSSPP
1. **Settings → Controls → Control mapping**.
2. The XInput defaults usually already work. If not, click each action and press the
   matching button on the phone.
3. Analog: map **Analog up/down/left/right** to the left stick.

### Check that Windows sees the controller
Press `Win + R`, type `joy.cpl` and open "Controller (XBOX 360 For Windows)". The buttons
light up when you touch the phone.

## 5b. Linux

On Linux the virtual controller is created through the kernel's `uinput` (no ViGEmBus),
with the same IDs as an Xbox 360 controller (`xpad` driver). Steam, SDL, PCSX2, PPSSPP
and RetroArch recognize it normally.

```bash
python -m venv .venv
.venv/bin/pip install -r requirements.txt
```

By default only root can access `/dev/uinput`. Grant access to your user:

- **Temporary (until reboot):**
  ```bash
  sudo setfacl -m u:$USER:rw /dev/uinput
  ```
- **Permanent** (access for the user logged in on the local session):
  ```bash
  echo 'KERNEL=="uinput", SUBSYSTEM=="misc", TAG+="uaccess", OPTIONS+="static_node=uinput"' \
    | sudo tee /etc/udev/rules.d/60-uinput.rules
  ```
  and restart the computer.

> Warning: access to `uinput` lets programs running as your user simulate keyboard and
> mouse. Only grant it on a personal machine.

For the PC screen stream, install `ffmpeg` and `gpu-screen-recorder` (Wayland/Hyprland,
GPU-accelerated). On X11 without `gpu-screen-recorder`, `ffmpeg` alone (x11grab) is used.

Run `.venv/bin/python server/server.py`. The log should show
`virtual Xbox 360 controller created (uinput: /dev/input/eventN)`.

To check: open <https://hardwaretester.com/gamepad> in the PC's browser, or run
`.venv/bin/python -m evdev.evtest` and choose "Microsoft X-Box 360 pad".

## 6. Latency tips

- Prefer **5 GHz** Wi-Fi and, if possible, the PC connected to the router by cable.
- Turn off the phone's battery saver mode.
- Keep the page in the foreground (the app releases all buttons when it goes to the
  background, for safety).
- Typical latency on a good network: 5–20 ms round trip.
- With the PC screen on, lower the resolution/quality in the panel if the video lags.

## 7. Troubleshooting

| Problem | Fix |
|---------|-----|
| `Could not create the virtual controller` | ViGEmBus not installed, or the PC was not restarted after installing it. |
| Phone can't open the page | Firewall blocking (the panel shows the command for your current network); network marked as Public; or the router has "client isolation/AP isolation" on (turn it off or use another network). |
| Phone says "Enter the controller PIN" | Tap the message and type the PIN shown in the terminal/panel, or scan the QR code again. |
| Wrong IP in the QR code (VPN, several network cards) | Run `ipconfig` and use the IPv4 of the Wi-Fi/Ethernet adapter manually. |
| `address already in use` | Something else is using the port: `python server/server.py --port 8090`. |
| Status stays on "Reconnecting…" | Server closed or the phone changed network; the app reconnects by itself when it's back. |
| "Stuck" button | Impossible by design (disconnecting/backgrounding releases everything), but tapping and releasing the button fixes it. |
| Want to test without Windows | `python server/server.py --dry-run` (works on Linux/macOS, without `vgamepad`). |

## Protocol (for anyone who wants to extend it)

JSON text messages over the `/ws` WebSocket:

| Message | Meaning |
|---------|---------|
| `{"b":"A","s":1}` / `{"b":"A","s":0}` | Button pressed / released (`A B X Y LB RB LT RT START BACK UP DOWN LEFT RIGHT L3 R3`) |
| `{"a":"L","x":0.75,"y":-0.2}` | Analog stick `L` or `R`, values from -1 to 1 (positive y = down on screen) |
| `{"r":1}` | Release everything |
| `{"p":123.4,"rtt":12}` | Ping; the server echoes the same message and keeps the `rtt` for the panel |

Connection: `/ws?cid=<phone id>&dev=<device>&pin=<PIN>`. The server answers
`{"t":"hello","slot":N,"name":"..."}` and may later send `{"t":"slot","slot":N}` (moved)
or `{"t":"name","name":"..."}`. Close codes: `4000` opened in another tab, `4001` access
off, `4002` room full, `4003` removed from the panel, `4004` PIN missing/wrong, `4005`
device locked after too many wrong PINs.

The server also sends `{"t":"rumble","v":0.75,"ms":500}` (game rumble; null `ms` = until
`v:0` arrives) and `{"t":"find","slot":N}` (find controller). The `hello` carries
`"https"` with the secure link, if any, and `"screen"` (screen stream on). With the
stream on, `/screen?cid=...` delivers one JPEG frame per binary message; the phone
replies `"a"` for every frame received (the server sends at most 2 unacknowledged
frames, to avoid building up delay).

Optimizations: buttons are only sent when they change; the analog stick is grouped into
at most one packet per frame (`requestAnimationFrame`) with the latest value, and is held
back if the socket buffer exceeds 1 KB, avoiding a growing queue.

## License

MIT, see [LICENSE](LICENSE).
