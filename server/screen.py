"""Transmissão da tela do PC para o fundo do controle no celular.

Captura a tela, reduz e codifica em JPEG (MJPEG) e entrega cada quadro aos
celulares conectados. Só roda enquanto houver alguém assistindo.

- Linux (Wayland/Hyprland): gpu-screen-recorder captura e codifica H.264 na
  GPU; o ffmpeg decodifica e converte cada quadro em JPEG.
- Linux (X11) sem gpu-screen-recorder: ffmpeg x11grab.
- Windows: ffmpeg gdigrab.
"""

import asyncio
import logging
import os
import shutil
import signal
import subprocess
import sys

log = logging.getLogger("screen")

IDLE_STOP_SECONDS = 5  # sem espectadores: espera um pouco antes de parar a captura
RESTART_SECONDS = 2


def _alive(proc):
    return proc.poll() is None if isinstance(proc, subprocess.Popen) else proc.returncode is None


class Viewer:
    """Um celular assistindo. Guarda só o quadro mais recente: se a rede atrasar, pula quadros."""

    def __init__(self):
        self.frame = None
        self.event = asyncio.Event()

    def push(self, frame):
        self.frame = frame
        self.event.set()


class Screen:
    def __init__(self, width=1280, fps=60, quality=6, monitor=None, on_change=None):
        self.width = width
        self.fps = fps
        self.quality = quality  # -q:v do MJPEG: 2 (melhor) a 31 (pior)
        self.monitor = monitor
        self.on_change = on_change or (lambda: None)
        self.enabled = False
        self.error = None
        self.viewers = set()
        self._task = None
        self._idle = None
        self._procs = []

    # ---------- Estado ----------
    @property
    def available(self):
        return self._pipeline_kind() is not None

    def info(self):
        return {
            "enabled": self.enabled,
            "available": self.available,
            "viewers": len(self.viewers),
            "width": self.width,
            "fps": self.fps,
            "quality": self.quality,
            "error": self.error,
        }

    def _pipeline_kind(self):
        if not shutil.which("ffmpeg"):
            return None
        if sys.platform == "win32":
            return "gdigrab"
        if shutil.which("gpu-screen-recorder"):
            return "gsr"
        if os.environ.get("DISPLAY") and not os.environ.get("WAYLAND_DISPLAY"):
            return "x11grab"
        return None

    # ---------- Espectadores ----------
    def add(self):
        viewer = Viewer()
        self.viewers.add(viewer)
        if self._idle:
            self._idle.cancel()
            self._idle = None
        if self._task is None:
            self._task = asyncio.create_task(self._supervise())
        self.on_change()
        return viewer

    def remove(self, viewer):
        self.viewers.discard(viewer)
        if not self.viewers and self._task and self._idle is None:
            self._idle = asyncio.get_running_loop().call_later(IDLE_STOP_SECONDS, self._stop_if_idle)
        self.on_change()

    async def configure(self, width, fps, quality):
        """Muda resolução/fps/qualidade; se estiver transmitindo, reinicia a captura na hora."""
        self.width = max(320, min(3840, int(width))) // 2 * 2
        self.fps = max(10, min(120, int(fps)))
        self.quality = max(2, min(31, int(quality)))
        if self._task:
            await self.stop()
            if self.viewers:
                self._task = asyncio.create_task(self._supervise())
        self.on_change()

    def _stop_if_idle(self):
        self._idle = None
        if not self.viewers:
            asyncio.create_task(self.stop())

    async def stop(self):
        task, self._task = self._task, None
        if self._idle:
            self._idle.cancel()
            self._idle = None
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        await self._kill()
        self.on_change()

    # ---------- Captura ----------
    def _publish(self, frame):
        for viewer in self.viewers:
            viewer.push(frame)

    async def _supervise(self):
        """Mantém a captura de pé enquanto houver espectadores."""
        try:
            while True:
                got_frame = await self._capture_once()
                await self._kill()
                if not self.viewers:
                    return
                if not got_frame:
                    return  # falhou antes do primeiro quadro: não adianta insistir
                await asyncio.sleep(RESTART_SECONDS)
        finally:
            if self._task is asyncio.current_task():
                self._task = None
            self.on_change()

    async def _capture_once(self):
        try:
            ff = await self._spawn()
        except Exception as exc:
            self.error = f"Não foi possível iniciar a captura: {exc}"
            log.error(self.error)
            return False

        got_frame = False
        buf = bytearray()
        while True:
            chunk = await ff.stdout.read(65536)
            if not chunk:
                break
            buf += chunk
            # O JPEG do ffmpeg não tem miniatura: o primeiro FFD9 é sempre o fim do quadro.
            while (end := buf.find(b"\xff\xd9")) >= 0:
                frame = bytes(buf[: end + 2])
                del buf[: end + 2]
                if frame[:2] == b"\xff\xd8":
                    if not got_frame:
                        got_frame = True
                        self.error = None
                        self.on_change()
                    self._publish(frame)

        err = (await ff.stderr.read()).decode(errors="replace").strip().splitlines()
        if not got_frame:
            self.error = err[-1] if err else "A captura terminou sem enviar imagem."
            log.error("Captura de tela falhou: %s", self.error)
        return got_frame

    def _ffmpeg_out(self):
        return [
            "-vf", f"scale={self.width}:-2",
            "-c:v", "mjpeg", "-q:v", str(self.quality),
            "-fps_mode", "passthrough", "-f", "image2pipe", "-",
        ]

    async def _spawn(self):
        kind = self._pipeline_kind()
        base = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin"]
        fast_in = ["-fflags", "nobuffer", "-flags", "low_delay"]
        pipe = dict(stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)

        if kind == "gsr":
            monitor, size = self._pick_monitor()
            height = round(self.width * size[1] / size[0] / 2) * 2
            gsr = subprocess.Popen(
                ["gpu-screen-recorder", "-w", monitor, "-c", "mpegts", "-k", "h264",
                 "-f", str(self.fps), "-s", f"{self.width}x{height}", "-q", "very_high",
                 "-fm", "cfr", "-keyint", "0.5", "-a", "", "-o", "/dev/stdout"],
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            )
            self._procs.append(gsr)
            ff = await asyncio.create_subprocess_exec(
                *base, *fast_in, "-probesize", "5000", "-analyzeduration", "0",
                "-f", "mpegts", "-i", "-", *self._ffmpeg_out(), stdin=gsr.stdout, **pipe)
            gsr.stdout.close()
        elif kind == "gdigrab":
            ff = await asyncio.create_subprocess_exec(
                *base, "-f", "gdigrab", "-framerate", str(self.fps), "-i", "desktop",
                *self._ffmpeg_out(), stdin=asyncio.subprocess.DEVNULL, **pipe)
        else:
            ff = await asyncio.create_subprocess_exec(
                *base, "-f", "x11grab", "-framerate", str(self.fps), "-i", os.environ["DISPLAY"],
                *self._ffmpeg_out(), stdin=asyncio.subprocess.DEVNULL, **pipe)
        self._procs.append(ff)
        log.info("Transmissão da tela iniciada (%s, %d px, %d fps)", kind, self.width, self.fps)
        return ff

    def _pick_monitor(self):
        out = subprocess.run(["gpu-screen-recorder", "--list-monitors"],
                             capture_output=True, text=True, timeout=10).stdout
        monitors = {}
        for line in out.splitlines():
            name, _, size = line.partition("|")
            try:
                w, h = size.strip().split("x")
                monitors[name] = (int(w), int(h))
            except ValueError:
                continue
        if not monitors:
            raise RuntimeError("gpu-screen-recorder não encontrou nenhum monitor")
        name = self.monitor if self.monitor in monitors else next(iter(monitors))
        return name, monitors[name]

    async def _kill(self):
        procs, self._procs = self._procs, []
        for p in procs:
            if _alive(p):
                try:
                    # SIGINT deixa o gpu-screen-recorder liberar a GPU direito
                    p.send_signal(signal.SIGINT if sys.platform != "win32" else signal.SIGTERM)
                except ProcessLookupError:
                    pass
        for p in procs:
            try:
                if isinstance(p, subprocess.Popen):
                    await asyncio.wait_for(asyncio.to_thread(p.wait), 3)
                else:
                    await asyncio.wait_for(p.wait(), 3)
            except asyncio.TimeoutError:
                p.kill()
