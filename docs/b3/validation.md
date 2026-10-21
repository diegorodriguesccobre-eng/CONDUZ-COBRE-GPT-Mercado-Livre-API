# B3 — entrega e auditoria local

Desenvolvimento local concluído em 21/10/2026, branch `b3/prepare-secure-integration`, HEAD/base `f59081e223006f3eb0739d01073ed2eba824687e`. Registro inicial de mudanças aditivas locais. A auditoria de publicação descrita abaixo sucede a entrega local; somente commit e push da branch B3 estão autorizados após aprovação dos controles. Merge, deploy e conexão real continuam proibidos.

## Resultados

| Verificação | Resultado |
| --- | --- |
| `npm run typecheck` | Aprovado |
| `npm test` | 210 testes, 12 arquivos, aprovados |
| `npm run test:registry` | 9 testes Node originais aprovados |
| Runtime B3 separado | 5 testes SQLite/workerd aprovados |
| Total | **224 testes: 148 existentes + 76 novos** |
| Bundles locais esbuild | B0, preparação B1/B2 e B3 compilados sem deploy |
| Preservação B1 | 76 arquivos originais byte a byte idênticos |
| Entradas B2 e B3 | 503 `PRODUCTION_DISABLED` em testes locais |
| `npm audit --audit-level=low` | Zero vulnerabilidades reportadas |
| Auditoria de assinaturas npm | 86 pacotes instalados verificados; 73 opcionais de outras plataformas não instalados |
| Proveniência Sigstore | Não verificada pelo script existente; assinatura registry não é a mesma garantia |
| `npm run audit:workspace` | Sem findings na política/inventário |
| Gitleaks 8.24.3 | Sem vazamentos no snapshot de fontes/documentos e nos 3 commits alcançáveis |

Gitleaks foi obtido da release oficial e teve SHA-256 comparado ao arquivo de checksums dessa release. Não houve instalação como dependência do projeto. O snapshot incluiu arquivos novos e versionados, sem node_modules, .wrangler, outputs ou ambientes locais. Nenhuma dependência, lockfile, workflow ou arquivo B0/B1 foi alterado. Os scanners não garantem ausência de todas as classes de segredo/falha; foram complementados por revisão de fluxos, testes de isolamento e comparação integral da base.

Os testes novos cobrem: JWT ausente/adulterado/issuer/audience/exp/sub/tipo inválidos, administrador vs viewer, Origin/método, cookie e sessão divergentes, state expirado/adulterado/duplicado/reutilizado, callback concorrente, PKCE incorreto em provedor simulado, erros do provedor, vendedor divergente no token/identidade/produto/refresh, corpo limitado, redirects/HTTP upstream sem repetição, escrita comercial bloqueada, queries arbitrárias, cifra/AAD, chave ausente, rotação, revogação local, 20 consultas com refresh único, marcador antes do provedor, falha de persistência, recriação/eviction do DO e ausência de dados privados nas respostas. `tests/setup.ts` preservado bloqueia global fetch; a composição B3 nunca chamou rede real nos testes.

## Arquivos adicionados

- `src/b3/adapter.ts`: adaptação candidata com injeção explícita e limites.
- `src/b3/keyring.ts`: envelope versionado e chaves AES-GCM.
- `src/b3/token-service.ts`: validação comercial, fila por conta, refresh, quarentena, rotação e revogação local.
- `src/b3/router.ts`: composição Access/OAuth e consultas restritas.
- `src/b3/vault.ts`: classe Durable Object B3 SQLite independente e dependências reais bloqueadas.
- `src/b3/entrypoint.ts`: entrada incondicionalmente inerte.
- `config/b3-readiness.json`: estado de travas e DevCenter confirmado pela Direção.
- `wrangler.b3.local.jsonc`, `vitest.b3.config.ts`: runtime/testes locais independentes.
- `tests/b3/adapter.test.ts`, `tests/b3/router.test.ts`, `tests/b3/tokens.test.ts`, `tests/b3-runtime/vault.integration.ts`: 76 testes B3.
- `scripts/verify-b3-preservation.mjs`: comparação integral contra o commit B1 e checagem de travas.
- `docs/b3/b2-reconstructed-record.md`: registro B2 explicitamente reconstruído.
- `docs/b3/architecture.md`: arquitetura, limites e decisões.
- `docs/b3/evidence-and-limitations.md`: evidência oficial e limitações.
- `docs/b3/operations-and-rollback.md`: validação local, rotação/revogação e proposta de implantação/reversão.
- Este relatório.

## Auditoria de segurança

A revisão local não identificou rota que habilite rede, escrita comercial ou leitura de conta selecionada pelo solicitante. A entrada B3 independe de env e continua 503. O router local só recebe portas tipadas, utiliza identidade individual e não exporta proxy genérico. A identidade do vendedor é conferida antes da primeira persistência e após cada refresh. Tokens e verifiers não aparecem em logs; erros de callback e respostas HTTP são genéricos. O store guarda state/tokens cifrados e hashes de sessão/state. Chaves e credenciais determinísticas dos testes estão rotuladas como sintéticas; não servem a ambientes reais.

Limitações de segurança para produção: MFA e política Access real não configurados, JWKS real bloqueado, identidade comercial real não comprovada, observabilidade/borda não auditadas, contratos Mercado Livre não validados, revogação remota e administração/reautorização não implementadas, timeout com corpo lento real não exercitado e disponibilidade/custo Free não verificados. As falhas ambíguas bloqueiam o cofre e podem exigir intervenção; é uma decisão de segurança com custo de disponibilidade. Não foram efetuados pentest externo, verificação remota da B2 ou garantia de segurança em produção.

## Revisão da Direção

Entrega local completa dentro do escopo de preparação sem ativação. A documentação B2 anterior continua ausente; sua reconstrução vem da Direção e não comprova o bundle remoto. O portal Mercado Livre retornou 403 pelo proxy; parsers/requests permanecem candidatos. Implantação futura e rollback estão propostos no runbook, com gates explícitos e versão B2 `5429aed8-11a4-40da-97ad-b54086b6dbe9`, sem executar ações externas.

A publicação controlada autoriza exclusivamente commit e push desta branch para revisão independente após os controles abaixo. Não realizar merge, release, deploy, cadastrar credenciais reais, conectar conta ou retirar travas. A execução da CI deve ser verificada pelo SHA efetivamente publicado e informada à Direção; este arquivo não antecipa seu resultado.


## Auditoria final para publicação em repositório público

O GitHub confirmou `private=false` e `visibility=public`. Todos os 19 candidatos foram lidos e avaliados para publicação pública, incluindo documentação e fixtures; nenhum log, arquivo de ambiente, chave real, token real, seller ID real, ID de aplicação/client ID real, comprador ou dado comercial privado foi identificado. IDs `42`/`99`, emails `.invalid`, chaves determinísticas e tokens com rótulo SYNTHETIC são exclusivamente de teste. Os nomes públicos do projeto/Worker, callback público e UUID da versão B2 são referências de infraestrutura fornecidas pela Direção; não são credenciais ou identidade comercial privada.

A comparação contra a base confirmou novamente 76 arquivos originais idênticos. Reexecução local: 210 Vitest + nove Node + cinco testes runtime = 224 aprovados; TypeScript aprovado; build de produção via Wrangler **dry-run** aprovado. npm audit reportou zero vulnerabilidades; as 86 assinaturas dos pacotes instalados foram verificadas, sem afirmação de verificação Sigstore. Gitleaks é executado sobre snapshot integral dos candidatos e arquivos originais e sobre todo o histórico/reflog local, com redação integral de eventuais achados. Inventário e exclusões de artefatos são conferidos antes do staging/commit; nenhum arquivo fora do manifesto pode ser incluído.

A única CI versionada herdada, `.github/workflows/ci.yml`, continua byte a byte idêntica. Tem permissões `contents: read`, checkout sem credenciais persistidas, Actions oficiais fixadas em SHA e executa apenas validação, testes, auditorias e builds com `--dry-run`. Não contém deploy efetivo, secrets Cloudflare, release, merge ou chamada de workflow externo. Nesta revisão, a CI executa 210 Vitest + nove Node (219 testes); os cinco testes runtime SQLite são executados localmente pelo comando adicional documentado e **não são cobertos pela CI herdada**. Não foi alterada a CI B0/B1 para manter os 76 arquivos preservados.

O registro B2 reconstruído declara explicitamente que o original não foi recuperado; não há comprovação nova do bundle remoto nem inspeção autenticada do Worker. A ausência de qualquer implantação nesta sessão e o workflow sem deploy preservam a B2. As referências remotas main/B1 devem ser comparadas antes e depois do único push autorizado. Aprovação desta auditoria é para revisão pública de código inerte, não para uso comercial ou produção.

## Manifesto público: 19 arquivos novos e riscos principais

| Arquivo | Função | Risco/limite principal |
| --- | --- | --- |
| `config/b3-readiness.json` | Travas e confirmação DevCenter | Não confundir escolhas no painel com contrato validado ou token só leitura; flags de ativação permanecem false. |
| `docs/b3/architecture.md` | Arquitetura e decisões | Descreve composição simulada; MFA e Access efetivo ainda não aplicados. |
| `docs/b3/b2-reconstructed-record.md` | Reconstrução declarada B2 | Não é original nem comprovação do artefato remoto. |
| `docs/b3/evidence-and-limitations.md` | Fontes e limites documentais | Portal Mercado Livre inacessível; contratos candidatos. |
| `docs/b3/operations-and-rollback.md` | Operação futura e reversão proposta | Rollback depende de versão/migrações/bindings e não revoga tokens automaticamente. |
| `docs/b3/validation.md` | Testes, auditoria e manifesto | Resultado local não garante produção; CI cobre 219 dos 224 testes. |
| `scripts/verify-b3-preservation.mjs` | Compara 76 arquivos e travas | Checagem local/estática, sem consultar configuração remota. |
| `src/b3/adapter.ts` | Adaptação candidata com limites | Transporte só injetado; contratos e comportamento de rede real pendentes. |
| `src/b3/entrypoint.ts` | Resposta 503 incondicional | Qualquer futura alteração da trava exige nova autorização e revisão. |
| `src/b3/keyring.ts` | Envelope AES-GCM versionado | Chaves reais exigem secrets aprovados e rotação operacional validada. |
| `src/b3/router.ts` | Access, callback e consultas | Sessão/state não substituem política MFA real e controles de borda. |
| `src/b3/token-service.ts` | Fila, identidade e refresh | Falhas ambíguas bloqueiam cofre; administração/reautorização futura pendente. |
| `src/b3/vault.ts` | DO SQLite B3 separado | Namespace/migração reais não implantados; provider e JWKS permanecem bloqueados. |
| `tests/b3-runtime/vault.integration.ts` | Persistência/eviction/atomicidade | Runtime local; não comprova ambiente remoto ou quotas reais. |
| `tests/b3/adapter.test.ts` | Restrições HTTP e vendedor | Fixtures sintéticas; não comprovam contrato oficial. |
| `tests/b3/router.test.ts` | JWT/OAuth/CSRF/replay/escrita | JWTs efêmeros; PKCE é validado por provedor simulado. |
| `tests/b3/tokens.test.ts` | Concorrência/cifra/falhas/rotação | Não exercita refresh nem revogação no Mercado Livre real. |
| `vitest.b3.config.ts` | Runtime B3 sintético | Chaves fixas de teste não podem ir para um ambiente real. |
| `wrangler.b3.local.jsonc` | Configuração local isolada | Não reutilizar como configuração de produção; workers_dev/preview desabilitados. |
