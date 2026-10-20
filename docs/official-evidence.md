# Evidências e pendências B0

Consulta em 20/10/2026. Pesquisa limitada aos requisitos desta implementação.

## Durable Objects SQLite: escolha confirmada para desenvolvimento local

Fontes oficiais Cloudflare consultadas pelo conteúdo do repositório cloudflare/cloudflare-docs, branch production:

- https://developers.cloudflare.com/durable-objects/platform/limits/
  Fonte: https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/durable-objects/platform/limits.mdx
- https://developers.cloudflare.com/durable-objects/platform/pricing/
  Tabela: https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/partials/durable-objects/durable-objects-pricing.mdx
- Planos: https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/partials/durable-objects/do-plans-note.mdx
- https://developers.cloudflare.com/workers/platform/pricing/
  Fonte: https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/workers/platform/pricing.mdx
- Nota de cobrança SQLite: https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/partials/durable-objects/do-sqlite-storage-no-bill-note.mdx

Documentado: SQLite no Free; até 100 classes e 5 GB totais na conta Free, até 10 GB por objeto sujeito ao
limite total menor; linha/string SQL de até 2 MB. Franquias DO Free: 100 mil requests/dia, 13 mil GB-s/dia,
5 milhões de linhas lidas/dia e 100 mil escritas/dia. Superar uma franquia Free causa falha da operação;
não representa disponibilidade garantida. Cada chamada RPC ao objeto conta como request.

Paid: mínimo Workers de US$ 5/mês; franquia DO de 1 milhão de requests/mês e 400 mil GB-s/mês; adicionais
indicados de US$ 0,15/milhão de requests e US$ 12,50/milhão de GB-s. SQLite tem cobrança própria por
armazenamento e linhas, com franquias. A nota oficial informa ativação de cobrança SQLite a partir de
janeiro de 2026; não tratar armazenamento pago como permanentemente gratuito. Verificar preços novamente
antes de contratar. Não foi contratado serviço, criado recurso ou medido consumo faturável nesta fase.

Decisão: usar DO SQLite exclusivamente no Miniflare/workerd local em B0. Persistência, consumo atômico e
recriação do objeto são testados. A estrutura é adequada ao cofre de uma conta, mas escolha do plano de
produção fica condicionada a métricas de CPU, volume de linhas, duração, região e aprovação de custo.
Não há afirmação de que o plano Free atende uma futura operação real.

## Mercado Livre: não confirmado nesta fase

O portal developers.mercadolivre.com.br respondeu 403 pelo proxy do ambiente na pesquisa anterior;
nenhum dado desse bloqueio autoriza concluir falta de acesso da Direção. A Direção informou acesso ao
DevCenter, aplicação Claude independente e nova aplicação GPT em configuração. Não foi acessado o painel
nem qualquer uma dessas aplicações. Não foram usados seus IDs, credenciais ou tokens.

Pendências documentais: enquadramento in-house, permissões exatas e acesso offline, PKCE atual, requisitos
de callback, formato do token endpoint, duração/rotação/revogação, endpoints/paginação de anúncios,
limites e termos de dados/IA. URLs de referência a conferir:

- https://developers.mercadolivre.com.br/pt_br/registre-sua-aplicacao
- https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao
- https://developers.mercadolivre.com.br/pt_br/usuarios-e-aplicacoes

O modelo local implementa Authorization Code + PKCE S256 por requisito B0; sua execução não confirma
suporte ou obrigatoriedade na plataforma. Tokens de 120 segundos e refresh rotacionado são decisões do
simulador, não regras atribuídas ao Mercado Livre. Os contratos versionados descrevem nossa API interna.
