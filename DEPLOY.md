# Publicação e operação

O aplicativo inclui um servidor Node.js 22 ou posterior e o backend de fontes públicas na mesma origem. Não precisa de banco de dados no servidor nem de dependências npm. Os cofres financeiros permanecem no navegador de cada pessoa. O cache público do processo pode ser descartado a cada reinício.

Este arquivo contém procedimentos de publicação; sua existência não significa que o endereço `chatgpt.site` já foi atualizado. Para atualizar esse endereço é necessário o projeto ou mecanismo de publicação que o controla. Fazer push ao GitHub só publica um site quando uma integração da hospedagem foi configurada para isso.

## Antes da publicação

1. Execute `npm test` no checkout da versão que será publicada.
2. Confira os testes de navegador descritos no README e o número de versão dos assets.
3. Registre o commit ou arquivo de distribuição escolhido. Guarde também a imagem anterior para reversão.
4. Publique na raiz da **mesma origem HTTPS** existente. Protocolo, hostname e porta identificam o armazenamento do navegador. Mudar esse endereço abre outro espaço de dados; faça backup e restauração explícita se a mudança for necessária.

Não use uma hospedagem somente estática para a entrega completa: `/api/data` precisa executar o servidor. No proxy reverso, encaminhe os caminhos da aplicação e `/api/data` ao mesmo processo, preserve o cabeçalho Host público, os cabeçalhos de segurança enviados pelo servidor e forneça HTTPS. Não exponha `.git`, backups, relatórios de testes ou arquivos do ambiente como conteúdo estático.

## Executar com Docker

A imagem usa Node 24.19.0 sobre Debian Bookworm, executa como usuário `node` e copia apenas o programa e seus assets. A imagem base está fixada por versão e digest verificado no Dockerfile; atualizações de segurança devem passar pelos testes antes de trocar essa referência.

```sh
docker build --tag minhas-financas:1.1.0 .
docker run --detach --name minhas-financas \
  --publish 127.0.0.1:3000:3000 \
  --read-only --cap-drop ALL \
  --security-opt no-new-privileges \
  minhas-financas:1.1.0
```

O serviço escuta `0.0.0.0:3000` dentro do contêiner. A porta no host fica restrita à máquina local para uso por um proxy HTTPS. O healthcheck solicita apenas `/`; não depende das fontes externas. Não é necessário montar volume para os cofres, pois esses dados não são armazenados no contêiner.

Também há uma configuração Compose equivalente:

```sh
RELEASE_TAG=1.1.0 docker compose up --detach --build
docker compose ps
docker compose logs --tail 50
```

Use `APP_PORT` para escolher uma porta local livre. A alteração dessa porta atrás do proxy não muda a origem pública; acessar a aplicação diretamente por outra porta muda o armazenamento visto pelo navegador.

## Executar sem Docker

Use um usuário sem privilégios e o gerenciador de processos fornecido pela hospedagem:

```sh
HOST=0.0.0.0 PORT=3000 NODE_ENV=production npm start
```

Configure reinício após falhas e no boot. A hospedagem deve terminar HTTPS e encaminhar as requisições ao processo. Não há etapa de build nem `npm install` para o runtime atual.

## Rede e verificação

As fontes públicas exigem saída HTTPS para `api.bcb.gov.br`, `olinda.bcb.gov.br`, `servicodados.ibge.gov.br`, `www.federalreserve.gov` e, para as amostras opcionais, `brapi.dev`. Não desabilite a verificação TLS. Em redes com proxy, use a configuração de proxy e confiança suportada pelo runtime e pela hospedagem.

Após publicar, confira no endereço público:

- A versão identificada no HTML e na interface é a da entrega escolhida.
- `/` e os módulos carregam com os tipos corretos, sem erros JavaScript.
- `/api/data?feed=macro`, `brazil` e `global` respondem com o contrato JSON, a data e a fonte dos dados; uma falha externa deve aparecer como indisponibilidade, nunca como valor inventado.
- A primeira visita conectada instala o núcleo offline. Uma aba da versão anterior continua coerente até a atualização explícita; não misture arquivos de entregas diferentes no mesmo cache.
- Um perfil de teste consegue criar, bloquear, desbloquear e restaurar um cofre com dados fictícios. Não use o cofre pessoal do usuário para esse teste.

## Reversão

Reverta o processo ou a imagem para a entrega anterior, mantendo o endereço público e o armazenamento do navegador. Guarde os assets completos e o service worker daquela entrega; não publique somente um módulo isolado.

A volta do servidor não desfaz alterações já gravadas no IndexedDB. Antes de voltar a uma versão anterior, valide a compatibilidade com uma cópia de teste e exporte um backup. Após criar ou renomear categorias personalizadas na 1.1.0, não reverta o frontend para 1.0.x: essas versões antigas não reconhecem os novos nomes, embora o schema permaneça 3. Mantenha 1.1.0 ou posterior para ler esses dados. Uma versão antiga do service worker também precisa ser instalada e ativada pelo fluxo normal de atualização; limpar dados do site não é um procedimento de reversão.

Para parar somente a implantação Compose, use `docker compose down`. Essa ação não apaga os cofres dos navegadores. Não execute limpeza de armazenamento no dispositivo do usuário para resolver um problema de publicação.
