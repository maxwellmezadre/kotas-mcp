# Do zero à primeira pergunta

## 1. Instalar

```sh
bun run setup
```

Compila, instala em `~/.local/bin/kotas`, registra o MCP no escopo de usuário e
instala a Skill.

## 2. Entrar na conta

```sh
kotas login --from-browser chrome    # se você já está logado no navegador
kotas login                          # ou e-mail e senha
kotas status
```

## 3. Baixar o histórico

```sh
kotas sync
```

O CLI repete os blocos sozinho e mostra o progresso no stderr. Uma conta com
quatro anos de uso leva uns dois minutos e ~300 requisições. Depois disso, quase
tudo é respondido do cache.

Rodar de novo é barato: o modo incremental para no primeiro bloco sem novidade.

## 4. Perguntar

```sh
kotas history                     # tudo que você já assinou
kotas spending --by year          # quanto por ano
kotas spending --by product       # o que mais pesou
kotas subscriptions               # o que você tem hoje
kotas payouts                     # o que você recebe como administrador
kotas balance                     # saldo e economia acumulada
```

## 5. Pelo Claude

Com o MCP registrado, pergunte em português:

- *"quanto já gastei no Kotas?"*
- *"quais assinaturas eu tenho e quanto pago em cada uma?"*
- *"por quanto tempo eu tive a Canva e quanto custou no total?"*
- *"quanto vou receber como administrador este mês?"*
- *"quanto tenho de caução parada?"*

## Manutenção

```sh
kotas sync                 # incremental, barato
kotas sync --full          # varre tudo de novo
kotas sync --reparse       # reprocessa o cache, zero requisições
kotas doctor               # diz qual camada quebrou
kotas export history --format csv
```
