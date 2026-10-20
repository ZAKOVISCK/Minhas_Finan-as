# Auditoria e entrega 1.1.0

A implementação do aplicativo local e do backend público foi concluída e validada no ambiente disponível. Esta entrega incorpora a revisão 1.0.2 e conclui as pendências de código: categorias, validação por campo, fontes públicas, legibilidade dos módulos e infraestrutura de produção. A publicação no endereço existente continua vinculada ao projeto da hospedagem que controla esse domínio; o envio do código ao GitHub não representa uma atualização automática desse site.

O frontend foi obtido dos arquivos públicos da versão 1.0.1, pois o repositório informado estava vazio. O backend desta entrega foi desenvolvido no projeto. Os testes usam dados fictícios; os cofres pessoais do usuário não foram acessados ou alterados.

## Resultado por área

| Área | Entrega validada |
|---|---|
| Finanças | Centavos e quantidades exatos, limites dos totais, datas, pagamentos parciais, transferências, cartões, recorrências e carteira |
| Backup | Exportação/restauração coerentes, criptografia e compatibilidade com estados antigos próximos do teto anterior de 32 MiB |
| Categorias | Adicionar, renomear, arquivar e reativar; referências atualizadas atomicamente; histórico e valores preservados |
| Formulários | Helpers e validação separados em `form-utils.mjs`; erros monetários e relacionais identificam o campo e mantêm a digitação |
| Importação | CSV/OFX com conciliação por pagamentos efetivos, identificadores preservados, multiplicidade e aplicação atômica do lote |
| Cofre | Bloqueio retira os dados da interface antes de operações assíncronas; falhas de rascunho não impedem o bloqueio |
| Persistência | Gravação transacional com comparação de revisão, repetição idempotente, integridade autenticada e recuperação explícita |
| Interface | Oito telas, adaptação móvel, paginação, nomes acessíveis, foco previsível, orçamento excedido e tabela semanal equivalente ao gráfico |
| Mercado | Backend real com quatro feeds, destinos HTTPS fixos, validação, cache, coalescência, limites e retentativas |
| Offline | Assets completos por versão, instalação atômica, ativação explícita e preservação dos arquivos usados por outras abas |
| Produção | Docker/Compose com usuário sem privilégios, filesystem somente leitura, imagem fixada por digest, healthcheck e publicação/rollback documentados |
| Manutenção | Módulos formatados, verificação de sintaxe de todos os JS/MJS e CI para Node 22/24, imagem e browsers |

Transferir dinheiro não cria receita ou despesa; pagar fatura não gera outra compra; uma recorrência gerada novamente não duplica sua ocorrência. Os testes verificam esses resultados e a preservação dos totais.

## Evidência de validação

A suíte nativa final executou **153 testes, todos aprovados**, sem casos ignorados. Inclui as regressões anteriores e testes novos de categorias, formulários, backend e leitura de backup no limite da versão antiga. A suíte financeira anterior também foi comparada à base pública: 24 de 47 cenários passavam antes das correções e 47 passaram depois; esses 23 cenários não representam 23 vulnerabilidades independentes.

No navegador foram aprovados cinco fluxos do controlador, quatro cenários de categorias, quatro de segurança do cofre, onze de IndexedDB/WebCrypto, quatro de recuperação e dez grupos de importação. A verificação visual cobriu 40 combinações de oito telas e cinco tamanhos, sem transbordamento horizontal ou erros JavaScript. Uma execução paralela do controlador teve timeout de inicialização; a repetição isolada com o mesmo critério de cinco segundos passou os cinco fluxos. A execução final WebKit foi repetida isoladamente após timeout de estabilidade durante o teste nativo pesado e passou.

Chromium e WebKit Linux passaram três cenários completos cada: edição/erros/foco/persistência; cofre/IndexedDB/WebCrypto/backup/bloqueio/desbloqueio; e 32 combinações de layout por engine. A política local de conteúdo permite somente scripts e estilos da própria origem, sem `unsafe-inline` ou `unsafe-eval`.

Firefox foi instalado, mas não iniciou a automação neste contêiner: falhas `uid_map: EROFS` e framebuffer SWGL ocorreram antes do carregamento do app. Suas variações de inicialização e Xvfb não resolveram o bloqueio. O resultado é zero cenários do app executados nessa engine nesta nuvem. A CI executou os três browsers em um runner independente e aprovou os três cenários de cada engine, incluindo as 32 combinações de layout por engine. A execução [39440149740](https://github.com/ZAKOVISCK/Minhas_Finan-as/actions/runs/39440149740) também aprovou os 153 testes em Node 22 e 24 e a imagem de produção. Os resultados estão registrados em `docs/VALIDACAO_1.1.0.json`. Safari/iOS físico, teclado virtual real e leitor de tela humano não foram testados.

O backend foi consultado por HTTP no processo local com provedores reais: `macro` retornou quatro indicadores, `brazil` dez publicações, `global` dez comunicados e `samples` duas cotações; os quatro responderam HTTP 200 sem erros. Datas e fontes permanecem visíveis. O backend não recebe dados financeiros, aceita somente feeds fixos e não é um proxy de URLs fornecidas pelo usuário.

A imagem de produção foi construída e iniciada como UID 1000 com filesystem somente leitura. HTML, módulos, MIME, healthcheck e portas configuráveis foram verificados; arquivos privados e módulos de servidor retornam 404. O comando `npm start` e a configuração de proxy desta nuvem foram testados. Os resultados detalhados e os hashes seguem no pacote de evidências.

## Compatibilidade e recuperação

O schema permanece em **3** e o envelope criptografado em **1**. AES-GCM, PBKDF2 SHA-256 com 600 mil iterações e chaves não extraíveis foram mantidos. A leitura antiga sem resumo de integridade continua aceita; a próxima gravação adiciona a proteção. O resumo detecta mistura de registros, sem impedir rollback integral para uma cópia antiga válida.

O limite do estado/JSON foi ajustado para **33 MiB**, mantendo o envelope criptografado em **48 MiB**. Uma fixture de 3.213 lançamentos, aceita pela versão 1.0.2 com somente 104 bytes de folga no antigo limite, passou a receber o catálogo sem se tornar ilegível. O novo teste preserva seus registros e verifica exportação/restauração.

A versão 1.1 lê backups antigos. Depois de criar ou renomear categorias personalizadas, versões 1.0.x não reconhecem esses nomes: mantenha **1.1.0 ou posterior**, inclusive ao atualizar abas antigas. A reversão do servidor não migra os dados do navegador para um formato anterior. Preservar o mesmo protocolo, hostname e porta mantém a origem dos cofres.

Registros e checkpoints sem cabeçalho são preservados até recuperação explícita. A exportação bruta conserva material criptografado e metadados, sem ser um backup normal pronto para restaurar. Senha incorreta não substitui os dados. O backup externo continua necessário; apagar os dados do site elimina também o IndexedDB.

## Publicação e limites externos

O procedimento completo está em [DEPLOY.md](DEPLOY.md). Para atualizar `minhas-financas-isaque.isaque-silvateixeira.chatgpt.site`, é necessário o projeto/painel que publica esse endereço. A revisão confirmou o acesso de escrita ao repositório GitHub, mas não identificou uma ferramenta de publicação dessa hospedagem no ambiente. Não foi criado outro domínio como substituto: isso abriria outra origem de armazenamento.

A entrega mantém o produto local e sem assinatura obrigatória. Sincronização, integração bancária, recuperação de senha por servidor e cálculo fiscal automático não fazem parte do serviço implementado; dependem de uma decisão de produto e de infraestrutura/provedores próprios. Foram apresentados como evoluções opcionais e não são simulados como recursos prontos.
