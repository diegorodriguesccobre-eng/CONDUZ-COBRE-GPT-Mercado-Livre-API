# I2 local — serviço privado de identidade

Checkpoint imutável: main `b3df5def93688d9d68fad39a9a61e96b5c4ba437` (I1 incorporada, 178 arquivos).
Este incremento acrescenta seis arquivos e transforma quatro caminhos fechados. Os hashes I1,
o autohash I1, as exceções históricas e os contratos de negócio não são substituídos.
O verificador exige o checkpoint I1 íntegro e uma projeção histórica válida; exige separadamente
os dez conteúdos I2 aprovados e os outros 174 arquivos idênticos. São 184 arquivos candidatos.
Os contadores históricos do relatório descrevem o checkpoint/projeção I1; `i2ProtectedFiles`
descreve os arquivos atuais inalterados. Não há fallback do candidato I2 para outra época.

## Escopo nominal

Adições, sob `prototype/mcp-local/`: `i2/identity-worker.ts`, `i2/identity-config.ts`,
`scripts/build-i2-identity.mjs`, `scripts/i2-identity-harness.mjs`,
`lab/tests/i2-identity.node.mjs` e este documento.
Alterações: `scripts/homologation-harness.mjs`, `tests/homologation.test.mjs` neste subprojeto;
`scripts/verify-b4-preservation.mjs` e `tests/b4/m21-preservation.node.mjs` na raiz.

## Bindings, rotas e egress

| Componente | Binding/capacidade | Limite |
|---|---|---|
| Worker privado `i2-identity` | `I2_MODE` | Somente `I2_IDENTITY_FICTIONAL_LOCAL_ONLY` |
| Worker privado | `I2_JWKS` | Uma chave pública RS256 efêmera, `synthetic-ephemeral`; sem chave privada |
| Worker privado | `I2_IDENTITIES` | DO `I2Identity`, nome interno `local-identity-authority` |
| Backend de cofre I1 | `INTEGRATION_IDENTITY` | Mesma classe/namespace no Worker `i2-identity` |
| Frente MCP | `HML_IDENTITY` | Serviço privado; envelopes I1 `issue`, `lookup`, `cancel` |
| Frente e demais portas | Bindings I1 existentes | Registro, grants, referência e cofres não são substituídos |

A frente continua aceitando apenas `/mcp` no loopback. O serviço privado aceita somente
POST JSON para `https://m1-ports.invalid/identity/issue`, `/lookup` e `/cancel`, por capacidade
do harness. A URL `.invalid` não é um destino de rede: é entregue ao binding de Worker.
Não há rota de fixture, administração, OAuth, refresh, grant ou seleção de namespace/conta.
O serviço privado não é encaminhado pelo listener público local da frente/backend.
O envelope privado continua `{args: ...}` / `{ok:true,value:...}`; falha de transporte/protocolo
continua indisponibilidade constante. O corpo está limitado pelo leitor I1 a 16 KiB e 1 segundo.

Todos os Workers recebem o mesmo bloqueador de egress do harness I1, que conta tentativas
e responde 503. Cada cenário exige zero tentativas. Não há resolução JWKS remota, credencial
comercial, recurso Cloudflare, deploy ou conexão com Mercado Livre/ChatGPT. As duas identidades,
issuer, audience, papéis e política JWT são exatamente os da I1. Não há nova política Access.

## Reutilização e isolamento

`I2Identity` utiliza o core `VerifiedIdentityHandles` corrigido e `AccessIdentityVerifier` existente,
com `createLocalJWKSet`. O bundle privado não importa o wrapper `integration/identity.ts`, fixtures,
drivers, recuperação administrativa ou scripts. Sua classe não tem API de seed/fixture/clock.
Os handles e assertions ficam somente em memória da instância; não são persistidos em SQLite.
Reiniciar/evictar o objeto perde os handles e exige emitir novas evidências após validar o JWT.
O Worker e DO privados são separados do Worker backend, mas compartilham um processo workerd
local. Isso não comprova segregação IAM, independência operacional ou custódia real de chaves.

O harness I1 conserva seu caminho padrão sem opções. A opção Node `identityRuntime` é uma
capacidade privilegiada de teste, sem binding ou parâmetro MCP correspondente. A variante I2
troca somente o destino de identidade; o sucesso de uma leitura exige que o cofre encontre
na autoridade privada o handle emitido pela frente. Não provisiona grants/tokens automaticamente.

## Aceite e limites da prova

O filho `lab/tests/i2-identity.node.mjs` exercita as três ferramentas e dois perfis para A/B,
negação cruzada antes de provider, JWT inválido, consumo concorrente, reutilização, independência,
cancelamento, reinício real do DO, indisponibilidade, rotas fechadas e laboratório sem bootstrap.
Inspeciona o bundle privado e compara os inputs de aplicação do bundle público com a main I1.
O fechamento exige recursos registrados liberados e zero egress; não é prova universal do runtime.

As ordens determinísticas de retomada **durante** a verificação e o cancelamento de um consumo
pendente continuam comprovados pelos sete testes inalterados do core, no filho de fronteiras I1.
O teste do novo serviço usa requisições paralelas reais; não declara controle sobre o escalonador
workerd. Seu teste de cancelamento comprova invalidação do handle, não interrupção criptográfica.
O reinício é eviction de DO no Miniflare; não é homologação de failover/hibernação no provedor.

Execução a partir de `prototype/mcp-local`, com Node 24.22.1 / Undici 7.30.1 e dependências
já aprovadas, sem atualização:

```sh
node scripts/build-i2-identity.mjs
node --test lab/tests/i2-identity.node.mjs
node scripts/ci.mjs run integration
node scripts/ci.mjs run homologation
```

O build executa typecheck estrito usando a configuração TypeScript existente com inclusão
explícita dos dois arquivos novos; não altera tsconfig nem emite JS no source. A homologação
inscreve explicitamente o filho I2, sem alterar dispatcher, workflow ou limite de 300 segundos.
Os artefatos ficam somente em `work/` ignorado. Contagens, resultados e falhas reais devem ser
registrados pelo executor; este documento não declara aprovação antecipada.

Continuam aceitas somente para I1 sintética as ressalvas anteriores de observabilidade e
intermitência inconclusiva; este incremento não afirma corrigi-las. PITR real continua skip
esperado e não homologado. MFA/quorum, referência independente, recuperação operacional,
custódia, egress e autenticação reais, OAuth e ChatGPT exigem autorização própria futura.
