# B3.1 — correções locais após auditoria independente

Data: 21/10/2026 (São Paulo). Base B3: `a53f7f3af8c0edb0da856916b60706b342d0118a`, branch `b3/prepare-secure-integration`. Somente ajustes locais autorizados; nenhum commit, push, merge, release, deploy ou conexão real nesta etapa. Nenhuma credencial real solicitada ou usada.

## Correções

- `src/b3/adapter.ts`: exige string cujo lowercase seja exatamente `bearer`, sem trim nem aceitação de tipos alternativos. Aceita `bearer`, `Bearer`, `BEARER`, caixa mista; rejeita ausência, null, tipos não string, Basic/MAC/DPoP, espaços, sufixos e quebras de linha. As validações de tokens, user_id, expires_in, destino e métodos permanecem.
- O mesmo adaptador aplica um único prazo de até dez segundos para cabeçalhos **e corpo completo**, além de 128 KiB de bytes descomprimidos. Progresso/chunks não reiniciam o prazo. Promise.race impõe o limite mesmo quando uma porta ignora AbortSignal; a requisição é abortada e o body cancelado. Cancelamento que trava/falha não é aguardado e não substitui o erro seguro. Resposta que chega depois do prazo é descartada. O parâmetro de teste permite somente reduzir o prazo, nunca ampliá-lo acima de dez segundos.
- `src/b3/token-service.ts`: aquisição/decifragem/refresh permanecem fechados em falha; execução de GET é tratada separadamente. Timeout/rede/429/5xx de consulta devolvem erro temporário sanitizado e deixam o registro ready intacto. Contrato inválido, permissão 403 e autenticação 401 são distinguidos. Não há repetição automática nem refresh provocado por falha de GET.
- Refresh continua serializado e escreve `refreshing` antes do provedor. Falha ambígua, timeout, divergência ou erro de armazenamento não reutiliza o refresh consumido e exige revisão. Resposta que devolve o mesmo refresh token de uso único também é recusada em quarentena. O consumo único é requisito informado pela auditoria independente; não foi inferido do simulador.
- `src/b3/router.ts`: expõe somente códigos/status/flag retryable aprovados e mensagem fixa, sem corpo upstream, tokens ou exceções.
- `.github/workflows/b3-sqlite.yml`: novo workflow independente em push/pull_request, Node24, checkout sem credenciais persistidas, Actions oficiais fixadas nos mesmos SHA da CI B1, `contents: read`, instalação sem scripts, typecheck, cinco testes SQLite/workerd e verificação de preservação. Sem secrets reais, deploy ou publicação. A CI original B0/B1 permanece idêntica.

## Erros de consulta e estado do cofre

| Situação no GET | Resposta B3 | Retryable | Efeito no cofre |
| --- | --- | --- | --- |
| Prazo total excedido | QUERY_TIMEOUT, 504 | true | Nenhum; sem refresh automático |
| Rede, 429, 5xx, erro desconhecido sanitizado | QUERY_UNAVAILABLE, 503 | true | Nenhum; pode consultar novamente |
| Corpo/contrato candidato inválido | QUERY_CONTRACT, 502 | false | Nenhum; revisar contrato |
| Permissão negada, HTTP 403 | QUERY_DENIED, 403 | false | Nenhum; revisar autorização/permissões sem ampliá-las |
| Autenticação rejeitada, HTTP 401 | REAUTH_REQUIRED, 401 | false | Não repete GET nem refresh; exige revisão da autorização |
| Produto/vendedor divergente | SELLER_MISMATCH, 403 | false | Dado recusado; sem trocar de conta |
| Falha em aquisição/refresh/cofre, fora do GET | REAUTH_REQUIRED, 503 | false | Mantém bloqueio/quarentena conforme a etapa |

HTTP 401 de consulta é evidência de autorização inválida e pede revisão; esta implementação não tenta adivinhar se renovar resolveria. Um erro temporário de consulta não pede reconexão. Quarentena persistente após refresh ambíguo continua obrigatória mesmo que o erro de origem fosse temporário: o provedor pode já ter consumido o token. A recuperação/reautorização administrativa continua pendente de futura revisão e autorização.

## Contratos e evidência documental

Em nova tentativa pelo proxy herdado, as três páginas retornaram `Tunnel connection failed: 403 Forbidden`:

- https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao
- https://developers.mercadolivre.com.br/pt_br/itens-e-buscas
- https://developers.mercadolivre.com.br/pt_br/usuarios-e-aplicacoes

A Direção trouxe da auditoria independente a referência oficial para `token_type: "bearer"` e refresh token de uso único. Esses dois pontos orientam as correções, mas **o conteúdo completo das páginas não pôde ser inspecionado neste ambiente**. Não se declara validação integral de nenhum contrato. `officialMercadoLivreContractsValidated` permanece false. Nenhum scope ou permissão foi acrescentado; Usuários com escrita obrigatória não implica token exclusivamente de leitura.

| Endpoint candidato | Contrato implementado/documentado localmente | Ainda pendente de confirmação integral |
| --- | --- | --- |
| GET `/users/me` | Bearer em header; id numérico coincide com vendedor configurado, nickname string limitada, site_id MLB; remove demais campos | Campos/regras oficiais vigentes, autorização e identidade comercial real |
| GET `/users/{USER_ID}/items/search` | USER_ID fixado pelo servidor, status active, limit 1–20, offset 0–99999; results com IDs MLB e paging total/limit/offset coerentes | Paginação, limites, filtros, shape e permissões oficiais |
| GET `/items/{ITEM_ID}` | ID MLB, seller_id esperado, title/status, price numérico BRL, quantidade opcional; somente campos permitidos retornam | Campos opcionais/nulos, status, moeda/preço/quantidade e regras de autorização oficiais |
| POST `/oauth/token`, Authorization Code | Form grant_type authorization_code, client_id/client_secret, code, code_verifier e redirect_uri exato; retorno candidato access_token, refresh_token, expires_in inteiro e user_id esperado; token_type Bearer sem distinção de caixa | Exigências/formatos completos, duração e erros oficiais; lowercase informado pela auditoria independente |
| POST `/oauth/token`, Refresh Token | Form grant_type refresh_token, client_id/client_secret e refresh_token; mesmo contrato candidato de retorno, identidade conferida, rotação e não reutilização | Duração, invalidação/revogação e erros oficiais completos; uso único informado pela auditoria independente |

Todos os fluxos continuam simulados. Não foram feitos POST/GET na API Mercado Livre nem usados client ID, segredo, seller ID ou tokens reais. Fixtures não se tornam contratos oficiais por passarem nos testes.

## Validação local

- `npm run typecheck`: aprovado.
- `npm test`: 253 testes aprovados (12 arquivos).
- `npm run test:registry`: nove testes Node aprovados.
- `node scripts/tooling.mjs test --config vitest.b3.config.ts`: cinco testes aprovados.
- **Total: 267 testes; 224 anteriores reexecutados e 43 novos casos B3.1.**
- `npm run build`, `npm run build:production`: aprovados em **dry-run**, sem upload/deploy; wrapper B1 retira a identidade Cloudflare e desabilita métricas.
- Bundle B3 em esbuild: aprovado localmente.
- npm audit: zero vulnerabilidades reportadas; assinaturas registry de 86 pacotes instalados verificadas; 73 opcionais de outras plataformas não instalados. Proveniência Sigstore não verificada pelo script existente.
- Inventário de workspace: sem findings. Gitleaks 8.24.3: nenhum vazamento encontrado no snapshot dos 97 arquivos candidatos/versionados nem nos quatro commits do histórico/reflog. Revisão manual sem identificação de dados privados reais. Comparação dos 76 arquivos originais: todos byte a byte idênticos. Sem publicação de logs ou arquivos de ambiente.

A revisão dos dois workflows atuais e seus comandos transitivos confirmou ausência de deploy efetivo: o workflow novo só executa testes/checagem; o herdado só valida, audita e compila em --dry-run. Ambos usam Actions oficiais fixadas, permissões somente de leitura e nenhum Secrets real. Nenhum workflow reutilizável, ação Cloudflare ou credencial de implantação foi adicionado. O novo workflow não foi executado remotamente nesta etapa, pois não há push; seu comando de testes foi exercitado localmente.

## Preservação e limites

Os 76 arquivos B0/B1, incluindo a CI herdada, `wrangler.production.jsonc`, entrypoint de produção e bloqueios de transporte/OAuth, permanecem byte a byte idênticos. A entrada B3 continua 503 incondicional `PRODUCTION_DISABLED`; DO B3 ainda usa provider OAuth e JWKS bloqueados. As flags de prontidão não são ativadas. Não existe rota de proxy ou escrita comercial. O registro B2 segue explicitamente reconstruído, sem alegação de original recuperado.

O HEAD local/remoto de referência é B3 `a53f7f3...`; B1/main e Worker B2 não recebem mudanças nesta etapa. Não foi inspecionado remotamente o Worker nem comprovada a disponibilidade de sua versão para rollback.

Riscos remanescentes: contratos oficiais completos inacessíveis; operação real de transporte/timeout/IdP não testada; cancelamento de uma porta arbitrária que ignora abort é melhor esforço (o chamador é liberado no prazo, mas a porta pode continuar pendente); MFA/Access efetivos, identidade real, secrets, quotas Free, revogação remota e recuperação administrativa ainda não preparados/validados para ativação. Esta revisão não habilita produção. Aguardar revisão da Direção antes de qualquer commit ou push.

## Arquivos B3.1

Modificados: `src/b3/adapter.ts`, `src/b3/token-service.ts`, `src/b3/router.ts`, `tests/b3/adapter.test.ts`, `tests/b3/tokens.test.ts`, `tests/b3/router.test.ts`, `docs/b3/architecture.md` e `docs/b3/evidence-and-limitations.md`.

Novos: `.github/workflows/b3-sqlite.yml` e este relatório `docs/b31/review.md`.
