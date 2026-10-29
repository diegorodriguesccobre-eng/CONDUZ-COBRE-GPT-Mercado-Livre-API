# CONDUZ-COBRE-GPT-Mercado-Livre-API
API teste para a empresa conduz cobre para auditoria de anúncios ativos

## Fase B0 implementada — apenas dados sintéticos

Worker TypeScript modular com autenticação interna obrigatória, OAuth simulado com PKCE S256,
state temporário de uso único, cofre AES-GCM em Durable Objects SQLite e renovação coordenada.
O transporte é exclusivamente sintético: não há cliente de rede real ou seleção de vendedor real.
A aplicação existente "Conduz Claude Agentes" e a aplicação GPT do DevCenter não são utilizadas.

Requer Node.js 24. Não há necessidade de login Cloudflare ou Mercado Livre.

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
npm run setup:local
npm run dev
```

Em outro terminal, `node scripts/smoke-local.mjs` valida o HTTP local sem mostrar chaves.
`npm run setup:local` cria exclusivamente chaves sintéticas locais em `.dev.vars`, ignorada pelo Git,
com permissão 0600, e preserva o arquivo se já existir. Não colocar credenciais reais nesse arquivo.
O servidor escuta somente em 127.0.0.1. O processo deve ser encerrado após os testes.

`npm run build` usa **Wrangler --dry-run**, somente para gerar bundle local; não publica recursos.
Não existe script de deploy nem implantação na CI. Não executar deploy ou push sem autorização.
A Direção autorizou a publicação da Fase B0 neste repositório público.
Credenciais, dados reais, deploy e serviços pagos continuam fora do escopo.

- [Execução e limites B0](docs/b0-runbook.md)
- [Evidências oficiais e pendências](docs/official-evidence.md)
- [Segurança e auditoria](docs/security.md)
- [Resultados da entrega](docs/b0-validation.md)
- [OpenAPI v1](contracts/v1/openapi.json)

Os contratos e fixtures são internos e propostos. Não representam respostas oficiais validadas do Mercado Livre.
GPT e Claude poderão consumir os contratos futuramente, após autorização própria; não há conector de IA ativo.

## Preparação B1 — branch local, sem ativação

A B0 e seus 82 testes foram preservados. A B1 acrescenta componentes offline de identidade individual,
callback público com sessão/PKCE e um adaptador real bloqueado no código. O alvo de produção separado
`wrangler.production.jsonc` usa o Worker `conduz-cobre-ml-api` e o callback registrado
`https://conduz-cobre-ml-api.conduz-cobre.workers.dev/oauth/mercadolivre/callback`.
O entrypoint de preparação responde 503 e não inicia OAuth. Não executar deploy ou publicar alterações sem autorização.

- [Procedimento da primeira implantação controlada](docs/b1/controlled-deployment.md)
- [Evidências e permissões pendentes](docs/b1/evidence-and-permissions.md)
- [Assinaturas e proveniência npm](docs/b1/npm-verification.md)
- [Validação B1](docs/b1/validation.md)

Verificações adicionais: `npm run test:registry`, `npm run audit:registry-signatures` e
`npm run build:production`. O último comando gera somente um bundle dry-run separado.
