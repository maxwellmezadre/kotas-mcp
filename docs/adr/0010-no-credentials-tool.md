# ADR-0010: Nenhuma tool para as credenciais do serviço compartilhado

Status: Aceito

## Contexto

`grupo/obter-dados-acesso` devolve o **login e a senha em texto claro** do
serviço compartilhado — a conta da Netflix, do Spotify, do Google One que o
grupo divide. A sessão do usuário tem acesso a ela, e seria trivial expor.

Seria até útil: "me lembra a senha do grupo do Spotify" é uma pergunta razoável.

## Decisão

Não existe tool para essa rota, e `raw_get` a bloqueia em qualquer forma
(inclusive `dados-acesso` e variações de caixa), antes mesmo de checar a
allowlist.

A alternativa considerada — expor atrás de uma variável de ambiente, com a senha
mascarada por padrão — foi recusada. Uma flag que a pessoa liga uma vez fica
ligada, e a partir daí toda conversa que toque no assunto carrega a senha de
terceiros para dentro do contexto do modelo e do histórico da conversa.

## Consequências

Quem precisar da senha pega no app do Kotas. A `SKILL.md` diz isso, para o
modelo responder direito em vez de tentar contornar.

`scripts/verify.ts` e `test/tools.test.ts` verificam as duas metades: que
nenhuma tool registrada tem nome ou schema relacionado a credenciais, e que a
rota é recusada pelo `raw_get`.
