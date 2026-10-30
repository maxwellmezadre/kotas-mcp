# kotas-mcp

[![MIT](https://img.shields.io/badge/licença-MIT-blue.svg)](LICENSE)
[![Bun ≥ 1.3](https://img.shields.io/badge/bun-%E2%89%A5%201.3-black.svg)](https://bun.sh)
[![TypeScript strict](https://img.shields.io/badge/typescript-strict-3178c6.svg)](tsconfig.json)
[![CI](https://github.com/maxwellmezadre/kotas-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/maxwellmezadre/kotas-mcp/actions/workflows/ci.yml)

CLI e servidor MCP para as suas assinaturas compartilhadas no
[Kotas](https://kotas.com.br): grupos, o que você paga em cada um, faturas,
créditos, cauções, repasses recebidos como administrador, saldo, economia
acumulada e o histórico completo — inclusive das assinaturas que você já
encerrou. Tudo em um cache local, para que uma pergunta como *"quanto já gastei
no Kotas?"* seja respondida sem abrir o site.

O Kotas não tem API pública de cliente. Este projeto conversa com a mesma API
que o app `app.kotas.com.br` usa, com a sua própria sessão, **somente leitura**:
nenhuma tool cancela assinatura, saca, paga ou muda um valor.

## Sumário

- [Instalação](#instalação)
- [Login](#login)
- [Uso — CLI](#uso--cli)
- [Uso — MCP](#uso--mcp)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Tools](#tools)
- [Como funciona](#como-funciona)
- [Troubleshooting](#troubleshooting)
- [Documentação](#documentação)
- [Licença](#licença)

## Instalação

### Tudo de uma vez (Claude Code)

```sh
bun run setup
```

Compila o binário, instala em `~/.local/bin/kotas`, registra o servidor MCP no
escopo de usuário do `~/.claude.json` e instala a Skill em
`~/.claude/skills/kotas-mcp/`.

### npm

```sh
npm install -g @maxwellmezadre/kotas-mcp
```

### Binário único

Baixe o executável do seu sistema na [página de
releases](https://github.com/maxwellmezadre/kotas-mcp/releases) e ponha no
`PATH`. Não precisa de runtime instalado.

## Login

Três caminhos, todos gravando o mesmo `session.enc` cifrado:

```sh
kotas login                              # e-mail e senha (pergunta, ou KOTAS_EMAIL/KOTAS_SENHA)
kotas login --from-browser chrome        # importa a sessão de um navegador já logado (macOS)
kotas login --paste                      # cola os três valores do localStorage
```

O login do Kotas não tem captcha, então o caminho por senha é HTTP puro e não
precisa de navegador. A senha é usada uma vez e **nunca é gravada**: só ficam os
dois tokens e o identificador do dispositivo.

Se a conta tiver verificação em duas etapas, passe o código:

```sh
kotas login --pin 123456
```

Se o Kotas pedir liberação de dispositivo (HTTP 412), ele manda um e-mail, SMS
ou mensagem no Telegram. Confirme e rode `kotas login` de novo — o identificador
já foi salvo, então não troque de máquina no meio do processo.

## Uso — CLI

```sh
kotas sync                    # baixa o histórico para o cache (repete os blocos sozinho)
kotas subscriptions           # as assinaturas que você tem hoje
kotas history                 # tudo que você já assinou, inclusive o que encerrou
kotas spending --by month     # quanto por mês
kotas payouts                 # o que você recebe como administrador
kotas balance                 # saldo e economia acumulada
kotas invoices --status pago --from 2026-01-01
kotas subscription 397075     # plano, rateio, vagas e participantes
kotas export history --format csv
```

Todo comando aceita `--json`, que imprime o mesmo objeto que a tool MCP devolve.

## Uso — MCP

```sh
claude mcp add -s user kotas -- /Users/você/.local/bin/kotas mcp
```

Ou à mão, no `~/.claude.json`:

```json
{
  "mcpServers": {
    "kotas": {
      "type": "stdio",
      "command": "/Users/você/.local/bin/kotas",
      "args": ["mcp"]
    }
  }
}
```

Use o caminho absoluto: clientes MCP não herdam o `PATH` do seu shell. Depois é
só perguntar: *"quanto já gastei no Kotas?"*, *"quais assinaturas eu tenho e
quanto pago em cada uma?"*, *"quanto vou receber como administrador este mês?"*

## Variáveis de ambiente

| Variável | Default | Para quê |
| --- | --- | --- |
| `KOTAS_CONFIG_DIR` | `~/.config/kotas-mcp` | Onde ficam sessão, chave e cache |
| `KOTAS_SESSION_KEY` | — | Chave AES em base64 de 32 bytes; sem ela, uma é gerada em `session.key` |
| `KOTAS_EXPORT_DIR` | `~/Downloads/kotas-export` | O único diretório onde `export` escreve |
| `KOTAS_READ_ONLY` | `0` | Não registra `login`, `sync` e `export` |
| `KOTAS_COMPACT` | `0` | Respostas mínimas por padrão, para economizar contexto |
| `KOTAS_EMAIL` / `KOTAS_SENHA` | — | Só para o bootstrap do `login`; nunca são gravadas |
| `KOTAS_IMPORT_BROWSER` | — | `dia` \| `arc` \| `chrome` \| `chromium` \| `brave` \| `edge` |
| `KOTAS_APP_VERSION` | `1.127.0.0` | Header `versao`; se a API responder 426, atualize |
| `KOTAS_API_TOKEN` | (chave do front) | Chave estática da API, igual para todo mundo |
| `KOTAS_MIN_INTERVAL_MS` | `300` | Intervalo mínimo entre requisições |
| `KOTAS_JITTER_MS` | `200` | Variação aleatória somada ao intervalo |
| `KOTAS_HTTP_TIMEOUT_MS` | `30000` | Timeout de cada requisição |
| `KOTAS_LOG_FILE` | — | Espelha o log (que sai no stderr) em um arquivo |
| `KOTAS_BASE_URL` | `https://api-front.kotas.com.br` | Só para testes |

## Tools

| Tool | Comando | Rede |
| --- | --- | --- |
| `auth_status` | `kotas status [--verify]` | 0 (1 com `--verify`) |
| `login` | `kotas login` | 1–2 |
| `doctor` | `kotas doctor` | ≈ 6 (3 com `--shallow`) |
| `sync` | `kotas sync [--full\|--reparse]` | em blocos |
| `list_subscriptions` | `kotas subscriptions` | 0 |
| `get_subscription` | `kotas subscription <id>` | 0 (1 se não estiver no cache) |
| `list_invoices` | `kotas invoices` | 0 |
| `get_invoice` | `kotas invoice <id>` | 0 (1 se faltarem os itens) |
| `list_credits` | `kotas credits` | 0 |
| `balance` | `kotas balance` | 2 |
| `list_payouts` | `kotas payouts` | 0 |
| `purchase_history` | `kotas history` | 0 |
| `spending_summary` | `kotas spending --by …` | 0 |
| `search_services` | `kotas search <termo>` | 1 |
| `export` | `kotas export <escopo>` | 0 |
| `raw_get` | `kotas raw <rota>` | 1 |

Referência completa dos parâmetros em [`docs/TOOLS.md`](docs/TOOLS.md), gerada a
partir do registry.

## Como funciona

1. **Sessão.** Dois tokens JWT (acesso e renovação) mais o identificador do
   dispositivo, cifrados com AES-256-GCM em `~/.config/kotas-mcp/session.enc`,
   modo 0600. O token de acesso dura 15 minutos e é renovado sozinho.
2. **Um funil só.** Toda requisição passa por `src/core/http.ts`, que serializa
   as chamadas, respeita um intervalo mínimo com jitter, faz backoff em 429/5xx
   e cuida da renovação do token.
3. **Faturas como raiz.** Um grupo cancelado some da API, então o histórico é
   reconstruído a partir da descrição das faturas
   (`Fatura grupo <produto> #<id>`). É por isso que `purchase_history` enxerga
   assinaturas que o site já não mostra.
4. **Cache local.** SQLite em `~/.config/kotas-mcp/cache.db`, com o payload cru
   guardado ao lado do dado interpretado — assim `sync --reparse` reprocessa
   todo o histórico sem gastar uma requisição.

## Troubleshooting

| Sintoma | O que fazer |
| --- | --- |
| `Nenhuma sessão do Kotas salva` | `kotas login` ou `kotas login --from-browser chrome` |
| `O Kotas pediu a liberação do dispositivo` (412) | Confirme o e-mail/SMS/Telegram e rode `kotas login` de novo |
| `A conta tem verificação em duas etapas` | `kotas login --pin 123456` |
| `sync` devolve `done: false` | É esperado: chame de novo até `done: true` (o CLI já faz isso) |
| Listas vazias | O cache está vazio: rode `kotas sync` |
| HTTP 426 | A versão do front mudou: ajuste `KOTAS_APP_VERSION` |
| HTTP 400 em um grupo | O grupo foi encerrado e não existe mais na API; use `kotas history` |
| Algo quebrou de um jeito estranho | `kotas doctor` diz qual camada |

## Documentação

| Arquivo | Conteúdo |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Camadas, regras duras e por que cada uma existe |
| [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) | Variáveis, arquivos em disco e registro no Claude Code |
| [`docs/USAGE.md`](docs/USAGE.md) | Do zero à primeira pergunta |
| [`docs/CLI.md`](docs/CLI.md) | Referência dos comandos |
| [`docs/TOOLS.md`](docs/TOOLS.md) | Referência das tools (gerada) |
| [`docs/LOGIN.md`](docs/LOGIN.md) | Os três caminhos de login e o que fica gravado |
| [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) | Modelo de domínio e schema do cache |
| [`docs/INTERNAL-API.md`](docs/INTERNAL-API.md) | A API do Kotas e as armadilhas confirmadas |
| [`docs/REDISCOVERY.md`](docs/REDISCOVERY.md) | O que fazer quando o Kotas mudar |
| [`docs/adr/`](docs/adr) | Uma decisão por arquivo |
| [`test/fixtures/README.md`](test/fixtures/README.md) | O que as fixtures são e o que a anonimização faz |

## Licença

MIT. Veja [LICENSE](LICENSE).
