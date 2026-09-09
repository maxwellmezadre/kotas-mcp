---
name: kotas-mcp
description: >-
  Assinaturas compartilhadas do Kotas da conta do usuário via MCP `kotas`:
  grupos, o que ele paga em cada um, faturas, créditos, cauções, repasses
  recebidos como administrador, saldo, economia acumulada e o histórico
  completo — inclusive das assinaturas já encerradas. Use para perguntas como
  "quanto já gastei no Kotas", "quais assinaturas eu tenho e quanto pago",
  "quanto vou receber como administrador", "quando eu assinei a Netflix e por
  quanto tempo". Triggers: kotas, assinatura, assinaturas, grupo, kota, rateio,
  vaga, fatura, mensalidade, quanto gastei, quanto pago, repasse, recebimento,
  administrador, membro, crédito, caução, saldo, economia, saque, fidelidade,
  Netflix, Spotify, Google One, SetApp, 1Password, Canva, Disney, HBO,
  Youtube Premium.
---

# Kotas — assinaturas compartilhadas

MCP `kotas` (`mcp__kotas__*`), 16 tools. Referência completa de parâmetros em
`TOOLS.md`, ao lado deste arquivo.

O Kotas é o serviço onde várias pessoas dividem uma assinatura. Cada assinatura
é um **grupo**, cada vaga é uma **kota**, e cada pessoa paga a sua parte. Quem
cria o grupo é o **administrador**: paga o serviço por fora e recebe o rateio
dos membros.

## Leia antes de responder

1. **Comece por `auth_status` quando qualquer coisa falhar.** Ele responde sem
   rede e diz se há sessão, de quem é, até quando o token vale e o que já está
   no cache. O token de acesso dura 15 minutos, então `accessTokenExpired: true`
   é normal — ele é renovado sozinho na chamada seguinte.

2. **O cache responde quase tudo.** `list_subscriptions`, `list_invoices`,
   `list_credits`, `list_payouts`, `purchase_history` e `spending_summary` não
   usam a rede. Se vierem vazios, rode `sync`.

3. **`sync` trabalha em blocos.** Se devolver `done: false`, chame de novo com
   os mesmos parâmetros até `done: true`. Não aumente `max_requests` para
   "acelerar" e não chame em paralelo: o ritmo existe para o uso ficar parecido
   com o de uma pessoa. Um histórico de ~260 faturas leva ~305 requisições e
   uns 2 minutos.

4. **Fatura cancelada ou estornada NÃO é gasto.** Só `status: "pago"` é dinheiro
   que saiu. `spending_summary` já conta só as pagas; se você somar à mão, some
   `total`, nunca `amount` — `total` é o que de fato saiu, com juros, reajuste
   e desconto embutidos.

5. **Grupo encerrado não existe mais na API.** `get_subscription` responde erro
   para ele, e `list_subscriptions` só mostra os que continuam ativos. O
   histórico das assinaturas antigas vive **nas faturas**, e é isso que
   `purchase_history` reconstrói. Para "o que eu já assinei", use
   `purchase_history`, nunca `list_subscriptions`.

6. **Nos créditos, use `available`, não `amount`.** A API zera o valor de face
   de todo lançamento já consumido, então `amount` vem 0 em quase tudo.
   `available` é a cifra que existe e é a que fecha com o saldo da carteira.

7. **Saldo bloqueado não é dinheiro perdido.** São as cauções das inscrições
   (crédito tipo 96): ficam retidas enquanto a assinatura durar e voltam quando
   ela é encerrada.

8. **Grupo que o usuário administra não gera fatura.** Ele paga o serviço por
   fora e recebe o rateio, então aparece em `purchase_history` com
   `monthsPaid: 0` e `totalPaid: null`, e o dinheiro dele está em
   `receivedAsAdmin` e em `list_payouts`. Não diga que ele "não pagou nada".

9. **Repasse com status `Cancelado` não vai mais acontecer.** Só some no
   previsto o que está `Agendado` — é o que `scheduledTotal` já faz.

10. **`search_services` é o catálogo, não o histórico.** Serve para "quanto
    custa o plano X no Kotas", não para "o que eu assino".

11. **As credenciais do serviço compartilhado (login e senha da Netflix, do
    Spotify…) não são acessíveis por aqui, de propósito.** Não existe tool para
    elas e a rota é bloqueada. Se pedirem, diga que estão no app do Kotas.

12. **Este servidor nunca altera a conta.** Não cancela assinatura, não saca,
    não paga, não muda valor de grupo. Se pedirem, explique que é só leitura.

## Tools ↔ CLI

| Tool | Comando | Para quê |
| --- | --- | --- |
| `auth_status` | `kotas status [--verify]` | Sessão, perfil, validade do token, cache |
| `login` | `kotas login [--from-browser chrome]` | Salva a sessão cifrada em disco |
| `doctor` | `kotas doctor [--shallow]` | Diz qual camada quebrou |
| `sync` | `kotas sync [--full\|--reparse]` | Baixa o histórico para o cache |
| `list_subscriptions` | `kotas subscriptions [--role]` | As assinaturas que ainda existem |
| `get_subscription` | `kotas subscription <id>` | Plano, rateio, vagas, participantes |
| `list_invoices` | `kotas invoices [--status --from --to]` | As faturas |
| `get_invoice` | `kotas invoice <id>` | Uma fatura com os itens |
| `list_credits` | `kotas credits [--kind]` | Cauções, repasses, adições, estornos |
| `balance` | `kotas balance` | Saldo e economia acumulada (ao vivo) |
| `list_payouts` | `kotas payouts [--group]` | O que se recebe como administrador |
| `purchase_history` | `kotas history [--active]` | Tudo que já foi assinado, inclusive encerrado |
| `spending_summary` | `kotas spending --by month` | Gastos por mês, ano, produto ou situação |
| `search_services` | `kotas search <termo>` | Catálogo de serviços e planos |
| `export` | `kotas export <escopo>` | CSV/JSON em `~/Downloads/kotas-export` |
| `raw_get` | `kotas raw <rota> [-q k=v]` | Válvula de escape para redescoberta |

## Receitas

| Pergunta | O que chamar |
| --- | --- |
| "quanto já gastei no Kotas?" | `spending_summary` com `by: "year"` |
| "quanto gasto por mês?" | `spending_summary` com `by: "month"` |
| "o que eu mais paguei?" | `spending_summary` com `by: "product"` |
| "quais assinaturas eu tenho?" | `list_subscriptions` |
| "o que eu já assinei um dia?" | `purchase_history` |
| "por quanto tempo tive a Canva?" | `purchase_history`, campo `monthsPaid` |
| "quanto vou receber este mês?" | `list_payouts`, campo `scheduledTotal` |
| "quanto tenho de saldo?" | `balance` |
| "quem está no meu grupo?" | `get_subscription` do grupo administrado |
| "quanto economizei?" | `balance`, campo `saved` |

## Avisos

- Somente leitura. Nenhuma tool altera a conta.
- Ritmo próximo ao de uma pessoa (~2 requisições por segundo). Não force.
- `KOTAS_READ_ONLY=1` remove `login`, `sync` e `export` do registro.
- O refresh token é o segredo de verdade: não o mostre nem o peça em texto.
