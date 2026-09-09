# ADR-0007: Dinheiro em inteiro de quatro casas

Status: Aceito (diverge da ADR-0007 dos MCPs irmãos, que usa centavos)

## Contexto

Somar `float` sobre um histórico de compras acumula erro, e o erro cai
exatamente nos totais que a pessoa confere. Os MCPs irmãos resolvem isso
guardando centavos inteiros.

Centavos não bastam aqui. O produto do Kotas é o rateio: um grupo de R$ 33,32
dividido por quatro membros dá R$ 8,33 cada, e a API expõe justamente
`valor4Casas` ao lado de `valor`. Arredondar para centavo na entrada joga fora a
precisão antes que qualquer conferência possa acontecer.

## Decisão

Dinheiro é inteiro em décimos de milésimo de real: 1 real = 10 000 unidades.
`valor4Casas × 10 000`. A conversão para decimal acontece num lugar só,
`src/cache/rows.ts`, e devolve `{ amount, currency: "BRL" }`.

`valorFormatado` é string de exibição e nunca entra em conta. `null` nunca vira
`0`: "não tem valor" e "custa zero" são fatos diferentes e só um deles soma.

## Consequências

`SUM()` em SQLite é exato. O rateio fecha: a soma das quatro partes de R$ 33,32
dá R$ 33,32.

Duas invariantes verificadas contra a conta real provam que o modelo está certo:
a soma das cauções bloqueadas bate com o `valorBloqueado` da carteira, e a soma
dos repasses disponíveis bate com o `valorDisponivel`.

Divergir da ADR-0007 dos irmãos custa uma coisa: quem ler os dois códigos
precisa lembrar que a escala não é a mesma. Está no nome — `units`, não `cents`.
