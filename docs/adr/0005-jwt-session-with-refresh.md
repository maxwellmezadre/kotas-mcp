# ADR-0005: Sessão por JWT com renovação, e não por cookie

Status: Aceito

## Contexto

Os outros cinco MCPs desta família autenticam por jar de cookie capturado do
navegador: os sites deles não têm API de token para o comprador. O Kotas tem. O
app é um SPA que faz login por `POST autenticacao/token`, recebe um par de JWTs
e os guarda no `localStorage`. Não há captcha no login — o hCaptcha só protege o
cadastro.

## Decisão

A sessão é o par de tokens mais o identificador do dispositivo. O login por
e-mail e senha é HTTP puro, sem navegador nenhum. `src/core/http.ts` cuida do
ciclo de vida: decodifica o `exp`, renova antes de expirar e renova de novo se
mesmo assim vier um 401.

Uma diferença deliberada em relação à família: lá, um 401 é terminal, porque
insistir em autenticação num site com anti-bot aprofunda o bloqueio. Aqui é uma
API REST comum e um 401 significa apenas "token velho", então ele dispara uma
renovação e **um** replay. O segundo 401 mata a sessão.

## Consequências

Sem `playwright-core`: o binário cai de 68 MB para 62 MB e o `--external
chromium-bidi` deixa de ser necessário.

O access token dura 15 minutos, então uma sessão vazada tem janela curta — mas o
**refresh token não rotaciona**, e é ele o segredo de verdade, com validade
longa. É por isso que a ADR-0006 vale aqui igual.

O `hashDispositivo` precisa ser reenviado sempre igual: um valor novo faz a API
abrir um desafio de liberação (HTTP 412) que nenhum chamador automatizado
consegue completar sozinho.

A renovação é deduplicada por uma promise única em voo. O funil serial já daria
exclusão mútua, mas `doctor` e `auth_status` podem disparar renovação fora dele.
