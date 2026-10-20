# Correções da auditoria independente — 1.1.1

Base conferida antes de editar: GitHub `main@0c22b907b2f89c79ceb81d9e414a9cea4b4697f2`, Site `715dbbac986b7c74ddc33a0aed5e959028eb6bdb`. Não havia mudanças posteriores nesses heads. O projeto e a origem foram mantidos.

## Correções verificáveis

- Históricos completos com paginação independente: 10 transferências ou 30 operações/proventos por página, primeira/anterior/próxima/última, contagem, nomes acessíveis e foco. Nenhum registro é descartado. Saldos, custos, posições e relatórios continuam usando todos os registros.
- Fixtures com 25 transferências, 65 operações e 65 proventos. Testes nativos verificam todos os IDs e as ações em todas as páginas; recebimento e exclusões antigas, persistência, replay, checkpoint e ausência de duplicação financeira. Testes de navegador usam o controlador real em desktop e 320×568.
- Mudança parcial de KDF é verificada antes de descriptografar a raiz, com a mensagem explícita de recriptografia completa. A guarda transacional permanece, assim como revisão/CAS e checkpoints. A regravação atômica de defaults legados na primeira gravação 1.0.1 permanece.
- Troca completa de senha, reabertura com a nova chave, recusa da antiga, backup antigo, novo checkpoint, concorrência entre duas conexões e tentativas inválidas são cobertos com estados sintéticos.
- Todos os assets passam pelo Worker, que aplica `nosniff`, CORP e a mesma política restritiva. Testes verificam MIME, GET/HEAD/304, SW e recusa de arquivos privados. A validação final depende também das respostas públicas, como descrito em DEPLOY.md.
- Código completo do Site, adaptação de rede, configuração, servidor Node, testes e instruções de instalação/publicação ficam no GitHub. O histórico é preservado e o SHA GitHub correspondente é incluído em `/version.json` no build.

## Evidências e contagem

`npm test` executa uma única suíte nativa sobre os arquivos atuais; os testes antigos foram movidos para `tests/` e apontam para `public/` e `lib/`. A cópia de referência `release/` não é executada novamente nem somada ao total.

`tests/compat.browser.py` informa por engine: cenários aprovados, bloqueados e falhos. As combinações de 8 telas × 4 tamanhos são cobertura interna de seu cenário responsivo; não são somadas aos cenários nem aos testes nativos. As sete suítes Chromium complementares têm cobertura sobreposta e resultados próprios.

O teste offline WebKit pode ser bloqueado por erro interno do driver. Nesse caso, um service worker mínimo independente é usado no diagnóstico; o cenário do app fica **bloqueado**, com `passed=false`, e não entra na contagem de aprovados. Engines que não iniciam também não contam como aprovadas. Os relatórios reais e logs ficam nos artefatos da CI correspondente ao commit, sem afirmação antecipada de sucesso.

Todos os testes usam perfis temporários e dados fictícios. Cofres reais não são abertos, reinicializados ou enviados ao servidor. Safari/iOS físico, teclado virtual real e leitor de tela humano não são equivalentes às engines Linux e exigem verificação separada.


## Verificação da hospedagem e correção 1.1.2

O teste público da primeira publicação 1.1.1 comprovou que Sites ainda servia assets diretamente sem os novos cabeçalhos. A versão 1.1.2 elimina esse caminho: o conjunto fechado entra no bundle do Worker e não é copiado para o diretório estático. A recusa de arquivos privados continua, assim como a identidade dos bytes, MIME e ETag. O SW ganha cache novo para que a política também seja atualizada nos clientes que instalaram a 1.1.1.
