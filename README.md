# Minhas finanças

Aplicativo de finanças pessoais com contas, pagamentos parciais, transferências, cartões, parcelas, planejamento, recorrências e investimentos. A demonstração fica separada do cofre pessoal, que começa vazio e usa criptografia local no navegador.

A versão **1.1.0** inclui frontend, backend de fontes públicas, testes e configuração de produção. O frontend original veio dos arquivos públicos da versão 1.0.1; o backend desta entrega foi implementado neste projeto. [CHANGELOG.md](CHANGELOG.md) descreve as mudanças, [AUDITORIA.md](AUDITORIA.md) registra resultados e limites, e [DEPLOY.md](DEPLOY.md) explica publicação e reversão. Código no GitHub e site publicado são entregas distintas: o endereço existente precisa receber a versão pelo mecanismo da hospedagem.

## Executar

Requer Node.js 22 ou posterior. O runtime não tem dependências npm para instalar.

```sh
npm start
```

O servidor usa `127.0.0.1:3000`. `npm run dev` reinicia o processo ao editar arquivos. `HOST` e `PORT` ajustam a escuta; em produção, use a configuração da hospedagem ou o Docker/Compose fornecido. O aplicativo deve ser servido na raiz da mesma origem HTTPS. Não há etapa de build nem banco de dados financeiro no servidor.

Em ambientes com proxy, Node 24 pode ser iniciado com `NODE_USE_ENV_PROXY=1 npm start`, preservando a configuração de confiança dos certificados. Em uma rede comum essa opção é desnecessária.

O armazenamento pertence ao protocolo, hostname e porta do navegador. Mudar esse endereço abre outro espaço de dados. Exporte um backup antes de uma mudança de origem.

## Recursos concluídos

- Contas e saldos iniciais datados; vencimento, competência e pagamentos separados.
- Transferências neutras nos relatórios de receitas/despesas; compras parceladas e pagamentos de fatura separados.
- Categorias configuráveis: adicionar, renomear, arquivar e reativar. Renomear atualiza lançamentos, orçamentos e recorrências. Arquivar mantém o histórico; recorrências existentes podem ser pausadas separadamente.
- Cofre AES-GCM com senha local, bloqueio manual/automático, backup criptografado e recuperação da cópia anterior.
- CSV/OFX com prévia, conciliação parcial, seleção em várias páginas e deduplicação por pagamentos efetivos.
- Interface móvel, tabela semanal acessível, paginação, foco e erros associados aos campos.
- Núcleo offline com atualização explícita e arquivos coerentes por versão.
- Backend gratuito de indicadores, notícias oficiais e amostras de ações opcionais.

## Testes

```sh
npm test
```

O comando verifica a sintaxe de todos os arquivos JavaScript e executa as regressões nativas: finanças, categorias, formulários, criptografia, importação, mercado, armazenamento, servidor e service worker. `npm run check` executa somente a verificação de sintaxe. A CI usa Node 22/24 e testa a imagem de produção.

Os testes de navegador usam Python com `playwright`, Chromium e dados fictícios em perfis temporários. Com o servidor ativo em outro terminal:

```sh
python tests/app.browser.py
python tests/categories.browser.py
python tests/security-vault.py --base-url http://127.0.0.1:3000
python tests/imports.browser.py
python tests/recovery.browser.py
python tests/browser_views.py
python tests/compat.browser.py --browser chromium
```

O teste isolado de IndexedDB/WebCrypto dispensa o servidor:

```sh
python tests/storage.browser.py
```

A suíte de compatibilidade aceita `--browser chromium|firefox|webkit|all`, endereço local, executável e diretório de evidências. Em um runner com permissão de instalar dependências, `python -m playwright install --with-deps firefox webkit` prepara as engines adicionais. Nesta nuvem, WebKit foi validado com bibliotecas em prefixo local e um helper; os detalhes estão nas evidências da entrega. Firefox foi instalado, mas seu processo não iniciou neste contêiner. WebKit Linux não equivale a Safari/iOS físico. Os testes não substituem verificação com teclado virtual e leitor de tela em aparelhos reais.

## Fontes públicas

`GET /api/data?feed=macro|brazil|global|samples` é atendido pelo servidor incluído. `/api/health` confirma a disponibilidade do processo, sem consultar fontes externas.

| Feed | Conteúdo | Fonte |
|---|---|---|
| `macro` | Selic, IPCA mensal/acumulado e PTAX de fechamento | Banco Central e IBGE via SGS |
| `brazil` | Publicações oficiais brasileiras | Agência IBGE Notícias |
| `global` | Comunicados de política monetária, em inglês | Federal Reserve |
| `samples` | Amostras de PETR4 e VALE3, mediante ação explícita | brapi |

O servidor consulta destinos fixos HTTPS, valida conteúdo/datas, compartilha consultas simultâneas e usa cache, timeout e retentativas limitadas. Não aceita URLs nem recebe registros financeiros pelo endpoint. Falhas de fonte aparecem com uma mensagem; dados anteriores são identificados como desatualizados. Uma falha não vira cotação zero. Os valores são referências com data, não uma garantia de preços em tempo real. A disponibilidade dos provedores gratuitos pode variar.

A saída de rede precisa alcançar `api.bcb.gov.br`, `olinda.bcb.gov.br`, `servicodados.ibge.gov.br`, `www.federalreserve.gov` e, para as amostras, `brapi.dev`. Não são necessárias chaves de API para os recursos públicos implementados e validados.

## Offline e atualizações

Após a primeira instalação conectada concluir, o service worker serve HTML, módulos, estilos e ícones do mesmo cache de versão, inclusive offline. Dados públicos dependem de conexão. Instalação incompleta preserva a versão anterior. **Atualizar aplicativo** ativa uma versão aguardando; conclua os rascunhos antes de usá-la. Outras abas mantêm seus arquivos até recarregar.

Ao publicar, altere o identificador em `sw.js` e os rótulos em `package.json`, `index.html` e `views.mjs`. Publique todos os arquivos da versão juntos. Não reutilize cache para conteúdo diferente.

Se for necessário reparar somente o cache do programa, remova o service worker e os caches `mf-core-*`/`mf-worker-meta` nas ferramentas do navegador e recarregue com conexão. **Limpar dados do site também apaga o cofre IndexedDB**. O cache offline não substitui backup.

## Backup, compatibilidade e recuperação

O backup padrão do cofre é criptografado e exige sua senha para restaurar. Faça a exportação em Configurações, guarde fora do navegador e use **Testar restauração** para verificar o arquivo. CSV e impressão contêm dados legíveis. O limite do estado/JSON é 33 MiB; o envelope de backup criptografado admite 48 MiB. O mesmo limite de plaintext vale para validação, criptografia e leitura.

O schema continua em 3 e o envelope criptografado em 1. Backups anteriores são lidos pela versão 1.1.0. O catálogo de categorias é compatível na leitura dos dados antigos. Depois de criar ou renomear categorias personalizadas, mantenha **1.1.0 ou posterior**: versões 1.0.x não reconhecem esses nomes. Atualize abas antigas antes de recarregar os registros. Reverter somente o servidor não migra os dados do navegador para um formato antigo.

Registros ou cópias anteriores sem cabeçalho são preservados. A abertura do cofre oferece exportação bruta para recuperação e, quando houver checkpoint válido, recuperação após senha e confirmação. A cópia bruta conserva material criptografado e metadados; não é um backup normal pronto para restaurar. A recuperação substitui o estado atual pela cópia escolhida.

Cofres antigos sem resumo autenticado de integridade continuam legíveis e recebem essa proteção na próxima gravação. Ela detecta mistura de registros, mas não impede substituir o armazenamento inteiro por uma cópia antiga válida. A senha não é recuperável pelo servidor. Limpar o perfil, perder o dispositivo ou remover os dados do site pode eliminar o cofre. Se o armazenamento estiver indisponível, o aviso de sessão temporária exige exportar antes de fechar.

O produto permanece local, sem assinatura obrigatória, sincronização entre dispositivos, integração bancária ou cálculo fiscal automático. Essas integrações exigem arquitetura, provedores e credenciais próprios; não são simuladas pelo aplicativo.
