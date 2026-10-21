# Auditoria gratuita da versão 1.3.0

Revisão publicada de referência: `500c67eefd499b5fe2abc68ffa3c8bbcbdf11843`.
Árvore: `e08c813779e5863b758a7c5c4adefd535eb6f452`.

Esta atualização é das ferramentas de teste. Não altera o aplicativo, os arquivos
públicos, o servidor, a criptografia, o armazenamento, o service worker ou o
lockfile npm. A versão publicada permanece 1.3.0. Não é uma nova publicação.

## Custo e isolamento

- Somente executores padrão `ubuntu-latest` no repositório público. Não configurar
  executores maiores, serviços de navegador pagos, hospedagem ou assinaturas.
- A CI atualizada imprime relatórios em logs e resumos de execução; não usa
  `upload-artifact`, `actions/cache` ou `setup-node` com cache. Não adiciona
  armazenamento faturável de artefatos ou caches.
- Navegadores usam perfis descartáveis e dados sintéticos. A checagem do site
  público consulta somente arquivos, versão, APIs públicas e controles de acesso.
- Nenhum segredo, cofre, backup real, perfil de navegador ou `node_modules` deve
  entrar no GitHub. Não alterar permissões, TLS ou o proxy para executar testes.

## Preparação e comandos reproduzíveis

Todos os comandos abaixo partem da raiz do checkout, onde está `package.json`.
No ambiente Finan-as, executar primeiro `cd /workspace/Minhas_Finan-as`.

Ferramentas: Node `24.19.0`, pnpm `11.25.0`, Python `3.12`,
Playwright Python `1.64.0` conforme `tests/requirements-browser.txt`.

```sh
git rev-parse HEAD
git status --short
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm test
pnpm lint
pnpm typecheck
pnpm build
node scripts/check-worker-build.mjs
python -m pip install -r tests/requirements-browser.txt
python -m playwright install --with-deps chromium firefox webkit
python tests/offline-driver.browser.py
```

Com o servidor iniciado em outro terminal por `pnpm start:node`, executar:

```sh
python tests/compat.browser.py --browser all --require-all-scenarios --output /tmp/mf-auditoria-compat
python tests/run-browser-suites.py --output /tmp/mf-auditoria-adicionais
```

Usar diretórios novos para preservar evidências de rodadas anteriores. A execução
Worker é separada: após o build, `pnpm start` inicia o Wrangler local, sem publicar
nem exigir credenciais Cloudflare. A hospedagem de produção não participa do
teste local e não é atualizada por estes comandos.

## Por que atualizar o Playwright

O 1.62.0 apresentava `WebKit encountered an internal error` na recarga após
`context.set_offline(True)`, inclusive em uma página mínima sem o aplicativo.
A correção upstream é https://github.com/microsoft/playwright/pull/42894,
incluída no Playwright 1.64.0. Uma atualização só encerra a pendência após a
reprodução mínima e o cenário do aplicativo passarem; não basta instalar a versão.

`tests/offline-driver.browser.py` executa somente a reprodução mínima nos três
motores. É diagnóstico da ferramenta e não soma cenários de aplicação.
`--require-all-scenarios` faz a CI falhar também para cenários bloqueados.
O modo anterior permanece disponível para diagnóstico, com bloqueios explícitos
no JSON, mas não comprova aprovação integral.

Os dois erros de lint eram o nome local `module` em testes de servidor. O nome
passa a `cryptoModule` nos testes atual e histórico, sem mudar as verificações.
Avisos restantes são mantidos visíveis; não desabilitar regras para ocultá-los.

## Como verificar as evidências

`Validate application` testa o commit exato da branch/PR, registra sua revisão,
instala pelo lockfile e executa testes, lint, tipos, build, Worker, imagem Node e
navegadores. O relatório de compatibilidade contém `passed`, contagens e motores.

`Audit published 1.3.0 without paid services` é uma rodada específica desta
auditoria: compara a branch com a referência publicada e reexecuta testes, tipos
e build no commit publicado exato, além da consulta pública somente de leitura.
Este fluxo não é um deploy nem certifica versões futuras do site.

Não somar as contagens das duas versões de Node, da referência publicada e das
suítes adicionais de Chromium: elas se sobrepõem. Combinações de telas também
não são cenários adicionais. Conferir separadamente erros, bloqueios e avisos.

O Codex pode inspecionar esses logs pelo conector GitHub mesmo que o seu shell
continue sem acesso ao registro npm. Inspecionar uma execução externa é distinto
de reexecutar os testes no próprio executor. Para uma confirmação independente,
o auditor precisa conferir revisão, workflow, comandos e resultados, e registrar
onde efetivamente executou cada verificação.

## Proxy do Codex

Se `curl` retorna HTTP `000`, saída `7`, com falha de conexão ao proxy herdado,
registrar o impedimento antes de instalar. Não trocar registro, desligar TLS,
usar túneis ou remover o proxy. A CI constitui uma alternativa de execução;
não significa que o proxy da nuvem foi reparado. A correção do serviço ou de uma
política administrada deve ser tratada pela plataforma/administrador.

Safari/iOS físico e leitor de tela humano permanecem avaliações distintas dos
testes Playwright; não registrar essas verificações como aprovadas por inferência.
