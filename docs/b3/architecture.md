# B3 — arquitetura e plano implementado localmente

Autorização inicial: Direção, desenvolvimento local; branch `b3/prepare-secure-integration`, base `f59081e223006f3eb0739d01073ed2eba824687e`. Na etapa inicial, nenhuma publicação, conexão real, credencial real, contratação ou escrita comercial foi autorizada. A autorização posterior permite exclusivamente auditoria, commit e push desta branch para revisão, mantendo todas as travas. Data: 21/10/2026 (São Paulo).

## Composição

`src/b3/router.ts` recebe o verificador Access B1 e o cofre de uma única conta. A composição é exercitada com JWKS efêmero e transporte sintético. Não há fallback para chave administrativa compartilhada. RS256, assinatura, issuer, audience, `sub`, tipo `app`, iat, exp e duração máxima de uma hora são verificados pelo componente B1 preservado. Funções vêm de mapa explícito por `sub`, nunca de email ou cabeçalho de função. Subject é pseudonimizado por SHA-256 com issuer. Viewer consulta; somente administrator inicia OAuth.

MFA é requisito da política Access/IdP, **não configuração aplicada nesta fase**, nem conclusão inferida da validade do JWT. O Worker valida a identidade emitida pelo Access; não afirma que os claims usuais provam MFA. Antes de ativação, a Direção deverá revisar política exigindo autenticação multifator no IdP e evidência de teste com e sem MFA, sessão de até uma hora e reautenticação. Service tokens e bypass das rotas internas não são permitidos.

`BrowserOAuthService` B1 é reutilizado sem alteração: POST `/oauth/start`, Origin exato e Sec-Fetch-Site same-origin quando presente; state, cookie e verifier de 32 bytes aleatórios, S256, prazo máximo de cinco minutos limitado pela sessão do operador. Cookie `__Host-conduz_oauth`, Secure, HttpOnly, SameSite=Lax, Path=/, sem Domain, permite retorno GET em navegação de topo. A URL de autorização só é devolvida ao administrador autenticado; não é seguida por código nesta fase.

Callback público **somente GET** no caminho exato `/oauth/mercadolivre/callback`; state e cookie obrigatórios. State cifrado inclui conta, operador iniciador, sessão, verifier, redirect e expiração. SQL `DELETE … RETURNING` em transação síncrona consome uma única vez antes da troca; não há restauração após erro. Sessão divergente invalida e consome o fluxo, escolhendo segurança sobre disponibilidade. Reutilização ou parâmetros duplicados falham. No retorno público, não se exige JWT Access de novo: a vinculação ao operador vem do fluxo iniciado autenticado. O fluxo dura até cinco minutos; uma revogação de operador durante esse intervalo não é consultada remotamente nesta fase. Ativação futura deve avaliar cancelamento de states pendentes ao revogar acesso.

Callback devolve 303 para `/oauth/result` sem código/state; erro genérico sem refletir dados do provedor. Limpa cookie, no-store, no-referrer, CSP restritiva e nosniff. Health, result e consultas exigem JWT. CORS não é habilitado. Rate limit por operador e callback e teto de 20 states usam SQLite B1. Ainda depende do Access e de controles de borda para resistência a ataques volumétricos.

## Cofre

`B3AccountVault` é classe nova com binding `B3_VAULT` e namespace SQLite próprio, separado de `AccountVault` B0 e `BrowserOAuthVault` B1. Reutiliza a implementação SQL preservada, sem migrar namespaces antigos. Uma instância/serviço por conta; todas as operações de tokens passam por fila exclusiva, incluindo consultas, conexão, rotação e revogação local. O nome futuro do DO deverá ser derivado exclusivamente de tenant/conta configurados no servidor, nunca de input do usuário.

`TokenKeyring` aplica envelope com keyId e AES-256-GCM via CryptoBox B1, IV aleatório de 96 bits e AAD vinculando tenant/ambiente/conta/versão/propósito. A chave de state é separada das chaves de tokens. Há até três chaves para transição. Dados só ficam em claro na memória de processamento; não há logging de request, body, headers ou exceções upstream.

`TokenCoordinator` valida vendedor no retorno candidato e em `/users/me` antes de gravar. Token válido é reutilizado; margem de renovação de 30 segundos. Antes do refresh grava status `refreshing` síncrono, depois aguarda provedor. Chamadas concorrentes na mesma conta compartilham a fila e usam uma única renovação. Falha de refresh, identidade ou gravação após refresh mantém marcador e exige revisão/reautorização; após eviction o marcador impede reutilizar o refresh antigo. Não há retry automático de troca/refresh. Falha ao gravar marcador impede chamar o provedor. A validade é política local candidata (60–86400 segundos), não afirmação sobre o Mercado Livre.

`revokeLocally()` persiste bloqueio e `rotate()` recifra com a chave ativa; não são rotas HTTP nem efetuam revogação remota. O status SQL `refreshing` também representa quarentena/revogação local, por compatibilidade com o store reutilizado; não há recuperação automática. Uma falha ao persistir revogação exige manter a aplicação inerte e intervenção, pois um bloqueio só em memória não prova revogação durável.

## API candidata fechada

`CandidateAdapter` só recebe transporte explicitamente injetado. Não tem fetch padrão. O DO B3 usa provedor que sempre bloqueia e cliente B1 com transporte real desativado. Somente GET `/users/me`, `/users/{vendedor-configurado}/items/search` (active, limit 1–20, offset limitado) e `/items/MLB…`; propriedade do produto é validada antes de retornar dados. Nenhum sellerId vem do solicitante. Parsers B1 candidatos removem email e campos não previstos.

Atualização local B3.1: ver `docs/b31/review.md` para correção de token_type, prazo total de resposta, classificação de erros de GET e workflow SQLite adicional. A autorização desta revisão não permite commit ou push.

POST é construído apenas por métodos de Authorization Code/refresh no endpoint `/oauth/token`, com formulário e parâmetros fixados; não existe rota de proxy nem API pública para enviar Request arbitrário. PUT/PATCH/DELETE e POST comerciais são negados. Redirect é manual; há um único prazo máximo de 10 segundos para cabeçalhos e corpo inteiro, imposto também contra portas que ignoram abort, com descarte de respostas tardias e cancelamento sem espera ilimitada. Corpo é limitado a 128 KiB mesmo sem Content-Length e não há repetição automática. O comportamento de transporte real ainda precisa de validação; nesta fase o transporte injetado só simula respostas locais.

## Travas

Nenhum arquivo B0/B1 é alterado. `src/b3/entrypoint.ts` responde incondicionalmente 503 `PRODUCTION_DISABLED`, sem instanciar cofre ou router. `wrangler.b3.local.jsonc` não usa o nome do Worker B2, não tem routes, workers_dev ou preview habilitados e não contém credenciais. A configuração serve apenas ao runtime local e aos testes. Mesmo chamada direta ao DO usa resolvedor JWKS bloqueado e provedor OAuth bloqueado.

Não existe variável que habilite integração nesta revisão. Os contratos oficiais não foram validados; portanto esta B3 é preparação funcional com simulação, **não integração pronta para produção**. `config/b3-readiness.json` registra todos os bloqueios e a confirmação DevCenter atual, sem editar o registro histórico B1.
