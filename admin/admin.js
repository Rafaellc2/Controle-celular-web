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
  const maxEl = $("#max-players");

  let ws = null;
  let state = null;
  let cards = [];
  let shownQrUrl = null;
  let linkKind = localStorage.getItem("controle-admin-link") || "fixed";
  const LINK_HELP = {
    fixed: "Não muda quando o IP do PC muda, e o layout salvo no celular continua. Funciona no iPhone e no Android 12 ou mais novo.",
    ip: "Funciona em qualquer celular, mas muda se o IP do PC mudar.",
    https: "Necessário para o giroscópio. Na primeira vez o celular avisa que o certificado não é confiável: toque em Avançado → Continuar.",
  };

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
      $("#summary").textContent = "Servidor desligado";
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
    $("#summary").textContent = `${online} de ${total} ${total === 1 ? "controle conectado" : "controles conectados"} · porta ${s.port}`;

    enabledEl.checked = s.enabled;
    $("#enabled-label").textContent = s.enabled ? "Acesso ligado" : "Acesso desligado";
    const note = $("#access-note");
    note.textContent = s.enabled
      ? "Acesso ligado: novos celulares entram no primeiro JOYSTICK livre."
      : "Acesso desligado: ninguém consegue entrar. Quem estava esperando entra sozinho quando você ligar.";
    note.classList.toggle("off", !s.enabled);

    const links = s.links || { ip: s.url };
    if (!links[linkKind]) linkKind = links.fixed ? "fixed" : "ip";
    document.querySelectorAll("#link-tabs .tab").forEach((tab) => {
      tab.classList.toggle("hidden", !links[tab.dataset.link]);
      tab.classList.toggle("on", tab.dataset.link === linkKind);
    });
    $("#link-help").textContent = LINK_HELP[linkKind];
    $("#url").textContent = links[linkKind];
    if (shownQrUrl !== links[linkKind]) {
      $("#qr").innerHTML = (s.qrs && s.qrs[linkKind]) || "";
      shownQrUrl = links[linkKind];
    }

    // Avisos
    $("#alert-firewall").classList.toggle("hidden", s.firewall !== false);
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
      move.add(new Option("Mover para…", ""));
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
      pill.textContent = "Livre";
      el.classList.remove("is-active");
      return;
    }

    if (p.online) {
      pill.className = "pill online";
      pill.textContent = p.rtt != null ? `Online · ${p.rtt} ms` : "Online";
    } else {
      pill.className = "pill away";
      pill.textContent = `Caiu · guarda ${p.reserve_left ?? 0}s`;
    }
    el.classList.toggle("is-active", p.online && p.held.length > 0);

    const input = el.querySelector(".player-name");
    if (document.activeElement !== input) input.value = p.name;
    input.placeholder = p.device || "Nome do jogador";

    el.querySelector(".meta").textContent = `${p.device || "Celular"} · ${p.ip} · ${p.online ? "conectado há " + since(p.since) : "reconectando…"}`;

    const [x, y] = p.stick;
    el.querySelector(".mini-stick .mini-dot").style.transform = `translate(${x * 17}px, ${y * 17}px)`;
    const [rx, ry] = p.rstick || [0, 0];
    el.querySelector(".mini-stick.right .mini-dot").style.transform = `translate(${rx * 13}px, ${ry * 13}px)`;
    el.querySelector(".rumble").classList.toggle("on", (p.rumble || 0) > 0);

    const held = el.querySelector(".held");
    const key = p.held.join(",");
    if (held.dataset.key !== key) {
      held.dataset.key = key;
      held.innerHTML = "";
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
  enabledEl.addEventListener("change", () => command({ cmd: "enabled", value: enabledEl.checked }));
  document.querySelectorAll("#link-tabs .tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      linkKind = tab.dataset.link;
      try { localStorage.setItem("controle-admin-link", linkKind); } catch { /* sem armazenamento */ }
      if (state) render(state);
    });
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
    shutdownBtn.textContent = "Clique de novo para encerrar";
    clearTimeout(shutdownTimer);
    shutdownTimer = setTimeout(() => {
      shutdownBtn.classList.remove("confirm");
      shutdownBtn.textContent = "Encerrar servidor";
    }, 3000);
  });

  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const text = document.getElementById(btn.dataset.copy).textContent;
      try {
        await navigator.clipboard.writeText(text);
        const old = btn.textContent;
        btn.textContent = "Copiado!";
        setTimeout(() => { btn.textContent = old; }, 1200);
      } catch { /* sem permissão: o texto continua selecionável */ }
    });
  });

  connect();
})();
