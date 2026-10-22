# B4 — Fase 2B.1: MCP local sintético

Protótipo isolado, baseado em `97e76a655c389c61bf1001f8d0c4333d2855aee1`.
Não altera os arquivos herdados, não integra o Worker existente e não contém configuração de deploy.
Executa apenas no loopback `http://127.0.0.1:<porta>/mcp`, com Miniflare/workerd local, identidades RS256 efêmeras e fixtures.

## Reproduzir no checkout isolado

```sh
cd /workspace/work/b4-mcp-local
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
- Política somente em memória, sem DB/DO/KV, provisionamento ou rota administrativa. Na superfície HTTP, os grants sintéticos são reconstruídos por requisição; a revogação é testada na unidade de autorização, não é um serviço de revogação operacional.
- Upload e resposta HTTP: 16 KiB e prazo de leitura de 2 s. Resultado de ferramenta: 4 KiB serializados antes da duplicação em `content` e `structuredContent`.
- Os dois perfis demonstrados são MCP `2026-07-28` com negociação fixada e compatibilidade 2025 via handshake legacy do SDK.
- Textos de anúncios são retornados como dados, com `untrusted_data: true`; não há avaliador de instruções ou execução de texto.

## Evidências

Após os comandos, `work/` contém `interoperability.json`, `test-wire.json`, `bundle-report.json` e os bundles locais. Os traces guardam método, perfil e status, sem headers de autenticação ou parâmetros das ferramentas.
O relatório de entrega está em `docs/phase-2b1-report.md`.
O cliente usa o pacote oficial `@modelcontextprotocol/client`, em Node, separado do processo workerd que executa o servidor. A demonstração usa HTTP real, não `InMemoryTransport` nem chamada direta às funções do servidor.

Isto não demonstra compatibilidade com ChatGPT ou todo cliente de terceiros. Persistência operacional e Fase 2B.2 dependem de nova aprovação.
