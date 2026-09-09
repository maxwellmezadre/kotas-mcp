# Segurança

## O modelo de ameaça

**O refresh token é a conta.** O token de acesso dura 15 minutos, então mesmo
vazando a janela é curta — mas o refresh token **não rotaciona**, continua
valendo e troca por um token de acesso novo quantas vezes quiser. Quem tiver o
arquivo de sessão tem a conta: as faturas, os grupos, os saldos e, pela API, as
credenciais dos serviços compartilhados.

Por isso a sessão é cifrada em repouso, redigida em todo log e nunca devolvida
por uma tool.

## Proteções

| Proteção | Como |
| --- | --- |
| Sessão em repouso | AES-256-GCM, arquivo `0600`, escrita atômica. A chave vem de `KOTAS_SESSION_KEY` ou de um `session.key` `0600` |
| Sessão em log | Os dois tokens e o identificador do dispositivo são redigidos em toda linha, por um provedor que acompanha as renovações. Headers nunca são logados, e URLs completas também não — elas carregam ids |
| Sessão em resposta de tool | `auth_status` devolve validade, perfil e contagens, nunca o valor de um token. `scripts/verify.ts` confere isso a cada CI |
| Senha | Usada uma vez no corpo do login e descartada. Nunca é gravada |
| Cache | `cache.db` `0600`, com o `umask` forçado na criação |
| Escrita em disco | Só `export`, e só dentro de `KOTAS_EXPORT_DIR`. O nome é reduzido a basename e o caminho resolvido é conferido contra o diretório |
| Escrita na conta | Não existe. Nenhuma tool cancela, paga, saca ou altera |
| Credenciais do serviço compartilhado | `grupo/obter-dados-acesso` devolve login e senha em texto claro. Não há tool para ela e o `raw_get` a bloqueia em qualquer forma (ADR-0010) |
| Superfície de leitura | `raw_get` só aceita uma allowlist de rotas, recusa verbos de escrita e `..`, e corta a resposta em 64 KB |
| Identidade do dispositivo | Persistida e reenviada sempre igual. Trocá-la abre um desafio de liberação que nenhum chamador automatizado completa |
| Fixtures | Anonimização determinística com leak guard que falha o script, mais uma varredura independente por padrão em `test/fixtures.test.ts` (ADR-0008) |

## Nunca faça

- Não commite `session.enc`, `session.key` nem `cache.db`.
- Não passe a senha em linha de comando numa máquina compartilhada: use
  `KOTAS_SENHA` ou deixe o `kotas login` perguntar.
- Não adicione uma rota de escrita à allowlist do `raw_get`.
- Não exponha as credenciais do serviço compartilhado, nem mascaradas.
- Não rode em rajada. O ritmo existe para o uso parecer o de uma pessoa, e os
  termos do Kotas não preveem uso automatizado.

## Revogando uma sessão

```sh
rm ~/.config/kotas-mcp/session.enc
```

Se achar que o refresh token vazou, troque a senha no app do Kotas — é o que
invalida a cadeia inteira.

## Reportando

Não abra issue pública. Use as [Security
Advisories](https://github.com/maxwellmezadre/kotas-mcp/security/advisories) do
repositório.
