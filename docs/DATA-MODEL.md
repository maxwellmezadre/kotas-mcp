# Modelo de dados

## Dinheiro

Inteiro em **décimos de milésimo de real** (1 real = 10 000 unidades). A família
de MCPs de compras usa centavos; aqui não serve, porque a API expõe
`valor4Casas` e o rateio divide o valor do grupo pelo número de membros —
R$ 33,32 entre quatro é R$ 8,33 cada, e a reconciliação entre o que os membros
pagam e o que o administrador recebe só fecha com quatro casas.

A conversão para decimal acontece num lugar só, `src/cache/rows.ts`, e devolve
`{ amount, currency: "BRL" }`. `valorFormatado` nunca entra em conta.

`null` não é `0`: "não tem valor" e "custa zero" são fatos diferentes e só um
deles soma.

## Datas

`YYYY-MM-DD`, string. A API manda ISO sem fuso (`2026-09-08T00:00:00`) mais um
gêmeo em pt-BR (`08/09/2026`); só o dia importa, e como string ele ordena
lexicograficamente, o que faz os filtros de período serem comparação simples em
SQL sem nenhum fuso mover um pagamento de mês.

## Entidades

**`invoices` — a raiz.** Um grupo cancelado some da API, então a fatura é o
único registro de que a assinatura existiu. `product` e `group_id` são extraídos
da descrição (`Fatura grupo <produto> #<id>`). `total_units` é o que de fato
saiu da conta e é a única coluna que deve ser somada; `amount_units` é o valor
antes de juros, reajuste e desconto.

**`invoice_items`** — o detalhe, que a listagem manda como `null` e só vem em
`fatura/extrato`.

**`groups`** — as assinaturas que ainda existem. `detail_error` guarda o motivo
quando o detalhe falhou (tipicamente o HTTP 400 de um grupo encerrado), para que
a fila não fique tentando de novo.

**`group_participants`** — só existe para grupo administrado: quem está dentro e
quanto cada um paga.

**`credits`** — o dinheiro que entrou. `available_units` é a cifra que existe;
`amount_units` vem 0 em quase tudo porque a API zera o valor de face depois que
o crédito é consumido.

**`payouts` / `payout_entries`** — o que se recebe como administrador. No
payload, o `id` do repasse **é** o id do grupo. `statement_fetched_at` distingue
"extrato vazio" de "extrato não buscado".

**`meta`** — cursor do sync e carimbos de conclusão.

## Índices e busca

Índices por data de pagamento, status, grupo e vencimento nas faturas; por
papel e status nos grupos; por tipo, grupo e data nos créditos.

Duas tabelas FTS5 com `unicode61 remove_diacritics 2` — é o que faz "credito"
achar "Crédito" — reconstruídas inteiras ao fim de cada sync.

## Payload cru

`raw_list` e `raw_detail` guardam o JSON como veio, com `parser_version` ao
lado. Quando um normalizador melhora, `sync --reparse` reprocessa o histórico
inteiro sem gastar uma requisição.

## O que não existe

- **Valor de face histórico dos créditos.** A API zera; só `credito/extrato`
  ainda o tem, uma requisição por crédito.
- **Fatura de grupo administrado.** O administrador paga o serviço por fora.
- **Detalhe de grupo encerrado.** HTTP 400, para sempre.
- **Credenciais do serviço compartilhado.** Existem na API e não são lidas aqui,
  de propósito.
