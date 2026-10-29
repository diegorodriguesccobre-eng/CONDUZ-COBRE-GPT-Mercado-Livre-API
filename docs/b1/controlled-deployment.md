# B1 — primeira implantação controlada (não executada)

Base preservada: B0 ed36da5. Esta entrega somente prepara arquivos, código e testes em branch local.
Nenhum comando de implantação, conexão com conta real, alteração de DNS ou publicação Git está autorizado nesta fase.

## Separação dos ambientes

| Item | Desenvolvimento B0 preservado | Produção preparada B1 |
| --- | --- | --- |
| Arquivo | wrangler.jsonc | wrangler.production.jsonc |
| Worker | conduz-cobre-b0-synthetic | conduz-cobre-ml-api |
| Entrypoint | src/index.ts | src/preparation/entrypoint.ts |
| Transporte | synthetic | disabled, bloqueio no código |
| Callback | http://localhost:8787/internal/oauth/callback | https://conduz-cobre-ml-api.conduz-cobre.workers.dev/oauth/mercadolivre/callback |
| Namespace | ACCOUNT_VAULT / AccountVault | BROWSER_OAUTH_VAULT / BrowserOAuthVault |
| Migração | v1, SQLite | b1-browser-v1, SQLite em namespace próprio |
| Identidade | chave compartilhada apenas local | verificador de JWT Access e roles individuais preparados |

Não usar wrangler.jsonc para produção nem trocar seus valores para reutilizá-lo. Configurações e chaves
B0 não devem ser copiadas para produção. O template de produção contém campos vazios intencionais;
preenchê-los não habilita OAuth. LIVE_TRANSPORT_ENABLED e PRODUCTION_OAUTH_ENABLED permanecem false.
O entrypoint preparado responde HTTP 503 para todos os caminhos, inclusive o callback registrado.
Isso é o comportamento esperado da primeira implantação inerte; não é uma integração OAuth operacional.

## URL, identidade e callback

Nome e URL confirmados pela Direção:

- Worker: `conduz-cobre-ml-api`.
- Origin: `https://conduz-cobre-ml-api.conduz-cobre.workers.dev`.
- Redirect: `https://conduz-cobre-ml-api.conduz-cobre.workers.dev/oauth/mercadolivre/callback`.

A mesma string é usada no template, Wrangler de produção, contrato, factory da autorização e corpo da troca.
Não acrescentar barra, query, fragmento ou caminho alternativo. O endereço em workers.dev dispensa DNS próprio;
esta fase não cria ou altera qualquer registro DNS ou recurso da conta.

Modelo preparado, testado somente offline:

1. Rotas internas e POST /oauth/start ficam atrás de Cloudflare Access, com login individual e MFA via IdP.
   Validar assinatura RS256, issuer fixo, AUD específico, sub, exp/iat e role por allowlist no backend.
   O backend não aceita um header de identidade sem assinatura nem a chave local B0 como identidade de produção.
2. JWKS vem do issuer configurado + /cdn-cgi/access/certs, com cache de cinco minutos, cooldown de trinta
   segundos e timeout de cinco segundos. Até essa consulta está bloqueada em B1; os testes usam chaves
   públicas locais e chaves de assinatura efêmeras em memória. Não copiar chave de teste para produção.
3. Início exige administrador, POST, Origin exata e, quando presente, Sec-Fetch-Site same-origin. O servidor
   gera state e verifier de 256 bits, PKCE S256 e prova aleatória de navegador em cookie __Host-conduz_oauth,
   Secure, HttpOnly, SameSite=Lax, Path=/, sem Domain. Prazo máximo cinco minutos, limitado pelo JWT individual.
4. O state é indexado por hash. Verifier, subject pseudônimo, conta, redirect e hash da prova do navegador
   ficam cifrados em SQLite. Cookies não contêm tokens Mercado Livre nem JWT Access.
5. SOMENTE o caminho exato GET /oauth/mercadolivre/callback pode futuramente receber uma regra de bypass
   de Access. Ele valida state + cookie + contexto + prazo e consome state atomicamente antes da troca.
   Não depende de Bearer ou JWT Access no retorno do navegador. Não estender bypass a /oauth/* ou /internal/*.
6. Callback repetido, cookie ausente/duplicado/de outro navegador, sessão expirada, parâmetros duplicados,
   redirect diferente e cancelamento não executam troca. Erros são saneados; cookie é apagado. Uma falha
   após consumir state exige reinício do consentimento; não restaurar state nem repetir código cegamente.
7. Em sucesso futuro, somente após validar seller e persistir tokens, redirecionar para /oauth/result,
   removendo code/state do endereço. No-store, no-referrer, sem scripts de terceiros ou payload sensível.

A lógica de sessão, validação JWT e callback foi testada com transporte offline, mas não está conectada
às rotas do entrypoint de produção. A ativação dessas rotas, do resolvedor JWKS e da troca de código depende
expressamente de outra revisão/autorização. O callback cadastrado não torna permissões ou PKCE ativos no DevCenter.

## Bindings e Secrets

Especificação sem valores em config/required-bindings.json:

- BROWSER_STATE_KEY_V1: nova chave AES-256-GCM de 32 bytes em base64url para o cofre de sessão B1.
- TOKEN_ENCRYPTION_KEY_V1: chave independente para o futuro cofre de tokens de produção.
- MELI_CLIENT_SECRET: necessário apenas na futura troca autorizada, nunca em Git, chat ou logs.
- MELI_CLIENT_ID: identificador de aplicação, configuração não secreta; não foi fornecido nesta fase.
- Access issuer/AUD, roles por sub, accountRef e expectedSellerId: configuração privada da implantação,
  sem valores de conta reais nos templates. Não publicar identificadores internos reais no Git público.

Usar bindings de Worker Secrets e valores introduzidos por operador autorizado em canal seguro. Não criar
arquivo .dev.vars com credenciais reais, usar segredo em comando exposto ao histórico ou credencial de produção
na CI. O primeiro deploy inerte não usa Secrets e não chama o Durable Object; não solicita credenciais Mercado Livre.
O namespace e as chaves B1 devem permanecer separados dos da B0. A futura ativação precisa ainda conectar
um cofre de tokens de produção com validação de seller, persistência atômica, renovação coordenada e rotação
de chaves; o cofre B0 continua limitado aos dados sintéticos e não foi convertido silenciosamente em produção.

## Procedimento após nova autorização expressa

1. Direção revisa o diff B1, resultados e pendências do DevCenter. Push/merge e deploy são autorizações separadas;
   nenhum ocorre automaticamente. Verificar novamente elegibilidade Free e franquias de Workers/SQLite/Access;
   interromper se a operação exigir contratação ou aumento de plano não autorizado.
2. Operador verifica a conta Cloudflare correta, subdomínio conduz-cobre.workers.dev, nome do Worker e ausência
   de colisão com recursos existentes. Não acessar ou alterar outras aplicações. Autenticação Cloudflare deve
   ocorrer por meio seguro e autorizado, sem enviar tokens no chat ou gravá-los no repositório.
3. Rodar npm ci --ignore-scripts, npm run typecheck, npm test, npm run test:registry, npm run audit:dependencies,
   npm run audit:registry-signatures e os scanners de conteúdo/histórico. Tratar a pendência TUF/Sigstore separadamente.
4. Rodar npm run build e npm run build:production. Ambos são SOMENTE dry-run. Conferir bundle, entrypoint,
   nome, URL, namespace e migração; nenhuma alteração no arquivo B0 é necessária.
5. Somente depois da autorização de implantação e conferência da conta, o operador poderá executar:

   ```sh
   npx --no-install wrangler deploy --config wrangler.production.jsonc
   ```

   Esse comando NÃO foi executado. Ele cria/publica recursos; não faz parte da CI nem dos scripts de build.
6. Verificar HTTPS e retorno HTTP 503 saneado em /oauth/mercadolivre/callback e /internal/health, sem logs de
   query, headers, body ou tokens. Nenhuma autorização real deve iniciar. Não divulgar preview de loopback.
7. Manter os dois bloqueios de código. Nova autorização é necessária para ligar login/rotas de produção,
   preencher bindings seguros, configurar exceção exata de Access e testar fluxo sintético pelo navegador.
   Somente depois de confirmar permissões e contratos oficiais deve ser proposta uma conexão Mercado Livre real.

A produção preparada não oferece escrita comercial, proxy genérico ou acesso a outras operações. A aplicação
existente de outra integração permanece intocada. Nenhum serviço pago foi ativado.
