# B4 — fase 1 local sintética

22/10/2026, São Paulo. Base exata: `6252e84f11891c40ff974e6eb1217836c4365902`.
Checkout independente: `/workspace/work/b4`, HEAD destacado, obtido por fetch do commit em repositório novo. Nenhum arquivo foi copiado do checkout original, de node_modules anterior ou do backup H1/H1.1. Os 32 arquivos H1/H1.1 não foram incorporados. O backup externo não foi acessado nem revalidado nesta fase.

## Implementação

`src/b4/local.ts`: composição local sobre B3.1, reutilizando `AccessIdentityVerifier` (jose RS256, assinatura, issuer, audience, exp/iat, type app, identidade por sub e role explícita). O resolvedor padrão continua sem rede; testes usam JWKS efêmero local. Cabeçalhos de email e Bearer compartilhado não autenticam.

`AccountAccess` exige concessão explícita por conta e subject derivado do emissor/sub, consultada a cada operação, sem cache de autorização. Falha na consulta, conta desconhecida, revogação ou ausência de concessão negam. Permissões `read` e `connect` são independentes; a checagem de administrador B3.1 continua obrigatória para iniciar OAuth. Conta é fixada na composição do router, nunca selecionada por JWT/query/header. Cofres, chave/contexto de cifragem, vendedor e portas devem continuar distintos por conta; o adapter B3.1 confere seller_id.

Callback permanece fora do Access: cookie Secure/HttpOnly/SameSite=Lax, state cifrado de consumo atômico único, expiração, vínculo com conta e operador e PKCE B3.1 são preservados. B4 reconsulta `connect` após consumir o state e antes da troca. Revogação local interrompe inclusive um fluxo pendente; state não é recolocado. Seller e PKCE continuam validados pelo coordenador/adapter reaproveitado. Não há troca real nesta fase.

`syntheticReadMcp` é fronteira preparatória de aplicação, com ferramentas `account`, `listings`, `listing`, allowlist e seleção explícita de conta. Entrega à porta somente o nome da ferramenta, sem propagar JWT/cookie/request. Não é servidor MCP interoperável nem implementação de Managed OAuth: transporte, discovery, parâmetros/paginação dos tools e autorização delegada ChatGPT precisam de projeto e homologação posteriores. Nenhuma rota `/mcp` é publicada ou aceita pelo router atual. Não há tool de escrita, proxy, conexão ou refresh.

Nenhum entrypoint, config Cloudflare, workflow, dependência, lockfile ou arquivo versionado B3.1 foi alterado. Nenhum deploy, commit, push ou merge. A factory local só é exercitada com portas sintéticas; não está ligada ao entrypoint Worker. Nenhuma credencial real ou conta ML/ChatGPT foi usada.

## Rotas exatas e publicação

Origem preparatória presente na base: `https://conduz-cobre-ml-api.conduz-cobre.workers.dev`. É referência de configuração, não evidência de estado remoto. Não houve consulta à Cloudflare. A informação de que nenhuma aplicação Access foi salva vem da Direção.

| Método e caminho | Tratamento planejado B4 | Estado verificável no código |
| --- | --- | --- |
| POST `/oauth/start` | Access individual + connect da conta + administrator + Origin/CSRF B3.1 | Apenas router local |
| GET `/oauth/result` | Access + read da conta | Apenas router local |
| GET `/internal/health` | Access + read da conta | Apenas router local |
| GET `/internal/account` | Access + read da conta | Apenas router local |
| GET `/internal/listings` | Access + read; limit 1–20, offset 0–99999 | Apenas router local |
| GET `/internal/listings/MLB{4–20 dígitos}` | Access + read + seller_id esperado | Apenas router local |
| GET `/oauth/mercadolivre/callback` | Público, sem desafio Access; state/cookie/PKCE/anti-replay + connect atual | Apenas router local; entrypoint preparatório retorna 503 |
| `/mcp` e discovery/Managed OAuth | Nenhuma rota habilitada; definição pendente | Ausentes; tool boundary em memória |
| Outros caminhos/métodos | Negados; não há proxy/escrita comercial | Router B3.1 mantém allowlist |

Para futura política Access: cobrir `/oauth/start`, `/oauth/result`, `/internal/*`; não cobrir callback com desafio de login. Prefixo protegido não cria rota: a aplicação continua negando caminhos desconhecidos. Hostnames efetivos do conector e estratégia Managed OAuth/Access ainda precisam de homologação antes de qualquer política.

`wrangler.production.jsonc` aponta para `src/preparation/entrypoint.ts`, que devolve `503 PRODUCTION_DISABLED` incondicionalmente, inclusive no callback. `src/b3/entrypoint.ts` também é inerte. A base contém ainda o Worker B0 sintético (`src/index.ts`, workers_dev=false), com `/internal/oauth/start`, `/internal/oauth/callback`, `/internal/health`, `/internal/account`, `/internal/listings` e três itens `MLB_SYNTH_001..003`, autenticados pelo mecanismo B0. Essas rotas B0 não são o OAuth de navegador B4 e não recebem alteração. Publicação efetiva no provedor não foi auditada nesta fase: não se declara nenhuma rota B4 publicada.

## npm e ambiente

Node 24.19.0, npm 11.9.0. Sandbox inicial bloqueou conexão com o proxy: npm ping retornou EPERM; git fetch não conectou à porta 8080. Usando a permissão de rede suportada da ferramenta, mesmo proxy e verificação TLS, fetch e `npm ci --ignore-scripts` funcionaram: 86 pacotes instalados. Não houve bypass de proxy, alteração de registry, dependências ou lockfile, uso de root ou desativação TLS. A correção é a permissão de execução, não mudança no projeto. Cache do primeiro diagnóstico ficou isolado no novo diretório.

## Limites e próxima etapa

Revogação local significa atualizar a fonte de política e negar a próxima operação/callback; não significa revogação de sessão remota Access ou cancelamento de operação já em execução. Persistência/administração da política, sincronização com IdP/Access, rotação/revogação JWKS e operação com falhas reais precisam de validação futura. Sem acesso ao diagnóstico B4 anterior neste ambiente, este documento não presume detalhes adicionais daquele diagnóstico.

Permanecem pendentes: homologação Managed OAuth/ChatGPT, contratos oficiais ML completos, topologia de MCP, proteção Access real e MFA, configuração de concessões/cofres por conta e regressão em ambiente real autorizado. Nenhuma dessas pendências autoriza ativação nesta fase.

## Resultados desta execução

| Verificação | Resultado |
| --- | --- |
| `npm ci --ignore-scripts` | 86 pacotes instalados, com permissão de rede suportada |
| `npm run typecheck` | Passou, inclusive após o ajuste final |
| `npm test` | 273 testes, 13 arquivos; inclui os 253 B3.1 e 20 B4 |
| `node scripts/tooling.mjs test --config vitest.b3.config.ts` | 5 testes SQLite/workerd passaram |
| `npm run test:registry` | 2 arquivos Node passaram, conforme contagem do runner atual |
| `node scripts/tooling.mjs test tests/b4/local.test.ts` | 20 testes B4 passaram após ajuste final da fronteira MCP |
| `node scripts/verify-b3-preservation.mjs` | 76 arquivos B0/B1 idênticos; cinco bloqueios/preservações true |
| `git diff --exit-code 6252e84f11891c40ff974e6eb1217836c4365902 --` | Sem diferenças em todos os arquivos já versionados B3.1 |

As primeiras tentativas workerd falharam com EPERM no listen loopback; a permissão de rede suportada resolveu. Uma tentativa auxiliar de executar suites em Node puro passou 129 testes mas não importou `cloudflare:workers` no router B3; não substitui nem invalida a regressão workerd que depois passou integralmente. O config auxiliar foi removido. Não foram executados npm audit remoto, builds de publicação ou pipelines GitHub nesta fase.

Arquivos adicionados: `src/b4/local.ts`, `tests/b4/local.test.ts` e `docs/b4/phase1.md`. Zero arquivos herdados modificados. Logs selecionados acompanham a entrega; não incluem caches npm, node_modules, configurações de ambiente ou .git. O pacote de fontes inclui a base versionada e estes três arquivos, com manifesto SHA-256.

**Fase 1 encerrada. Solicita-se revisão e aprovação da Direção antes da próxima etapa. Esta entrega não autoriza políticas Cloudflare, conexão real, commit, push, merge ou deploy.**
