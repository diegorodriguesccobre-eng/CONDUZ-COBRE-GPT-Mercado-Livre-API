# B4 2B.3-C — composição local única

Protótipo exclusivamente sintético, baseado em `6e595e99f2bc0a84cc216b817cf7eab779502065`. Não configura rotas, Access, OAuth, infraestrutura, contas ou credenciais reais. O código funcional B3.1 e o Worker existente permanecem intactos. As correções aprovadas atualizaram os quatro manifests/locks da raiz e MCP; nesta consolidação eles estão congelados. A evolução de CI modifica os workflows MCP e SQLite sob autorização própria. Não homologado para produção.

## Fluxo e capacidades

`cliente MCP independente → fixture integrated-worker → AccessIdentityVerifier (JWKS efêmero local) → registro interno validado → autorização persistente G/A/P + W R2 → cofre da conta → TokenKeyring/TokenCoordinator/CandidateAdapter B3.1 → DTO sintético → SDK MCP → buffering integral → revalidação → resposta`.

As ferramentas continuam `account`, `listings` e `listing`, com schemas, descrições, anotações e perfis MCP `2026-07-28`/`2025-11-25` herdados. O teste compara a descoberta com a implementação anterior. Cada mensagem admite uma chamada; batches são recusados. HTTP limitado a 16 KiB, tool envelope a 4 KiB, entrada a 2 s e operação a 15 s. Nenhuma ferramenta comercial de escrita, conexão, renovação ou administração é exposta.

`vault/server.ts` extrai o registro comum das ferramentas; `vault/storage.ts` delega a leitura ao novo `vault/read-core.ts`. O caminho legado mantém seu contrato e não ativa os hooks novos. A composição integrada fornece hooks privados para verificação em cada novo GET, após provider, preparação e auditoria. O transporte retorna dados fictícios em memória, sem `fetch` externo. O facade de armazenamento de TokenCoordinator proíbe `putTokens`/state; a identidade do vendedor é conferida antes das leituras e cada item é validado. Read nunca renova nem conecta.

## Identidade e vinculação

O registro deriva uma cópia validada e congelada de `VAULTS`, com unicidade de conta, seller, cofre e keyId. A composição fixa ambiente `synthetic-r2`, perfil `synthetic`, revisão e digest; não aceita seller, chave, namespace, endpoint ou ambiente do cliente. JWT extra e headers não alteram resolução. O cliente pode solicitar uma account_ref, cuja autorização é verificada separadamente. O fixture aceita apenas HTTP em 127.0.0.1 e somente `/mcp`; não captura o callback público `/oauth/mercadolivre/callback` nem OAuth start/interfaces internas. As garantias state/PKCE/cookie/replay do callback permanecem na composição B3.1 desabilitada, coberta pela regressão da raiz.

A autoridade efêmera de identidade revalida o JWT assinado e emite handle privado vinculado ao digest da operação, subject pseudonimizado e expiração. O cofre consulta o emissor; UUID e subject fornecidos isoladamente não são prova. Reinício perde os handles e exige nova verificação. Nenhum JWT vai ao command, resposta ou auditoria. A frente sintética e os cofres compartilham um runtime de laboratório: não representam segregação IAM ou de chaves real. O mapa de material fictício é binding privilegiado do driver; produção exigirá serviços separados e custódia de chaves aprovada.

Cada command vincula operação, nonce, conta, identidade, prazos, query, registryDigest e bindingDigest, sob scope fixo. O cofre confere seu ID real. O nonce é persistido antes de I/O e não é reutilizável. Um ticket não aceita mudança de query/tool/conta. Handle de entrega é consumido uma vez; erros também o cancelam. Nenhum construtor cria grant ou token: apenas provision/seed explícitos do driver privilegiado, sem rota HTTP ou ferramenta MCP.

## Guardião e entrega

Em cada fase, o adaptador lê W, consulta G.permissions(read), relê W e compara seq/root/gateRevision, ACTIVE e ausência de pending; registro e validade também são conferidos. G preserva suas verificações de autoridade/projeção e latch. Ausência de read comprovada no estado atual produz erro constante de autorização. Falha não explicada por estado negativo produz erro de dependência ou bloqueio de recuperação, nunca autorização presumida. Não existe cache de allow. Mudar outra conta pode recusar conservadoramente a operação por conta do head global.

A operação guarda um pin e um stamp privado do token: conta, keyId, generation, digest da row e expiração. Status precisa ser ready e margem estritamente maior que 30 s. Mudança de row, binding, checkpoint ou identidade invalida o resultado. Não há atualização automática de revisão para aproveitar autorização posterior.

A barreira final fica fora do callback da ferramenta. O handler SDK conclui framing, a resposta HTTP inteira é lida sob limite e prazo, e o handler é fechado. São concluídos digest dos bytes, conferência do cofre, consumo da evidência e auditoria de entrega. A última operação assíncrona da aplicação é uma nova prova do guardião, que inclui registro e validade. Depois há apenas verificações síncronas de prazo/margem/abort e construção de Response com os bytes já bufferizados. Rejeição descarta todo o buffer e serializa uma resposta MCP constante independente, sem o payload comercial.

Isto garante ausência de bytes comerciais liberados antes da decisão final no modelo local. Não existe transação entre W/SQLite e a rede: revogação posterior ao ponto final não recolhe bytes já enfileirados. Sockets, proxy e runtime podem trabalhar depois desse ponto. O teste independente de buffering registra JSON/SSE, revogação/revisão após serialização, erro, stream infinito/quebrado e desconexão. O modelo não transforma atraso/cancelamento de transporte em decisão positiva de segurança.

## Erros, auditoria e limites

Asserções negativas exigem resposta MCP `isError:true`, ausência de structuredContent e código constante esperado. Erros JSON-RPC/schema usam os helpers estritos anteriores. Rejeições de Promise, ECONNRESET, timeout e indisponibilidade não satisfazem esses helpers. A integração distingue IDENTITY_DENIED, READ_DENIED, RECOVERY_REQUIRED, REVISION_CHANGED, BINDING_DENIED, TOKEN_UNAVAILABLE, REPLAY, BUSY e DEPENDENCY_UNAVAILABLE. As portas RPC de identidade usam envelope fechado para preservar a classificação sem confiar em protótipos remotos ou mensagens arbitrárias.

Eventos privados registram fases, operationId, conta e revisão, sem JWT, token, chave, ciphertext ou texto comercial. As respostas são DTOs e strings não confiáveis, nunca instruções executáveis. Canários conhecidos são verificados; isto não é DLP genérico, classificação semântica de segredos ou prova de redação no edge real. A retenção e cotas reais da auditoria exigem projeto operacional. Falha de armazenamento nunca autoriza e não permite afirmar durabilidade de latch se o disco falhou.

Fila admitida no cofre: no máximo nove operações em curso/espera; excesso retorna BUSY. Cada GET integrado tem limite de no máximo 10 s ou prazo restante. O driver libera pausas injetadas ou dispõe o runtime no encerramento. O transporte sintético em memória não prova cancelamento de HTTP externo. O harness herdado mantém timeouts, cancelamento, fechamento de cliente, disposal de Miniflare e bloqueio de egress. Testes verificam recursos registrados e liberação de porta; não equivalem a prova universal de ausência de qualquer timer interno do provedor.

## Correção controlada das classificações

O CandidateAdapter herdado continua intacto: seu catch sanitiza toda exceção do transporte. A integração preserva a primeira causa tipada em contexto privado da operação antes dessa sanitização. Hooks de autorização registram o código fechado e o relançam; rejeições do transporte e prazo vencido são capturados como ReadDependencyFailure com categoria transport/timeout. Um erro sanitizado posterior nunca sobrescreve essa primeira causa. AppError local é classificado somente por tipo/código aprovado, inclusive após a transformação do TokenCoordinator. `QUERY_UNAVAILABLE` e `QUERY_TIMEOUT` são dependência; a primeira causa local transport/timeout previamente capturada permanece prioritária. Não se usa texto de mensagem ou exceção arbitrária como prova. A resposta pública de dependência permanece constante; a trilha privada distingue failure-transport, failure-timeout e failure-upstream sem material sensível. Schema/protocolo continuam com as rejeições específicas do SDK, e falhas genéricas do cliente continuam a falhar os testes negativos.

L34/L35 exigem REVISION_CHANGED, revogação confirmada e estado autoritativo persistido; L34 exige zero GET. L46 injeta erro de transporte contendo canário e prazo de provider com pausa real, exige erro MCP de dependência e categorias privadas distintas, sem eco de causa. L40 separa projeção antiga de grant já revogado (negação comprovada por W, sem obrigação de HOLD) de projeção incompatível com grant atualmente ativo (HOLD/PROJECTION_DIVERGENCE). Como R2 torna revogação terminal, o controle ativo usa outra instância de laboratório, sem reativar o par revogado. L44 exige código exato conforme a falha: referência indisponível/guardião indisponível produz dependência; erro desconhecido no guardião pode fechar W e produzir RECOVERY_REQUIRED. O teste verifica o fault persistido, head, latch e zero I/O, nunca aceita rejeição genérica do proxy Node como decisão de segurança.

Resultados finais e cobertura ficam no relatório externo da execução; este documento descreve o mecanismo e não presume aprovação de todos os testes ou homologação operacional.

## Execução local

```sh
# raiz: instalação reproduzível autorizada, sem atualização
npm ci --ignore-scripts
cd prototype/mcp-local
npm ci --ignore-scripts --cache ../../.wrangler/npm-cache
npm exec -- tsc --noEmit -p tsconfig.integration.json
node --test tests/integration.test.mjs
```

Node 24, workerd/Miniflare e cliente SDK oficial nas versões já fixadas. Executar os comandos em perfil autorizado para subprocessos e loopback 127.0.0.1:portas efêmeras. Não desativar proteções, usar sudo ou conectar contas reais. Bundles/coverage/dados efêmeros ficam em `work/` ignorado. Manifestos e logs de auditoria ficam fora do repositório.

A suíte associa C3-L01…L48 individualmente; L43 demonstra o limite de restauração coerente de todas as raízes. Os 32 cenários externos da matriz aprovada continuam pendentes individualmente, sob autorização específica. O PITR real R1-78 continua skip no R2-Q.

## Consolidação de dependências e preservação

Versões congeladas: Node 24.22.1 / Undici interno 7.30.1; Vitest Plugin 1.4.8; Wrangler 4.153.0; Miniflare 5.20261023.0-beta; workers-types 5.20261023.1; workerd 1.20261023.1; Undici npm 7.30.1; Zod raiz 4.6.6 e MCP 4.6.7. Vitest 5.0.5, TypeScript 5.9.3, esbuild 0.28.2, SDK MCP 2.3.1 e jose 6.2.13 foram preservados.

Os antigos overrides parent-scoped foram removidos na atualização autorizada porque os novos pais já fixam Undici/Zod corrigidos. Eles não são reintroduzidos nesta etapa. O verificador B4 exige os hashes/conteúdo exatos dos quatro manifests/locks aprovados. Contra B3.1, são **94 arquivos binariamente iguais** e somente três exceções: package.json, package-lock.json e .github/workflows/b3-sqlite.yml. Nesse workflow, somente a seleção do verificador na branch B4 pode mudar. O script original B3.1 e as suas regras permanecem intactos. Uma quarta exceção, remoção, arquivo candidato inesperado ou flag de ativação reprova a verificação.

## Classificação QUERY e projeção pública

| Origem no adapter | Após TokenCoordinator | Classificação B4 / texto MCP constante |
|---|---|---|
| HTTP 401: QUERY_AUTH_REQUIRED | REAUTH_REQUIRED | conexão/token: INTEGRATION_TOKEN_UNAVAILABLE |
| HTTP 403: QUERY_DENIED | QUERY_DENIED | conexão/token: INTEGRATION_TOKEN_UNAVAILABLE; não inventa negação de grant read |
| 429/5xx: UPSTREAM_UNAVAILABLE retryable | QUERY_UNAVAILABLE | dependência: INTEGRATION_DEPENDENCY_UNAVAILABLE; causa upstream se não houve causa local anterior |
| Timeout do adapter/corpo: UPSTREAM_TIMEOUT | QUERY_TIMEOUT | dependência: INTEGRATION_DEPENDENCY_UNAVAILABLE; causa timeout |
| JSON/contrato inválido: UPSTREAM_CONTRACT ou indisponibilidade não retryable | QUERY_CONTRACT | conexão/contrato: INTEGRATION_TOKEN_UNAVAILABLE |
| Seller incompatível | SELLER_MISMATCH | INTEGRATION_TOKEN_UNAVAILABLE |
| Exceção inesperada na operação | QUERY_UNAVAILABLE sanitizado | INTEGRATION_DEPENDENCY_UNAVAILABLE |
| AppError de código desconhecido | não confiado como permissão | INTEGRATION_DEPENDENCY_UNAVAILABLE, sem eco do código/mensagem |

ReadTokenFailure privado preserva uma recusa de validação local antes de o coordinator a sanitizar para QUERY_UNAVAILABLE. VAULT_UNAVAILABLE, CONFIG_INVALID e CIPHERTEXT_INVALID permanecem falhas locais de token/cofre; não são reclassificadas como indisponibilidade upstream. A mesma regra de primeira causa preserva a rejeição de item/vendedor não pertencente à conta. ReadDependencyFailure privado preserva transport/timeout antes da sanitização. Erro genérico ou objeto com campo code não prova autorização negada. Falhas locais de token/storage/validação continuam fechadas. A negação de grant read exige IntegrationFailure tipado e código fechado, derivado das verificações de política. Nenhum ramo inclui cause, stack, token ou dados do provider na resposta.

Os testes novos exercitam o adapter/coordinator reais com transporte sintético, todos os códigos conhecidos e desconhecidos, timeout curto de corpo, falhas de conexão e a serialização MCP. Na composição workerd, respostas HTTP 429/503 e corpo quebrado comprovam causa privada, resultado MCP constante, estado de token/grants intacto e recuperação por nova leitura limpa. O timeout de corpo de 10 s do adapter é verificado no teste isolado com prazo curto; o harness integrado mantém seu limite de I/O de 5 s, sem ampliá-lo para o cenário.

## CI e prova independente reproduzível

O workflow MCP fixa Node 24.22.1 e usa scripts/ci.mjs para os grupos mcp, persistence, recovery, vault, integration, buffering e regression. O inventário recursivo exige sete .test.mjs: os seis anteriores, incluindo integration, mais query-classification. A união dos grupos precisa executar cada arquivo exatamente uma vez. A prova independente é script separado e seu fixture também precisa existir: não é descoberta pelo glob .test.mjs.

A prova de buffering está em scripts/prove-buffering.mjs e tests/fixtures/buffering-worker.ts, com caminhos relativos. Compila para work/buffering/ e executa 14 casos: JSON/SSE × allow/revoke/revision/tool-error/infinite/broken/disconnect. Confere ausência de headers/dados antes da barreira final, descarte por revogação/revisão, cancelamento, zero egress e porta encerrada. Não é DLP nem transação entre rede e W.

```sh
npm exec -- tsc --noEmit -p tsconfig.integration.json
node scripts/ci.mjs run integration
node scripts/ci.mjs run buffering
# Na raiz:
node scripts/verify-b4-preservation.mjs
node scripts/audit-cloudflare-bundles.mjs
node --test tests/b4/preservation.node.mjs
```

O grupo regression repete 273 principais, cinco SQLite/workerd, nove Node históricos e os novos testes do verificador no Node fixado, sem alterar o teste histórico de configuração do ci.yml. Os seis typechecks, demonstração, auditorias npm dos dois projetos, assinaturas e inspeção dos bundles estão cobertos por comandos explícitos. O workflow SQLite mantém os testes anteriores: na branch B4 usa o verificador B4, nas demais usa o B3.1 original. Actions continuam por SHA, contents:read, credenciais Git não persistidas, sem secrets, escrita, upload de materiais privados ou deploy.

Os workflows legados mantêm Node 24 flutuante; isso não equivale a fixar seu patch. O workflow B4 fixa o runtime e repete as regressões para reprodução do laboratório. Os relatórios distinguem resultado local, CI ainda não executado no GitHub, homologação operacional e produção. Esta etapa não publica commits nem garante antecipadamente CI remoto verde.

## Bloqueios de produção

Restauração coerente de W/G/A/P ainda pode reativar permissões: o teste registra o contraexemplo, não uma proteção resolvida. Diretórios, tabelas, namespaces e instâncias locais não comprovam independência real do guardião. Permanecem pendentes referência externa atual autenticada/monotônica, exclusão/recriação/rollback de W, MFA e quorum de pessoas reais, PITR Cloudflare, custódia/rotação de chaves, restauração operacional e segregação IAM. Recuperação administrativa continua simulação, sem prova de MFA. Não há OAuth real, Managed OAuth, integração ChatGPT ou Mercado Livre; elegibilidade do plano e compatibilidade OAuth exigem confirmação futura.
