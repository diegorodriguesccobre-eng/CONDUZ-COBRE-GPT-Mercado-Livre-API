# B1 — evidências e permissões ainda não concedidas

Consulta em 20/10/2026; configuração informada pela Direção, sem credenciais ou acesso ao painel.

## DevCenter

A Direção confirmou a criação da aplicação GPT e o redirect em workers.dev. Isso não confirma permissões finais.
O registro legível por máquina está em config/devcenter-status.json, com validated=false e productionOAuthReady=false.

Última captura descrita, ainda sem confirmação das seleções atuais:

- Finalidade Negócios; uso exclusivo da operação própria; modalidade in-house não confirmada.
- Usuários: Leitura e escrita exibida inicialmente, não confirmada como permissão ativa.
- Comunicações, publicação/sincronização, publicidade, faturamento, métricas e promoções: Sem acesso exibido.
- Orders, Messages, Prices, Items, Catalog, Shipments, Promotions e subgrupos ainda não verificados.
- Authorization Code e Client Credentials marcados; Refresh Token e PKCE desmarcados na captura anterior.

Antes de conexão: conferir Authorization Code + PKCE S256, retirar Client Credentials se não necessário ao fluxo,
verificar a exigência oficial de Refresh Token/acesso persistente e confirmar leitura mínima para identidade e
anúncios próprios. Usuários com escrita e publicação/sincronização sem acesso não demonstram esse objetivo;
não solicitar nem aceitar escrita residual sem avaliação da Direção. Não presumir nomes scope=read/offline_access.
Não acrescentar acesso a pedidos, compradores, mensagens, pagamentos, publicidade ou dados fiscais.

O portal oficial continua respondendo 403 pelo proxy desta máquina nas páginas de cadastro, autenticação,
usuários e itens/buscas. Não houve tentativa de login, acesso à conta Mercado Livre ou uso das aplicações reais.
A leitura do portal exige liberação do hostname developers.mercadolivre.com.br na rede do ambiente; não foi
alterada a política. A modalidade in-house, scopes, PKCE/refresh atuais, payloads/paginação e regras de tokens
continuam pendentes. Nenhuma seleção foi inferida apenas da criação da aplicação ou da URL registrada.

Fontes tentadas:

- https://developers.mercadolivre.com.br/pt_br/registre-sua-aplicacao
- https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao
- https://developers.mercadolivre.com.br/pt_br/usuarios-e-aplicacoes
- https://developers.mercadolivre.com.br/pt_br/itens-e-buscas

O SDK oficial arquivado foi consultado somente como evidência histórica. Seu modelo Item documenta preço
numérico, mas é um modelo de entrada antigo e não confirma o contrato GET vigente. Por isso, fixtures B1
com IDs/quantidades inventados e preço numérico têm rótulo SYNTHETIC_DRAFT_NOT_CURRENT_OFFICIAL_CONTRACT.
Não são respostas reais, não demonstram permissões e não são apresentadas como contrato oficial 2026.
Os parsers candidatos recusam vendedor divergente e removem PII; contratos v1 B0 permanecem inalterados.

Referência histórica: https://github.com/mercadolibre/nodejs-sdk/blob/master/src/model/Item.js

## Identidade Cloudflare e Actions

Documento oficial Access consultado no repositório cloudflare/cloudflare-docs:
https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json.mdx

Confirma Cf-Access-Jwt-Assertion, RS256, validação issuer/AUD e endpoint /cdn-cgi/access/certs. Implementação
usa jose, como no exemplo oficial, com resolvedor local injetado nos testes e consulta remota bloqueada em B1.

Tags oficiais resolvidas por Git e action.yml de cada SHA consultado, confirmando runtime node24:

- actions/checkout v7.0.1: 3d3c42e5aac5ba805825da76410c181273ba90b1.
- actions/setup-node v7.1.0: 949feb2413d6458794dcd2491c4babbbce0c15c1.

Checkout não persiste credenciais; permissões contents:read; Node 24; runner ubuntu-24.04 para evitar o aviso
de migração do ubuntu-latest. Runner hospedado/self-hosted deve suportar Actions Node24 (setup-node documenta
mínimo 2.327.1). CI permanece sem deploy e sem Secrets de produção. Nenhuma execução GitHub B1 foi disparada.
