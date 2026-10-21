# B3 — evidências atuais e limites

Consulta pública em 21/10/2026. Nenhuma chamada à API comercial, painel, autenticação ou Worker remoto.

## Mercado Livre

Tentativas diretas pelo proxy herdado, todas recusadas com `Tunnel connection failed: 403 Forbidden`:

- https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao
- https://developers.mercadolivre.com.br/pt_br/usuarios-e-aplicacoes
- https://developers.mercadolivre.com.br/pt_br/itens-e-buscas

O erro é de conectividade/política deste ambiente, não evidência de indisponibilidade do portal para a Direção. Não houve bypass da política. Faltam confirmar contratos atuais de token, capitalização token_type, PKCE, renovação/rotação/revogação, identidade, anúncios/paginação/detalhes, quotas, termos aplicáveis a dados/IA e modalidade in-house. Nenhum nome de scope é presumido.

As fixtures e os parsers B1/B3 são candidatos sintéticos, não contratos oficiais. A faixa local de validade do token, margem de renovação e shape das respostas exigem revisão documental antes de ativar. O teste PKCE incorreto demonstra recusa pelo provedor simulado e consumo único do state; não verifica comportamento do servidor Mercado Livre.

## Cloudflare

Fontes oficiais obtidas via conteúdo público de `cloudflare/cloudflare-docs`, branch production, HTTP 200:

- https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json.mdx — RS256, header, issuer, AUD e JWKS `/cdn-cgi/access/certs`.
- https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/durable-objects/api/sqlite-storage-api.mdx — SQLite e transações via API de storage.

São páginas da branch consultada, não versões fixadas em commit. `DELETE RETURNING`, consumo único, rollback e persistência foram também exercitados no workerd/SQLite local. Não foi verificada política Access real, integração MFA, suporte efetivo da combinação workers.dev + políticas por caminho, custos reais, quotas remotas ou rollback do painel. Antes da implantação esses itens devem ser comprovados, mantendo o callback exato. Se a política por caminho não puder preservar o callback público com os internos protegidos em workers.dev, interromper o rollout e submeter mudança de domínio/callback à Direção.

## DevCenter confirmado pela Direção

Confirmação após salvar e reabrir: CONDUZ COBRE GPT API; Authorization Code, Refresh Token e PKCE necessário habilitados; Client Credentials e VIS desabilitados; Mercado Livre habilitado; publicação/sincronização Leitura; comunicações, publicidade, faturamento, métricas, promoções e vendas/envios Sem acesso; Usuários Leitura e escrita obrigatória não editável.

Essa informação atualiza o entendimento B3, mas não altera os documentos históricos B1. `config/b3-readiness.json` é o registro atual. A permissão Usuários obrigatória **não torna o token exclusivamente de leitura**. A contenção comercial é imposta pelo código de operações fechado e deverá ser revista novamente diante da documentação oficial. Não foram usados client ID, segredo, conta, seller ID real ou tokens reais.
