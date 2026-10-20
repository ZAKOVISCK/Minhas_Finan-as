## 1.2.0 — acesso para uso pessoal

- Tela de acesso local por senha, criação no primeiro uso e bloqueio ao sair/reabrir, usando o cofre criptografado existente.
- Nova marca vetorial de carteira, integrada à entrada, menu, favicon e ícones instaláveis.
- Fim da abertura/criação automática de demonstrações e do botão de reinicializar exemplos.
- Limpeza atômica apenas dos exemplos intactos; alterações, dados órfãos e checkpoints desconhecidos são preservados separadamente para exportação e descarte explícito.
- Nenhuma alteração no schema financeiro, nome/versão do IndexedDB ou envelope de backup. Cofres pessoais continuam compatíveis.
- Testes do primeiro acesso vazio, novo login, privacidade, limpeza com concorrência e preservação do cofre pessoal. Fixtures dos testes de navegador passam a ser criadas explicitamente em cofres sintéticos criptografados.

# Correção de hospedagem 1.1.2

- Assets servidos em bytes pelo Worker, com `publicDir:false`, para garantir cabeçalhos mesmo quando Sites ignora o roteamento de arquivos enviados.
- Preservados MIME, ETag, HEAD/304, CSP, escopo e atualização segura do SW. Cache `mf-core-1.1.2` para atualizar clientes da 1.1.1.
- Mantidas integralmente as correções de histórico, KDF e migração da revisão 1.1.1.

# Alterações

## 1.1.1

- Históricos completos e paginados de transferências, operações e proventos, com ações antigas acessíveis, foco e adaptação móvel.
- Validação de mudança de KDF anterior à leitura cifrada da raiz; CAS, recuperação e correção de migração 1.0.1 preservados.
- Cabeçalhos uniformes para os assets pelo Worker; MIME, cache, SW, HEAD e 304 mantidos.
- Projeto completo, adaptação do servidor, testes sobre o código atual, CI multiengine e instruções reproduzíveis de build/publicação no GitHub.
- Proveniência por `/version.json` e commit GitHub no build; cache offline `mf-core-1.1.1`, sem limpeza de cofres.

---

# Alterações

## 1.1.0 — conclusão das pendências de implementação

- Backend `/api/data` e healthcheck incluídos: BCB/IBGE, notícias IBGE, comunicados Fed e amostras brapi opcionais. Todos os quatro feeds foram consultados com dados reais; validação, cache, limite de resposta, timeout e retentativas foram testados.
- Categorias configuráveis com IDs, renomeação atômica das referências, arquivo/reativação e preservação de histórico e backups antigos. Categorias personalizadas exigem leitor 1.1.0 ou posterior.
- Templates e validação de formulários extraídos para `form-utils.mjs`, com erros monetários e relacionais associados ao campo e preservação dos dados digitados.
- Limite de plaintext/estado ampliado para 33 MiB, preservando margem para o catálogo na leitura de estados antigos próximos do limite anterior. Envelope criptografado permanece em 48 MiB.
- Módulos formatados para revisão e manutenção. Política de conteúdo sem scripts ou estilos inline, lista pública restrita e backend privado não exposto como arquivo.
- Docker/Compose com usuário sem privilégios, imagem fixada por digest, filesystem somente leitura, healthcheck e CI para Node 22/24 e imagem de produção. Procedimento de publicação e reversão em `DEPLOY.md`.
- Regressões de categorias, formulários e backend adicionadas. Fluxos do cofre e layouts validados no Chromium e WebKit Linux. Firefox instalado, porém bloqueado no lançamento pelo contêiner. No runner da CI, Chromium, Firefox e WebKit foram aprovados; Safari/iOS físico e leitor de tela humano não foram executados.

A publicação no endereço existente depende do mecanismo da hospedagem. O repositório e o pacote de código não alteram automaticamente o site. Sincronização e conexão bancária continuam integrações opcionais, sem contratação ou simulação nesta entrega.

## 1.0.2 — revisão local

Base: arquivos públicos da versão 1.0.1. Esta revisão não foi publicada no site.

### Regras financeiras

- Correção da seleção da última cotação ou posição registrada no mesmo dia e da ordem de novas operações após exclusões.
- Validação de quantidades, arredondamento, desdobramentos, totais e tamanho do estado antes de persistir; frações inferiores à precisão admitida não são truncadas silenciosamente.
- Validação de recorrências, datas e compras vinculadas a cartão. Uma compra de cartão não pode ser convertida em receita.
- Índices de pagamentos, contas e cotações reduzem consultas repetidas em relatórios, faturas e exportações.

### Importação e fontes públicas

- Conciliação usa pagamentos efetivos, com data, valor e conta. Um compromisso ainda não pago não é tratado como movimentação bancária já importada.
- Identificadores bancários são preservados por pagamento, inclusive em conciliações parciais. Linhas idênticas sem identificador mantêm sua multiplicidade, com aviso sobre duplicidade inferida.
- Lotes são aplicados de forma atômica. Leitura de CSV/OFX, sinais, codificação e validação das linhas receberam correções.
- Respostas de mercado são validadas; falhas parciais mantêm os dados anteriores com indicação de desatualização. Links de notícias ficam restritos a fontes oficiais HTTPS.

### Cofre e armazenamento

- Bloquear o cofre retira dados pessoais, filtros, arquivos selecionados e formulários da interface antes de aguardar a criptografia dos rascunhos. Uma falha ao guardar o rascunho não impede o bloqueio.
- Repetir a mesma operação devolve o estado efetivamente salvo; reutilizar seu identificador com outro conteúdo gera conflito.
- Cabeçalhos, registros e cópias anteriores são verificados. Registros ou checkpoints sem cabeçalho são preservados e não são substituídos por um espaço vazio; a recuperação exige ação explícita.
- Resumo autenticado do estado detecta a mistura de registros antigos e atuais. A troca de chave regrava todos os registros e descarta cópias anteriores incompatíveis.
- Exportação bruta e recuperação da cópia anterior ficam disponíveis no fluxo de abertura quando aplicável. Formatos criptográficos existentes foram mantidos, com validação de estrutura e tamanho antes da derivação de chave.

### Interface e entrega

- Ajustes de navegação por teclado, retorno de foco, mensagens de erro e nomes acessíveis dos controles.
- Lançamentos se adaptam a telas pequenas; navegação inferior reserva seu espaço real. O gráfico semanal ganhou tabela acessível e o orçamento excedido tem indicação textual.
- Ocultar valores também protege detalhes de gráficos. Rotas inválidas são rejeitadas e as operações do controlador são serializadas.
- O service worker instala o conjunto completo de uma versão e mantém a versão usada por outras abas. A ativação da atualização é explícita.
- Servidor local sem dependências npm, cabeçalhos de segurança, testes nativos e CI em Node 22/24.

### Verificação e limites

A suíte nativa reúne 110 testes. Scripts adicionais verificam os fluxos reais em Chromium, usando dados fictícios; os comandos estão no README.

O schema continua na versão 3; `payments.importKey` é opcional. Backups criptografados continuam no envelope versão 1. Registros antigos sem resumo de integridade são aceitos e atualizados na próxima gravação. Dados inconsistentes são preservados para recuperação, sem correção silenciosa de valores.

O backend de `/api/data` não foi disponibilizado. O servidor local retorna HTTP 503 para esse serviço. Não foram adicionados sincronização entre dispositivos, conexão bancária, recuperação de senha por servidor ou cálculo fiscal. A criptografia protege os dados armazenados; não impede acesso por um dispositivo comprometido nem a restauração completa de uma cópia antiga válida.


## Publicação Sites 1.1.0

- Incorporado `main` em `0c22b907b2f89c79ceb81d9e414a9cea4b4697f2` no projeto e domínio originais.
- Mantido backend original, adaptando o transporte para Cloudflare Workers e preservando CSP, destinos fixos e contrato JSON.
- Corrigida a primeira gravação de registros legados sem digest, com testes contra o cofre real 1.0.1 usando somente fixtures sintéticas. Schema, envelope, criptografia, IDs, valores e origem preservados.
- Adicionados testes da adaptação, migração de cofres e backup antigo, mais CI de migração e offline em navegadores.

- HTML e assets compartilham o mesmo caminho de entrega, ETag e `Cache-Control: no-cache, no-transform`, preservando bytes, CSP e revalidação sem transformações intermediárias.
