# Minhas Finanças 1.2.0

Finanças pessoais locais, com cofre criptografado, demonstração separada, controle financeiro, carteira e fontes econômicas públicas. Sem assinatura, credenciais bancárias ou APIs pagas.

Site original: https://minhas-financas-isaque.isaque-silvateixeira.chatgpt.site .

Este repositório contém o **projeto completo da publicação Sites**, incluindo os assets reais, o servidor Worker, a alternativa Node, a configuração de build e todos os testes. A revisão 1.1.2 integra a correção de compatibilidade que a publicação 1.1.0 acrescentou ao GitHub original. O histórico anterior é preservado; `release/` é somente a referência integral de `main@0c22b907b2f89c79ceb81d9e414a9cea4b4697f2`, sem uso no runtime atual.

## Instalação e execução

Node 22.13 ou posterior e pnpm 11.25.0:

```sh
npm install --global pnpm@11.25.0
pnpm install --frozen-lockfile
npm test
pnpm typecheck
pnpm build
node scripts/check-worker-build.mjs
```

`pnpm dev` inicia o desenvolvimento Vinext/Worker. Depois do build, `pnpm start` executa o Worker local pelo Wrangler. Esses comandos não publicam o app. Não é necessário autenticar o Wrangler para os testes locais.

Para o servidor Node de desenvolvimento/teste e a alternativa de hospedagem Node:

```sh
npm run start:node
```

Escuta padrão: `http://127.0.0.1:3000`. O runtime Node não precisa das dependências de frontend; `node server.mjs` funciona com os arquivos do checkout. O Docker usa esse servidor, com usuário sem privilégios. O domínio original usa o Worker.

## Organização

- `public/`: módulos financeiros, controlador, views, estilos, ícones, manifest e SW.
- `lib/shell.html`: HTML entregue nas rotas `/` e `/index.html`.
- `lib/market-server.mjs`: consultas públicas com destinos fixos, cache, validação e limites.
- `lib/market-http.mjs`: adaptação segura do transporte para o Worker.
- `lib/static-http.mjs` e `lib/embedded-assets.mjs`: assets empacotados no Worker, cabeçalhos uniformes, MIME, ETag, HEAD e 304.
- `build/sites-worker.ts`, `vite.config.ts`, `.openai/hosting.json`: projeto original e build da hospedagem. A integração Sites é preservada.
- `server.mjs`, `Dockerfile`, `compose.yaml`: execução Node reproduzível.
- `tests/`: suítes nativas e de navegador sobre os arquivos efetivamente publicados, incluindo fixtures sintéticas da versão 1.0.1.
- `UPSTREAM.json`: versão, referências anteriores e SHA-256 de cada arquivo público.

## Testes de navegador

O servidor de teste deve ser local e usar perfis descartáveis. Não abra cofres reais:

```sh
python -m pip install -r tests/requirements-browser.txt
python -m playwright install --with-deps chromium firefox webkit
python tests/compat.browser.py --browser all --output /tmp/minhas-financas-compat
python tests/run-browser-suites.py --output /tmp/minhas-financas-additional
```

A CI executa Node 22/24, TypeScript/build do Worker, Docker, as três engines e as suítes complementares Chromium. Contagens nativas, cenários de navegador e combinações de telas são apresentadas separadamente. Um cenário bloqueado não é aprovado. As suítes complementares têm sobreposição de cobertura e não são somadas à compatibilidade.

## Dados, atualização e publicação

O mesmo domínio e o IndexedDB são mantidos. Schema 3, envelope 1, AES-GCM e KDF permanecem compatíveis. A correção da primeira gravação de cofres 1.0.1 é mantida; uma troca parcial de KDF é recusada antes de tentar abrir a raiz. Trocas completas de senha recriptografam todos os registros.

Históricos de transferências, operações e proventos têm paginação independente e ações até o registro mais antigo. Os cálculos usam o conjunto completo, independentemente da página. A navegação de páginas não grava alterações financeiras.

O cache `mf-core-1.2.0` instala todos os assets de forma atômica. **Atualizar aplicativo** ativa a versão aguardando; as outras abas preservam seus arquivos até recarregar. Não limpe os dados do site para atualizar.

A rotina **Verify original public Site** (disparo manual ou criação de uma branch `codex/verify-public-*` depois da publicação) verifica novamente os mesmos cenários em produção, somente no domínio autorizado e com contextos novos e descartáveis; seus resultados não são somados aos da CI local. `node scripts/verify-public.mjs --commit <SHA>` confere bytes, cabeçalhos, APIs e controles de acesso.

`/version.json` e `X-App-Source-Commit` identificam o commit GitHub usado no build publicado. O commit interno Sites e o commit GitHub podem ter pais diferentes, mas devem ter a mesma árvore de arquivos. O procedimento está em [DEPLOY.md](DEPLOY.md); as correções e limites em [AUDITORIA.md](AUDITORIA.md).

BCB/IBGE, notícias IBGE, comunicados Fed e duas amostras brapi dependem de conexão e disponibilidade externa. Não há promessa de bolsa completa ou cotação em tempo real. Cofres, senhas e registros financeiros não são enviados às APIs. Backups externos continuam necessários.

## Acesso e primeiro uso — 1.2.0

A tela inicial exige criar ou desbloquear o cofre antes de mostrar o painel. No primeiro acesso, informe seu nome e uma senha de pelo menos 12 caracteres. O cofre começa sem contas, lançamentos, pagamentos, posições ou investimentos. Categorias padrão são uma estrutura de organização, sem valores financeiros.

O login é local: a senha deriva a chave AES-GCM e não é enviada ao servidor. Reabrir a página pede a senha novamente. **Bloquear cofre** encerra a sessão e remove os dados pessoais da interface; rascunhos desta sessão são conservados somente se puderem ser criptografados. Os bloqueios automáticos e a troca completa de senha permanecem.

Cada navegador/dispositivo possui seu próprio cofre. Para usar em outro aparelho, exporte o backup criptografado e restaure-o no outro navegador. Não há conta por e-mail, sincronização em nuvem ou recuperação de senha pelo servidor.

### Retirada dos exemplos

O app não chama mais a fábrica de demonstração nem abre uma sessão financeira sem criptografia. No carregamento, `access.mjs` reconhece somente o exemplo original intacto, incluindo seu checkpoint. A exclusão usa uma comparação atômica da cópia completa em `removeDemoSlot`; apenas as chaves e registros de `demo` são removidos. O cofre `personal`, checkpoints pessoais, backups e cópias legadas potencialmente reais permanecem.

Demonstrações alteradas, órfãs, corrompidas ou com checkpoints diferentes ficam separadas, fora do painel pessoal. A tela oferece exportar a cópia bruta para revisão e um descarte explícito; não há importação silenciosa para o cofre. Isso evita apagar um lançamento real que tenha sido digitado no antigo espaço de testes.

O banco mantém o nome e a versão existentes para preservar cofres. Atualize/recarregue as outras abas: uma aba antiga ainda pode executar o código antigo. Não limpe IndexedDB ou dados do site para atualizar.

### Identidade visual

`public/icon.svg` contém a marca vetorial de carteira em verde, branco e menta. O mesmo desenho aparece na entrada, menu, favicon e ícones PWA 192/512. `node scripts/brand-icons.mjs` reproduz os PNGs sem dependências adicionais.
