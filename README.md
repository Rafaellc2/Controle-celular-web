# Controle Web — celulares como controles de Xbox 360 no PC

Use a tela do smartphone (navegador, mesma rede Wi-Fi) como gamepad para jogar
emuladores como **PCSX2** e **PPSSPP** (Bomba Patch) no Windows ou no Linux.
Vários celulares ao mesmo tempo: cada um vira um **JOYSTICK-1, 2, 3...**

O servidor Python cria um **controle Xbox 360 virtual** pelo driver **ViGEmBus**;
para o Windows e para o emulador ele é idêntico a um controle físico.

```
Celular (navegador)  --WebSocket/Wi-Fi-->  server.py  --vgamepad-->  ViGEmBus  -->  Emulador
```

## Estrutura

```
controle-web     # lançador: sobe o servidor (se preciso) e abre o painel
server/
  server.py      # HTTP + WebSockets (/ws celulares, /admin/ws painel), IP e QR Code
  screen.py      # transmissão da tela do PC (MJPEG) para o fundo do controle
  hub.py         # slots JOYSTICK-N, reservas, comandos do painel
  gamepad.py     # controle virtual por slot (ViGEmBus, uinput ou só log em --dry-run)
admin/           # painel (só abre em http://localhost neste PC)
public/
  index.html     # layout do controle
  style.css
  app.js         # multi-touch, envio otimizado, reconexão automática
requirements.txt
```

## 1. Instalação no Windows

### 1.1 Python
Instale o **Python 3.10 ou superior** em <https://www.python.org/downloads/>.
No instalador, marque **"Add python.exe to PATH"**.

### 1.2 Driver ViGEmBus
1. Baixe o instalador mais recente em
   <https://github.com/nefarius/ViGEmBus/releases>
   (arquivo `ViGEmBus_1.22.0_x64_x86_arm64.exe` ou versão mais nova).
2. Execute e conclua a instalação.
3. Reinicie o computador.

> Ao rodar `pip install vgamepad` no Windows, o pacote também pode abrir o
> instalador do ViGEmBus automaticamente. Se já estiver instalado, apenas feche.

### 1.3 Dependências do projeto
Abra o PowerShell na pasta do projeto:

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## 2. Executar

```powershell
python server/server.py
```

O terminal mostra o endereço (ex.: `http://192.168.0.15:8080`) e um **QR Code**.

Opções:

| Opção        | Efeito                                                      |
|--------------|-------------------------------------------------------------|
| `--port N`   | Muda a porta (padrão `8080`, ou `CONTROLE_WEB_PORT`)        |
| `--https-port N` | Porta HTTPS para o giroscópio (padrão `8443`; `0` desliga) |
| `--name NOME` | Link fixo `http://NOME.local` (padrão `controle`)          |
| `--max-players N` | Quantidade inicial de controles (padrão 4, máx. 8; muda no painel) |
| `--screen`   | Já começa com a transmissão da tela ligada (liga/desliga também no painel) |
| `--screen-width N` / `--screen-fps N` / `--screen-quality N` / `--screen-monitor NOME` | Largura (1280), fps (60), qualidade JPEG 2–31 (6); o painel também ajusta e guarda em `~/.controle-web/screen.json` e monitor da transmissão |
| `--dry-run`  | Não cria o controle virtual; só mostra as entradas no log   |
| `--verbose`  | Loga também os movimentos do analógico                      |

### Firewall
Na primeira execução o Windows pergunta se o Python pode acessar a rede:
permita em **Redes privadas**. Confirme também que sua conexão Wi-Fi está como
perfil **Privado** (Configurações → Rede e Internet → Wi-Fi → propriedades).
No Linux com ufw, libere as duas portas (o painel mostra o comando):
`sudo ufw allow from 192.168.0.0/24 to any port 8080,8443 proto tcp`.

### Links
O painel mostra três links (com QR Code):

| Link | Quando usar |
|------|-------------|
| **Link fixo** `http://controle.local:8080` | Padrão. Não muda quando o IP do PC muda, então o layout salvo no celular continua. iPhone e Android 12+. |
| **Pelo IP** `http://192.168.x.x:8080` | Celular que não abre o `.local`. |
| **Com giroscópio** `https://192.168.x.x:8443` | Para usar o giroscópio (o navegador só libera o sensor em HTTPS). Na primeira vez aparece o aviso de certificado: **Avançado → Continuar**. |

O certificado HTTPS é gerado sozinho em `~/.controle-web/`. Cada link guarda
seus próprios perfis no celular (o navegador separa por endereço).

## 3. Conectar o celular

1. Celular e PC na **mesma rede Wi-Fi**.
2. Escaneie o QR Code (ou digite o endereço no Chrome/Safari).
3. Gire o celular para a **horizontal** e toque em **⛶ Tela cheia**.
4. O indicador no topo mostra o status e a latência (ping ida e volta).

Para abrir mais rápido depois, use "Adicionar à tela inicial" no navegador.

## 3b. Painel e vários jogadores

Abra **http://localhost:8080/admin** no PC (só funciona neste computador).
No Linux, o app **Controle Web** no menu (Super + Space) sobe o servidor e
abre o painel direto.

- **Acesso ligado/desligado:** desligado, ninguém entra e quem estava
  conectado sai. Os celulares ficam esperando e entram sozinhos quando você
  religar.
- **Link e QR Code** para passar aos amigos, com botão de copiar.
- **Controles:** um cartão por JOYSTICK-N com o aparelho, IP, ping, botões
  apertados, os dois analógicos e a vibração do jogo ao vivo (bom para
  testar). Dá para dar nome ao jogador, **achar** (o celular dele pisca na
  cor do JOYSTICK e vibra), **mover** para outro número (troca com quem
  estiver lá) ou **remover**.
- **Jogadores:** quantos controles existem (1 a 8).
- **Avisos:** firewall bloqueando a porta, ou controle virtual em modo de
  teste (sem driver/permissão), com o comando para resolver.
- **Encerrar servidor:** desliga tudo (clique duas vezes).

Cada celular guarda um ID no navegador. Se cair, o número dele fica
reservado por 60 s e ele volta para o mesmo JOYSTICK. Com a sala cheia, um
celular novo pega a vaga de quem caiu há mais tempo.

Os controles virtuais são criados em ordem (JOYSTICK-1 primeiro) e ficam
existindo até encerrar o servidor, para o emulador não perder o mapeamento.

### Atalho no menu (Linux)

Crie `~/.local/share/applications/controle-web.desktop` apontando para o
lançador:

```ini
[Desktop Entry]
Type=Application
Name=Controle Web
Comment=Celulares como controles de videogame para jogar com os amigos
Exec=/caminho/para/controle_celular_web/controle-web
Icon=input-gaming
Terminal=false
Categories=Game;Utility;
```

O log do servidor fica em `$XDG_RUNTIME_DIR/controle-web.log`.

## 4. Layout e mapeamento

| Tela (PlayStation) | Controle virtual (Xbox 360) |
|--------------------|-----------------------------|
| ✕                  | A                           |
| ○                  | B                           |
| □                  | X                           |
| △                  | Y                           |
| L1 / R1            | LB / RB                     |
| L2 / R2            | LT / RT (gatilho total)     |
| SELECT / START     | Back / Start                |
| D-pad              | D-pad (com diagonais)       |
| Analógico esquerdo / direito | Analógicos esquerdo / direito |
| L3 / R3 (ocultos no padrão) | Clique dos analógicos |

Multi-touch: dá para segurar R1 (correr) e apertar ✕/○/□ ao mesmo tempo, e
deslizar o dedo de um botão de ação para outro sem levantar.

### Ajustes no celular (⚙)

- **Perfis do HUD:** um layout e ajustes por jogo (ex.: "Bomba Patch",
  "Corrida"). **+ Novo** copia o perfil atual. Tudo fica salvo no celular.
- **Editar HUD:** arraste para mover, pinça com dois dedos (ou − / +) para o
  tamanho, **◐ − / +** para a transparência (sem nenhum botão selecionado
  muda todos de uma vez), **Ocultar/Mostrar** botões (L3/R3 começam ocultos).
- **Tela do PC no fundo:** mostra a tela do computador atrás do controle.
  Primeiro ligue **Tela do PC** no painel (vem desligada por segurança) e
  depois ative no menu do celular. No Linux/Wayland usa `gpu-screen-recorder`
  + `ffmpeg` (precisam estar instalados); no Windows usa só o `ffmpeg`.
  Jogos em tela cheia exclusiva podem aparecer pretos: use janela sem borda.
- **Analógico flutuante:** o analógico esquerdo aparece onde o dedo encostar
  no lado esquerdo da tela.
- **Vibração ao apertar:** desligada, fraca, média ou forte, com botão de teste.
- **Vibração do jogo:** o celular vibra quando o jogo manda vibrar o
  controle (Linux e Windows).
- **Giroscópio** (precisa do link HTTPS): **Volante** controla o analógico
  esquerdo girando o celular; **Inclinar** usa também frente/trás.
  **Centralizar** define a posição neutra; **Inverter** troca o sentido.
  Encostar no analógico tem prioridade sobre o giroscópio.

## 5. Configurar o emulador

Deixe o servidor rodando **e o celular conectado** antes de abrir o emulador,
para que o controle virtual já exista.

### PCSX2 (2.x)
1. **Configurações → Controles**.
2. **Porta de Controle 1** → tipo **DualShock 2**.
3. Clique em **Mapeamento Automático** (Automatic Mapping) e escolha
   **XInput-0** (ou SDL-0 "Xbox 360 Controller").
4. Pronto: ✕ = Cruz, ○ = Círculo, □ = Quadrado, △ = Triângulo, L1/R1/L2/R2 iguais.

### PPSSPP
1. **Configurações → Controles → Mapeamento de controles**.
2. Os padrões para XInput costumam já funcionar. Se não, clique em cada ação
   e pressione o botão correspondente no celular.
3. Analógico: mapeie **Analógico para cima/baixo/esquerda/direita** para o
   analógico esquerdo.

### Verificar se o Windows enxerga o controle
Pressione `Win + R`, digite `joy.cpl` e abra o "Controller (XBOX 360 For
Windows)". Os botões acendem quando você toca no celular.

## 5b. Linux

No Linux o controle virtual é criado pelo `uinput` do kernel (sem ViGEmBus),
com os mesmos IDs de um controle Xbox 360 (driver `xpad`). Steam, SDL,
PCSX2, PPSSPP e RetroArch reconhecem normalmente.

```bash
python -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Por padrão só o root acessa `/dev/uinput`. Libere para seu usuário:

- **Temporário (até reiniciar):**
  ```bash
  sudo setfacl -m u:$USER:rw /dev/uinput
  ```
- **Permanente** (acesso para o usuário logado na sessão local):
  ```bash
  echo 'KERNEL=="uinput", SUBSYSTEM=="misc", TAG+="uaccess", OPTIONS+="static_node=uinput"' \
    | sudo tee /etc/udev/rules.d/60-uinput.rules
  ```
  e reinicie o computador.

> Aviso: acesso ao `uinput` permite que programas do seu usuário simulem
> teclado e mouse. Dê essa permissão só em máquina pessoal.

Rode `.venv/bin/python server/server.py`. O log deve mostrar
`Controle Xbox 360 virtual criado (uinput: /dev/input/eventN)`.

Para conferir: abra <https://hardwaretester.com/gamepad> no navegador do PC,
ou rode `.venv/bin/python -m evdev.evtest` e escolha "Microsoft X-Box 360 pad".

## 6. Dicas de latência

- Prefira Wi-Fi **5 GHz** e o PC ligado no roteador por cabo, se possível.
- Desative o modo de economia de bateria do celular.
- Mantenha a página em primeiro plano (o app solta todos os botões ao ir para
  segundo plano, por segurança).
- Latência típica numa rede boa: 5–20 ms de ida e volta.

## 7. Solução de problemas

| Problema | Solução |
|----------|---------|
| `Não foi possível criar o controle virtual` | ViGEmBus não instalado ou PC não reiniciado após instalar. |
| Celular não abre a página | Firewall bloqueando; rede marcada como Pública; ou o roteador tem "isolamento de clientes/AP isolation" (desative ou use outra rede). |
| IP errado no QR (VPN, várias placas de rede) | Rode `ipconfig` e use o IPv4 do adaptador Wi-Fi/Ethernet manualmente. |
| `address already in use` | Outra coisa usa a porta: `python server/server.py --port 8090`. |
| Status fica em "Reconectando…" | Servidor fechado ou celular mudou de rede; o app reconecta sozinho quando voltar. |
| Botão "preso" | Impossível pela lógica (desconexão/segundo plano soltam tudo), mas tocar e soltar o botão corrige. |
| Quero testar sem Windows | `python server/server.py --dry-run` (funciona em Linux/macOS, sem `vgamepad`). |

## Protocolo (para quem quiser estender)

Mensagens JSON texto pelo WebSocket `/ws`:

| Mensagem                            | Significado                              |
|-------------------------------------|------------------------------------------|
| `{"b":"A","s":1}` / `{"b":"A","s":0}` | Botão pressionado / solto (`A B X Y LB RB LT RT START BACK UP DOWN LEFT RIGHT L3 R3`) |
| `{"a":"L","x":0.75,"y":-0.2}`       | Analógico `L` ou `R`, valores de -1 a 1 (y positivo = para baixo na tela) |
| `{"r":1}`                           | Soltar tudo                              |
| `{"p":123.4,"rtt":12}`              | Ping; o servidor devolve a mesma mensagem e guarda o `rtt` para o painel |

Conexão: `/ws?cid=<id do celular>&dev=<aparelho>`. O servidor responde
`{"t":"hello","slot":N,"name":"..."}` e depois pode mandar
`{"t":"slot","slot":N}` (movido) ou `{"t":"name","name":"..."}`.
Códigos de fechamento: `4000` aberto em outra aba, `4001` acesso desligado,
`4002` sala cheia, `4003` removido pelo painel.

Do servidor para o celular também vêm `{"t":"rumble","v":0.75,"ms":500}`
(vibração do jogo; `ms` nulo = até chegar `v:0`) e `{"t":"find","slot":N}`
(achar controle). O `hello` traz `"https"` com o link seguro, se houver.

Otimizações: botões são enviados só quando mudam; o analógico é agrupado em no
máximo um pacote por quadro (`requestAnimationFrame`) com o valor mais recente,
e é segurado se o buffer do socket passar de 1 KB, evitando fila acumulada.
