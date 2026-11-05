(() => {
  "use strict";

  // ---------- Configuração ----------
  const STICK_DEADZONE = 0.1;      // fração do raio ignorada no centro
  const STICK_EPSILON = 0.01;      // variação mínima para reenviar o analógico
  const DPAD_DEADZONE = 0.2;       // fração do raio do D-pad sem direção
  const MAX_BUFFERED = 1024;       // bytes na fila do socket antes de segurar o analógico
  const PING_INTERVAL = 2000;
  const PING_TIMEOUT = 5000;       // sem resposta → considera conexão morta
  const RECONNECT_MIN = 250;
  const RECONNECT_MAX = 2000;
  const RETRY_BLOCKED = 3000;      // acesso desligado / sala cheia: tenta de novo neste intervalo
  const TAP_SLOP = 12;             // px que o dedo pode andar e ainda contar como toque num botão do menu
  // Cor de cada JOYSTICK-N (mesma ordem do painel)
  const SLOT_COLORS = ["#7fa8ff", "#ff6b6b", "#4fd1a5", "#e58cff", "#ffb547", "#5ad7e6", "#ff9a5a", "#b49cff"];

  // Layout padrão do HUD: centro do item em % da tela (x, y), escala (s) e se começa oculto
  const DEFAULT_LAYOUT = {
    LT: { x: 10, y: 12, s: 1 },
    LB: { x: 27, y: 12, s: 1 },
    RB: { x: 73, y: 12, s: 1 },
    RT: { x: 90, y: 12, s: 1 },
    DPAD: { x: 17, y: 42, s: 1 },
    STICK: { x: 30, y: 74, s: 1 },
    RSTICK: { x: 64, y: 80, s: 0.75 },
    BACK: { x: 42, y: 30, s: 1 },
    START: { x: 58, y: 30, s: 1 },
    L3: { x: 44, y: 60, s: 0.6, hidden: true },
    R3: { x: 56, y: 60, s: 0.6, hidden: true },
    Y: { x: 83, y: 32, s: 1 },
    X: { x: 72, y: 52, s: 1 },
    B: { x: 94, y: 52, s: 1 },
    A: { x: 83, y: 72, s: 1 },
  };
  const ITEM_NAMES = {
    LT: "L2", LB: "L1", RB: "R1", RT: "R2", DPAD: "Direcional",
    STICK: "Analógico esquerdo", RSTICK: "Analógico direito",
    BACK: "SELECT", START: "START", L3: "L3", R3: "R3",
    Y: "△ Triângulo", X: "□ Quadrado", B: "○ Círculo", A: "✕ Xis",
  };
  const SCALE_MIN = 0.4;
  const SCALE_MAX = 2.2;
  const PROFILES_KEY = "controle-perfis-v1";
  const OLD_LAYOUT_KEY = "controle-hud-v1"; // versão antiga: um layout só

  // Vibração por nível: desligada, fraca, média, forte (ms)
  const VIBRA_MS = [0, 15, 30, 55];
  const VIBRA_KEY = "controle-vibra";
  const GAME_VIBRA_KEY = "controle-vibra-jogo";

  // Giroscópio: ângulo (graus) para o analógico ir até o fim
  const GYRO_STEER_MAX = 28;
  const GYRO_TILT_MAX = 22;
  const GYRO_DEADZONE = 2;

  // ---------- Armazenamento local (pode falhar em aba anônima) ----------
  function load(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, value); } catch { /* sem armazenamento: vale só nesta sessão */ }
  }

  // ---------- Elementos ----------
  const $ = (sel) => document.querySelector(sel);
  const statusEl = $("#status");
  const statusText = $("#status-text");
  const slotEl = $("#slot");
  const noticeEl = $("#notice");
  const menuEl = $("#menu");
  const editbarEl = $("#editbar");
  const findEl = $("#find");
  const dpadEl = $("#dpad");
  const hapticEl = $("#haptic");

  const items = {};
  document.querySelectorAll("[data-item]").forEach((el) => { items[el.dataset.item] = el; });
  const buttonEls = {};
  document.querySelectorAll("[data-btn]").forEach((el) => { buttonEls[el.dataset.btn] = el; });
  const dpadArms = {};
  dpadEl.querySelectorAll("[data-dir]").forEach((el) => { dpadArms[el.dataset.dir] = el; });

  // ---------- Identidade do celular ----------
  // ID guardado no aparelho para voltar ao mesmo JOYSTICK-N ao reconectar.
  function clientId() {
    let id = load("controle-cid");
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      save("controle-cid", id);
    }
    return id;
  }

  function deviceName() {
    const ua = navigator.userAgent;
    const android = ua.match(/Android [\d.]+; ([^;)]+?)(?: Build|\))/);
    if (android && android[1] !== "K") return android[1].trim();
    if (/iPhone/.test(ua)) return "iPhone";
    if (/iPad/.test(ua)) return "iPad";
    if (/Android/.test(ua)) return "Android";
    return "Navegador";
  }

  const CID = clientId();
  const DEVICE = deviceName();
  const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function copy(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // ---------- Perfis (layout + ajustes por jogo) ----------
  // { active: "Padrão", list: { "Padrão": { layout, floating, gyro, gyroInvert } } }
  function normalizeLayout(saved) {
    const layout = copy(DEFAULT_LAYOUT);
    if (!saved || typeof saved !== "object") return layout;
    for (const id of Object.keys(layout)) {
      const it = saved[id];
      if (!it) continue;
      if (Number.isFinite(it.x)) layout[id].x = clamp(it.x, 0, 100);
      if (Number.isFinite(it.y)) layout[id].y = clamp(it.y, 0, 100);
      if (Number.isFinite(it.s)) layout[id].s = clamp(it.s, SCALE_MIN, SCALE_MAX);
      if ("hidden" in it) layout[id].hidden = Boolean(it.hidden);
    }
    return layout;
  }

  function newProfile(layout) {
    return { layout: normalizeLayout(layout), floating: false, gyro: "off", gyroInvert: false };
  }

  function loadProfiles() {
    let data = null;
    try { data = JSON.parse(load(PROFILES_KEY) || "null"); } catch { data = null; }
    if (!data || typeof data.list !== "object" || !Object.keys(data.list).length) {
      // Primeira vez (ou vindo da versão com um layout só)
      let old = null;
      try { old = JSON.parse(load(OLD_LAYOUT_KEY) || "null"); } catch { old = null; }
      data = { active: "Padrão", list: { "Padrão": newProfile(old) } };
    }
    for (const [name, p] of Object.entries(data.list)) {
      data.list[name] = {
        layout: normalizeLayout(p.layout),
        floating: Boolean(p.floating),
        gyro: ["off", "steer", "tilt"].includes(p.gyro) ? p.gyro : "off",
        gyroInvert: Boolean(p.gyroInvert),
      };
    }
    if (!data.list[data.active]) data.active = Object.keys(data.list)[0];
    return data;
  }

  const profiles = loadProfiles();
  const prof = () => profiles.list[profiles.active];

  function saveProfiles() {
    save(PROFILES_KEY, JSON.stringify(profiles));
  }

  function applyItem(id, it) {
    const el = items[id];
    el.style.setProperty("--x", it.x);
    el.style.setProperty("--y", it.y);
    el.style.setProperty("--s", it.s);
    el.classList.toggle("is-hidden", Boolean(it.hidden));
  }

  function applyLayout(layout) {
    for (const id of Object.keys(items)) applyItem(id, layout[id]);
  }

  applyLayout(prof().layout);

  // ---------- Vibração ----------
  let vibraLevel = Number(load(VIBRA_KEY) ?? 2);
  if (!(vibraLevel in VIBRA_MS)) vibraLevel = 2;
  let gameVibra = load(GAME_VIBRA_KEY) !== "0";
  const canVibrate = typeof navigator.vibrate === "function";
  let rumbleTimer = null;

  function haptic() {
    if (!vibraLevel) return;
    if (canVibrate) {
      navigator.vibrate(VIBRA_MS[vibraLevel]);
    } else if (IS_IOS) {
      hapticEl.click(); // Safari 18+: alternar um <input switch> dá um toque háptico
    }
  }

  // Vibração pedida pelo jogo. O motor do celular só liga/desliga, então a
  // força vira um padrão liga/desliga (quanto mais forte, menos pausas).
  function playRumble(v, ms) {
    clearTimeout(rumbleTimer);
    if (!gameVibra) return;
    if (!canVibrate) {
      if (IS_IOS && v > 0.05) hapticEl.click();
      return;
    }
    if (!(v > 0.05)) {
      navigator.vibrate(0);
      return;
    }
    const total = ms || 1000;
    const on = 25;
    const off = Math.round((on * (1 - v)) / Math.max(v, 0.15));
    let pattern = [total];
    if (off >= 5) {
      pattern = [];
      for (let t = 0; t < total; t += on + off) pattern.push(on, off);
    }
    navigator.vibrate(pattern);
    // Sem duração (ViGEmBus manda só o estado dos motores): renova até o jogo mandar parar.
    if (!ms) rumbleTimer = setTimeout(() => playRumble(v, null), 900);
  }

  // Diagnóstico: diz se o bloqueio é do navegador ou do celular
  function testVibra() {
    const note = $("#vibra-note");
    if (!canVibrate) {
      if (IS_IOS) {
        hapticEl.click();
        note.textContent = "iPhone: o Safari não tem vibração para sites. Tentei o truque do iOS 18; se não sentiu, não há como vibrar.";
      } else {
        note.textContent = "Este navegador não tem vibração para sites. Use o Chrome ou o Samsung Internet.";
      }
      return;
    }
    const ok = navigator.vibrate([80, 60, 80]);
    note.textContent = ok
      ? "Pedido de vibração aceito pelo navegador. Se não sentiu, o celular está bloqueando: desative o modo silencioso/Não perturbe e ligue \"Vibração ao tocar\" (Configurações → Sons e vibração)."
      : "O navegador recusou a vibração. Toque em qualquer lugar da tela uma vez e teste de novo.";
  }

  // ---------- WebSocket ----------
  let ws = null;
  let reconnectDelay = RECONNECT_MIN;
  let reconnectTimer = null;
  let pingTimer = null;
  let lastPong = 0;
  let lastRtt = null;
  let playerName = "";
  let currentSlot = null;
  let httpsUrl = null;
  let stopped = false; // true quando removido ou aberto em outra aba: só volta com toque

  function isOpen() {
    return ws !== null && ws.readyState === WebSocket.OPEN;
  }

  function send(obj) {
    if (isOpen()) ws.send(JSON.stringify(obj));
  }

  function setStatus(cls, text) {
    statusEl.className = "status " + cls;
    statusText.textContent = text;
  }

  function slotColor(slot) {
    return SLOT_COLORS[(slot - 1) % SLOT_COLORS.length];
  }

  function setSlot(slot) {
    currentSlot = slot;
    slotEl.textContent = slot ? `J${slot}` : "J?";
    statusEl.style.setProperty("--slot-color", slot ? slotColor(slot) : "");
    document.title = slot ? `JOYSTICK-${slot}` : "Web Controller";
  }

  function showNotice(title, hint) {
    $("#notice-title").textContent = title;
    $("#notice-hint").textContent = hint;
    noticeEl.classList.remove("hidden");
  }

  function hideNotice() {
    noticeEl.classList.add("hidden");
  }

  // Painel do PC pediu "achar controle": pisca a cor do slot e vibra
  let findTimer = null;
  function showFind(slot) {
    findEl.style.setProperty("--find-color", slotColor(slot));
    $("#find-label").textContent = `JOYSTICK-${slot}`;
    findEl.classList.remove("hidden");
    // Reinicia a animação de piscar
    findEl.style.animation = "none";
    void findEl.offsetWidth;
    findEl.style.animation = "";
    if (canVibrate) navigator.vibrate([200, 100, 200, 100, 400]);
    else if (IS_IOS) hapticEl.click();
    clearTimeout(findTimer);
    findTimer = setTimeout(() => findEl.classList.add("hidden"), 2600);
  }

  function connect() {
    clearTimeout(reconnectTimer);
    if (stopped || (ws && ws.readyState <= WebSocket.OPEN)) return;

    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const query = `cid=${encodeURIComponent(CID)}&dev=${encodeURIComponent(DEVICE)}`;
    const sock = new WebSocket(`${proto}//${location.host}/ws?${query}`);
    ws = sock;
    setStatus("off", "Conectando…");

    sock.onopen = () => {
      lastPong = performance.now();
      clearInterval(pingTimer);
      pingTimer = setInterval(ping, PING_INTERVAL);
    };

    sock.onmessage = (ev) => {
      let data;
      try { data = JSON.parse(ev.data); } catch { return; }
      if (typeof data.p === "number") {
        lastPong = performance.now();
        lastRtt = Math.round(lastPong - data.p);
        const label = playerName ? `${playerName} · ${lastRtt} ms` : `${lastRtt} ms`;
        setStatus(lastRtt > 60 ? "slow" : "on", label);
      } else if (data.t === "hello") {
        // Aceito pelo servidor: zera o controle no PC e reenvia o que está pressionado.
        reconnectDelay = RECONNECT_MIN;
        playerName = data.name || "";
        httpsUrl = data.https || null;
        setSlot(data.slot);
        hideNotice();
        setStatus("on", playerName || "Conectado");
        sendSnapshot();
      } else if (data.t === "slot") {
        setSlot(data.slot);
        haptic();
      } else if (data.t === "name") {
        playerName = data.name || "";
      } else if (data.t === "rumble") {
        playRumble(Number(data.v) || 0, data.ms || null);
      } else if (data.t === "find") {
        showFind(data.slot || currentSlot || 1);
      }
    };

    sock.onclose = (ev) => {
      if (ws !== sock) return;
      clearInterval(pingTimer);
      ws = null;
      playRumble(0);
      setSlot(null);
      setStatus("off", "Desconectado");

      if (ev.code === 4000 || ev.code === 4003) {
        // Não reconecta sozinho: evita duas abas brigando ou voltar depois de removido.
        stopped = true;
        releaseAll();
        if (ev.code === 4000) showNotice("Este controle foi aberto em outra aba ou janela.", "Toque para usar aqui");
        else showNotice("Você foi removido pelo anfitrião.", "Toque para entrar de novo");
        return;
      }
      if (ev.code === 4001 || ev.code === 4002) {
        releaseAll();
        if (ev.code === 4001) showNotice("O anfitrião desligou o acesso aos controles.", "Aguardando liberar…");
        else showNotice("Todos os controles estão em uso.", "Aguardando uma vaga…");
        reconnectTimer = setTimeout(connect, RETRY_BLOCKED);
        return;
      }
      setStatus("off", "Reconectando…");
      reconnectTimer = setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX);
    };

    sock.onerror = () => sock.close();
  }

  function ping() {
    if (!isOpen()) return;
    if (performance.now() - lastPong > PING_TIMEOUT) {
      // Socket "pendurado" (comum ao trocar de rede no celular): força reconexão.
      ws.close();
      return;
    }
    send({ p: performance.now(), rtt: lastRtt });
  }

  // Ao (re)conectar: zera o controle no PC e reenvia o que está pressionado agora.
  function sendSnapshot() {
    send({ r: 1 });
    for (const name of sent) send({ b: name, s: 1 });
    for (const st of Object.values(sticks)) {
      if (st.x !== 0 || st.y !== 0) send({ a: st.id, x: st.x, y: st.y });
      st.sentX = st.x;
      st.sentY = st.y;
    }
  }

  // ---------- Estado de entrada ----------
  // touchId -> { kind: "btn", btn } | { kind: "dpad", dirs: [] } | { kind: "stick", id }
  //          | { kind: "ui", action, x, y } | { kind: "edit" }
  const touches = new Map();
  const sent = new Set(); // botões que o PC acredita estarem pressionados

  // Recalcula o conjunto de botões pressionados e envia só as diferenças.
  function syncButtons() {
    const want = new Set();
    for (const t of touches.values()) {
      if (t.kind === "btn" && t.btn) want.add(t.btn);
      else if (t.kind === "dpad") t.dirs.forEach((d) => want.add(d));
    }

    for (const name of sent) {
      if (!want.has(name)) {
        sent.delete(name);
        setPressedVisual(name, false);
        send({ b: name, s: 0 });
      }
    }
    let pressedNew = false;
    for (const name of want) {
      if (!sent.has(name)) {
        sent.add(name);
        setPressedVisual(name, true);
        send({ b: name, s: 1 });
        pressedNew = true;
      }
    }
    if (pressedNew) haptic();
  }

  function setPressedVisual(name, on) {
    const el = buttonEls[name] || dpadArms[name];
    if (el) el.classList.toggle("pressed", on);
  }

  function buttonAt(x, y) {
    const el = document.elementFromPoint(x, y);
    const btn = el && el.closest("[data-btn]");
    return btn ? btn.dataset.btn : null;
  }

  function dpadDirs(x, y) {
    const r = dpadEl.getBoundingClientRect();
    const half = r.width / 2;
    const dx = x - (r.left + half);
    const dy = y - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < half * DPAD_DEADZONE) return [];
    // 8 setores de 45°, começando em "direita"
    const angle = Math.atan2(dy, dx);
    const sector = (Math.round(angle / (Math.PI / 4)) + 8) % 8;
    return [
      ["RIGHT"], ["RIGHT", "DOWN"], ["DOWN"], ["DOWN", "LEFT"],
      ["LEFT"], ["LEFT", "UP"], ["UP"], ["UP", "RIGHT"],
    ][sector];
  }

  // ---------- Analógicos ----------
  function makeStick(id, item) {
    const el = items[item];
    return {
      id, item, el, knob: el.querySelector(".knob"),
      touchId: null, cx: 0, cy: 0, radius: 1, floating: false,
      x: 0, y: 0, sentX: 0, sentY: 0, frame: 0,
    };
  }
  const sticks = { L: makeStick("L", "STICK"), R: makeStick("R", "RSTICK") };

  function stickStart(st, touch, floatingAt) {
    if (floatingAt) {
      // Flutuante: o analógico vai para onde o dedo encostou
      st.floating = true;
      st.el.classList.add("floating");
      st.el.style.setProperty("--x", (floatingAt.x / innerWidth) * 100);
      st.el.style.setProperty("--y", (floatingAt.y / innerHeight) * 100);
    }
    const r = st.el.getBoundingClientRect();
    st.touchId = touch.identifier;
    st.cx = r.left + r.width / 2;
    st.cy = r.top + r.height / 2;
    st.radius = r.width / 2;
    st.el.classList.add("active");
    stickMove(st, touch);
  }

  function stickMove(st, touch) {
    let dx = (touch.clientX - st.cx) / st.radius;
    let dy = (touch.clientY - st.cy) / st.radius;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }

    // Knob segue o dedo (limitado à borda). Usa o tamanho sem escala,
    // porque o knob já está dentro do item escalado.
    const travel = (st.el.offsetWidth / 2) * 0.6;
    st.knob.style.transform = `translate(${dx * travel}px, ${dy * travel}px)`;

    // Deadzone radial com reescala, para não perder precisão perto do centro
    const mag = Math.min(len, 1);
    if (mag < STICK_DEADZONE) {
      st.x = 0;
      st.y = 0;
    } else {
      const scale = (mag - STICK_DEADZONE) / (1 - STICK_DEADZONE) / mag;
      st.x = round2(dx * scale);
      st.y = round2(dy * scale);
    }
    scheduleStick(st);
  }

  function stickEnd(st) {
    st.touchId = null;
    st.x = 0;
    st.y = 0;
    st.el.classList.remove("active");
    st.knob.style.transform = "";
    if (st.floating) {
      st.floating = false;
      st.el.classList.remove("floating");
      applyItem(st.item, prof().layout[st.item]);
    }
    // Soltar o analógico vai na hora, sem esperar o próximo frame
    // (rAF pode atrasar ou pausar, e o stick ficaria travado fora do centro).
    if (st.frame) cancelAnimationFrame(st.frame);
    if (st.id === "L" && gyroActive()) applyGyro(); // giroscópio volta a mandar no analógico
    flushStick(st, true);
  }

  function round2(v) {
    return Math.round(v * 100) / 100;
  }

  // Coalesce: no máximo um pacote por analógico por frame, sempre o valor mais recente.
  function scheduleStick(st) {
    if (!st.frame) st.frame = requestAnimationFrame(() => flushStick(st, false));
  }

  function flushStick(st, force) {
    st.frame = 0;
    if (!isOpen()) return; // o snapshot da reconexão envia o valor atual
    const centered = st.x === 0 && st.y === 0;
    const changed =
      Math.abs(st.x - st.sentX) > STICK_EPSILON ||
      Math.abs(st.y - st.sentY) > STICK_EPSILON ||
      (centered && (st.sentX !== 0 || st.sentY !== 0));
    if (!changed) return;
    if (!force && ws.bufferedAmount > MAX_BUFFERED) {
      scheduleStick(st); // rede congestionada: tenta de novo no próximo frame com o valor mais novo
      return;
    }
    send({ a: st.id, x: st.x, y: st.y });
    st.sentX = st.x;
    st.sentY = st.y;
  }

  function stickByTouch(id) {
    return Object.values(sticks).find((st) => st.touchId === id);
  }

  // ---------- Giroscópio ----------
  // Usa a gravidade medida pelo acelerômetro: funciona em qualquer celular com sensor
  // e não acumula erro. Precisa de HTTPS (contexto seguro) no Chrome e no Safari.
  let gyroListening = false;
  let gyroRaw = null;             // { roll, pitch } em graus
  let gyroCenter = { roll: 0, pitch: 0 };
  let gyroNeedsCenter = true;

  function gyroActive() {
    return prof().gyro !== "off" && gyroListening;
  }

  function onMotion(ev) {
    const g = ev.accelerationIncludingGravity;
    if (!g || g.x == null) return;
    let gx = g.x, gy = g.y, gz = g.z;
    // Android mede a reação à gravidade (aponta para cima); iOS mede a gravidade.
    if (IS_IOS) { gx = -gx; gy = -gy; gz = -gz; }
    const angle = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 90;
    // Componentes nos eixos da tela em paisagem
    let right, up;
    if (angle === 90) { right = -gy; up = gx; }
    else if (angle === 270 || angle === -90) { right = gy; up = -gx; }
    else { right = gx; up = gy; }
    const deg = 180 / Math.PI;
    gyroRaw = {
      roll: Math.atan2(-right, Math.hypot(up, gz)) * deg,   // girar como volante (+ = direita)
      pitch: Math.atan2(up, gz) * deg,                       // inclinar para frente/trás
    };
    if (gyroNeedsCenter) {
      gyroCenter = { ...gyroRaw };
      gyroNeedsCenter = false;
    }
    applyGyro();
  }

  function gyroAxis(value, max) {
    const v = Math.abs(value) < GYRO_DEADZONE ? 0 : value - Math.sign(value) * GYRO_DEADZONE;
    return round2(clamp(v / (max - GYRO_DEADZONE), -1, 1));
  }

  function applyGyro() {
    const st = sticks.L;
    if (!gyroRaw || st.touchId !== null || editing) return; // dedo no analógico tem prioridade
    const p = prof();
    const sign = p.gyroInvert ? -1 : 1;
    st.x = sign * gyroAxis(gyroRaw.roll - gyroCenter.roll, GYRO_STEER_MAX);
    // Inclinar para frente (topo do celular se afastando) = analógico para cima
    st.y = p.gyro === "tilt" ? sign * gyroAxis(gyroCenter.pitch - gyroRaw.pitch, GYRO_TILT_MAX) : 0;
    scheduleStick(st);
  }

  let gyroAsking = false;

  async function startGyro() {
    if (gyroListening) return true;
    if (!window.isSecureContext || gyroAsking) return false;
    if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
      gyroAsking = true;
      try {
        if ((await DeviceMotionEvent.requestPermission()) !== "granted") return false;
      } catch {
        return false;
      } finally {
        gyroAsking = false;
      }
      if (prof().gyro === "off") return false; // desligado enquanto esperava a permissão
    }
    window.addEventListener("devicemotion", onMotion);
    gyroListening = true;
    gyroNeedsCenter = true;
    return true;
  }

  function stopGyro() {
    window.removeEventListener("devicemotion", onMotion);
    gyroListening = false;
    gyroRaw = null;
    const st = sticks.L;
    if (st.touchId === null) {
      st.x = 0;
      st.y = 0;
      flushStick(st, true);
    }
  }

  async function syncGyro() {
    if (prof().gyro === "off") {
      stopGyro();
    } else if (!(await startGyro())) {
      renderMenu();
    }
  }

  // ---------- Modo de edição do HUD ----------
  let editing = false;
  let draft = null;     // layout sendo editado
  let selected = null;  // id do item selecionado
  let drag = null;      // { id, item, startX, startY, ox, oy }
  let pinch = null;     // { id, startDist, startScale }
  const touchPos = new Map(); // touchId -> {x, y}, para a pinça

  function enterEdit() {
    releaseAll();
    send({ r: 1 });
    closeMenu();
    editing = true;
    draft = copy(prof().layout);
    select(null);
    document.body.classList.add("editing");
    editbarEl.classList.remove("hidden");
  }

  function exitEdit(keep) {
    if (keep) {
      prof().layout = draft;
      saveProfiles();
    }
    applyLayout(prof().layout);
    editing = false;
    draft = null;
    drag = null;
    pinch = null;
    select(null);
    document.body.classList.remove("editing");
    editbarEl.classList.add("hidden");
  }

  function select(id) {
    if (selected) items[selected].classList.remove("selected");
    selected = id;
    if (id) items[id].classList.add("selected");
    updateEditbar();
  }

  function updateEditbar() {
    const it = selected && draft ? draft[selected] : null;
    $("#edit-title").textContent = it
      ? `${ITEM_NAMES[selected]} · ${Math.round(it.s * 100)}%${it.hidden ? " · oculto" : ""}`
      : `${profiles.active}: arraste para mover · pinça com 2 dedos para redimensionar`;
    $("#toggle-hide").textContent = it && it.hidden ? "Mostrar" : "Ocultar";
  }

  function setScale(id, s) {
    draft[id].s = Math.round(clamp(s, SCALE_MIN, SCALE_MAX) * 100) / 100;
    applyItem(id, draft[id]);
    updateEditbar();
  }

  function editStart(t, el) {
    touchPos.set(t.identifier, { x: t.clientX, y: t.clientY });
    const itemEl = el && el.closest("[data-item]");
    if (drag && !pinch && touches.size > 0) {
      // Segundo dedo: pinça para mudar o tamanho do item que está sendo arrastado
      const p = touchPos.get(drag.id);
      pinch = {
        id: t.identifier,
        startDist: Math.max(10, Math.hypot(t.clientX - p.x, t.clientY - p.y)),
        startScale: draft[drag.item].s,
      };
      touches.set(t.identifier, { kind: "edit" });
      return;
    }
    if (!itemEl) {
      select(null);
      touches.set(t.identifier, { kind: "edit" });
      return;
    }
    const id = itemEl.dataset.item;
    select(id);
    drag = { id: t.identifier, item: id, startX: t.clientX, startY: t.clientY, ox: draft[id].x, oy: draft[id].y };
    document.body.classList.add("dragging");
    touches.set(t.identifier, { kind: "edit" });
  }

  function editMove(t) {
    touchPos.set(t.identifier, { x: t.clientX, y: t.clientY });
    if (!drag) return;
    if (pinch) {
      const a = touchPos.get(drag.id);
      const b = touchPos.get(pinch.id);
      if (a && b) setScale(drag.item, pinch.startScale * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.startDist));
      return;
    }
    if (t.identifier !== drag.id) return;
    const it = draft[drag.item];
    // Encaixe a cada 0,5% para alinhar fácil
    it.x = clamp(Math.round((drag.ox + ((t.clientX - drag.startX) / innerWidth) * 100) * 2) / 2, 0, 100);
    it.y = clamp(Math.round((drag.oy + ((t.clientY - drag.startY) / innerHeight) * 100) * 2) / 2, 0, 100);
    applyItem(drag.item, it);
  }

  function editEnd(t) {
    touchPos.delete(t.identifier);
    if (pinch && t.identifier === pinch.id) {
      // Fim da pinça: o arraste continua da posição atual, sem pulo
      pinch = null;
      const p = touchPos.get(drag.id);
      if (p) Object.assign(drag, { startX: p.x, startY: p.y, ox: draft[drag.item].x, oy: draft[drag.item].y });
    } else if (drag && t.identifier === drag.id) {
      drag = null;
      pinch = null;
      document.body.classList.remove("dragging");
    }
  }

  // ---------- Menu ----------
  let deleteArmed = false;

  function openMenu() {
    releaseAll();
    deleteArmed = false;
    renderMenu();
    menuEl.classList.remove("hidden");
  }

  function closeMenu() {
    menuEl.classList.add("hidden");
  }

  function renderMenu() {
    const p = prof();
    // Perfis
    const box = $("#profiles");
    box.innerHTML = "";
    Object.keys(profiles.list).forEach((name, i) => {
      const chip = document.createElement("div");
      chip.className = "chip" + (name === profiles.active ? " on" : "");
      chip.dataset.action = `profile:${i}`;
      chip.textContent = name;
      box.appendChild(chip);
    });
    const del = $("#profile-delete");
    del.classList.toggle("disabled", Object.keys(profiles.list).length < 2);
    del.classList.toggle("confirm", deleteArmed);
    del.textContent = deleteArmed ? "Toque de novo" : "Excluir";

    $("#tg-floating").classList.toggle("on", p.floating);
    $("#tg-game-vibra").classList.toggle("on", gameVibra);
    $("#tg-gyro-invert").classList.toggle("on", p.gyroInvert);

    document.querySelectorAll("#vibra .seg").forEach((el) => {
      el.classList.toggle("on", el.dataset.action === `vibra:${vibraLevel}`);
    });
    document.querySelectorAll("#gyro .seg").forEach((el) => {
      el.classList.toggle("on", el.dataset.action === `gyro:${p.gyro}`);
    });

    let vnote = "";
    if (!canVibrate && IS_IOS) vnote = "No iPhone a vibração tem força fixa e precisa do iOS 18 ou mais novo.";
    else if (!canVibrate) vnote = "Este navegador não permite vibração.";
    $("#vibra-note").textContent = vnote;

    // Giroscópio só funciona em HTTPS
    let gnote = "";
    const needHttps = p.gyro !== "off" && !window.isSecureContext;
    if (needHttps) {
      gnote = httpsUrl
        ? "O giroscópio só funciona pelo link seguro (HTTPS). Seus perfis deste link não vão junto: crie de novo lá."
        : "O giroscópio precisa do link seguro (HTTPS), que está desligado no servidor.";
    } else if (p.gyro !== "off" && !gyroListening) {
      gnote = "Sem acesso ao sensor de movimento. No iPhone, permita o acesso quando o Safari perguntar.";
    } else if (p.gyro !== "off") {
      gnote = "Segure o celular na posição de jogo e toque em Centralizar.";
    }
    $("#gyro-note").textContent = gnote;
    $("#gyro-https").classList.toggle("hidden", !(needHttps && httpsUrl));
  }

  function uniqueName(base) {
    let name = base;
    for (let n = 2; profiles.list[name]; n++) name = `${base} ${n}`;
    return name;
  }

  function switchProfile(name) {
    if (!profiles.list[name] || name === profiles.active) return;
    releaseAll();
    profiles.active = name;
    saveProfiles();
    applyLayout(prof().layout);
    syncGyro();
    haptic();
  }

  function askName(title, value) {
    const name = (window.prompt(title, value) || "").trim().slice(0, 20);
    return name || null;
  }

  // ---------- Touch ----------
  function actionAt(x, y) {
    const el = document.elementFromPoint(x, y);
    return el ? el.closest("[data-action]") : null;
  }

  function inScrollableMenu(target) {
    return target instanceof Element && target.closest(".sheet") !== null;
  }

  function onTouchStart(ev) {
    // Dentro do menu deixa o navegador rolar a lista; o resto da tela é só do controle.
    if (!inScrollableMenu(ev.target)) ev.preventDefault();
    for (const t of ev.changedTouches) {
      const el = document.elementFromPoint(t.clientX, t.clientY);
      const action = el ? el.closest("[data-action]") : null;
      if (action) {
        // Botões de menu/edição: só disparam ao soltar no mesmo lugar, sem arrastar
        touches.set(t.identifier, { kind: "ui", action, x: t.clientX, y: t.clientY });
      } else if (editing) {
        editStart(t, el);
      } else {
        startGameTouch(t, el);
      }
    }
    syncButtons();
  }

  function startGameTouch(t, el) {
    const stickEl = el && el.closest("[data-stick]");
    const L = sticks.L;
    if (stickEl) {
      const st = sticks[stickEl.dataset.stick];
      if (st.touchId === null) {
        // Flutuante: encostar no analógico também recentraliza nele
        const floatAt = st.id === "L" && prof().floating ? { x: t.clientX, y: t.clientY } : null;
        touches.set(t.identifier, { kind: "stick", id: st.id });
        stickStart(st, t, floatAt);
        return;
      }
    }
    if (el && el.closest("#dpad")) {
      touches.set(t.identifier, { kind: "dpad", dirs: dpadDirs(t.clientX, t.clientY) });
      return;
    }
    const btn = buttonAt(t.clientX, t.clientY);
    if (!btn && prof().floating && L.touchId === null && t.clientX < innerWidth / 2) {
      // Área vazia do lado esquerdo: analógico flutuante nasce aqui
      touches.set(t.identifier, { kind: "stick", id: "L" });
      stickStart(L, t, { x: t.clientX, y: t.clientY });
      return;
    }
    touches.set(t.identifier, { kind: "btn", btn });
  }

  function onTouchMove(ev) {
    if (!inScrollableMenu(ev.target)) ev.preventDefault();
    for (const t of ev.changedTouches) {
      const state = touches.get(t.identifier);
      if (!state) continue;
      if (state.kind === "edit") editMove(t);
      else if (state.kind === "stick") stickMove(sticks[state.id], t);
      else if (state.kind === "dpad") state.dirs = dpadDirs(t.clientX, t.clientY);
      else if (state.kind === "btn") state.btn = buttonAt(t.clientX, t.clientY); // permite deslizar entre botões
      else if (state.kind === "ui" && Math.hypot(t.clientX - state.x, t.clientY - state.y) > TAP_SLOP) {
        state.action = null; // virou rolagem/arraste: não dispara a ação
      }
    }
    syncButtons();
  }

  function onTouchEnd(ev) {
    if (!inScrollableMenu(ev.target)) ev.preventDefault();
    for (const t of ev.changedTouches) {
      const state = touches.get(t.identifier);
      touches.delete(t.identifier);
      if (!state) continue;
      if (state.kind === "edit") editEnd(t);
      else if (state.kind === "stick") stickEnd(sticks[state.id]);
      else if (state.kind === "ui" && state.action && ev.type === "touchend" &&
               actionAt(t.clientX, t.clientY) === state.action) {
        // Ações que exigem gesto do usuário (tela cheia, vibração, sensor) disparam ao soltar
        runAction(state.action.dataset.action);
      }
    }
    syncButtons();
    // O sensor só pode ser liberado durante um toque: tenta no primeiro toque se o perfil usa giroscópio
    if (ev.type === "touchend" && prof().gyro !== "off" && !gyroListening) startGyro();
  }

  function releaseAll() {
    touches.clear();
    touchPos.clear();
    drag = null;
    pinch = null;
    document.body.classList.remove("dragging");
    for (const st of Object.values(sticks)) {
      if (st.touchId !== null) stickEnd(st);
    }
    syncButtons();
  }

  const opts = { passive: false };
  document.addEventListener("touchstart", onTouchStart, opts);
  document.addEventListener("touchmove", onTouchMove, opts);
  document.addEventListener("touchend", onTouchEnd, opts);
  document.addEventListener("touchcancel", onTouchEnd, opts);
  document.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("gesturestart", (e) => e.preventDefault()); // pinch no iOS
  document.addEventListener("dblclick", (e) => e.preventDefault());

  // ---------- Ações ----------
  async function runAction(name) {
    const [cmd, arg] = name.split(":");
    if (cmd !== "profile-delete") deleteArmed = false;
    switch (cmd) {
      case "menu": openMenu(); break;
      case "menu-close": closeMenu(); break;
      case "edit": enterEdit(); break;
      case "save": exitEdit(true); haptic(); break;
      case "cancel": exitEdit(false); break;
      case "reset":
        draft = copy(DEFAULT_LAYOUT);
        applyLayout(draft);
        select(null);
        break;
      case "size-down":
        if (selected) setScale(selected, draft[selected].s - 0.1);
        break;
      case "size-up":
        if (selected) setScale(selected, draft[selected].s + 0.1);
        break;
      case "toggle-hide":
        if (selected) {
          draft[selected].hidden = !draft[selected].hidden;
          applyItem(selected, draft[selected]);
          updateEditbar();
        }
        break;
      case "bar-move": {
        // baixo → cima → meio → baixo
        const pos = editbarEl.classList.contains("bottom") ? "top" : editbarEl.classList.contains("top") ? "" : "bottom";
        editbarEl.classList.remove("top", "bottom");
        if (pos) editbarEl.classList.add(pos);
        break;
      }

      case "vibra":
        vibraLevel = Number(arg);
        save(VIBRA_KEY, String(vibraLevel));
        renderMenu();
        haptic(); // amostra da intensidade escolhida
        break;
      case "vibra-test": testVibra(); break;
      case "game-vibra":
        gameVibra = !gameVibra;
        save(GAME_VIBRA_KEY, gameVibra ? "1" : "0");
        if (!gameVibra) playRumble(0);
        renderMenu();
        break;

      case "floating":
        prof().floating = !prof().floating;
        saveProfiles();
        renderMenu();
        break;

      case "profile":
        switchProfile(Object.keys(profiles.list)[Number(arg)]);
        renderMenu();
        break;
      case "profile-new": {
        const name = askName("Nome do novo perfil (ex.: Bomba Patch, Corrida):", uniqueName("Perfil"));
        if (!name) break;
        // Novo perfil começa como cópia do atual
        const finalName = uniqueName(name);
        profiles.list[finalName] = copy(prof());
        switchProfile(finalName);
        renderMenu();
        break;
      }
      case "profile-rename": {
        const name = askName("Novo nome do perfil:", profiles.active);
        if (!name || name === profiles.active || profiles.list[name]) break;
        // Mantém a ordem dos perfis ao renomear
        const list = {};
        for (const [k, v] of Object.entries(profiles.list)) list[k === profiles.active ? name : k] = v;
        profiles.list = list;
        profiles.active = name;
        saveProfiles();
        renderMenu();
        break;
      }
      case "profile-delete":
        if (Object.keys(profiles.list).length < 2) break;
        if (!deleteArmed) {
          deleteArmed = true; // exclusão pede um segundo toque
          renderMenu();
          break;
        }
        deleteArmed = false;
        delete profiles.list[profiles.active];
        profiles.active = Object.keys(profiles.list)[0];
        saveProfiles();
        applyLayout(prof().layout);
        syncGyro();
        renderMenu();
        break;

      case "gyro":
        prof().gyro = arg;
        saveProfiles();
        await syncGyro();
        gyroNeedsCenter = true;
        renderMenu();
        break;
      case "gyro-invert":
        prof().gyroInvert = !prof().gyroInvert;
        saveProfiles();
        renderMenu();
        break;
      case "gyro-center":
        if (gyroRaw) gyroCenter = { ...gyroRaw };
        else gyroNeedsCenter = true;
        haptic();
        break;
      case "open-https":
        if (httpsUrl) location.href = httpsUrl;
        break;

      case "reconnect":
        stopped = false;
        hideNotice();
        connect();
        break;
      case "fullscreen": await toggleFullscreen(); break;
      default: break; // "noop": toque no fundo do menu
    }
  }

  async function toggleFullscreen() {
    closeMenu();
    const root = document.documentElement;
    try {
      if (!document.fullscreenElement && root.requestFullscreen) {
        await root.requestFullscreen({ navigationUI: "hide" });
        if (screen.orientation && screen.orientation.lock) {
          await screen.orientation.lock("landscape").catch(() => {});
        }
      } else if (document.exitFullscreen) {
        await document.exitFullscreen();
      }
    } catch { /* navegador sem suporte (ex: iPhone) */ }
    requestWakeLock();
  }

  // ---------- Tela sempre acesa ----------
  let wakeLock = null;
  async function requestWakeLock() {
    if (!("wakeLock" in navigator) || wakeLock) return;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } catch { /* sem permissão / sem HTTPS */ }
  }

  // ---------- Ciclo de vida da página ----------
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      // App em segundo plano: nada pode ficar preso apertado no PC.
      releaseAll();
      playRumble(0);
      send({ r: 1 });
    } else {
      requestWakeLock();
      connect();
    }
  });
  window.addEventListener("pagehide", () => {
    releaseAll();
    send({ r: 1 });
  });
  window.addEventListener("online", connect);

  connect();
  requestWakeLock();
  // Android libera o sensor sem pedir; no iPhone ele só liga depois de um toque no menu.
  if (prof().gyro !== "off") startGyro();
})();
