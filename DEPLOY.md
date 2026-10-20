# Publicação da versão 1.2.0 no projeto original

Projeto Sites `appgprj_6ad60d588e3c819189574322fd3a67a9`; origem HTTPS preservada:
https://minhas-financas-isaque.isaque-silvateixeira.chatgpt.site . Audiência pública, sem login de plataforma. Não adicionar D1/R2 nem transferir cofres ao servidor.

## Preparar e verificar

1. Confira o HEAD atual do Site e do GitHub. Concilie alterações posteriores antes de editar. Não force refs nem reescreva histórico.
2. Instale as dependências do lockfile e execute os comandos de teste/build do README. O Node serve os mesmos arquivos de `public/` e `lib/shell.html`; a CI usa estados fictícios e perfis temporários.
3. Se os assets mudarem, atualize a versão em `package.json`, `lib/security.mjs`, HTML, interface e `public/sw.js`. Rode `node scripts/release-manifest.mjs` para atualizar os hashes.
4. A CI deve executar as suítes nativas sobre os módulos atuais, não sobre a referência arquivada em `release/`. Contabilize cenários bloqueados e falhos separadamente.

## Assets, CSP e APIs

A publicação 1.1.1 revelou que Sites entregava os arquivos enviados diretamente antes de executar o Worker, mesmo com `run_worker_first=true`. Por isso, a versão 1.1.2 usa `publicDir:false` e o plugin `build/public-assets-plugin.mjs`: o pequeno conjunto fechado de assets entra no bundle do Worker, em bytes base64, sem cópias concorrentes em `dist/client/`.

O Worker serve esse conjunto pelo adaptador `lib/embedded-assets.mjs`, aplica a lista fechada e os cabeçalhos em todas as respostas, incluindo HEAD/304: `nosniff`, CORP `same-origin`, CSP sem inline/eval, cache revalidado e escopo `/` para o SW. MIME, bytes originais e ETag SHA-256 são preservados. `_headers` e metadados de roteamento da plataforma não são usados como garantia de segurança.

O build deve preservar essa configuração no `dist/server/wrangler.json`. Execute `node scripts/check-worker-build.mjs` e confira os cabeçalhos novamente no endereço público após publicar. Apenas encontrar o código no arquivo não conclui essa verificação.

`/api/data?feed=macro|brazil|global|samples` e `/api/health` permanecem na mesma origem. A saída HTTPS usa destinos fixos `api.bcb.gov.br`, `olinda.bcb.gov.br`, `servicodados.ibge.gov.br`, `www.federalreserve.gov` e `brapi.dev`. Sem chaves obrigatórias. O adaptador converte `redirect:error` em `manual` e recusa 3xx sem seguir o redirecionamento. Não ampliar a CSP do navegador para essas fontes: as consultas ocorrem no servidor.

## Proveniência exata

Sincronize a árvore completa de arquivos rastreados do projeto com um commit no GitHub, preservando `main` como ancestral. Nunca copie `.git`, perfis de navegador, `.env`, tokens, caches, node_modules, rascunhos ou dados financeiros.

O build usa `APP_SOURCE_COMMIT` se informado, ou o HEAD do checkout como padrão. Ao compilar o projeto Sites a partir de um checkout com histórico próprio, informe o SHA GitHub completo correspondente à mesma árvore:

```sh
APP_SOURCE_COMMIT=<SHA_GITHUB_DE_40_CARACTERES> pnpm build
```

`/version.json` e os cabeçalhos públicos identificam esse SHA GitHub. Confirme que `git rev-parse HEAD^{tree}` dos dois commits coincide; somente ter a mesma versão nominal não basta. O commit Sites é registrado pela publicação nativa.

## Publicar no Sites

A publicação exige acesso de edição ao projeto original pelo Sites. O GitHub por si só não altera esse domínio. Use o helper oficial de origem para abrir/sincronizar o checkout e empacotar a versão, mantendo `.openai/hosting.json` e o projeto existentes. As credenciais temporárias devem permanecer em memória e ser passadas por stdin, nunca em arquivos ou URLs.

Execute os checks/build pendentes pelo fluxo oficial, sincronize o commit exato e empacote seus artefatos. Salve a versão com o SHA Sites e o arquivo retornados pelo helper. Publique essa versão salva no mesmo projeto. Não use `wrangler deploy` sem o mecanismo e as credenciais próprios da plataforma.

## Conferência pública obrigatória

- `/version.json`, HTML/footer e SW identificam 1.2.0 e o commit esperado.
- Todos os 17 arquivos públicos têm os hashes de `UPSTREAM.json`, MIME correto, `nosniff` e CORP `same-origin`; SW com revalidação, escopo raiz e cache de versão.
- As quatro APIs devolvem seus dados reais, fontes e timestamps; falhas externas são identificadas sem inventar valores.
- Parâmetros inválidos 400; origem externa 403; métodos de escrita 405; código privado 404.
- Aba antiga recebe a atualização explícita; dados persistem sem limpeza do armazenamento.
- Perfil de teste separado acessa todas as páginas dos históricos e as ações antigas, sem alterar dados reais.

## Dados e reversão

Não limpe IndexedDB, localStorage ou dados do Site para atualizar. A origem, schema e envelope são preservados. A cópia anterior é mantida nas gravações comuns e após recusas inválidas. Na troca completa de senha, o checkpoint cifrado pela chave antiga é descartado deliberadamente; a próxima gravação recria um checkpoint cifrado pela chave nova. Backups anteriores continuam legíveis com a senha original.

Mantenha 1.1.2 ou posterior para conservar estas correções. Reverter o servidor não reverte dados já salvos no navegador. Após categorias personalizadas, não usar frontend 1.0.x. A origem HTTP/hostname/porta não pode ser mudada sem exportação/restauração explícita.

## Alternativa Node

`node server.mjs` ou `docker compose up --build --detach` executa o mesmo frontend e as quatro APIs. Configure proxy HTTPS que preserve Host e cabeçalhos; o bind padrão do Compose é somente localhost. O domínio original continua controlado pelo Sites; iniciar um Node em outro endereço não transfere os cofres.

## Validação adicional da 1.2.0

Confirme a tela de acesso, criação vazia, senha incorreta sem alteração de bytes, bloqueio/novo acesso e acesso offline. Valide a limpeza apenas dos exemplos reconhecidos e a exportação dos registros alterados para revisão. Todos os 17 arquivos públicos devem corresponder ao manifesto. Os ícones novos precisam entrar no precache da 1.2.0; cofres e schema não devem ser reinicializados.

Esta revisão deve ser publicada pelo fluxo de Sites no mesmo projeto. Enquanto o ambiente de execução não estiver disponível para abrir o source, compilar e empacotar, mantenha a candidata na branch e a produção 1.1.2 na main. Nunca publique um pacote da versão anterior com o SHA novo.
