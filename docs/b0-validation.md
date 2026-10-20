# Entrega B0 — evidências de validação

Data: 20/10/2026. Implementação exclusivamente local e sintética.

Registro da entrega B0 anterior ao primeiro push. Posteriormente, a Direção autorizou a publicação
desta versão no repositório público, substituindo o requisito de visibilidade privada. Os resultados
abaixo descrevem a validação B0; a situação atual de publicação e CI deve ser consultada no GitHub.

## Resultado funcional

| Verificação | Resultado |
| --- | --- |
| Testes no runtime Workers/workerd | 82 executados, 82 passaram, 0 falhas, 0 pendentes |
| Criptografia e PKCE | 8 testes passaram |
| OAuth, vendedor e renovação | 17 testes passaram |
| Adaptador HTTP e limites | 18 testes passaram |
| Worker, SQLite e segurança das rotas | 31 testes passaram |
| Contratos JSON Schema/OpenAPI | 8 testes passaram |
| TypeScript strict (`npm run typecheck`) | Passou, exit 0 |
| Bundle Wrangler (`npm run build`) | Passou, exit 0; somente --dry-run |
| Tamanho do bundle | 30,19 KiB; gzip 8,34 KiB |
| Smoke HTTP em Wrangler local | 9 requisições verificadas, passou |
| Instalação congelada `npm ci --ignore-scripts` | Passou com cache explícito e com o cache gravável configurado em .npmrc |

O smoke HTTP verificou autenticação, health, início OAuth, callback, rejeição de replay, identidade,
primeira página, detalhe e próxima página. O servidor foi encerrado após a prova. As chaves e o estado
sintéticos criados para essa prova foram removidos; executar setup:local antes de iniciar uma nova sessão.

Os testes incluem PKCE pelo vetor RFC 7636, expiração/uso único de state, troca de operador, vendedor
incorreto, alteração/contexto de ciphertext, paginação, limites, ausência de fetch externo, remoção de
segredos dos logs, recusa de escrita, refresh concorrente e recuperação após eviction real do objeto.
Uma prova adicional por HTTP identificou e corrigiu a aceitação de POST vazio com stream; há regressão
cobrindo POST vazio e recusa de conteúdo. A execução final contém essa correção.

## Auditoria

- npm audit, incluindo desenvolvimento: 0 vulnerabilidades reportadas.
- npm audit signatures: não concluído. Download de metadados TUF da verificação de proveniência respondeu
  HTTP 403 pela rede do ambiente. Nenhuma assinatura, checksum ou verificação TLS foi desabilitada.
- Gitleaks 8.30.1 obtido do release oficial com SHA256 verificado:
  551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb.
- Primeira varredura do histórico: 0 achados. Primeira varredura da árvore completa: 2 achados, ambos as
  chaves locais geradas em .dev.vars. Busca exata dessas chaves nos arquivos próprios encontrou apenas
  .dev.vars. Essas chaves foram removidas após encerrar o servidor; não foi criada allowlist de scanner.
- Uma varredura após encerrar o servidor identificou duas ocorrências do segredo efêmero de protocolo
  MF-Proxy-Shared-Secret nos logs internos de depuração do Wrangler. Não eram tokens OAuth nem chaves
  da aplicação. Esses logs foram removidos e o wrapper passou a usar diretórios temporários de logs,
  removidos ao encerrar a ferramenta. Nenhum marcador de token OAuth sintético foi encontrado nos logs.
- Varredura final Gitleaks: 0 achados no histórico e 0 achados na árvore, incluindo arquivos ignorados.
- Inventário final: README modificado e 48 arquivos novos; 3.999 arquivos ignorados inventariados
  (.wrangler: 185, dist: 3, node_modules: 3.811), sem arquivos sensíveis versionados.
- Histórico/reflogs: um commit alcançável e um commit nos reflogs. git fsck --full e git diff --check passaram.
- Diretórios temporários de logs: zero restantes. .dev.vars removida. Servidor HTTP local encerrado.
- Inspeção manual: sem transporte externo no Worker, tokens/codes/state ausentes nos logs da API,
  parâmetros e métodos fechados, vendedor fixo, sem implantação na CI e sem alteração de aplicação real.

Os relatórios técnicos redigidos ficam em /tmp/conduz-b0-*.json e /tmp/conduz-b0-*.log. Não integram Git.
A CI foi configurada; não foi executada no GitHub, pois não houve publicação.

## Pendências antes de implantação

1. Publicação B0 em repositório público autorizada posteriormente pela Direção; reauditar antes do push.
2. Aprovação específica da Direção para criar recursos, implantar ou usar contas reais; nenhuma é presumida.
3. Confirmar documentação vigente de cadastro in-house, permissões, PKCE, callback, tokens, anúncios e limites.
4. Implementar e revisar em fase própria transporte real, identidade de produção/sessão web, callback HTTPS,
   configuração de ambiente, secrets e rotação de chaves. B0 recusa modo live e configuração de produção.
5. Medir CPU, volume SQL e duração, aprovar plano/custo, retenção e logs de borda; revisar preços oficiais.
6. Concluir verificação adicional de assinaturas/proveniência npm quando a rede permitir e reauditar antes de push.
7. Homologação autenticada real somente após autorização, com aplicação GPT independente da aplicação Claude.

Nenhum push, deploy Cloudflare, recurso pago, chamada autenticada ao Mercado Livre, operação comercial
ou integração de IA ocorreu. A aplicação Conduz Claude Agentes permanece independente e inalterada.

## Arquivos implementados

49 arquivos de projeto: 48 novos e README existente atualizado preservando seu conteúdo original.

- `.dev.vars.example`
- `.github/workflows/ci.yml`
- `.gitignore`
- `.npmrc`
- `README.md`
- `contracts/v1/account.schema.json`
- `contracts/v1/common.schema.json`
- `contracts/v1/error.schema.json`
- `contracts/v1/health.schema.json`
- `contracts/v1/listing.schema.json`
- `contracts/v1/listings.schema.json`
- `contracts/v1/oauth-callback.schema.json`
- `contracts/v1/oauth-start.schema.json`
- `contracts/v1/openapi.json`
- `docs/b0-runbook.md`
- `docs/b0-validation.md`
- `docs/official-evidence.md`
- `docs/security.md`
- `package-lock.json`
- `package.json`
- `scripts/audit-workspace.mjs`
- `scripts/compile-contracts.mjs`
- `scripts/generate-contracts.mjs`
- `scripts/setup-local.mjs`
- `scripts/smoke-local.mjs`
- `scripts/tooling.mjs`
- `src/auth.ts`
- `src/config.ts`
- `src/crypto.ts`
- `src/errors.ts`
- `src/index.ts`
- `src/mercado-livre/client.ts`
- `src/mercado-livre/fixtures.ts`
- `src/mercado-livre/synthetic-transport.ts`
- `src/oauth/service.ts`
- `src/types.ts`
- `src/vault/account-vault.ts`
- `src/vault/sqlite-store.ts`
- `tests/adapter.test.ts`
- `tests/contracts.test.ts`
- `tests/crypto.test.ts`
- `tests/env.d.ts`
- `tests/helpers.ts`
- `tests/oauth.test.ts`
- `tests/setup.ts`
- `tests/worker.test.ts`
- `tsconfig.json`
- `vitest.config.ts`
- `wrangler.jsonc`
