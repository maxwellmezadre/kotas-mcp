# ADR-0008: Fixtures reais anonimizadas num repositório público

Status: Aceito

## Contexto

Testes contra payloads inventados provam pouco: eles provam que o código faz o
que o autor imaginou, não o que a API manda. As armadilhas de verdade só
aparecem no que o Kotas realmente devolve — `grupoId` vindo `null` num campo que
a especificação dizia preenchido, `valor` zerado numa listagem, `participantes[]`
existindo onde estava documentado que não existia. As três foram descobertas
assim, e nenhuma teria aparecido num objeto escrito à mão.

Mas o repositório é público e a conta é de uma pessoa.

## Decisão

Capturar as respostas cruas em `task/captures/` (fora do git, `0600`) com
`scripts/capture-fixtures.ts`, e gerar `test/fixtures/` com um anonimizador
determinístico, `scripts/anonymize-fixture.ts`:

- Ids são remapeados por `sha256(salt + valor)` **mantendo o formato** — o
  comprimento de um número, o traçado de um GUID — e trocados no arquivo
  inteiro, então as relações sobrevivem: o `#327356` dentro de
  `"Fatura grupo SetApp #327356"` continua sendo o id de um grupo em
  `groups.json`.
- **Dinheiro, quantidades e datas nunca são tocados.** Ids são trocados por nome
  de campo e pelo padrão `#<id>`, nunca por "qualquer sequência longa de
  dígitos". As identidades financeiras continuam verdadeiras nas fixtures: a
  soma das cauções bloqueadas ainda dá o `valorBloqueado` da carteira, e há um
  teste que confere exatamente isso.
- **Id de enum não é id.** `statusId`, `tipoId` e `formaAcessoId` ficam
  intactos; remapear `statusId` transformaria uma fatura paga em cancelada e
  todo teste passaria descrevendo um fato que nunca aconteceu.
- PII vira placeholder fixo por nome de campo. O nome de um grupo é
  `"<serviço> de <pessoa>"`: o serviço fica, porque os parsers o leem, e a
  pessoa some pela passada global.
- `descricao` é raspada de ids, não embaralhada: a forma
  `Fatura grupo <produto> #<id>` é justamente o que está sendo testado.

Duas passadas: tudo é anonimizado primeiro, e só então cada saída é conferida
contra os segredos colhidos de **todas** elas. O script sai com erro se algo
escapar, nomeando o campo de origem.

## Consequências

Os testes leem o que a API manda de verdade, e cada armadilha achada contra a
conta virou um teste sobre a fixture que a contém.

`test/fixtures.test.ts` faz a guarda independente: procura por **padrão**
(e-mail, CPF, telefone, JWT, CEP, cartão), nunca por valor literal — escrever o
dado real no teste para conferir que ele sumiu seria publicá-lo.

O sal (`task/anonymize.salt`) e a lista de segredos extras
(`task/anonymize.secrets`) ficam fora do git. Sem o sal, o mapeamento não é
reversível nem reproduzível por terceiros.
