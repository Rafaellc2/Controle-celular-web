"""Wrapper do controle virtual Xbox 360 (Windows: ViGEmBus via vgamepad; Linux: uinput).

Recebe mensagens já decodificadas do celular e aplica no gamepad
imediatamente, chamando update() a cada mudança para minimizar o lag.
"""

import logging
import sys

log = logging.getLogger("gamepad")

# Nome usado no protocolo -> nome do enum XUSB_BUTTON no vgamepad
BUTTON_NAMES = {
    "A": "XUSB_GAMEPAD_A",
    "B": "XUSB_GAMEPAD_B",
    "X": "XUSB_GAMEPAD_X",
    "Y": "XUSB_GAMEPAD_Y",
    "LB": "XUSB_GAMEPAD_LEFT_SHOULDER",
    "RB": "XUSB_GAMEPAD_RIGHT_SHOULDER",
    "START": "XUSB_GAMEPAD_START",
    "BACK": "XUSB_GAMEPAD_BACK",
    "UP": "XUSB_GAMEPAD_DPAD_UP",
    "DOWN": "XUSB_GAMEPAD_DPAD_DOWN",
    "LEFT": "XUSB_GAMEPAD_DPAD_LEFT",
    "RIGHT": "XUSB_GAMEPAD_DPAD_RIGHT",
    "L3": "XUSB_GAMEPAD_LEFT_THUMB",
    "R3": "XUSB_GAMEPAD_RIGHT_THUMB",
}
TRIGGERS = {"LT", "RT"}
STICKS = {"L", "R"}


def _clamp(v):
    v = float(v)
    if v != v:  # NaN
        return 0.0
    return -1.0 if v < -1.0 else 1.0 if v > 1.0 else v


class BaseGamepad:
    """Lógica comum: valida mensagens e despacha para os métodos de baixo nível."""

    def apply(self, msg):
        if "b" in msg:
            name = msg["b"]
            pressed = bool(msg.get("s"))
            if name in TRIGGERS:
                self._trigger(name, pressed)
            elif name in BUTTON_NAMES:
                self._button(name, pressed)
            else:
                return
        elif "a" in msg:
            stick = msg["a"]
            if stick not in STICKS:
                return
            # Tela: Y cresce para baixo. XInput: Y positivo é para cima.
            self._stick(stick, _clamp(msg.get("x", 0)), -_clamp(msg.get("y", 0)))
        elif "r" in msg:
            self.reset()
            return
        else:
            return
        self._update()

    def reset(self):
        self._reset()
        self._update()

    def close(self):
        pass


class VirtualGamepad(BaseGamepad):
    def __init__(self, slot):
        import vgamepad as vg

        self._vg = vg
        self.pad = vg.VX360Gamepad()
        self._buttons = {k: getattr(vg.XUSB_BUTTON, v) for k, v in BUTTON_NAMES.items()}
        log.info("JOYSTICK-%d: controle Xbox 360 virtual criado (ViGEmBus).", slot)

    def _button(self, name, pressed):
        if pressed:
            self.pad.press_button(button=self._buttons[name])
        else:
            self.pad.release_button(button=self._buttons[name])

    def _trigger(self, name, pressed):
        value = 255 if pressed else 0
        if name == "LT":
            self.pad.left_trigger(value=value)
        else:
            self.pad.right_trigger(value=value)

    def _stick(self, stick, x, y):
        if stick == "L":
            self.pad.left_joystick_float(x_value_float=x, y_value_float=y)
        else:
            self.pad.right_joystick_float(x_value_float=x, y_value_float=y)

    def _reset(self):
        self.pad.reset()

    def _update(self):
        self.pad.update()

    def close(self):
        del self.pad  # vgamepad remove o controle do ViGEmBus ao liberar o objeto


class LinuxGamepad(BaseGamepad):
    """Controle Xbox 360 virtual no Linux via /dev/uinput (python-evdev).

    Usa os mesmos IDs USB e códigos do driver xpad, então SDL, Steam,
    PCSX2, PPSSPP e RetroArch reconhecem como um controle de Xbox 360.
    """

    AXIS_MAX = 32767
    BUTTON_CODES = {
        "A": "BTN_A",
        "B": "BTN_B",
        "X": "BTN_X",
        "Y": "BTN_Y",
        "LB": "BTN_TL",
        "RB": "BTN_TR",
        "START": "BTN_START",
        "BACK": "BTN_SELECT",
        "L3": "BTN_THUMBL",
        "R3": "BTN_THUMBR",
    }
    DPAD = {"UP", "DOWN", "LEFT", "RIGHT"}

    def __init__(self, slot):
        from evdev import AbsInfo, UInput, ecodes as e

        self._e = e
        self._buttons = {k: getattr(e, v) for k, v in self.BUTTON_CODES.items()}
        stick = AbsInfo(value=0, min=-32768, max=32767, fuzz=16, flat=128, resolution=0)
        trigger = AbsInfo(value=0, min=0, max=255, fuzz=0, flat=0, resolution=0)
        hat = AbsInfo(value=0, min=-1, max=1, fuzz=0, flat=0, resolution=0)
        caps = {
            e.EV_KEY: list(self._buttons.values()) + [e.BTN_MODE],
            e.EV_ABS: [
                (e.ABS_X, stick), (e.ABS_Y, stick),
                (e.ABS_RX, stick), (e.ABS_RY, stick),
                (e.ABS_Z, trigger), (e.ABS_RZ, trigger),
                (e.ABS_HAT0X, hat), (e.ABS_HAT0Y, hat),
            ],
        }
        self.dev = UInput(
            caps,
            name="Microsoft X-Box 360 pad",
            vendor=0x045E,
            product=0x028E,
            version=0x110,
            bustype=e.BUS_USB,
            phys=f"controle-web/joystick{slot}",
        )
        self._dpad = set()
        log.info("JOYSTICK-%d: controle Xbox 360 virtual criado (uinput: %s).", slot, self.dev.device.path)

    def _button(self, name, pressed):
        if name in self.DPAD:
            if pressed:
                self._dpad.add(name)
            else:
                self._dpad.discard(name)
            e = self._e
            hx = ("RIGHT" in self._dpad) - ("LEFT" in self._dpad)
            hy = ("DOWN" in self._dpad) - ("UP" in self._dpad)
            self.dev.write(e.EV_ABS, e.ABS_HAT0X, hx)
            self.dev.write(e.EV_ABS, e.ABS_HAT0Y, hy)
        else:
            self.dev.write(self._e.EV_KEY, self._buttons[name], int(pressed))

    def _trigger(self, name, pressed):
        code = self._e.ABS_Z if name == "LT" else self._e.ABS_RZ
        self.dev.write(self._e.EV_ABS, code, 255 if pressed else 0)

    def _stick(self, stick, x, y):
        e = self._e
        ax, ay = (e.ABS_X, e.ABS_Y) if stick == "L" else (e.ABS_RX, e.ABS_RY)
        # evdev usa Y positivo para baixo: desfaz a inversão feita para o XInput
        self.dev.write(e.EV_ABS, ax, int(x * self.AXIS_MAX))
        self.dev.write(e.EV_ABS, ay, int(-y * self.AXIS_MAX))

    def _reset(self):
        e = self._e
        for code in self._buttons.values():
            self.dev.write(e.EV_KEY, code, 0)
        for code in (e.ABS_X, e.ABS_Y, e.ABS_RX, e.ABS_RY, e.ABS_Z, e.ABS_RZ, e.ABS_HAT0X, e.ABS_HAT0Y):
            self.dev.write(e.EV_ABS, code, 0)
        self._dpad.clear()

    def _update(self):
        self.dev.syn()

    def close(self):
        self.dev.close()


class DummyGamepad(BaseGamepad):
    """Usado com --dry-run ou sem ViGEmBus/uinput: só registra as entradas no log."""

    def __init__(self, slot):
        self.tag = f"J{slot}"

    def _button(self, name, pressed):
        log.info("%s botão %-5s %s", self.tag, name, "DOWN" if pressed else "up")

    def _trigger(self, name, pressed):
        log.info("%s gatilho %-3s %s", self.tag, name, "DOWN" if pressed else "up")

    def _stick(self, stick, x, y):
        log.debug("%s stick %s x=%+.2f y=%+.2f", self.tag, stick, x, y)

    def _reset(self):
        log.info("%s reset (tudo solto)", self.tag)

    def _update(self):
        pass


def backend_name():
    return "uinput" if sys.platform.startswith("linux") else "ViGEmBus"


def create_gamepad(slot, dry_run=False):
    """Cria o controle virtual do slot. Levanta exceção se o backend falhar
    (vgamepad/evdev ausente, ViGEmBus não instalado, sem permissão no uinput)."""
    if dry_run:
        return DummyGamepad(slot)
    if sys.platform.startswith("linux"):
        return LinuxGamepad(slot)
    return VirtualGamepad(slot)
