(() => {
  "use strict";

  // Mesmas cores do app do celular (JOYSTICK-1, 2, 3...)
  const SLOT_COLORS = ["#7fa8ff", "#ff6b6b", "#4fd1a5", "#e58cff", "#ffb547", "#5ad7e6", "#ff9a5a", "#b49cff"];
  const LABELS = {
    A: "✕", B: "○", X: "□", Y: "△",
    LB: "L1", RB: "R1", LT: "L2", RT: "R2",
    START: "START", BACK: "SELECT", L3: "L3", R3: "R3",
    UP: "↑", DOWN: "↓", LEFT: "←", RIGHT: "→",
  };

  const $ = (sel) => document.querySelector(sel);
  const slotsEl = $("#slots");
  const template = $("#slot-template");
  const enabledEl = $("#enabled");
  const screenEl = $("#screen");
  const maxEl = $("#max-players");

  let ws = null;
  let state = null;
  let cards = [];
  let shownQrUrl = null;
  let linkKind = localStorage.getItem("controle-admin-link") || "fixed";

  // ---------- Conexão com o servidor ----------
  function connect() {
    const sock = new WebSocket(`ws://${location.host}/admin/ws`);
    ws = sock;
    sock.onopen = () => $("#offline").classList.add("hidden");
    sock.onmessage = (ev) => {
      const data = JSON.parse(ev.data);
      if (data.t === "state") render(data);
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      $("#offline").classList.remove("hidden");
      $("#summary").textContent = t("a.server.off");
      setTimeout(connect, 2000);
    };
  }

  function command(cmd) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(cmd));
  }

  // ---------- Renderização ----------
  function render(s) {
    state = s;

    const total = s.slots.length;
    const online = s.online;
    $("#summary").textContent = t(total === 1 ? "a.summary.one" : "a.summary.many", { n: online, total, port: s.port });

    enabledEl.checked = s.enabled;
    $("#pin-box").classList.toggle("hidden", !s.pin);
    $("#pin").textContent = s.pin || "";
    const sc = s.screen || {};
    for (const [id, key] of [["screen-width", "width"], ["screen-fps", "fps"], ["screen-quality", "quality"]]) {
      const el = $("#" + id);
      if (sc[key] !== undefined && document.activeElement !== el) el.value = String(sc[key]);
    }
    $("#screen-cfg").classList.toggle("hidden", sc.available === false);
    screenEl.checked = Boolean(sc.enabled);
    screenEl.disabled = sc.available === false;
    $("#screen-label").textContent = sc.available === false ? t("a.screen.unavailable")
      : !sc.enabled ? t("a.screen.off")
      : sc.error ? t("a.screen.err", { err: sc.error })
      : t("a.screen.on", { n: sc.viewers });
    $("#enabled-label").textContent = t(s.enabled ? "a.access.on" : "a.access.off");
    const note = $("#access-note");
    note.textContent = t(s.enabled ? "a.access.note.on" : "a.access.note.off");
    note.classList.toggle("off", !s.enabled);

    const links = s.links || { ip: s.url };
    if (!links[linkKind]) linkKind = links.fixed ? "fixed" : "ip";
    document.querySelectorAll("#link-tabs .tab").forEach((tab) => {
      tab.classList.toggle("hidden", !links[tab.dataset.link]);
      tab.classList.toggle("on", tab.dataset.link === linkKind);
    });
    $("#link-help").textContent = t(`a.help.${linkKind}`);
    $("#url").textContent = links[linkKind];
    if (shownQrUrl !== links[linkKind]) {
      $("#qr").innerHTML = (s.qrs && s.qrs[linkKind]) || "";
      shownQrUrl = links[linkKind];
    }

    // Avisos
    $("#alert-firewall").classList.toggle("hidden", s.firewall !== false);
    document.querySelectorAll(".lan-ip").forEach((el) => { el.textContent = s.lan_ip || ""; });
    document.querySelectorAll(".port").forEach((el) => { el.textContent = s.port; });
    $("#firewall-cmd").textContent = s.firewall_cmd || "";

    const dry = Boolean(s.backend_error);
    $("#alert-backend").classList.toggle("hidden", !dry);
    $("#backend-error").textContent = dry ? `(${s.backend_error})` : "";
    const linux = (s.platform || "").startsWith("linux");
    $("#backend-fix-linux").classList.toggle("hidden", !linux);
    $("#backend-fix-windows").classList.toggle("hidden", linux);

    // Quantidade de jogadores
    if (maxEl.options.length !== s.max_slots) {
      maxEl.innerHTML = "";
      for (let n = 1; n <= s.max_slots; n++) maxEl.add(new Option(String(n), String(n)));
    }
    if (document.activeElement !== maxEl) maxEl.value = String(s.max_players);
    $("#max-hint").classList.toggle("hidden", s.max_players <= 4 || linux);

    if (cards.length !== total) buildCards(total);
    s.slots.forEach((slot, i) => updateCard(cards[i], slot));
  }

  function buildCards(total) {
    slotsEl.innerHTML = "";
    cards = [];
    for (let n = 1; n <= total; n++) {
      const el = template.content.firstElementChild.cloneNode(true);
      el.style.setProperty("--c", SLOT_COLORS[(n - 1) % SLOT_COLORS.length]);
      el.querySelector(".slot-name").textContent = `JOYSTICK-${n}`;

      const move = el.querySelector(".move");
      move.add(new Option(t("a.move.opt"), ""));
      for (let m = 1; m <= total; m++) {
        if (m !== n) move.add(new Option(`JOYSTICK-${m}`, String(m)));
      }
      move.addEventListener("change", () => {
        if (move.value) command({ cmd: "move", slot: n, to: Number(move.value) });
        move.value = "";
      });

      el.querySelector(".kick").addEventListener("click", () => command({ cmd: "kick", slot: n }));
      el.querySelector(".find").addEventListener("click", () => command({ cmd: "find", slot: n }));

      const input = el.querySelector(".player-name");
      const save = () => command({ cmd: "rename", slot: n, name: input.value });
      input.addEventListener("change", save);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });

      slotsEl.appendChild(el);
      cards.push(el);
    }
  }

  function updateCard(el, slot) {
    const p = slot.player;
    el.classList.toggle("is-empty", !p);
    el.querySelector(".empty").classList.toggle("hidden", Boolean(p));
    el.querySelector(".filled").classList.toggle("hidden", !p);

    const pill = el.querySelector(".pill");
    if (!p) {
      pill.className = "pill";
      pill.textContent = t("a.free");
      el.classList.remove("is-active");
      return;
    }

    if (p.online) {
      pill.className = "pill online";
      pill.textContent = p.rtt != null ? t("a.online.ms", { rtt: p.rtt }) : t("a.online");
    } else {
      pill.className = "pill away";
      pill.textContent = t("a.away", { s: p.reserve_left ?? 0 });
    }
    el.classList.toggle("is-active", p.online && p.held.length > 0);

    const input = el.querySelector(".player-name");
    if (document.activeElement !== input) input.value = p.name;


    el.querySelector(".meta").textContent = `${p.device || t("a.device")} · ${p.ip} · ${p.online ? t("a.connected", { t: since(p.since) }) : t("a.reconnecting")}`;

    const [x, y] = p.stick;
    el.querySelector(".mini-stick .mini-dot").style.transform = `translate(${x * 17}px, ${y * 17}px)`;
    const [rx, ry] = p.rstick || [0, 0];
    el.querySelector(".mini-stick.right .mini-dot").style.transform = `translate(${rx * 13}px, ${ry * 13}px)`;
    el.querySelector(".rumble").classList.toggle("on", (p.rumble || 0) > 0);

    const held = el.querySelector(".held");
    const key = p.held.join(",");
    if (held.dataset.key !== key) {
      held.dataset.key = key;
      held.innerHTML = p.held.length ? "" : `<span class="idle muted">${t("a.nobtn")}</span>`;
      for (const b of p.held) {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = LABELS[b] || b;
        held.appendChild(chip);
      }
    }
  }

  function since(ts) {
    const s = Math.max(0, Math.round(Date.now() / 1000 - ts));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
  }

  // ---------- Ações ----------
  screenEl.addEventListener("change", () => command({ cmd: "screen", value: screenEl.checked }));

  enabledEl.addEventListener("change", () => command({ cmd: "enabled", value: enabledEl.checked }));
  document.querySelectorAll("#link-tabs .tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      linkKind = tab.dataset.link;
      try { localStorage.setItem("controle-admin-link", linkKind); } catch { /* sem armazenamento */ }
      if (state) render(state);
    });
  });
  for (const id of ["screen-width", "screen-fps", "screen-quality"]) {
    $("#" + id).addEventListener("change", () => command({
      cmd: "screen_config",
      width: Number($("#screen-width").value),
      fps: Number($("#screen-fps").value),
      quality: Number($("#screen-quality").value),
    }));
  }
  $("#new-pin").addEventListener("click", () => {
    if (confirm(t("a.pin.confirm"))) command({ cmd: "new_pin" });
  });
  maxEl.addEventListener("change", () => command({ cmd: "max_players", value: Number(maxEl.value) }));
  $("#retry-backend").addEventListener("click", () => command({ cmd: "retry_backend" }));

  // Encerrar pede um segundo clique (sem diálogo do navegador)
  const shutdownBtn = $("#shutdown");
  let shutdownTimer = null;
  shutdownBtn.addEventListener("click", () => {
    if (shutdownBtn.classList.contains("confirm")) {
      command({ cmd: "shutdown" });
      return;
    }
    shutdownBtn.classList.add("confirm");
    shutdownBtn.textContent = t("a.shutdown.confirm");
    clearTimeout(shutdownTimer);
    shutdownTimer = setTimeout(() => {
      shutdownBtn.classList.remove("confirm");
      shutdownBtn.textContent = t("a.shutdown");
    }, 3000);
  });

  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const text = document.getElementById(btn.dataset.copy).textContent;
      try {
        await navigator.clipboard.writeText(text);
        const old = btn.textContent;
        btn.textContent = t("a.copied");
        setTimeout(() => { btn.textContent = old; }, 1200);
      } catch { /* sem permissão: o texto continua selecionável */ }
    });
  });

  connect();
})();
