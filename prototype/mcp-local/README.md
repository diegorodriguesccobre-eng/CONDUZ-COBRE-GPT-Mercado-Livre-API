# B4 — Fase 2B.1: MCP local sintético

Protótipo isolado, originalmente baseado em `97e76a655c389c61bf1001f8d0c4333d2855aee1`.
A evolução local 2B.2-A parte de `dd2933d1c1d39e76e8d9011048666933be6b2eb6`; consulte [a arquitetura persistente](docs/persistence.md).
Não altera os arquivos herdados, não integra o Worker existente e não contém configuração de deploy.
Executa apenas no loopback `http://127.0.0.1:<porta>/mcp`, com Miniflare/workerd local, identidades RS256 efêmeras e fixtures.

## Reproduzir no checkout isolado

```sh
# Na raiz de um checkout isolado da base aprovada:
npm ci --ignore-scripts
cd prototype/mcp-local
npm ci --ignore-scripts
npm run typecheck
npm test
npm run demo
```

As instalações usam os dois lockfiles; não atualize versões para reproduzir a entrega.
`npm test` e `npm run demo` iniciam workerd em uma porta aleatória de `127.0.0.1`, conectam um cliente MCP independente por TCP e encerram ambos ao terminar. Não deixam endpoint publicado nem servidor persistente.
O sandbox precisa permitir execução de processos e sockets locais. Nenhum comando de implantação é necessário.

## Superfície

- Somente `account`, `listings` e `listing`, com schemas de entrada/saída fechados.
- `synthetic-operator-a` tem `read` em `account-a`; `synthetic-operator-b` tem `read` em `account-b`.
- JWTs e chave privada são gerados no harness, ficam em memória e não são gravados nos relatórios.
- O JWT é validado pelo verificador B4/B3.1 reaproveitado. O header usado é uma simulação local de Access; não é uma integração Access ou OAuth real.
- O modo original `startLocal()` usa política em memória e reconstrói os grants por requisição. O novo `startPersistent()` é um harness separado de testes com SQLite/DO local; não cria rotas administrativas, bindings de produção ou cofres operacionais.
- Upload e resposta HTTP: 16 KiB e prazo de leitura de 2 s. Resultado de ferramenta: 4 KiB serializados antes da duplicação em `content` e `structuredContent`.
- Os dois perfis demonstrados são MCP `2026-07-28` com negociação fixada e compatibilidade 2025 via handshake legacy do SDK.
- Textos de anúncios são retornados como dados, com `untrusted_data: true`; não há avaliador de instruções ou execução de texto.

## Evidências

Após os comandos, `work/` contém `interoperability.json`, `test-wire.json`, `bundle-report.json` e os bundles locais. Os traces guardam método, perfil e status, sem headers de autenticação ou parâmetros das ferramentas.
O relatório de entrega está em `docs/phase-2b1-report.md`.
O cliente usa o pacote oficial `@modelcontextprotocol/client`, em Node, separado do processo workerd que executa o servidor. A demonstração usa HTTP real, não `InMemoryTransport` nem chamada direta às funções do servidor.

Isto não demonstra compatibilidade com ChatGPT ou todo cliente de terceiros. Persistência operacional e a Fase 2B.2-B dependem de nova aprovação.

## Fase 2B.1-Q: rejeições e encerramento

`scripts/rejections.mjs` compartilha os contratos de rejeição entre a demonstração e os testes. Autorização exige o resultado MCP `isError: true` com `SYNTHETIC_READ_DENIED`; schema exige o erro de entrada do SDK para a ferramenta indicada. Ferramenta desconhecida exige `ProtocolError` real, código `-32602` e mensagem exata. No SDK fixado, `__proto__` é negado como `disabled`; os demais nomes desconhecidos são `not found`. JSON-RPC bruto exige status, envelope, id, código e mensagem, inclusive em SSE. Exceções de conexão, timeout, HTTP indisponível ou leitura interrompida não satisfazem esses contratos.

Os 36 casos originais são preservados com expectativas mais estritas. A suíte adicional testa falhas injetadas (incluindo `ECONNRESET`) e o ciclo de vida em subprocessos. `npm test` descobre ambas as suítes, sem alteração de workflow ou dependência. A demonstração também falha se um reset ocorrer na chamada da ferramenta desconhecida, sem gravar relatório de sucesso.

O harness registra clientes, transportes, respostas e requests nativos, aborta operações pendentes e tenta todos os cleanups. `close()` é idempotente e recusa novas operações; falha em um cliente não impede `Miniflare.dispose()`. Há prazos de 10 s para ready e 5 s para I/O/cleanup; timers próprios são removidos em finally. Erros de execução e cleanup são propagados, inclusive em `AggregateError`, em vez de serem convertidos em sucesso.

`work/lifecycle-evidence.json` registra os cenários com encerramento natural, portas recusando conexão, processos workerd encerrados e ausência de recursos/timers adicionais, incluindo timers sem ref. Os subprocessos não usam `process.exit()` nem force-exit; o teste pai só mata seu grupo em caso de timeout, que faz o teste falhar. A inspeção de processos usa `/proc` e os diagnósticos de handles/timers são específicos de Linux/Node 24, compatíveis com o runner Ubuntu 24.04 previsto.

Factories e hooks opcionais de `startLocal` existem apenas como pontos locais de composição e injeção de falhas; não são parâmetros MCP, variáveis de ambiente ou bindings do Worker. Na entrega 2B.1-Q nenhum arquivo `src/` foi alterado. A evolução 2B.2-A modifica somente o entrypoint do protótipo, preservando o Worker existente. OAuth real e operação de produção continuam fora do escopo. A validação local não substitui nova execução GitHub após eventual publicação autorizada.

## Fase 2B.2-A: persistência sintética

`npm test` descobre os 71 testes anteriores e 42 novos casos de persistência/segurança (113 no total). Os testes novos compilam seu próprio entrypoint local e usam diretórios temporários de SQLite, removidos no encerramento. Para conferir também os tipos do fixture administrativo/falhas:

```sh
npm exec -- tsc --noEmit -p tsconfig.persistence.json
node --test tests/persistence.test.mjs
```

O registro independente de revisões/revogações é obrigatório para autorizar uma projeção de concessão restaurada. Restaurar apenas a projeção não desfaz uma revogação. Restaurar simultaneamente uma versão antiga da autoridade e das projeções está fora da garantia: exige uma âncora externa confiável ou recuperação com bloqueio e reconciliação administrativa. Não restaure o diretório completo como procedimento operacional. Os detalhes e limites estão em [docs/persistence.md](docs/persistence.md).
