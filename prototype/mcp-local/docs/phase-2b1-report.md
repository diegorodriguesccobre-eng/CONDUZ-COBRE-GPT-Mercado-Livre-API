# CONDUZ COBRE — B4 — relatório da Fase 2B.1

Data: 22/10/2026, America/Sao_Paulo. Base oficial: branch `b4/cloudflare-access-mcp`, commit `97e76a655c389c61bf1001f8d0c4333d2855aee1`. Desenvolvimento em checkout independente `/workspace/work/b4-mcp-local`, HEAD destacado. O checkout original `/workspace/work/b4` e seu ZIP de preservação não foram usados como área de edição.

## Resultado

Interoperabilidade real demonstrada por Streamable HTTP entre um cliente MCP Node separado e um servidor executado em workerd/Miniflare, ambos exclusivamente locais. Descoberta, chamadas, negações e erros foram exercitados em dois perfis: `2026-07-28` fixado e compatibilidade `2025-11-25` do SDK, com versão negociada conferida no cliente. Três ferramentas anunciadas: `account`, `listings`, `listing`; nenhum tool comercial de escrita ou de administração.

TypeScript: aprovado. Testes finais: **36/36**, quatro suites, zero falhas/cancelamentos/skips. Demonstração: aprovada nos dois perfis. npm audit do subprojeto: zero vulnerabilidades reportadas. Os testes e a demonstração registraram **zero tentativas de egress do Worker**, com porta de saída negada pelo harness. Foram feitas consultas de documentação e instalação/auditoria npm durante o desenvolvimento; zero egress refere-se à aplicação em execução.

## Compatibilidade do SDK e Workers

O SDK oficial TypeScript v2 `2.3.1` publica `createMcpHandler` e `McpServer`. O handler opera com Request/Response Web Standards. Foi empacotado com esbuild usando `platform: browser` e condições `workerd`/`browser`, e executado no binário workerd `1.20261019.1`, compatibility date `2026-10-01`, sem flag `nodejs_compat`.

O bundle da aplicação mediu **695.538 bytes**, com 208 módulos de entrada e nenhum import Node builtin no grafo empacotado. O adaptador de JSON Schema selecionado é o caminho workerd do SDK, evitando compilação dinâmica do validador Node. A prova de execução é a suíte HTTP em workerd, não apenas sucesso do bundler.

Não foram necessários patches no SDK, Express, servidor Node na aplicação, alteração de runtime do Worker existente ou atualização de dependências herdadas. Duas correções normais do harness/entrypoint foram feitas: uso da função pública `convertV4MiniflareOptions` da versão 5 do Miniflare, e remoção de export numérico do entrypoint Worker (workerd trata exports nomeados como entrypoints). Isso não implicou alteração estrutural na arquitetura B4.

A primeira rodada funcional registrou 34/35: o teste de Host forjado usando fetch não enviou o valor de Host pretendido e recebeu 400. O teste passou a usar HTTP nativo Node para transmitir o Host adulterado; passou com rejeição 403. A rodada final, incluindo teste adicional de upload incompleto, passou 36/36. Esses eventos não foram ocultados nem tratados como falha de produção.

Fontes oficiais consultadas:

- [SDK v2, runtimes Web Standards](https://ts.sdk.modelcontextprotocol.io/v2/serving/web-standard).
- [SDK v2, cliente HTTP](https://ts.sdk.modelcontextprotocol.io/v2/clients/connect).
- [Pacotes oficiais e exports](https://ts.sdk.modelcontextprotocol.io/v2/get-started/packages).

## Dependências fixadas

Todas as dependências diretas do subprojeto usam versões exatas. O novo `prototype/mcp-local/package-lock.json` fixa as transitivas e suas integridades; o package/lockfile da raiz continuam byte a byte iguais à base oficial.

| Papel | Pacote | Versão |
| --- | --- | --- |
| Servidor MCP runtime | `@modelcontextprotocol/server` | `2.3.1` |
| Schemas | `zod` | `4.6.7` |
| JWT sintético/verificador | `jose` | `6.2.13` |
| Cliente independente, somente desenvolvimento | `@modelcontextprotocol/client` | `2.3.1` |
| Runtime de teste, somente desenvolvimento | `miniflare` | `5.20261019.1-beta` |
| Tipos Workers, somente desenvolvimento | `@cloudflare/workers-types` | `5.20261019.1` |
| Bundler, somente desenvolvimento | `esbuild` | `0.28.2` |
| Compilador, somente desenvolvimento | `typescript` | `5.9.3` |

`@modelcontextprotocol/core` resolve para `2.3.1`. Miniflare usa workerd `1.20261019.1`, já presente no ambiente herdado. O harness foi validado com Node `24.19.0` e npm `11.9.0`. O relatório legível por máquina separa dependências diretas, transitivas e opcionais de outras plataformas. Miniflare é beta nesta base: sua aprovação aqui é exclusivamente para testes locais, não produção.

## Ferramentas, limites e autenticação

| Tool | Entrada | Resultado sintético |
| --- | --- | --- |
| `account` | `account_ref` | referência, nickname e site |
| `listings` | `account_ref`, limit inteiro 1–20, offset inteiro 0–1 | IDs, total e next_offset |
| `listing` | `account_ref`, item_id no formato sintético fechado | ID, título, status e preço decimal/BRL |

Offset 0–1 é uma limitação intencional das fixtures de dois itens, não um contrato comercial para a Fase 2B.2. As entradas e saídas usam strictObject; não aceitam propriedades extras, tokens, URLs, endpoint, seller_id ou métodos arbitrários. Dados de outra conta ou item de outro proprietário geram erro seguro. A propriedade readOnlyHint é metadado; a ausência de implementações de escrita e a allowlist fazem a restrição efetiva.

Reutilizados sem alteração `AccountAccess` e `AccessIdentityVerifier` da base B4. Os dois operadores têm papel viewer e somente read na conta respectiva. A permissão read não implica connect. Header de email e Bearer compartilhado não substituem assinatura/claims. O harness gera uma chave RS256 efêmera; somente o JWKS público é fornecido ao Worker. A simulação usa `Cf-Access-Jwt-Assertion` fornecido pelo cliente local, mas verificado criptograficamente. Não há serviço Access, OAuth real, IdP ou MFA conectado.

Existe uma chave de modo sintético e o entrypoint recusa host não loopback, HTTPS, origem externa, rota diferente de `/mcp` e query string. Não foi criado arquivo Wrangler para este protótipo. O launcher vincula listener e inspector a `127.0.0.1`, desativa telemetria e bloqueia egress do Worker. Teste/demo encerram o listener em finally.

Corpos HTTP têm limite de 16 KiB e prazo de leitura de 2 s. Corpos excessivos geram 413; upload incompleto gerou 408 em aproximadamente 2.007 ms na validação. Resultado de ferramenta tem limite de 4 KiB UTF-8 antes de sua representação duplicada; o limite HTTP também é aplicado à resposta total. GET de sessão não é implementado: o perfil é stateless e responde 405, conforme o handler do SDK. Não há SSE legado separado em `/sse`; o SDK gerencia os frames de Streamable HTTP, inclusive as respostas SSE do perfil 2025.

O título adversarial de fixture é serializado e retornado intacto com `untrusted_data: true`. O teste confirma que ele não modifica autorização nem provoca outra chamada/egress. Não há modelo de linguagem neste experimento; isto não certifica resistência de um cliente LLM a prompt injection.

## Composição e evidência dos testes

| Suite | Testes |
| --- | ---: |
| MCP 2026-07-28 | 9 |
| Compatibilidade MCP 2025 | 9 |
| HTTP, autenticação e limites | 15 |
| Política em memória e segurança do resultado | 3 |
| Total | 36 |

Cada perfil valida descoberta de exatamente três tools e schemas fechados; leituras, paginação e detalhe para ambos operadores; negação nos dois sentidos e item cruzado; texto adversarial; chamadas concorrentes; tools desconhecidos/escrita; parâmetros ausentes, extras, tipos/tamanhos/limites inválidos. Há múltiplas verificações dentro de alguns casos; os números acima contam casos do runner, sem inflar assertions.

HTTP cobre ausência de JWT, cabeçalhos forjados, emissor/audiência/tempo/tipo/sujeito inválidos, adulteração RS256, Origin/Host, rotas e query proibidas, métodos/media type, JSON inválido, método RPC desconhecido, corpo grande, upload parado e modo sintético obrigatório. Unidades adicionais verificam separação read/connect, revogação em memória mantendo JWT válido, política indisponível fechando acesso e limite UTF-8 do resultado.

O cliente `@modelcontextprotocol/client` roda em Node; o servidor roda em outro processo workerd. A conexão efetivamente atravessa TCP/HTTP. Não se usou InMemoryTransport, stub do protocolo ou chamada direta de handlers para a demonstração. No perfil moderno houve `server/discover`, tools/list e tools/call; no perfil 2025 houve initialize e chamadas compatíveis. Os traces registram apenas metadados, sem JWT, chave privada, headers ou argumentos.

Artefatos locais em `prototype/mcp-local/work/`: `interoperability.json`, `test-wire.json`, `tests-final.log`, `typecheck-final.log`, `demo.log`, `check-results.json`, `bundle-report.json`, `npm-audit.json`. Não são candidatos a publicação.

## Inventário e preservação

Todos os arquivos novos candidatos estão sob `prototype/mcp-local/`: `.gitignore`, `package.json`, `package-lock.json`, `tsconfig.json`, `README.md`, `src/synthetic.ts`, `src/server.ts`, `src/worker.ts`, `scripts/build.mjs`, `scripts/local-harness.mjs`, `scripts/demo.mjs`, `tests/interoperability.test.mjs` e `docs/phase-2b1-report.md`.

A base oficial tem 100 arquivos versionados (97 B3.1 + três B4). A comparação final compara todos com os blobs do commit oficial; nenhum arquivo herdado é candidato a mudança. A proposta de incorporação é adicionar o subprojeto somente após revisão da Direção, sem conectar seu entrypoint ao Worker atual. ZIPs, logs, inventários de preservação, caches, bundles e node_modules ficam fora de eventual commit.

## Limites e proposta para a Fase 2B.2

O protótipo não contém persistência operacional. Na superfície HTTP, grants sintéticos são reconstruídos por requisição; a revogação foi demonstrada na unidade AccountAccess com política em memória. Não há administração remota, banco, KV, Durable Object, provisionamento de usuários ou revogação distribuída implementados. Não há cofre Mercado Livre nem simulação de que dados reais foram consultados.

Interoperabilidade está comprovada para os dois perfis com o cliente oficial v2 independente. Isso não comprova compatibilidade com todos os clientes ou com ChatGPT; a elegibilidade do plano e OAuth continuam pendentes. Refresh, MFA, descoberta OAuth, limites Cloudflare hospedados, falhas reais do provedor e proteção operacional de segredos não foram homologados. Nenhuma dependência foi declarada livre de risco apenas por npm audit retornar zero.

Proposta de próxima etapa, sujeita a aprovação: revisar este subprojeto e a adoção do SDK; definir armazenamento autoritativo de operadores/concessões, isolamento de cofres e garantias de revogação; implementar primeiro com dados sintéticos e testes de restart/concorrência; projetar descoberta OAuth em separado; só depois solicitar autorização específica para homologação externa. Qualquer ajuste do package/lockfile oficial, CI, entrypoint ou configuração de Cloudflare precisará constar do escopo aprovado. Não comprar plano ou serviço para superar elegibilidade não confirmada.

## Encerramento

Nenhum commit, push, merge, PR ou deploy; nenhuma consulta Mercado Livre, configuração OAuth real, mudança Zero Trust ou conexão ChatGPT; nenhum arquivo do Worker existente modificado. Fase 2B.2 não iniciada. Aguardar revisão e autorização expressa da Direção.
