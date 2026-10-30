# Configuração

Tudo vem do ambiente, com prefixo `KOTAS_`. Nenhum arquivo `.env` é lido.

## Variáveis

| Variável | Default | Para quê |
| --- | --- | --- |
| `KOTAS_CONFIG_DIR` | `~/.config/kotas-mcp` | Sessão, chave e cache |
| `KOTAS_SESSION_KEY` | — | Chave AES base64 de 32 bytes (`openssl rand -base64 32`) |
| `KOTAS_EXPORT_DIR` | `~/Downloads/kotas-export` | O único diretório onde `export` grava |
| `KOTAS_READ_ONLY` | `0` | Não registra `login`, `sync` e `export` |
| `KOTAS_COMPACT` | `0` | Respostas mínimas por padrão |
| `KOTAS_EMAIL` | — | Bootstrap do `login`. Nunca é gravado |
| `KOTAS_SENHA` (ou `KOTAS_PASSWORD`) | — | Bootstrap do `login`. Nunca é gravada |
| `KOTAS_IMPORT_BROWSER` | — | `dia`, `arc`, `chrome`, `chromium`, `brave` ou `edge` |
| `KOTAS_APP_VERSION` | `1.127.0.0` | Header `versao` |
| `KOTAS_API_TOKEN` | chave do front | Chave estática da API, igual para todos |
| `KOTAS_MIN_INTERVAL_MS` | `300` | Intervalo mínimo entre requisições |
| `KOTAS_JITTER_MS` | `200` | Variação aleatória somada ao intervalo |
| `KOTAS_HTTP_TIMEOUT_MS` | `30000` | Timeout por requisição |
| `KOTAS_LOG_FILE` | — | Espelha o log em arquivo (ele sempre sai no stderr) |
| `KOTAS_BASE_URL` | `https://api-front.kotas.com.br` | Só para testes |

Um valor inválido é erro de configuração, não default silencioso — e todos os
problemas são reportados de uma vez.

## Arquivos em disco

| Caminho | Modo | Conteúdo |
| --- | --- | --- |
| `~/.config/kotas-mcp/session.enc` | 0600 | Tokens e identificador do dispositivo, AES-256-GCM |
| `~/.config/kotas-mcp/session.key` | 0600 | Chave gerada, quando não há `KOTAS_SESSION_KEY` |
| `~/.config/kotas-mcp/cache.db` (+ `-wal`, `-shm`) | 0600 | Cache SQLite |
| `~/Downloads/kotas-export/` | 0700 | Saída do `export` |

## Registro no Claude Code

```sh
claude mcp add -s user kotas -- /Users/você/.local/bin/kotas mcp
```

Um servidor com o mesmo nome no escopo de projeto **sombreia** o de usuário —
`bun run setup` remove essas entradas ao instalar.

Para deixar o servidor sem nenhuma escrita local:

```json
{
  "mcpServers": {
    "kotas": {
      "type": "stdio",
      "command": "/Users/você/.local/bin/kotas",
      "args": ["mcp"],
      "env": { "KOTAS_READ_ONLY": "1" }
    }
  }
}
```

## Ritmo

O padrão é ~300 ms mais até 200 ms de jitter entre requisições, ou seja, cerca
de duas por segundo. Os termos de uso do Kotas não preveem uso automatizado; o
ritmo existe para o tráfego ficar parecido com o de uma pessoa. Um histórico de
quatro anos leva uns dois minutos — não vale a pena apressar.
