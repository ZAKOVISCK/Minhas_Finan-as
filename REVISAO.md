# Implementação da auditoria integral · v1.0.1

O aplicativo mantém o mesmo Site e o acesso público. A versão 0.2 foi preservada em `legacy/` para regressão e migração; a base financeira local existente não é sobrescrita na atualização.

| Achado | Implementação e evidência |
| --- | --- |
| A01 — exportação não restaurável | Limites simétricos por formato e exportação compacta; round-trip de 10.000 registros com descrições multibyte |
| A02 — vencimento e pagamento confundidos | Compromissos e liquidações separados; parciais e pagamento em mês posterior com testes |
| A03 — exemplos misturados ao pessoal | Demonstração e cofre pessoal independentes; cofre novo vazio |
| A04 — proteção dos dados | AES-GCM por registro e backup cifrado; senha local separada do acesso ao site |
| A05 — persistência e recuperação | Solicitação de persistência, estimativa de uso, verificação de arquivo, recuperação anterior e aviso de sessão temporária |
| A06 — aviso após commit | Exceção do BroadcastChannel não invalida gravação; identificador de operação para retry e revisão transacional |
| A07 — validação divergente | Domínio comum; pagamentos futuros e migração antiga com realizado futuro são rejeitados |
| A08 — referências sem histórico | Orçamentos e reserva com vigência mensal; preços por data; total global legado identificado separadamente |
| A09 — contraste e legibilidade | Tokens de texto ajustados e contraste AA testado; foco visível, alvos móveis maiores e fontes locais do sistema |
| A10 — rascunhos descartados | Rascunhos de edição preservados na sessão; aviso de saída; cifragem em memória ao bloquear o cofre |
| A11 — lista com 10.000 linhas | Até 50 linhas por página; totais dos filtros; teste com 10.000 registros |
| A12 — estado monolítico | Entidades em registros separados, diff de escrita e journal; transferências/faturas persistidas atomicamente |
| A13 — instalação e offline | Manifesto, ícones, cache versionado e atualização explícita; validação automatizada dos arquivos, teste nativo pendente |
| A14 — cabeçalhos e dependências | Documento e rotas do Worker com CSP sem inline/eval, nosniff, Referrer-Policy, HSTS, anti-frame e Permissions-Policy; fontes externas removidas |
| A15 — verificação incompleta | 78 testes, sintaxe, tipos, build e consultas reais; revisão visual e comportamento nativo de PWA ainda dependem de navegador |
| A16 — funcionalidades e fontes | Contas, cartões, recorrências, metas, importação, carteira, relatórios, macroindicadores e notícias implementados; cobertura de bolsa permanece limitada às fontes gratuitas e entradas manuais |

## Limites explícitos

- O acesso ao site continua sem login no ChatGPT. A senha protege somente o cofre pessoal local.
- Não houve contratação de serviço pago. A hospedagem e as fontes mantêm seus limites e condições de terceiros.
- A lista de acompanhamento aceita ações, FIIs e índices, com valores manuais/importados. As quatro cotações sem token da brapi são amostras para testes; não representam cobertura de mercado em tempo real.
- O relatório diferencia caixa, competência, aportes e posições, mas não apura IR nem emite recomendações de investimento.
- Notícias reproduzem títulos e links oficiais. A interpretação é educativa, sem IA paga e sem previsão automática de preços.
- A cópia anterior acompanha a última gravação, não um histórico ilimitado. Backups externos continuam necessários.
- Ações não verificadas em navegador não são apresentadas como aprovadas. O QA automatizado de DOM/IndexedDB usa implementações JavaScript de teste.

## Verificação executada

`pnpm test` (78 testes), `pnpm check`, `pnpm typecheck` e build pelo fluxo oficial Sites. Fontes macro, IBGE e Federal Reserve consultadas com os adaptadores reais; cada falha individual permanece visível e não produz valor zero fictício.

Correção de compatibilidade da hospedagem: o Cache API é opcional; erros de leitura/gravação do cache não impedem a consulta. O shell HTML é servido por uma rota para que os cabeçalhos do Worker sejam aplicados ao documento.
