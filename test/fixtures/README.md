# Fixtures

Respostas reais da conta do autor, capturadas em 09/09/2026 em
`api-front.kotas.com.br` e anonimizadas deterministicamente por
`scripts/anonymize-fixture.ts` antes de entrar no repositório, que é público.

| Arquivo | Origem |
| --- | --- |
| `invoices-paid.json` | `GET fatura/obterlista` com `statusId=13` |
| `invoices-cancelled.json` | idem com `statusId=19`, as faturas que **não** são gasto |
| `invoice-statement.json` | `GET fatura/extrato` — os itens, que a listagem manda como `null` |
| `groups.json` | `GET grupo/usuario/` (página 0) |
| `group-member.json` | `GET grupo/membro/{id}` |
| `group-admin.json` | `GET grupo/admin/{id}`, com `participantes[]` |
| `group-closed.json` | o HTTP 400 de um grupo encerrado, que some da API |
| `credits-active.json` | `GET credito/obterlista` com `ativos=true` — os lançamentos em vigor |
| `credits-history.json` | idem com `ativos=false` — o histórico consumido, com o valor zerado |
| `balance.json` | `GET credito` |
| `savings.json` | `GET credito/economia` |
| `payouts.json` | `GET recebimento/obtergrupos` |
| `payout-statement.json` | `GET recebimento/extrato` |
| `services.json` | `GET servico/planos/pesquisar/spotify` |

## O que a anonimização faz

- **Ids** (`id`, `grupoId`, `faturaId`, `servicoId`, `adminId`, `usuarioId`,
  `idHash`) são remapeados por `sha256(salt + valor)` mantendo o formato — o
  comprimento de um número, o traçado de um GUID — e trocados no arquivo
  inteiro. Por isso as relações sobrevivem: o `#327356` dentro de
  `"Fatura grupo SetApp #327356"` continua sendo o id de um grupo em
  `groups.json`, que é exatamente o que faz o teste da reconstrução do histórico
  significar alguma coisa.

- **Dinheiro, quantidades e datas nunca são tocados.** Ids são trocados por
  nome de campo e pelo padrão `#<id>`, nunca por "qualquer sequência longa de
  dígitos". É o que mantém `valorTotal4Casas` e `dataPagamento` verdadeiros, e
  com eles as identidades financeiras: a soma das cauções bloqueadas em
  `credits-active.json` continua dando o `valorBloqueado` de `balance.json`.

- **Id de enum não é id.** `statusId`, `tipoId`, `formaAcessoId` e companhia
  ficam intactos. Remapear `statusId` transformaria uma fatura paga em
  cancelada e todo teste passaria descrevendo um fato que nunca aconteceu.

- **PII** vira placeholder fixo por nome de campo: `adminNome`,
  `adminNomeCompleto`, `adminEmail`, `nickname`, `telefone` e as URLs de avatar.
  O nome do participante vira `Participante <palavra>`, mantendo a contagem.

- **Nome de grupo** é `"<serviço> de <pessoa>"`. O serviço fica (os parsers o
  leem); a pessoa some, porque o nome dela já foi substituído em `adminNome` e a
  passada global remove todas as ocorrências.

- **`descricao` é raspada, não embaralhada.** Ela é o texto que carrega o
  produto e o id do grupo de uma assinatura encerrada — a forma
  `Fatura grupo <produto> #<id>` é justamente o que o parser está sendo testado
  contra.

## Leak guard

Tudo é anonimizado primeiro e só então cada saída é conferida contra os valores
colhidos de **todas** elas, mais o que estiver em `task/anonymize.secrets`. O
script sai com erro se algo escapar, nomeando o campo de origem.

`test/fixtures.test.ts` faz a guarda independente: procura por **padrão**
(e-mail, CPF, telefone, JWT, GUID conhecido), nunca por valor literal — escrever
o dado real no teste para conferir que ele sumiu seria publicá-lo.
