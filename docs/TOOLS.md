# Tools

> Gerado por `bun run docs:tools` a partir de `src/tools/registry.ts`. Não edite à mão.

O servidor expõe **16 tools**. Com `KOTAS_READ_ONLY=1` as 3 que escrevem algo (sessão, cache, arquivo) não são registradas.

| Tool | Escreve | O que faz |
| --- | --- | --- |
| [`auth_status`](#authstatus) | — | Diz se há uma sessão do Kotas salva, de quem ela é e até quando o token vale, e o que já está no cache local. … |
| [`login`](#login) | sim | Salva uma sessão do Kotas em disco, cifrada. Três caminhos: e-mail e senha (`email`+`password`, ou as variávei… |
| [`doctor`](#doctor) | — | Diagnóstico camada a camada: configuração, sessão salva, renovação do token, versão do front, grupos, faturas,… |
| [`sync`](#sync) | sim | Baixa o histórico do Kotas para o cache local. Trabalha em blocos: faz até max_requests chamadas e devolve `do… |
| [`list_subscriptions`](#listsubscriptions) | — | Lista as assinaturas compartilhadas (grupos) do Kotas a partir do cache local, com o que você paga em cada uma… |
| [`get_subscription`](#getsubscription) | — | Detalha uma assinatura: plano, o que você paga, o valor cheio do serviço, a taxa da Kotas, vagas, fidelidade e… |
| [`list_invoices`](#listinvoices) | — | Lista as faturas do Kotas a partir do cache local, da mais recente para a mais antiga. Não usa a rede. ATENÇÃO… |
| [`get_invoice`](#getinvoice) | — | Detalha uma fatura, com os itens que a compõem. Lê o cache; se os itens ainda não estiverem lá, busca 1 vez na… |
| [`list_credits`](#listcredits) | — | Lista os lançamentos de crédito do cache com o significado de cada tipo traduzido: adição de saldo, caução da … |
| [`balance`](#balance) | — | Saldo da carteira Kotas ao vivo (1–2 requisições): disponível, bloqueado (as cauções das inscrições) e pendent… |
| [`list_payouts`](#listpayouts) | — | Lista os recebimentos como administrador: quanto cada grupo repassa por ciclo, quanto cada membro paga e a dat… |
| [`purchase_history`](#purchasehistory) | — | Reconstrói a linha do tempo de TODAS as assinaturas já pagas, inclusive as encerradas, a partir das faturas — … |
| [`spending_summary`](#spendingsummary) | — | Soma os gastos no Kotas agrupados por mês, ano, produto ou situação. Conta apenas faturas PAGAS por padrão: ca… |
| [`search_services`](#searchservices) | — | Busca serviços no catálogo do Kotas pelo nome (Netflix, Spotify, Google One…) e devolve os planos disponíveis … |
| [`export`](#export) | sim | Exporta o cache para CSV ou JSON dentro de KOTAS_EXPORT_DIR (por padrão ~/Downloads/kotas-export). Não usa a r… |
| [`raw_get`](#rawget) | — | Chama uma rota GET da API do Kotas diretamente, com a mesma sessão, o mesmo ritmo e os mesmos headers das outr… |

## `auth_status`

Diz se há uma sessão do Kotas salva, de quem ela é e até quando o token vale, e o que já está no cache local. Não usa a rede por padrão. Com verify=true gasta 1 requisição para confirmar que o Kotas ainda aceita a sessão (renovando o token se preciso). Comece por aqui quando outra tool reclamar de sessão. Nunca devolve o valor de um token.

**Escreve em disco/cache:** não

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `verify` | boolean | — | Também faz 1 chamada ao Kotas para confirmar que a sessão é aceita |

## `login`

Salva uma sessão do Kotas em disco, cifrada. Três caminhos: e-mail e senha (`email`+`password`, ou as variáveis KOTAS_EMAIL/KOTAS_SENHA); importando de um navegador já logado (`from_browser`); ou colando os três valores do localStorage (`tokens`). A senha é usada uma vez e nunca é gravada. Se a conta tiver verificação em duas etapas, passe `pin`.

**Escreve em disco/cache:** sim

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `email` | string (min 3 chars) | — | E-mail da conta Kotas |
| `password` | string (min 1 chars) | — | Senha; usada uma vez, nunca gravada |
| `pin` | string (`^\d{4,8}$`) | — | Código de 6 dígitos da verificação em duas etapas |
| `from_browser` | `dia` \| `arc` \| `chrome` \| `chromium` \| `brave` \| `edge` | — | Importa a sessão do localStorage deste navegador (macOS) |
| `tokens` | object | — | Sessão colada à mão, do DevTools do navegador |

## `doctor`

Diagnóstico camada a camada: configuração, sessão salva, renovação do token, versão do front, grupos, faturas, créditos, recebimentos e cache. Use quando algo falhar de um jeito estranho: ele diz qual camada quebrou. Gasta cerca de 6 requisições (2 com deep=false).

**Escreve em disco/cache:** não

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `deep` | boolean | — | Também testa grupos, créditos e recebimentos (default true) |

## `sync`

Baixa o histórico do Kotas para o cache local. Trabalha em blocos: faz até max_requests chamadas e devolve `done: false` com um `hint`. CHAME DE NOVO com os mesmos parâmetros até `done: true`. Nunca chame em paralelo nem dispare outras tools de rede junto. Varre as faturas dos cinco status (é a única fonte do histórico), depois grupos, créditos e recebimentos. `mode: reparse` reprocessa o que já está no cache sem usar a rede.

**Escreve em disco/cache:** sim

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `mode` | `incremental` \| `full` \| `reparse` | — | incremental (default depois do primeiro full) para no primeiro bloco sem novidade; full varre tudo; reparse não usa a rede |
| `max_requests` | integer (≥ 1, ≤ 200) | — | Orçamento de requisições do bloco (default 40) |
| `with_groups` | boolean | — | Também sincroniza os grupos (default true) |
| `with_credits` | boolean | — | Também sincroniza os créditos (default true) |
| `with_payouts` | boolean | — | Também sincroniza os recebimentos de administrador (default true) |
| `with_invoice_items` | boolean | — | Também busca os itens de cada fatura, 1 requisição por fatura (default true) |

## `list_subscriptions`

Lista as assinaturas compartilhadas (grupos) do Kotas a partir do cache local, com o que você paga em cada uma, quantas vagas tem e se você é membro ou administrador. Não usa a rede. Só aparecem grupos que ainda existem na API: um grupo encerrado some do Kotas e só sobrevive nas faturas — para o histórico completo use `purchase_history`.

**Escreve em disco/cache:** não

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `role` | `todos` \| `membro` \| `administrador` | — | Filtra pelo seu papel no grupo (default todos) |
| `limit` | integer (≥ 1, ≤ 200) | — | Máximo de itens (default 100) |
| `compact` | boolean | — | Devolve apenas os campos essenciais, para economizar contexto (default KOTAS_COMPACT) |

## `get_subscription`

Detalha uma assinatura: plano, o que você paga, o valor cheio do serviço, a taxa da Kotas, vagas, fidelidade e os participantes com o que cada um paga — a API devolve os participantes tanto para membro quanto para administrador. Lê o cache; se o grupo não estiver lá, busca 1 vez na API. NÃO devolve login nem senha do serviço compartilhado: o kotas-mcp nunca expõe essas credenciais.

**Escreve em disco/cache:** não

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `group_id` | integer (≥ 1) | sim | Id do grupo no Kotas, como aparece em `list_subscriptions` ou na descrição da fatura |
| `compact` | boolean | — | Devolve apenas os campos essenciais, para economizar contexto (default KOTAS_COMPACT) |

## `list_invoices`

Lista as faturas do Kotas a partir do cache local, da mais recente para a mais antiga. Não usa a rede. ATENÇÃO ao somar: só fatura com status `pago` é dinheiro que saiu da conta — cancelada e estornada não são gasto. O campo a somar é `total`, nunca `amount`. Use `product` para saber de qual assinatura a cobrança era, inclusive de grupos que já foram encerrados.

**Escreve em disco/cache:** não

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `status` | `pago` \| `pendente` \| `cancelado` \| `atraso` \| `estornado` | — | Filtra por situação da fatura |
| `from` | string (`^\d{4}-\d{2}-\d{2}$`) | — | Data inicial (YYYY-MM-DD), sobre a data de pagamento ou vencimento |
| `to` | string (`^\d{4}-\d{2}-\d{2}$`) | — | Data final (YYYY-MM-DD) |
| `group_id` | integer (≥ 1) | — | Só as faturas deste grupo |
| `product` | string (min 1 chars) | — | Nome exato do produto, como aparece em `product` |
| `limit` | integer (≥ 1, ≤ 500) | — | Máximo de itens (default 50) |
| `offset` | integer (≥ 0) | — | Itens a pular (paginação) |
| `compact` | boolean | — | Devolve apenas os campos essenciais, para economizar contexto (default KOTAS_COMPACT) |

## `get_invoice`

Detalha uma fatura, com os itens que a compõem. Lê o cache; se os itens ainda não estiverem lá, busca 1 vez na API (`fatura/extrato`), porque a listagem devolve `itens: null`.

**Escreve em disco/cache:** não

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `invoice_id` | integer (≥ 1) | sim | Id da fatura no Kotas, como aparece em `list_invoices` |

## `list_credits`

Lista os lançamentos de crédito do cache com o significado de cada tipo traduzido: adição de saldo, caução da inscrição (fica bloqueada), repasse recebido como administrador e estorno de cancelamento. Não usa a rede. É aqui que aparece o dinheiro que ENTROU — as faturas só mostram o que saiu. ATENÇÃO: use `available`, não `amount`. A API zera o valor de face de todo lançamento já consumido, então `amount` vem 0 em quase tudo; `available` é a cifra que existe de verdade e é a que soma com o saldo da carteira.

**Escreve em disco/cache:** não

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `kind` | `adicaoDeSaldo` \| `caucaoDaInscricao` \| `repasseAdministrador` \| `estornoCancelamento` | — | Filtra pelo tipo do lançamento |
| `limit` | integer (≥ 1, ≤ 500) | — | Máximo de itens (default 100) |

## `balance`

Saldo da carteira Kotas ao vivo (1–2 requisições): disponível, bloqueado (as cauções das inscrições) e pendente, mais a economia acumulada que a própria Kotas calcula. O saldo bloqueado não é dinheiro perdido: volta quando a assinatura é encerrada.

**Escreve em disco/cache:** não

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `with_savings` | boolean | — | Também busca a economia acumulada (1 requisição extra, default true) |

## `list_payouts`

Lista os recebimentos como administrador: quanto cada grupo repassa por ciclo, quanto cada membro paga e a data do próximo pagamento. Lê o cache, não usa a rede. Com group_id devolve também o extrato daquele grupo, participante por participante. Status `Cancelado` significa que o repasse não vai mais acontecer — não some no previsto.

**Escreve em disco/cache:** não

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `group_id` | integer (≥ 1) | — | Também traz o extrato deste grupo |
| `only_scheduled` | boolean | — | Só os repasses agendados (default false) |

## `purchase_history`

Reconstrói a linha do tempo de TODAS as assinaturas já pagas, inclusive as encerradas, a partir das faturas — que é a única fonte que sobra, porque um grupo cancelado some da API. Para cada produto devolve a primeira e a última fatura, quantos meses foram pagos, o total pago, se ainda está ativo, a caução retida e o que foi recebido como administrador. Grupos que o usuário ADMINISTRA aparecem com `monthsPaid: 0` e `totalPaid: null`: neles não há fatura, o administrador paga o serviço por fora e recebe o rateio dos membros. Não usa a rede.

**Escreve em disco/cache:** não

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `include_credit_purchases` | boolean | — | Inclui as compras de crédito avulso, que não pertencem a nenhum grupo (default false) |
| `active_only` | boolean | — | Só as assinaturas que ainda existem hoje (default false) |

## `spending_summary`

Soma os gastos no Kotas agrupados por mês, ano, produto ou situação. Conta apenas faturas PAGAS por padrão: cancelada e estornada não são dinheiro que saiu. Não usa a rede. A data usada é a do pagamento e, na falta dela, a do vencimento.

**Escreve em disco/cache:** não

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `by` | `month` \| `year` \| `product` \| `status` | sim | Como agrupar |
| `from` | string (`^\d{4}-\d{2}-\d{2}$`) | — | Data inicial (YYYY-MM-DD) |
| `to` | string (`^\d{4}-\d{2}-\d{2}$`) | — | Data final (YYYY-MM-DD) |
| `include_unpaid` | boolean | — | Inclui faturas não pagas — só faz sentido com by=status (default false) |

## `search_services`

Busca serviços no catálogo do Kotas pelo nome (Netflix, Spotify, Google One…) e devolve os planos disponíveis com o valor cheio e quantas kotas cada um tem. Gasta 1 requisição. Isto é o CATÁLOGO: para o que você já assinou ou pagou, use `purchase_history` ou `list_invoices`.

**Escreve em disco/cache:** não

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `query` | string (min 2 chars) | sim | Nome ou parte do nome do serviço |
| `limit` | integer (≥ 1, ≤ 50) | — | Máximo de serviços (default 10) |

## `export`

Exporta o cache para CSV ou JSON dentro de KOTAS_EXPORT_DIR (por padrão ~/Downloads/kotas-export). Não usa a rede e não altera nada na conta. Valores saem em reais com 4 casas, do jeito que a Kotas calcula o rateio.

**Escreve em disco/cache:** sim

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `scope` | `invoices` \| `subscriptions` \| `credits` \| `payouts` \| `history` | sim | O que exportar |
| `format` | `csv` \| `json` | — | Formato (default csv) |
| `from` | string (`^\d{4}-\d{2}-\d{2}$`) | — | Só para invoices: data inicial (YYYY-MM-DD) |
| `to` | string (`^\d{4}-\d{2}-\d{2}$`) | — | Só para invoices: data final (YYYY-MM-DD) |
| `filename` | string | — | Nome do arquivo, sem caminho; default kotas-<scope>-<data>.<formato> |

## `raw_get`

Chama uma rota GET da API do Kotas diretamente, com a mesma sessão, o mesmo ritmo e os mesmos headers das outras tools. Serve para redescobrir um endpoint quando a API muda. Use com parcimônia e nunca em rajada. Somente leitura: qualquer rota com verbo de escrita (cancelar, pagar, retirar, alterar…) é recusada, e as credenciais do serviço compartilhado (`grupo/obter-dados-acesso`) são bloqueadas em qualquer forma.

**Escreve em disco/cache:** não

| Parâmetro | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `path` | string (`^[A-Za-z0-9][A-Za-z0-9_/.-]*$`) | sim | Rota relativa, sem barra inicial (ex.: grupo/categorias) |
| `query` | object | — | Parâmetros de query (ex.: { "page": 1, "pageSize": 50 }) |
| `max_bytes` | integer (≥ 1024, ≤ 65536) | — | Corta a resposta neste tamanho (default 65536) |
