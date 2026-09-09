# Arquitetura

Camadas, de baixo para cima. Cada uma só conhece a de baixo.

```
config ──▶ core/{errors,logger,sqlite,http} ──▶ session/{jwt,store,login,browser-import}
                                                        │
                                        kotas/{api,types} ──▶ domain/{money,dates,enums,normalize,types}
                                                        │
                                        cache/{db,statements,repo,rows,sync,analytics}
                                                        │
                                                     tools/
                                                    ╱      ╲
                                             mcp/server   cli/index
                                                    ╲      ╱
                                                     bin.ts
```

## Fluxo de uma pergunta

*"Quanto gastei no Kotas em 2026?"*

1. O cliente MCP chama `spending_summary` com `by: "year"`.
2. `mcp/server.ts` valida os argumentos contra o schema TypeBox da tool.
3. A tool chama `cache/analytics.ts`, que faz um `GROUP BY` em SQLite.
4. `cache/rows.ts` converte os inteiros para decimal e devolve `Money`.
5. Nenhuma requisição foi feita: o cache já tinha a resposta.

*"Sincroniza o histórico."*

1. `sync` chama `cache/sync.ts`.
2. Ele pede páginas a `kotas/api.ts`, que conhece as rotas e os dois estilos de
   paginação.
3. `core/http.ts` renova o token se preciso, respeita o ritmo e envia.
4. `domain/normalize.ts` traduz o payload cru para o modelo de domínio.
5. `cache/repo.ts` grava, guardando também o payload cru.

## As sete regras

1. **Nenhuma requisição fora de `src/core/http.ts`.** É o único lugar que sabe
   renovar o token, esperar entre chamadas e recuar em erro.
2. **Só `src/domain/normalize.ts` conhece nomes de campo do Kotas.** Quando a
   API renomear algo, exatamente um arquivo muda.
3. **O SDK do MCP só existe em `src/mcp/`; o commander só em `src/cli/`.**
4. **Dinheiro em inteiro para dentro, decimal só na borda.** A conversão
   acontece em `src/cache/rows.ts` e em nenhum outro lugar.
5. **`stdout` é do JSON-RPC.** Todo log vai para `stderr`, com os tokens
   redigidos.
6. **Falha de tool vira `isError`, nunca derruba o servidor.** Uma chamada ruim
   não pode levar o processo junto.
7. **Nada de escrita na conta.** Nem uma tool, nem um caminho no `raw_get`.

## O que cada diretório faz

| Diretório | Responsabilidade |
| --- | --- |
| `config.ts` | Ambiente → `Config` validado. Nenhum `.env` é lido. |
| `context.ts` | Injeção de dependência. Todo colaborador temporal é substituível. |
| `core/` | Erros, log, SQLite e o funil HTTP. Nada de domínio aqui. |
| `session/` | JWT, sessão cifrada em repouso, login e import do navegador. |
| `kotas/` | Rotas e paginação. Sem normalização. |
| `domain/` | Modelo, dinheiro, datas, enums e o tradutor de payload. |
| `cache/` | Schema, statements, gravação, motor de sync e as consultas analíticas. |
| `tools/` | Uma tool por arquivo, com o schema TypeBox junto. |
| `mcp/`, `cli/` | As duas superfícies, alimentadas pelo mesmo registry. |

## Por que existe cache

Um grupo cancelado responde HTTP 400: some da API. A única fonte do histórico é
`fatura/obterlista`, que exige varrer cinco status paginados — mais de 300
requisições para uma conta com quatro anos de uso. Sem cache, toda pergunta
custaria isso de novo.

Guardar o payload cru ao lado do dado interpretado é o que permite
`sync --reparse`: quando um normalizador melhora, o histórico inteiro é
reprocessado com zero requisições.

## Por que toda fase do sync é retomável por requisição

Uma chamada de tool tem timeout no cliente, então `sync` trabalha com um
orçamento de requisições e devolve `done: false`. Para isso funcionar, **cada
fase precisa retomar de onde parou** — as listagens marcam no cursor que já
rodaram, e o trabalho por item (detalhe de fatura, detalhe de grupo, extrato de
repasse) fica numa fila em SQL. Sem isso, um orçamento pequeno faz as fases
baratas re-rodarem a cada bloco e a fase cara nunca avança.

## Testes

`bun test`, sem framework de mock: os colaboradores são injetados em
`createContext`. O relógio é falso e registra cada espera, então o ritmo e o
backoff são verificados em microssegundos.

As fixtures em `test/fixtures/` são respostas reais da conta, anonimizadas
deterministicamente (ADR-0008), e `test/fixtures.test.ts` roda os normalizadores
sobre elas: é o que separa "o código faz o que o autor imaginou" de "o código
faz o que a API manda".

O portão é `bun run verify`, que roda `tsc --noEmit`, os testes e depois sobe o
**servidor MCP de verdade** por stdio para conferir as promessas que só
aparecem em execução: `stdout` 100% JSON-RPC, log no `stderr`, `tools/list`
igual ao registry, rota de credenciais recusada, servidor vivo depois de vários
erros e o subconjunto exato em modo somente leitura.
