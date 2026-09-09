# ADR-0009: A fatura é a raiz, não o grupo

Status: Aceito

## Contexto

O caminho óbvio seria modelar a assinatura (o "grupo") como entidade principal e
pendurar as faturas nela. Mas um grupo cancelado **some da API**:
`grupo/membro/{id}` responde HTTP 400, sem detalhe, para sempre. Numa conta com
quatro anos de uso, isso é a maioria do histórico.

O que sobra é a descrição da fatura:

```
Fatura grupo Claude Max 20× — Poder 20x do PRO #415083
```

Produto e id do grupo, no texto.

## Decisão

`invoices` é a tabela raiz. `product` e `group_id` são extraídos da descrição
por regex na normalização, e `groups` é enriquecimento das assinaturas que ainda
existem. `purchase_history` agrupa faturas por grupo para reconstruir a linha do
tempo.

O regex é guloso no produto, então um serviço cujo nome tenha "#" ainda separa
no último — `Plano #1 da casa #196386` dá produto `Plano #1 da casa` e grupo
`196386`.

## Consequências

O `sync` sempre varre as faturas primeiro: é a fase cara e é a que carrega a
informação que não pode ser recuperada de outro jeito.

`list_subscriptions` mostra só o que existe hoje; quem quiser "o que eu já
assinei" tem que usar `purchase_history`. A descrição das duas tools diz isso.

Um caso não cabe no modelo e precisou de tratamento próprio: **grupo que o
usuário administra não gera fatura nenhuma** — o administrador paga o serviço
por fora e recebe o rateio. `purchase_history` acrescenta esses grupos a partir
do cache, com `monthsPaid: 0` e `totalPaid: null`; sem isso, as duas maiores
assinaturas de uma conta somem do próprio histórico.
