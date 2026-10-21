# B3 — operação, implantação futura e reversão (proposta não executada)

## Revisão local reproduzível

Requisitos: Node 24; branch B3 baseada em B1; dependências do lockfile, sem credenciais. Comandos locais:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm test
npm run test:registry
node scripts/tooling.mjs test --config vitest.b3.config.ts
node scripts/verify-b3-preservation.mjs
npm run audit:dependencies
npm run audit:registry-signatures
npm run audit:workspace
```

Os testes runtime adicionais usam `wrangler.b3.local.jsonc`, workerd/Miniflare, SQLite novo e chaves determinísticas **exclusivas de teste**. Nenhuma credencial real deve ser colocada nesse arquivo ou no repositório. `npm test` cobre os 139 Vitest originais mais os novos testes `.test.ts`; `test:registry` cobre os nove Node originais. A configuração adicional roda testes de integração `.integration.ts` sem alterar o runner B0/B1. Na etapa inicial a compilação foi feita por esbuild. Na auditoria de publicação, `npm run build` e `npm run build:production` são apenas builds locais: o wrapper fixado acrescenta obrigatoriamente `--dry-run`, desabilita métricas e retira identidade Cloudflare. Nenhum comando de implantação efetiva está autorizado.

## Chaves e revogação

1. Em fase futura autorizada, gerar chave de state e chave(s) AES-256 independentes por ambiente/conta em mecanismo de secrets aprovado; nunca no Git, nos logs ou em vars públicas. O mapa de chaves e o keyId ativo precisam de binding secreto validado. Não há provisionamento nesta revisão.
2. Rotação: manter temporariamente a antiga, instalar nova com id novo, torná-la ativa e usar `TokenCoordinator.rotate()` na fila exclusiva da conta para recifrar o único registro. Confirmar leitura com a nova, ausência de leitores antigos e health antes de retirar a antiga. Testes comprovam keyId e AAD; o procedimento remoto e o mecanismo administrativo ainda não existem.
3. State: interromper novos inícios, aguardar mais de cinco minutos/cancelar estados, então trocar chave independente. Não manter states decifráveis indefinidamente.
4. Revogação: bloquear rotas na borda e impedir tráfego, chamar operação administrativa local equivalente a `revokeLocally()` por canal autenticado futuro e confirmar marcador persistente. Revogar autorização da aplicação/tokens no mecanismo oficial Mercado Livre, ainda pendente de documentação. Não se implementou endpoint de revogação suposto. Se comprometida, retirar chave e destruir/quarentenar tokens; a exclusão em backups deve seguir retenção e política aprovadas.
5. Refresh ambíguo ou cofre em `refreshing`: não resetar para ready, não repetir token antigo, não editar SQL para contornar. Investigar, revogar no provedor quando documentado e autorizado e realizar nova autorização em cofre limpo/versionado após revisão. A classe atual recusa sobrescrever conexão existente. Migração/reconexão administrativa é trabalho futuro controlado.

## Condições para futura implantação

Nenhum passo abaixo é executável sob a autorização atual. Exige nova aprovação expressa da Direção.

1. Validar e versionar a documentação oficial Mercado Livre e ajustar parsers/requests/prazos conforme evidência; reexecutar testes. Confirmar permissões mínimas e risco residual de Usuários com escrita.
2. Revisar individualmente o issuer/AUD, mapa de operadores por `sub`, revogação, MFA obrigatório no IdP, sessão e proteção por rota. Cobrir `/internal/*`, `/oauth/start` e `/oauth/result`; permitir callback público somente no caminho exato, GET e cookies/estado válidos. Validar a precedência das políticas no domínio workers.dev real, sem supor que o bypass do callback permite bypass dos internos.
3. Aprovar identidade comercial real esperada em canal privado e armazenamento de secrets. Não fornecer segredos nem IDs privados ao Git/chat. Definir conta única pelo servidor e política de retenção. Confirmar disponibilidade no Free sem upgrade automático ou contratação.
4. Recuperar, com acesso somente leitura autorizado, metadados/artefato da B2 e validar que a versão `5429aed8-11a4-40da-97ad-b54086b6dbe9` está disponível para rollback. Registrar bindings, migrações e configurações sem valores secretos. O commit B1 sozinho não prova esse bundle.
5. Implementar ativação em nova revisão, separada e aprovada: transporte real com deadline completo, JWKS remoto controlado, bindings secretos, DO por conta, cancelamento de estados e canal de administração/reautorização/revogação. Os bloqueios atuais são constantes/entrypoint inerte; mudar variáveis não basta. Não reutilizar `wrangler.b3.local.jsonc` como configuração de produção.
6. Submeter diff, testes e auditoria à Direção **antes** de push/merge/deploy. Fazer rollout controlado e compatível com a migração B1 existente; adicionar classe B3 sem renomear/remover classes antigas. Testar primeiro release inerte, health e políticas, ainda sem OAuth. Só após autorização separada conectar conta e validar vendedor/leituras mínimas. Não ativar escrita comercial.
7. Antes de tráfego real, definir alertas sem bodies/queries/tokens/PII, limites, quotas Free e critérios de rollback. Não habilitar logging automático do callback com query sensível. Auditar observabilidade e logs da borda/IdP além do código, pois não foram inspecionados nesta fase.

## Reversão proposta para B2

Gatilhos: falha de autenticação/MFA, acesso cruzado, vendedor divergente, escrita inesperada, exposição de segredo, erros/quotas ou refresh ambíguo.

1. Interromper novos fluxos e tráfego B3 na borda; colocar serviço em modo inerte. Preservar evidências mínimas sem tokens. Se necessário revogar concessão no provedor por procedimento oficial autorizado.
2. Retornar a versão publicada do Worker `conduz-cobre-ml-api` para `5429aed8-11a4-40da-97ad-b54086b6dbe9`, **somente após confirmar sua disponibilidade e compatibilidade com migrações/bindings**. Não foram executados comandos de rollback e não foi garantido que reverter versão restaura configurações, secrets ou dados.
3. Conferir callback e `/internal/health`: HTTPS, 503, `PRODUCTION_DISABLED`. Confirmar OAuth inativo, nenhum tráfego Mercado Livre e proteção dos segredos. Ajustar Access para não impedir a verificação inerte prevista, por mudança aprovada.
4. Cofre B3 separado não é lido pela B2. Não apagar classes/tabelas, não reverter migrações SQLite destrutivamente e não copiar tokens para B0/B1. Quarentenar cofre/chaves B3; aplicar revogação e retenção aprovadas. Rollback de código **não revoga tokens** nem desfaz alterações de IdP/Access.
5. Se a versão B2 não estiver disponível ou não aceitar o estado das migrações, manter serviço inerte e obter artefato validado/revisão da Direção; não improvisar reconstrução como se fosse a versão original.
