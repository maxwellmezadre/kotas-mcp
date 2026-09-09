# Login

## Por que não precisa de navegador

O formulário de login do Kotas não tem captcha — o hCaptcha só protege o
cadastro. Então `POST autenticacao/token` é chamável por HTTP puro, e este
projeto não depende de Playwright nem de Chrome. É a diferença que faz o binário
ser 62 MB em vez dos 68 MB dos irmãos.

## Caminho normal: e-mail e senha

```sh
kotas login
kotas login --email você@exemplo.com --password 'senha'
KOTAS_EMAIL=… KOTAS_SENHA=… kotas login
```

A senha é usada uma vez, no corpo da requisição, e **nunca é gravada**. O que
fica em disco são os dois tokens e o identificador do dispositivo.

## Import do navegador

```sh
kotas login --from-browser chrome     # arc | chrome | chromium | brave | edge
```

O Kotas guarda a sessão no `localStorage` de `app.kotas.com.br`, não em cookie:

| Chave | Conteúdo |
| --- | --- |
| `@chave` | access token (JWT) |
| `@c08cbbfd6eefc83ac6d23c4c791277e4` | refresh token |
| `SEFTSF9ESVNQT1NJVElWTw==` | identificador do dispositivo |

O Chromium guarda o `localStorage` num diretório LevelDB. Ele é lido varrendo os
registros crus, sem biblioteca: todo binding de LevelDB para JS é um addon
nativo, e addon nativo não entra em `bun build --compile`. O que torna a varredura
confiável é a **validação de forma**: o access token precisa ser um JWT, o
refresh token uma string opaca e o identificador 32 hexadecimais. Um byte que
casou por acaso é descartado em vez de salvo.

Só macOS. Se não achar, a mensagem manda usar `kotas login`.

## Colando à mão

```sh
kotas login --paste
```

Cole, um por linha, os três valores acima (o terceiro é opcional). Serve quando
o navegador não é suportado.

## Verificação em duas etapas

Quando a conta tem 2FA, o código de 6 dígitos vai num **header**, não no corpo:

```sh
kotas login --pin 123456
```

## Liberação de dispositivo (HTTP 412)

O Kotas abre um desafio quando não reconhece o dispositivo ou o IP. Ele devolve
um **novo** identificador, que é gravado na hora — se não fosse, a tentativa
seguinte recomeçaria o desafio. Confirme pelo e-mail, SMS ou Telegram e rode
`kotas login` de novo, na mesma máquina.

## O que fica gravado

`~/.config/kotas-mcp/session.enc`, modo 0600, AES-256-GCM:

```
[0] versão do formato | [1..12] IV | [13..28] tag GCM | [29..] texto cifrado
```

A chave vem de `KOTAS_SESSION_KEY` ou de `session.key` (0600), gerada na
primeira gravação. A escrita é atômica (grava e renomeia), porque o servidor MCP
pode estar salvando uma renovação de token no mesmo instante em que
`kotas login` grava uma sessão nova.

## Ciclo de vida

O access token dura 15 minutos. O funil HTTP o renova sozinho, antes de expirar
e também em resposta a um 401. **O refresh token não rotaciona** — ele continua
valendo, e é o segredo de verdade.

Se você rodar `kotas login` em outro terminal, o servidor MCP percebe pelo
`mtime` do arquivo e recarrega sem precisar reiniciar.

## Revogando

```sh
rm ~/.config/kotas-mcp/session.enc
```

E, no app do Kotas, troque a senha se achar que o refresh token vazou.
