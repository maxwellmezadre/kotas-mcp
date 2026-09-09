# CLI

Todo comando aceita `--json`, que imprime exatamente o objeto que a tool MCP
devolve. Sem ele, a saída é uma tabela legível.

## Sessão

```sh
kotas status [--verify]
kotas login [--email …] [--password …] [--pin 123456]
kotas login --from-browser chrome|arc|chromium|brave|edge
kotas login --paste
kotas doctor [--shallow]
```

`--verify` gasta uma requisição para confirmar que a API ainda aceita a sessão.
`--shallow` pula os testes de grupos, créditos e recebimentos.

## Cache

```sh
kotas sync [--full] [--reparse] [--max-requests 40]
```

O CLI repete os blocos até terminar e imprime o progresso no stderr — o stdout
continua sendo só o resultado final.

## Assinaturas

```sh
kotas subscriptions [--role todos|membro|administrador]
kotas subscription <grupoId>
```

## Financeiro

```sh
kotas invoices [--status pago|pendente|cancelado|atraso|estornado]
               [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--product "SetApp"] [--limit 50]
kotas invoice <faturaId>
kotas credits [--kind adicaoDeSaldo|caucaoDaInscricao|repasseAdministrador|estornoCancelamento]
kotas balance
kotas payouts [--group <grupoId>]
```

## Análise

```sh
kotas history [--active] [--with-credits]
kotas spending --by month|year|product|status [--from …] [--to …]
```

## Catálogo e saída

```sh
kotas search "google one"
kotas export invoices|subscriptions|credits|payouts|history [--format csv|json] [--filename …]
```

## Redescoberta

```sh
kotas raw grupo/categorias
kotas raw credito/obterlista -q page=1 -q pageSize=50 -q ativos=false
```

Só rotas de leitura da allowlist. Verbo de escrita, `..` e a rota de credenciais
do serviço compartilhado são recusados.

## Outros

```sh
kotas tools          # o que está registrado (muda com KOTAS_READ_ONLY)
kotas --version
kotas mcp            # sobe o servidor MCP no stdio
```
