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
  // Cor de cada JOYSTICK-N (mesma ordem do painel)
  const SLOT_COLORS = ["#7fa8ff", "#ff6b6b", "#4fd1a5", "#e58cff", "#ffb547", "#5ad7e6", "#ff9a5a", "#b49cff"];

  // Layout padrão do HUD: centro do item em % da tela (x, y) e escala (s)
  const DEFAULT_LAYOUT = {
    LT: { x: 10, y: 12, s: 1 },
    LB: { x: 27, y: 12, s: 1 },
    RB: { x: 73, y: 12, s: 1 },
    RT: { x: 90, y: 12, s: 1 },
    DPAD: { x: 17, y: 42, s: 1 },
    STICK: { x: 30, y: 74, s: 1 },
    BACK: { x: 45, y: 86, s: 1 },
    START: { x: 55, y: 86, s: 1 },
    Y: { x: 83, y: 32, s: 1 },
    X: { x: 72, y: 52, s: 1 },
    B: { x: 94, y: 52, s: 1 },
    A: { x: 83, y: 72, s: 1 },
  };
  const ITEM_NAMES = {
    LT: "L2", LB: "L1", RB: "R1", RT: "R2", DPAD: "Direcional", STICK: "Analógico",
    BACK: "SELECT", START: "START", Y: "△ Triângulo", X: "□ Quadrado", B: "○ Círculo", A: "✕ Xis",
  };
  const SCALE_MIN = 0.5;
  const SCALE_MAX = 2.2;
  const LAYOUT_KEY = "controle-hud-v1";

  // Vibração por nível: desligada, fraca, média, forte (ms)
  const VIBRA_MS = [0, 15, 30, 55];
  const VIBRA_KEY = "controle-vibra";

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
  const dpadEl = $("#dpad");
  const stickEl = $("#stick");
  const knobEl = $("#knob");
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

  // ---------- Layout do HUD ----------
  function copyLayout(layout) {
    return JSON.parse(JSON.stringify(layout));
  }

  function loadLayout() {
    const layout = copyLayout(DEFAULT_LAYOUT);
    let saved = null;
    try { saved = JSON.parse(load(LAYOUT_KEY) || "null"); } catch { saved = null; }
    if (saved && typeof saved === "object") {
      for (const id of Object.keys(layout)) {
        const it = saved[id];
        if (!it) continue;
        if (Number.isFinite(it.x)) layout[id].x = clamp(it.x, 0, 100);
        if (Number.isFinite(it.y)) layout[id].y = clamp(it.y, 0, 100);
        if (Number.isFinite(it.s)) layout[id].s = clamp(it.s, SCALE_MIN, SCALE_MAX);
        layout[id].hidden = Boolean(it.hidden);
      }
    }
    return layout;
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

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  let layout = loadLayout();
  applyLayout(layout);

  // ---------- Vibração ----------
  let vibraLevel = Number(load(VIBRA_KEY) ?? 2);
  if (!(vibraLevel in VIBRA_MS)) vibraLevel = 2;
  const canVibrate = typeof navigator.vibrate === "function";

  function haptic() {
    if (!vibraLevel) return;
    if (canVibrate) {
      navigator.vibrate(VIBRA_MS[vibraLevel]);
    } else if (IS_IOS) {
      hapticEl.click(); // Safari 18+: alternar um <input switch> dá um toque háptico
    }
  }

  function renderVibra() {
    document.querySelectorAll("#vibra .seg").forEach((el) => {
      el.classList.toggle("on", el.dataset.action === `vibra:${vibraLevel}`);
    });
    let note = "";
    if (!canVibrate && IS_IOS) note = "No iPhone a vibração tem força fixa e precisa do iOS 18 ou mais novo.";
    else if (!canVibrate) note = "Este navegador não permite vibração.";
    $("#vibra-note").textContent = note;
  }

  // ---------- WebSocket ----------
  let ws = null;
  let reconnectDelay = RECONNECT_MIN;
  let reconnectTimer = null;
  let pingTimer = null;
  let lastPong = 0;
  let lastRtt = null;
  let playerName = "";
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

  function setSlot(slot) {
    slotEl.textContent = slot ? `J${slot}` : "J?";
    statusEl.style.setProperty("--slot-color", slot ? SLOT_COLORS[(slot - 1) % SLOT_COLORS.length] : "");
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
        setSlot(data.slot);
        hideNotice();
        setStatus("on", playerName || "Conectado");
        sendSnapshot();
      } else if (data.t === "slot") {
        setSlot(data.slot);
        haptic();
      } else if (data.t === "name") {
        playerName = data.name || "";
      }
    };

    sock.onclose = (ev) => {
      if (ws !== sock) return;
      clearInterval(pingTimer);
      ws = null;
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
    if (stick.x !== 0 || stick.y !== 0) {
      send({ a: "L", x: stick.x, y: stick.y });
    }
    stick.sentX = stick.x;
    stick.sentY = stick.y;
  }

  // ---------- Estado de entrada ----------
  // touchId -> { kind: "btn", btn } | { kind: "dpad", dirs: [] } | { kind: "stick" } | { kind: "ui" }
  // Todos guardam `action`: o elemento [data-action] onde o toque começou.
  const touches = new Map();
  const sent = new Set(); // botões que o PC acredita estarem pressionados
  const stick = { touchId: null, cx: 0, cy: 0, radius: 1, x: 0, y: 0, sentX: 0, sentY: 0 };
  let stickFrame = 0;

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

  // ---------- Analógico ----------
  function stickStart(touch) {
    const r = stickEl.getBoundingClientRect();
    stick.touchId = touch.identifier;
    stick.cx = r.left + r.width / 2;
    stick.cy = r.top + r.height / 2;
    stick.radius = r.width / 2;
    stickEl.classList.add("active");
    stickMove(touch);
  }

  function stickMove(touch) {
    let dx = (touch.clientX - stick.cx) / stick.radius;
    let dy = (touch.clientY - stick.cy) / stick.radius;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }

    // Knob segue o dedo (limitado à borda). Usa o tamanho sem escala,
    // porque o knob já está dentro do item escalado.
    const travel = (stickEl.offsetWidth / 2) * 0.6;
    knobEl.style.transform = `translate(${dx * travel}px, ${dy * travel}px)`;

    // Deadzone radial com reescala, para não perder precisão perto do centro
    const mag = Math.min(len, 1);
    if (mag < STICK_DEADZONE) {
      stick.x = 0;
      stick.y = 0;
    } else {
      const scale = (mag - STICK_DEADZONE) / (1 - STICK_DEADZONE) / mag;
      stick.x = round2(dx * scale);
      stick.y = round2(dy * scale);
    }
    scheduleStick();
  }

  function stickEnd() {
    stick.touchId = null;
    stick.x = 0;
    stick.y = 0;
    stickEl.classList.remove("active");
    knobEl.style.transform = "";
    // Soltar o analógico vai na hora, sem esperar o próximo frame
    // (rAF pode atrasar ou pausar, e o stick ficaria travado fora do centro).
    if (stickFrame) cancelAnimationFrame(stickFrame);
    flushStick(true);
  }

  function round2(v) {
    return Math.round(v * 100) / 100;
  }

  // Coalesce: no máximo um pacote de analógico por frame, sempre o valor mais recente.
  function scheduleStick() {
    if (!stickFrame) stickFrame = requestAnimationFrame(() => flushStick(false));
  }

  function flushStick(force) {
    stickFrame = 0;
    if (!isOpen()) return; // o snapshot da reconexão envia o valor atual
    const centered = stick.x === 0 && stick.y === 0;
    const changed =
      Math.abs(stick.x - stick.sentX) > STICK_EPSILON ||
      Math.abs(stick.y - stick.sentY) > STICK_EPSILON ||
      (centered && (stick.sentX !== 0 || stick.sentY !== 0));
    if (!changed) return;
    if (!force && ws.bufferedAmount > MAX_BUFFERED) {
      scheduleStick(); // rede congestionada: tenta de novo no próximo frame com o valor mais novo
      return;
    }
    send({ a: "L", x: stick.x, y: stick.y });
    stick.sentX = stick.x;
    stick.sentY = stick.y;
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
    draft = copyLayout(layout);
    select(null);
    document.body.classList.add("editing");
    editbarEl.classList.remove("hidden");
  }

  function exitEdit(keep) {
    if (keep) {
      layout = draft;
      save(LAYOUT_KEY, JSON.stringify(layout));
    }
    applyLayout(layout);
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
      : "Arraste para mover · pinça com 2 dedos para redimensionar";
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
    }
  }

  // ---------- Menu ----------
  function openMenu() {
    releaseAll();
    renderVibra();
    menuEl.classList.remove("hidden");
  }

  function closeMenu() {
    menuEl.classList.add("hidden");
  }

  // ---------- Touch ----------
  function actionAt(x, y) {
    const el = document.elementFromPoint(x, y);
    return el ? el.closest("[data-action]") : null;
  }

  function onTouchStart(ev) {
    ev.preventDefault();
    for (const t of ev.changedTouches) {
      const el = document.elementFromPoint(t.clientX, t.clientY);
      const action = el ? el.closest("[data-action]") : null;
      if (action) {
        // Botões de menu/edição: só disparam ao soltar no mesmo lugar
        touches.set(t.identifier, { kind: "ui", action });
      } else if (editing) {
        editStart(t, el);
      } else if (el && el.closest("#stick") && stick.touchId === null) {
        touches.set(t.identifier, { kind: "stick" });
        stickStart(t);
      } else if (el && el.closest("#dpad")) {
        touches.set(t.identifier, { kind: "dpad", dirs: dpadDirs(t.clientX, t.clientY) });
      } else {
        touches.set(t.identifier, { kind: "btn", btn: buttonAt(t.clientX, t.clientY) });
      }
    }
    syncButtons();
  }

  function onTouchMove(ev) {
    ev.preventDefault();
    for (const t of ev.changedTouches) {
      const state = touches.get(t.identifier);
      if (!state) continue;
      if (state.kind === "edit") editMove(t);
      else if (state.kind === "stick") stickMove(t);
      else if (state.kind === "dpad") state.dirs = dpadDirs(t.clientX, t.clientY);
      else if (state.kind === "btn") state.btn = buttonAt(t.clientX, t.clientY); // permite deslizar entre botões
    }
    syncButtons();
  }

  function onTouchEnd(ev) {
    ev.preventDefault();
    for (const t of ev.changedTouches) {
      const state = touches.get(t.identifier);
      touches.delete(t.identifier);
      if (!state) continue;
      if (state.kind === "edit") editEnd(t);
      else if (state.kind === "stick") stickEnd();
      else if (state.kind === "ui" && ev.type === "touchend" && actionAt(t.clientX, t.clientY) === state.action) {
        // Ações que exigem gesto do usuário (tela cheia, vibração) disparam ao soltar
        runAction(state.action.dataset.action);
      }
    }
    syncButtons();
  }

  function releaseAll() {
    touches.clear();
    touchPos.clear();
    drag = null;
    pinch = null;
    if (stick.touchId !== null) stickEnd();
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
    if (name.startsWith("vibra:")) {
      vibraLevel = Number(name.slice(6));
      save(VIBRA_KEY, String(vibraLevel));
      renderVibra();
      haptic(); // amostra da intensidade escolhida
      return;
    }
    switch (name) {
      case "menu": openMenu(); break;
      case "menu-close": closeMenu(); break;
      case "edit": enterEdit(); break;
      case "save": exitEdit(true); haptic(); break;
      case "cancel": exitEdit(false); break;
      case "reset":
        draft = copyLayout(DEFAULT_LAYOUT);
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
      case "bar-move": editbarEl.classList.toggle("bottom"); break;
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
})();
