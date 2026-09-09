# ADR-0012: Toda fase do sync retomável por requisição

Status: Aceito

## Contexto

Uma chamada de tool tem timeout no cliente, então `sync` trabalha com orçamento
de requisições e devolve `done: false` pedindo para ser chamado de novo. A
primeira versão tratava cada fase como uma unidade: faturas, depois grupos,
depois créditos, depois recebimentos, depois os detalhes das faturas.

Isso tem um modo de falha que só aparece com orçamento pequeno. As fases baratas
re-rodam a cada bloco, consomem o orçamento inteiro e a fase cara — os detalhes
de fatura, uma requisição cada — nunca avança. `done` nunca vira `true` e o sync
roda para sempre. Um teste com `max_requests: 1` pegou isso.

## Decisão

Cada fase é retomável na granularidade de **uma requisição**:

- As listagens marcam no cursor que já terminaram (`invoicesDone`,
  `groupsListed`, `creditsActiveDone`, `creditsHistoryDone`, `payoutsListed`).
- O trabalho por item fica numa fila em SQL, não em memória: detalhe de fatura,
  detalhe de grupo e extrato de repasse são consultas sobre colunas
  `*_fetched_at` / `*_error`.

Uma fase concluída não gasta nada nos blocos seguintes, então o que sobra vai
sempre para a fila mais cara.

## Consequências

`sync` termina com qualquer orçamento, inclusive `max_requests: 1` — e há um
teste que roda exatamente esse caso até o fim.

Um bloco que morre no meio não perde nada: o que já foi gravado está gravado, e
a fila em SQL sabe o que falta.

Exigiu uma coluna a mais (`payouts.statement_fetched_at`), porque um extrato
vazio é um fato e precisa ser distinguível de "ainda não busquei" — sem ela a
fila giraria para sempre no mesmo grupo.
