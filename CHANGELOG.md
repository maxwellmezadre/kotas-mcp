# Changelog

Segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e
[SemVer](https://semver.org/lang/pt-BR/).

## [Unreleased]

## [0.1.0] - 2026-09-08

Primeira versão. CLI e servidor MCP para as assinaturas compartilhadas do Kotas,
sobre o mesmo núcleo dos MCPs de compras irmãos (amazon, mercadolivre, shein,
shopee, aliexpress).

### Added

- 16 tools: `auth_status`, `login`, `doctor`, `sync`, `list_subscriptions`,
  `get_subscription`, `list_invoices`, `get_invoice`, `list_credits`, `balance`,
  `list_payouts`, `purchase_history`, `spending_summary`, `search_services`,
  `export` e `raw_get`.
- CLI com um comando por tool e `--json` em todos.
- Login por e-mail e senha (HTTP puro, o Kotas não tem captcha no login), import
  do `localStorage` de um navegador Chromium e colagem manual dos três valores.
- Renovação automática do token de acesso, que dura 15 minutos: proativa antes
  de expirar e reativa num 401, deduplicada por uma promise única em voo.
- Cache SQLite com o payload cru guardado, e `sync --reparse` para reprocessar o
  histórico inteiro sem rede.
- `purchase_history`, que reconstrói a linha do tempo de todas as assinaturas —
  inclusive as encerradas, que já não existem na API.

### Notas

Achados contra a conta real que contradizem a especificação de engenharia
reversa; todos estão em `docs/INTERNAL-API.md` e cada um tem teste:

- `credito/obterlista` **exige** o parâmetro `ativos`: sem ele a resposta é
  HTTP 404, não uma lista vazia.
- `ativos=true` e `ativos=false` são conjuntos disjuntos — os lançamentos em
  vigor e o histórico já consumido. É preciso buscar os dois.
- `valor` e `valor4Casas` vêm sempre `0` na listagem de créditos. A cifra que
  existe é `valorDisponivel4Casas`, e é ela que fecha com o saldo da carteira.
- `grupoId` vem `null` em todo crédito de repasse; o id do grupo está na
  descrição, como nas faturas.
- `api/versao` responde 200 com corpo vazio.
- Grupo que o usuário administra não gera fatura nenhuma: ele paga o serviço por
  fora e recebe o rateio dos membros.

### Segurança

- `grupo/obter-dados-acesso` devolve o login e a senha do serviço compartilhado
  em texto claro. Não existe tool para ela e o `raw_get` a bloqueia (ADR-0010).
- Somente leitura: nenhuma tool altera a conta.

[Unreleased]: https://github.com/maxwellmezadre/kotas-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/maxwellmezadre/kotas-mcp/releases/tag/v0.1.0
