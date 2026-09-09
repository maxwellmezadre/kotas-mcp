# Contribuindo

## Ambiente

```sh
bun install
bun run verify      # o portão: tsc + testes + invariantes do servidor real
```

`bun run verify` é o que o CI roda. Se ele passa, o PR passa.

## Convenções

- Código, comentários, testes e **commits em inglês**. Documentação, descrições
  de tool, help do CLI e mensagens de erro **em pt-BR** — quem lê essas é o
  usuário.
- Sem linter. O portão é o `tsc` estrito (`noUncheckedIndexedAccess`,
  `noUnused*`, `verbatimModuleSyntax`) mais os testes.
- Nenhum arquivo de lógica acima de cerca de 450 linhas.
- Conventional Commits, sem escopo, uma linha, até 72 caracteres.
- Mensagem de erro sempre nomeia a correção. `KotasAuthError` já anexa o
  `LOGIN_HINT`; o chamador não consegue esquecer.

## Regras de arquitetura

1. Nenhuma requisição fora de `src/core/http.ts`.
2. Só `src/domain/normalize.ts` conhece nomes de campo do Kotas.
3. SDK do MCP só em `src/mcp/`; commander só em `src/cli/`.
4. Dinheiro em inteiro de quatro casas para dentro; decimal só na borda da tool,
   em `src/cache/rows.ts`.
5. `stdout` é do JSON-RPC. Log só no `stderr`, com os tokens redigidos.
6. Falha de tool vira `isError`, nunca crash.
7. Nada de escrita na conta. Nem uma tool, nem um caminho no `raw_get`.

Uma oitava, específica daqui: **toda fase do `sync` tem que ser retomável por
requisição** (ADR-0012). Se você adicionar uma fase, dê a ela uma marca no
cursor ou uma fila em SQL, e cubra com um teste de `max_requests: 1`.

## Testes

`bun test`, sem framework de mock: os colaboradores entram por
`createContext`. O relógio falso registra cada espera, então ritmo e backoff são
verificados sem esperar de verdade.

Toda armadilha da API vira teste sobre a fixture que a contém, e o nome do
teste descreve a armadilha:

```ts
test("`ativos` always goes out on credits: without it the API answers 404")
```

As fixtures em `test/fixtures/` são respostas reais anonimizadas por
`scripts/anonymize-fixture.ts`; nenhuma captura crua entra no git (ADR-0008).

## Publicando

`git tag vX.Y.Z && git push origin vX.Y.Z` dispara o release: `verify`, publicação
no npm por OIDC (sem token) e os binários para linux-x64, darwin-arm64 e
windows-x64.

## Dado pessoal

`task/` está no `.gitignore` porque a especificação e as capturas de
investigação carregam dados de uma conta real. Antes de colar um payload num
issue, tire os ids, os valores e as datas.
