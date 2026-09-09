# A API interna do Kotas

Base: `https://api-front.kotas.com.br`. Backend ASP.NET Web API. Tudo aqui foi
chamado de verdade contra uma conta real em 08/09/2026, com o front na versão
`1.127.0.0`.

## Headers obrigatórios

Em **toda** requisição:

```http
Content-Type: application/json
Authorization: Bearer <access token>
token: <chave estática do front>
versao: 1.127.0.0
hashDispositivo: <32 hex>
```

- `token` é a chave da API embutida no bundle do front. Não muda por usuário e
  não é segredo do usuário — por isso vem como default.
- `versao` muito defasada faz a API responder **426**.
- `hashDispositivo` é a identidade do dispositivo, devolvida no login. Trocá-lo
  abre um desafio de liberação (**412**), então ele é persistido e reenviado
  sempre igual.

## Sessão

| Método | Rota | Observação |
| --- | --- | --- |
| POST | `autenticacao/token` | Login. `{email, senha, socialAuth: 1, …}`. Sem captcha. |
| POST | `autenticacao/refresh-token` | Header extra `role: refresh-token` |
| POST | `autenticacao/2fa/pin/validar` | O PIN vai no header `TWFA`, não no corpo |

O access token dura **15 minutos** (`exp - iat = 900`). O refresh responde com a
**string JWT crua**, não um objeto, e **não rotaciona** o refresh token.

Resposta 412 do login: `{ "hash": "<novo hashDispositivo>", "tipoSolicitacao": 1 }`,
com `{ semSolicitacao: 0, dispositivo: 1, ip: 2 }`.

## Paginação — inconsistente

| Rota | Primeira página | Resposta | Obrigatório |
| --- | --- | --- | --- |
| `grupo/usuario/` | `0` | array cru | — |
| `recebimento/obtergrupos` | `0` | envelope `{itens, totalPaginas, …}` | **404 sem `page` e `pageSize`** |
| `fatura/obterlista` | `1` | array cru | **`[]` sem `statusId`** |
| `credito/obterlista` | `1` | array cru | **404 sem `ativos`** |

`pageSize` máximo **50**. Acima disso a resposta é
`{"message":"algo de errado não está certo :P, tente novamente em alguns minutos."}`.

## Rotas de leitura usadas

| Rota | Devolve |
| --- | --- |
| `api/versao` | 200 com corpo vazio (ver errata) |
| `grupo/usuario/` | Grupos ativos do usuário, membro e administrador |
| `grupo/membro/{id}` | Detalhe como membro, com `participantes[]` |
| `grupo/admin/{id}` | Detalhe como administrador, com `participantes[]` |
| `fatura/obterlista` | Faturas de um `statusId` |
| `fatura/extrato?faturaId=` | A fatura com `itens[]` |
| `credito` | Saldos consolidados |
| `credito/economia` | Economia acumulada na vida |
| `credito/obterlista` | Lançamentos de crédito |
| `recebimento/obtergrupos` | Repasses por grupo administrado |
| `recebimento/extrato?grupoId=` | Extrato do repasse, participante a participante |
| `servico/planos/pesquisar/{q}` | Catálogo |

## Enums

`status_fatura`: `{ pendente: 11, pago: 13, cancelado: 19, atraso: 63, estornado: 67 }`
`status_credito`: `{ bloqueado: 33, disponivel: 34, utilizado: 35, estornado: 36, pendentePagamento: 41, cancelado: 46, sacado: 65 }`
`tipo_credito`: `{ adicaoDeSaldo: 94, caucaoDaInscricao: 96, repasseAdministrador: 97, estornoCancelamento: 98 }`
`status_grupo`: `{ aguardandoMembros: 1, aguardandoAssinatura: 3, ativo: 4, pendenteAprovacao: 50, reprovado: 51, assinadoComVagas: 52, cancelado: 55, aguardandoEdicao: 68, aguardandoLiberacao: 69, filaEspera: 76, cancelamentoAgendado: 77, reprovadoAutomaticamente: 110, triagem: 111 }`
`status_recebimento`: `{ agendado: 4, cancelado: 55 }`
`forma_acesso`: `{ loginSenha: 239, convite: 240, codigoAtivacao: 241, cookie: 242, combinar: 308 }`

## Armadilhas confirmadas

1. **Grupo encerrado responde HTTP 400.** Não 404, não lista vazia: 400 com
   mensagem genérica. É indistinguível de um erro de verdade sem contexto, e é
   por isso que o histórico se apoia nas faturas.

2. **`fatura/obterlista` sem `statusId` devolve `[]`.** Silenciosamente. Quem
   esquecer conclui que a conta não tem faturas.

3. **`credito/obterlista` sem `ativos` devolve 404.** A especificação original
   listava o parâmetro como opcional; ele não é.

4. **`ativos=true` e `ativos=false` são conjuntos disjuntos.** `true` traz os
   lançamentos ainda em vigor (6 na conta de referência); `false` traz o
   histórico já consumido (121). Para o razão completo é preciso buscar os dois.

5. **`valor` e `valor4Casas` vêm sempre 0 na listagem de créditos**, inclusive
   nos ativos. A cifra que existe é `valorDisponivel4Casas`; o valor de face só
   aparece em `credito/extrato`, uma requisição por crédito. A invariante que
   prova isso: a soma das cauções bloqueadas dá exatamente o `valorBloqueado` da
   carteira, e a soma dos repasses disponíveis dá exatamente o
   `valorDisponivel`.

6. **`grupoId` vem `null` em todo crédito do tipo 97** e em parte dos tipo 96.
   O id do grupo está na descrição: `"Recebimento adm. grupo #397075"`,
   `"Inscrição em grupo cod. #103179"`.

7. **`api/versao` responde 200 com corpo vazio.** Não publica versão nenhuma. O
   valor de chamá-la é provar que o header `versao` foi aceito.

8. **`recebimento/obtergrupos` responde 404 sem `page` e `pageSize`**, mesmo
   para a primeira página.

9. **Grupo administrado não gera fatura.** O administrador paga o serviço por
   fora e recebe o rateio dos membros, então as maiores assinaturas de uma
   conta podem não ter nenhuma fatura própria.

10. **`grupo/membro/{id}` também devolve `participantes[]`.** A especificação
    dizia que a lista só existia em `grupo/admin/{id}`; os dois payloads têm o
    mesmo conjunto de campos. Quem divide uma assinatura enxerga com quem
    divide.

11. **`grupo/obter-dados-acesso` devolve login e senha do serviço compartilhado
    em texto claro.** Não é usada por este projeto e é bloqueada no `raw_get`.
