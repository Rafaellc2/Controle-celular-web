// Textos da interface (celular e painel) em inglês e português.
// Idioma: ?lang=en|pt (fica salvo) ou o idioma do navegador; inglês se não for português.
// HTML: data-i18n (texto), data-i18n-html (texto com marcação), data-i18n-title, data-i18n-placeholder.
// JS: t("chave", { variavel: valor }).
(() => {
  "use strict";

  // chave: [inglês, português]
  const S = {
    // ----- Celular: status e avisos -----
    "status.connecting": ["Connecting…", "Conectando…"],
    "status.connected": ["Connected", "Conectado"],
    "status.disconnected": ["Disconnected", "Desconectado"],
    "status.reconnecting": ["Reconnecting…", "Reconectando…"],
    "notice.replaced": ["This controller was opened in another tab or window.", "Este controle foi aberto em outra aba ou janela."],
    "notice.replaced.hint": ["Tap to use it here", "Toque para usar aqui"],
    "notice.kicked": ["You were removed by the host.", "Você foi removido pelo anfitrião."],
    "notice.kicked.hint": ["Tap to join again", "Toque para entrar de novo"],
    "notice.pin": ["Enter the controller PIN.", "Digite o PIN do controle."],
    "notice.pin.hint": ["Tap here (the PIN is shown in the PC panel)", "Toque aqui (o PIN aparece no painel do PC)"],
    "notice.locked": ["Too many wrong PIN attempts.", "Muitas tentativas com PIN errado."],
    "notice.locked.hint": ["Wait a few minutes and tap to try again", "Aguarde alguns minutos e toque para tentar de novo"],
    "notice.disabled": ["The host turned off access to the controllers.", "O anfitrião desligou o acesso aos controles."],
    "notice.disabled.hint": ["Waiting for access to be turned on…", "Aguardando liberar…"],
    "notice.full": ["All controllers are in use.", "Todos os controles estão em uso."],
    "notice.full.hint": ["Waiting for a free slot…", "Aguardando uma vaga…"],
    "pin.prompt": ["Controller PIN (shown in the PC panel):", "PIN do controle (aparece no painel do PC):"],
    "rotate": ["Rotate your phone to landscape", "Gire o celular para a horizontal"],
    "find.sub": ["This is your controller", "Este é o seu controle"],

    // ----- Celular: editor do HUD -----
    "edit.hint": ["Tap a button to edit", "Toque num botão para editar"],
    "edit.title.item": ["{name} · size {size}% · opacity {op}%", "{name} · tamanho {size}% · opacidade {op}%"],
    "edit.title.inv": [" · invisible (still works)", " · invisível (funciona)"],
    "edit.title.off": [" · disabled", " · desativado"],
    "edit.title.none": [
      "{profile}: drag · pinch to resize · ◐ changes opacity of all · green = visible, red = invisible",
      "{profile}: arraste · pinça redimensiona · ◐ opacidade de todos · verde = visível, vermelho = invisível",
    ],
    "edit.opac.down": ["More transparent", "Mais transparente"],
    "edit.opac.up": ["More opaque", "Mais opaco"],
    "edit.ghost": ["Invisible", "Invisível"],
    "edit.visible": ["Visible", "Visível"],
    "edit.ghost.title": ["Hidden on screen but still works", "Some da tela mas continua funcionando"],
    "edit.disable": ["Disable", "Desativar"],
    "edit.enable": ["Enable", "Ativar"],
    "edit.disable.title": ["Removes the button (it stops working)", "Remove o botão (não funciona mais)"],
    "edit.move": ["Move this bar", "Mover esta barra"],
    "edit.reset": ["Default", "Padrão"],
    "edit.cancel": ["Cancel", "Cancelar"],
    "edit.save": ["Save", "Salvar"],
    "item.DPAD": ["D-pad", "Direcional"],
    "item.STICK": ["Left stick", "Analógico esquerdo"],
    "item.RSTICK": ["Right stick", "Analógico direito"],
    "item.Y": ["△ Triangle", "△ Triângulo"],
    "item.X": ["□ Square", "□ Quadrado"],
    "item.B": ["○ Circle", "○ Círculo"],
    "item.A": ["✕ Cross", "✕ Xis"],

    // ----- Celular: menu -----
    "menu.settings": ["Settings", "Ajustes"],
    "menu.close": ["✕ Close", "✕ Fechar"],
    "menu.profile": ["HUD profile", "Perfil do HUD"],
    "menu.new": ["+ New", "+ Novo"],
    "menu.rename": ["Rename", "Renomear"],
    "menu.delete": ["Delete", "Excluir"],
    "menu.delete.confirm": ["Tap again", "Toque de novo"],
    "menu.edit": ["✎ Edit HUD", "✎ Editar HUD"],
    "menu.floating": ["Floating stick", "Analógico flutuante"],
    "menu.floating.sub": ["appears where your finger lands (left side)", "aparece onde o dedo encostar (lado esquerdo)"],
    "menu.fullscreen": ["⛶ Fullscreen", "⛶ Tela cheia"],
    "menu.screen": ["PC screen as background", "Tela do PC no fundo"],
    "menu.screen.sub": ["streams your computer's screen (turn it on in the PC panel)", "transmite a tela do computador (liga no painel do PC)"],
    "menu.screen.note": [
      "Streaming is off in the PC panel (or the PC can't capture the screen).",
      "A transmissão está desligada no painel do PC (ou o PC não consegue capturar a tela).",
    ],
    "profile.default": ["Default", "Padrão"],
    "profile.base": ["Profile", "Perfil"],
    "profile.new.prompt": ["New profile name (e.g. Racing, Fighting):", "Nome do novo perfil (ex.: Bomba Patch, Corrida):"],
    "profile.rename.prompt": ["New profile name:", "Novo nome do perfil:"],

    "vib.title": ["Vibration on press", "Vibração ao apertar"],
    "vib.off": ["Off", "Desligada"],
    "vib.low": ["Low", "Fraca"],
    "vib.mid": ["Medium", "Média"],
    "vib.high": ["Strong", "Forte"],
    "vib.game": ["Game vibration", "Vibração do jogo"],
    "vib.game.sub": ["the phone vibrates when the game rumbles", "o celular vibra quando o jogo manda"],
    "vib.test": ["📳 Test vibration", "📳 Testar vibração"],
    "vib.note.ios": [
      "iPhone: Safari has no vibration for websites. The iOS 18 trick was tried; if you felt nothing, vibration isn't possible.",
      "iPhone: o Safari não tem vibração para sites. Tentei o truque do iOS 18; se não sentiu, não há como vibrar.",
    ],
    "vib.note.none": ["This browser has no vibration for websites. Use Chrome or Samsung Internet.", "Este navegador não tem vibração para sites. Use o Chrome ou o Samsung Internet."],
    "vib.note.ok": [
      "The browser accepted the vibration request. If you felt nothing, the phone is blocking it: turn off silent/Do Not Disturb mode and turn on \"Vibrate on touch\" (Settings → Sound and vibration).",
      "Pedido de vibração aceito pelo navegador. Se não sentiu, o celular está bloqueando: desative o modo silencioso/Não perturbe e ligue \"Vibração ao tocar\" (Configurações → Sons e vibração).",
    ],
    "vib.note.refused": ["The browser refused the vibration. Tap anywhere on the screen once and test again.", "O navegador recusou a vibração. Toque em qualquer lugar da tela uma vez e teste de novo."],
    "vib.note.ios.fixed": ["On iPhone vibration has a fixed strength and needs iOS 18 or newer.", "No iPhone a vibração tem força fixa e precisa do iOS 18 ou mais novo."],
    "vib.note.unsupported": ["This browser doesn't allow vibration.", "Este navegador não permite vibração."],

    "gyro.title": ["Gyroscope (left stick)", "Giroscópio (analógico esquerdo)"],
    "gyro.off": ["Off", "Desligado"],
    "gyro.steer": ["Steering", "Volante"],
    "gyro.tilt": ["Tilt", "Inclinar"],
    "gyro.invert": ["Invert", "Inverter"],
    "gyro.center": ["◎ Center", "◎ Centralizar"],
    "gyro.range": ["Turn for full range", "Girar para o máximo"],
    "gyro.range.sub": ["lower = more sensitive", "quanto menor, mais sensível"],
    "gyro.dead": ["Dead zone", "Zona morta"],
    "gyro.dead.sub": ["rotation ignored near the center", "giro ignorado no centro"],
    "gyro.https": ["🔒 Open secure link", "🔒 Abrir link seguro"],
    "gyro.note.https": [
      "The gyroscope only works on the secure link (HTTPS). Profiles don't carry over between links: create them again there.",
      "O giroscópio só funciona pelo link seguro (HTTPS). Seus perfis deste link não vão junto: crie de novo lá.",
    ],
    "gyro.note.nohttps": ["The gyroscope needs the secure link (HTTPS), which is off on the server.", "O giroscópio precisa do link seguro (HTTPS), que está desligado no servidor."],
    "gyro.note.nosensor": ["No access to the motion sensor. On iPhone, allow access when Safari asks.", "Sem acesso ao sensor de movimento. No iPhone, permita o acesso quando o Safari perguntar."],
    "gyro.note.center": ["Hold the phone in playing position and tap Center.", "Segure o celular na posição de jogo e toque em Centralizar."],

    // ----- Painel -----
    "a.title": ["Web Controller", "Controle Web"],
    "a.connecting": ["Connecting to the server…", "Conectando ao servidor…"],
    "a.server.off": ["Server stopped", "Servidor desligado"],
    "a.summary.one": ["{n} of {total} controller connected · port {port}", "{n} de {total} controle conectado · porta {port}"],
    "a.summary.many": ["{n} of {total} controllers connected · port {port}", "{n} de {total} controles conectados · porta {port}"],
    "a.access.title": ["Allow phones to connect", "Permitir que celulares se conectem"],
    "a.access.on": ["Access on", "Acesso ligado"],
    "a.access.off": ["Access off", "Acesso desligado"],
    "a.access.note.on": ["Access on: new phones take the first free JOYSTICK.", "Acesso ligado: novos celulares entram no primeiro JOYSTICK livre."],
    "a.access.note.off": [
      "Access off: nobody can join. Anyone who was waiting joins by themselves when you turn it on.",
      "Acesso desligado: ninguém consegue entrar. Quem estava esperando entra sozinho quando você ligar.",
    ],
    "a.screen.title": ["Show this PC's screen behind the phones' controller", "Mostrar a tela deste PC no fundo do controle dos celulares"],
    "a.screen.label": ["PC screen", "Tela do PC"],
    "a.screen.unavailable": ["PC screen unavailable (ffmpeg/gpu-screen-recorder missing)", "Tela do PC indisponível (falta ffmpeg/gpu-screen-recorder)"],
    "a.screen.off": ["PC screen off", "Tela do PC desligada"],
    "a.screen.err": ["PC screen: {err}", "Tela do PC: {err}"],
    "a.screen.on": ["PC screen on · {n} watching", "Tela do PC ligada · {n} assistindo"],
    "a.pin.title": ["Type it on the phone, or scan the QR code (it already carries the PIN)", "Digite no celular, ou escaneie o QR Code (já leva o PIN)"],
    "a.pin.new": ["New PIN", "Novo PIN"],
    "a.pin.new.title": ["Generates another PIN and disconnects the phones", "Gera outro PIN e desconecta os celulares"],
    "a.pin.confirm": ["Generate a new PIN? Connected phones will be disconnected.", "Gerar um novo PIN? Os celulares conectados serão desconectados."],
    "a.shutdown": ["Shut down server", "Encerrar servidor"],
    "a.shutdown.confirm": ["Click again to shut down", "Clique de novo para encerrar"],
    "a.offline": [
      "Server stopped or not responding. Open <b>Web Controller</b> from your app launcher to start it again.",
      "Servidor encerrado ou sem resposta. Abra <b>Controle Web</b> pelo menu de apps (Super + Space) para ligar de novo.",
    ],
    "a.fw": [
      "<b>The firewall is blocking port <span class=\"port\"></span> on this network (<span class=\"lan-ip\"></span>).</b> Phones won't be able to open the link. Run in a terminal:",
      "<b>Firewall bloqueando a porta <span class=\"port\"></span> nesta rede (<span class=\"lan-ip\"></span>).</b> Os celulares não vão conseguir abrir o link. Rode no terminal:",
    ],
    "a.copy": ["Copy", "Copiar"],
    "a.copied": ["Copied!", "Copiado!"],
    "a.backend": [
      "<b>Controllers in test mode:</b> inputs show up here but don't reach games. <span id=\"backend-error\" class=\"muted\"></span>",
      "<b>Controles em modo de teste:</b> as entradas aparecem aqui, mas não chegam aos jogos. <span id=\"backend-error\" class=\"muted\"></span>",
    ],
    "a.backend.win": ["Install the ViGEmBus driver (see the README) and restart the PC.", "Instale o driver ViGEmBus (veja o README) e reinicie o PC."],
    "a.retry": ["Try again", "Tentar de novo"],
    "a.invite.h": ["Invite players", "Convide os jogadores"],
    "a.invite.p": [
      "On the same Wi-Fi network, open this link (or scan the QR code) and turn the phone to landscape.",
      "Na mesma rede Wi-Fi, abram este link (ou escaneiem o QR Code) e virem o celular na horizontal.",
    ],
    "a.tab.fixed": ["Fixed link", "Link fixo"],
    "a.tab.ip": ["By IP", "Pelo IP"],
    "a.tab.https": ["With gyroscope", "Com giroscópio"],
    "a.help.fixed": [
      "Doesn't change when the PC's IP changes, and the layout saved on the phone stays. Works on iPhone and Android 12 or newer.",
      "Não muda quando o IP do PC muda, e o layout salvo no celular continua. Funciona no iPhone e no Android 12 ou mais novo.",
    ],
    "a.help.ip": ["Works on any phone, but changes if the PC's IP changes.", "Funciona em qualquer celular, mas muda se o IP do PC mudar."],
    "a.help.https": [
      "Required for the gyroscope. The first time, the phone warns that the certificate isn't trusted: tap Advanced → Continue.",
      "Necessário para o giroscópio. Na primeira vez o celular avisa que o certificado não é confiável: toque em Avançado → Continuar.",
    ],
    "a.copylink": ["Copy link", "Copiar link"],
    "a.cfg.h": ["PC screen on the phone", "Tela do PC no celular"],
    "a.cfg.res": ["Resolution", "Resolução"],
    "a.cfg.quality": ["Quality (bitrate)", "Qualidade (bitrate)"],
    "a.q.low": ["Low · ~25 Mbps (720p 60 fps)", "Baixa · ~25 Mbps (720p 60 fps)"],
    "a.q.mid": ["Medium · ~40 Mbps", "Média · ~40 Mbps"],
    "a.q.high": ["High · ~55 Mbps", "Alta · ~55 Mbps"],
    "a.q.max": ["Maximum · 75+ Mbps, good 5 GHz Wi-Fi only", "Máxima · 75+ Mbps, só Wi-Fi 5 GHz bom"],
    "a.cfg.note": [
      "More resolution, FPS and quality need 5 GHz Wi-Fi and more CPU/GPU on the PC. Changes apply immediately.",
      "Mais resolução, FPS e qualidade pedem Wi-Fi 5 GHz e mais CPU/GPU do PC. A mudança vale na hora.",
    ],
    "a.players.h": ["Controllers", "Controles"],
    "a.players.max": ["Players", "Jogadores"],
    "a.maxhint": ["Windows recognizes at most 4 XInput controllers.", "O Windows reconhece no máximo 4 controles XInput."],
    "a.free": ["Free", "Livre"],
    "a.waiting": ["Waiting for a phone…", "Aguardando um celular…"],
    "a.name.ph": ["✎ Name this player", "✎ Dar nome ao jogador"],
    "a.name.title": ["Click to set a name", "Clique para dar um nome"],
    "a.lstick": ["Left stick", "Analógico esquerdo"],
    "a.rstick": ["Right stick", "Analógico direito"],
    "a.nobtn": ["No buttons", "Nenhum botão"],
    "a.rumble": ["📳 Rumbling", "📳 Vibrando"],
    "a.move.title": ["Swap numbers with another controller", "Trocar de número com outro controle"],
    "a.move.opt": ["Move to…", "Mover para…"],
    "a.find": ["Find", "Achar"],
    "a.find.title": ["Makes the phone vibrate and flash", "Faz o celular vibrar e piscar"],
    "a.kick": ["Remove", "Remover"],
    "a.kick.title": ["Disconnects and frees the number", "Desconecta e libera o número"],
    "a.online": ["Online", "Online"],
    "a.online.ms": ["Online · {rtt} ms", "Online · {rtt} ms"],
    "a.away": ["Dropped · held for {s}s", "Caiu · guarda {s}s"],
    "a.device": ["Phone", "Celular"],
    "a.connected": ["connected {t} ago", "conectado há {t}"],
    "a.reconnecting": ["reconnecting…", "reconectando…"],
  };

  const saved = (() => { try { return localStorage.getItem("controle-lang"); } catch { return null; } })();
  const asked = new URLSearchParams(location.search).get("lang");
  const pick = [asked, saved, navigator.language].find((l) => l) || "en";
  const lang = /^pt/i.test(pick) ? "pt" : "en";
  if (asked) { try { localStorage.setItem("controle-lang", asked); } catch { /* sem armazenamento */ } }
  const idx = lang === "pt" ? 1 : 0;

  window.t = (key, vars) => {
    const entry = S[key];
    let text = entry ? entry[idx] : key;
    if (vars) for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, v);
    return text;
  };

  window.applyI18n = (root = document) => {
    root.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = window.t(el.dataset.i18n); });
    root.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = window.t(el.dataset.i18nHtml); });
    root.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = window.t(el.dataset.i18nTitle); });
    root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = window.t(el.dataset.i18nPlaceholder); });
  };

  document.documentElement.lang = lang === "pt" ? "pt-BR" : "en";
  window.applyI18n();
})();
