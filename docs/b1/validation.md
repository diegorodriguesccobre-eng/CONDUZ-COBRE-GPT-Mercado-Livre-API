# B1 — entrega local para revisão

Data: 20/10/2026. Base B0: ed36da5. Branch local: b1/prepare-real-integration.
Sem push, merge, deploy, DNS, conta Mercado Livre, credenciais reais ou serviço pago.

## Preservação

Os 33 arquivos protegidos de fontes B0, testes B0, contratos v1 e configurações locais foram comparados
byte a byte ao commit-base: nenhuma alteração. Todos os 82 testes B0 continuam executando sem substituição.
O README foi apenas acrescido da seção B1. As entradas preexistentes do lockfile estão inalteradas;
única dependência nova: jose 6.2.13 para verificação JWT recomendada pela documentação oficial Cloudflare.
Os demais ajustes existentes limitam-se a Actions, scripts/package e compilação adicional de schemas B1.

## Implementação

- src/preparation/config.ts: callback confirmado, separação de estágio e bloqueios de código false.
- src/preparation/access-identity.ts: JWT RS256 individual, issuer/AUD/exp/iat/sub/role, subject pseudônimo,
  resolvedor JWKS preparado com consulta remota desativada; sem chave compartilhada de operador em produção.
- src/preparation/browser-oauth.ts: início administrativo com Origin exata, cookie __Host seguro, state
  temporário cifrado, PKCE S256, associação à sessão, consumo atômico, cancelamento/replay e resposta saneada.
  Callback público não exige Bearer/JWT, mas exige a prova vinculada à sessão autenticada no início.
- src/preparation/browser-vault.ts: namespace SQLite próprio, quota, cofre de state e porta de troca desativada.
- src/preparation/real-http-transport.ts: factory fechada de leituras/troca/refresh, sem proxy arbitrário,
  redirect_uri exata, transporte real bloqueado. Implementação futura usa redirect manual e recusa 3xx;
  Workers não suporta redirect error. Nenhuma requisição real foi executada.
- src/preparation/draft-contracts.ts e prepared-read-client.ts: normalização candidata, seller conferido,
  preço decimal textual e remoção de PII; testes usam transporte sintético injetado.
- src/preparation/entrypoint.ts: alvo de produção inerte, HTTP 503 em todos os caminhos.
- wrangler.production.jsonc: Worker conduz-cobre-ml-api, origin e callback confirmados, namespace independente,
  migração SQLite própria, previews e observabilidade desativados. wrangler.jsonc B0 permanece intacto.
- config/: template, requisitos de bindings sem valores secretos e estado DevCenter explicitamente não validado.
- contracts/preparation/: OpenAPI 3.1 e JSON Schema separados; contratos v1 intactos.
- scripts/audit-registry-signatures.mjs: assinaturas ECDSA npm e integridade, sem confundir com proveniência.
- .github/workflows/ci.yml: Actions oficiais com SHA fixo e runtime Node24, checkout sem persistir credenciais,
  runner fixo Ubuntu 24.04, testes extras e dois builds dry-run; sem deploy ou credenciais de produção.

## Resultados

| Verificação | Resultado |
| --- | --- |
| Testes Workers/workerd | 139 executados e aprovados: 82 B0 + 57 B1 |
| Testes Node de assinatura/configuração/CI | 9 executados e aprovados |
| Total | 148 aprovados, zero falhas, zero ignorados/pendentes |
| TypeScript strict | Passou |
| Build local B0, somente dry-run | Passou; 30,19 KiB / gzip 8,34 KiB |
| Build de produção preparada, somente dry-run | Passou; 13,86 KiB / gzip 4,47 KiB |
| npm audit | Zero vulnerabilidades reportadas |
| Assinaturas ECDSA registry npm | 86 pacotes instalados verificados, zero falhas |
| Pacotes opcionais de outras plataformas | 73 não instalados, não declarados verificados |
| Proveniência npm/Sigstore | Pendente: TUF bloqueado por HTTP 403; controles preservados |
| Scanners de segredos | Zero achados no conteúdo candidato e no histórico; cinco alertas em cache npm público, classificados |

Os testes incluem autenticador JWT (assinatura, issuer, audience, expiração, role e negação de algoritmo none),
callback público com cookie obrigatório, associação ao operador/conta, sessão expirada, duplicação de cookie/query,
PKCE, replay concorrente, cancelamento, erro de troca, SQLite após reconstrução, Origin/CSRF, callback byte a byte
idêntico ao cadastrado, isolamento B0/produção e prova de que os testes não chamam fetch externo.

A primeira varredura marcou um identificador de audiência de teste, que é configuração pública não secreta;
o exemplo foi simplificado. Cinco alertas adicionais se referem exclusivamente ao cache ignorado dos metadados
públicos de jose. O arquivo foi comparado byte a byte com https://registry.npmjs.org/jose e é idêntico.
Esses alertas de dados públicos não são credenciais da operação; nenhum arquivo de cache integra o Git.
Não foi criada allowlist ampla e nenhum checksum ou configuração TLS foi alterado para obter aprovação.

Relatórios de testes, auditoria e builds ficam em /tmp/b1-* e /tmp/conduz-b1-registry-signatures.json,
fora do repositório. A CI B1 não foi executada no GitHub, pois não houve publicação desta branch.

## Pendências antes de qualquer ativação real

1. Revisão da Direção e autorizações separadas para publicação e implantação. Procedimento em controlled-deployment.md.
2. Confirmar modalidade in-house, permissões finais de leitura, PKCE e refresh no DevCenter/documentação atual.
   Criação da aplicação e URL confirmada não confirmam permissões. Ver evidence-and-permissions.md.
3. Concluir verificação Sigstore quando a rede permitir; npm-verification.md descreve a causa e o destino necessário.
4. Configurar identidade Access/IdP/MFA e roles individuais, sem bypass das rotas internas, após autorização.
5. Integrar as rotas hoje inertes ao verificador, cofre e troca de código em uma fase revisada, preservando
   proteção própria do callback público, seller aprovado, cofre de tokens de produção e rotação de chaves.
6. Somente após nova aprovação, considerar liberar as duas travas de código e qualquer conexão real.

O primeiro deploy proposto é estritamente inerte: HTTPS/Worker/binding preparados, HTTP 503, sem consentimento
ou troca de código. B1 não deve ser descrita como conexão real validada ou OAuth de produção habilitado.
