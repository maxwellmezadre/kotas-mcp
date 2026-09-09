# Quando o Kotas mudar

O front do Kotas evolui e a API vai junto. O roteiro abaixo é a ordem que custa
menos requisições.

## 1. `kotas doctor`

Ele testa as camadas na ordem — configuração, sessão, token, versão, grupos,
faturas, créditos, recebimentos, cache — e nomeia a que quebrou. Uma camada que
não pôde rodar também é reportada, com o motivo.

Se a falha for **426**, é só a versão: ajuste `KOTAS_APP_VERSION` para a que o
`app.kotas.com.br` estiver usando (está no bundle, em `versao`).

## 2. Olhe o payload cru

```sh
kotas raw fatura/obterlista -q page=1 -q pageSize=5 -q statusId=13
kotas raw grupo/usuario/ -q page=0 -q pageSize=5
kotas raw credito/obterlista -q page=1 -q pageSize=5 -q ativos=true
```

`raw_get` usa a mesma sessão, o mesmo ritmo e os mesmos headers das outras
tools. Ele é a válvula de escape: só leitura, com allowlist de rotas, deny-list
de verbos de escrita e teto de 64 KB.

Se a rota nova estiver fora da allowlist, adicione o prefixo em
`src/tools/raw.ts` — e só se for de leitura.

## 3. Compare com o que está guardado

O cache guarda o payload cru de cada fatura e de cada grupo. Dá para ver o que
mudou sem gastar requisição nenhuma:

```sh
sqlite3 ~/.config/kotas-mcp/cache.db \
  "SELECT raw_list FROM invoices ORDER BY updated_at DESC LIMIT 1;" | jq 'keys'
```

## 4. Conserte o normalizador

Só `src/domain/normalize.ts` conhece nomes de campo. Mude lá, suba
`PARSER_VERSION` em `src/cache/sync.ts` e rode:

```sh
kotas sync --reparse
```

O histórico inteiro é reprocessado com zero requisições, porque o payload cru
está guardado.

## 5. Recapture e grave o caso no teste

```sh
bun run scripts/capture-fixtures.ts --write     # task/captures/, fora do git
bun run scripts/anonymize-fixture.ts --write    # test/fixtures/, com leak guard
```

Toda armadilha que apareceu na conta real virou teste. Antes de fechar, escreva
o seu: as boas estão em `test/fixtures.test.ts` (o que a API manda de verdade),
`test/api.test.ts` (parâmetros obrigatórios) e `test/normalize.test.ts`.

## Limitações conhecidas (medidas)

- Grupo encerrado: HTTP 400, sem detalhe, para sempre.
- Valor de face de crédito consumido: zerado pela API na listagem.
- `grupoId` do crédito tipo 97: sempre `null`; o id está na descrição.
- `api/versao`: 200 com corpo vazio.
- Grupo administrado: não tem fatura.

## Nunca automatize

- Cancelamento, saque, pagamento, alteração de valor ou de plano.
- `grupo/obter-dados-acesso`: devolve login e senha do serviço em texto claro.
- Rajadas. O ritmo existe para o uso parecer o de uma pessoa.
