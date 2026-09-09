# ADR-0011: Ler o localStorage do Chromium sem dependência nativa

Status: Aceito

## Contexto

Os MCPs irmãos importam a sessão lendo o SQLite de cookies do Chromium e
decifrando os valores com a senha do Keychain. Não serve aqui: o Kotas não usa
cookie. Os dois tokens e o identificador do dispositivo ficam no `localStorage`
de `app.kotas.com.br`, que o Chromium guarda num diretório **LevelDB**.

Todo binding de LevelDB para JavaScript (`classic-level` e afins) é um addon
nativo, e addon nativo não é embutido por `bun build --compile`. Adotar um
significaria abrir mão do binário único.

## Decisão

Os registros são lidos varrendo os bytes crus dos arquivos `.log` e `.ldb`,
procurando o prefixo `_<origem>\0\1` e decodificando os varints que emolduram a
chave e o valor. Duas molduras aparecem — a do log de escrita
(`tipo|tamanhoChave|chave|tamanhoValor|valor`) e a de bloco de tabela
(`compartilhado|restante|tamanhoValor` antes da chave) — e ambas são tentadas.

O que torna uma varredura de bytes confiável é a **validação de forma**: o
access token precisa casar com o formato de um JWT, o refresh token com uma
string opaca de pelo menos 16 caracteres, e o identificador com 32 hexadecimais
minúsculos. Um casamento por acaso ou uma leitura rasgada é descartado em vez de
salvo.

## Consequências

Três dependências no total, nenhuma nativa, binário único de 62 MB.

A varredura pode não achar nada — um bloco `.ldb` comprimido com snappy, por
exemplo. Isso é aceitável porque **não é o caminho principal**: o login por
e-mail e senha é HTTP puro e sempre funciona, e a mensagem de erro do import
manda usar ele ou `--paste`.

Verificado contra os perfis reais de Chrome e Arc desta máquina, e os dois
formatos de registro têm teste com bytes construídos à mão.
