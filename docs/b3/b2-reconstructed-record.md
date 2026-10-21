# B2 — registro reconstruído em 21/10/2026

Este é um registro novo, reconstruído exclusivamente das confirmações da Direção na retomada e na autorização B3. A documentação local anterior B2 **não foi recuperada**. Este arquivo não é o original, nem evidência de nova consulta ao painel ou ao Worker.

| Campo | Evidência informada pela Direção |
| --- | --- |
| Worker | `conduz-cobre-ml-api` |
| Plano | Cloudflare Workers Free |
| URL | https://conduz-cobre-ml-api.conduz-cobre.workers.dev |
| Versão publicada | `5429aed8-11a4-40da-97ad-b54086b6dbe9` |
| Callback | https://conduz-cobre-ml-api.conduz-cobre.workers.dev/oauth/mercadolivre/callback |
| Callback e `/internal/health` | HTTP 503, `PRODUCTION_DISABLED` |
| HTTPS | Funcionando |
| OAuth e conta Mercado Livre | Nenhuma conexão real; OAuth não ativado |
| Main | B0 preservada; nenhum merge |
| Credencial administrativa Cloudflare temporária | Revogada |

Constatação local separada: a referência `b2/predeploy-inert-review` aponta para o mesmo commit B1 `f59081e223006f3eb0739d01073ed2eba824687e`; não contém documentação B2 adicional. Não foi demonstrada correspondência criptográfica entre esse commit e o bundle efetivamente publicado. Não foram recuperados artefato de implantação, logs, bindings efetivos ou comprovante da configuração remota.

Na B3, `wrangler.production.jsonc`, entrypoint B1, DO B1, todos os fontes e demais arquivos versionados B0/B1 são preservados byte a byte. Testes locais confirmam 503 com `PRODUCTION_DISABLED`; nenhuma chamada remota ao Worker foi realizada. A preservação remota decorre da ausência de deploy ou alteração externa nesta sessão; o estado remoto não foi novamente inspecionado.
