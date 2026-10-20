# Execução B0

Apenas CONDUZ COBRE, ambiente b0-local. Sem credenciais de provedor, sem recursos externos e sem escrita comercial.
O README contém os comandos de instalação, teste, bundle, inicialização e smoke HTTP.

## Rotas implementadas

Todas exigem Authorization: Bearer com a chave interna local, incluindo health e callback.

| Método | Rota | Comportamento |
| --- | --- | --- |
| GET | /internal/health | Estado do Worker e transporte sintético |
| POST | /internal/oauth/start | Cria state e código simulados e devolve caminho de callback sintético |
| GET | /internal/oauth/callback?state=…&code=… | Consome state, verifica PKCE e vendedor antes de cifrar tokens |
| GET | /internal/account | Identidade sintética autorizada |
| GET | /internal/listings?limit=1&cursor=… | Anúncios ativos próprios, com cursor cifrado |
| GET | /internal/listings/MLB_SYNTH_001 | Detalhe de anúncio sintético autorizado |

B0 usa um operador interno e um vendedor fixo: SELLER_CONDUZ_SYNTHETIC. Nenhum ID de conta real é aceito.
Limite de 30 chamadas ao cofre por operador/minuto, até 20 states pendentes, state/cursor de cinco minutos,
página de até vinte anúncios. Health não acessa o cofre. Anúncios 001 e 002 são ativos; 003 é pausado.
`completeness: complete` significa que a página foi obtida por inteiro, não que todo o catálogo foi carregado.
Os valores de preço e estoque são inventados. Moeda decimal textual, IDs como strings, horários UTC.

O endereço oauth.synthetic.invalid é deliberadamente não resolvível. O cliente de teste usa
synthetic_callback_path com o mesmo Bearer; não deve abrir authorization_url em um navegador.
Origens de navegador são negadas nesta fase; não há sessão web ou Cloudflare Access implementado.
HTTPS, sessão de navegador e callback real pertencem à próxima fase, após aprovação e verificação documental.

O cofre guarda states por hash e payload cifrado, tokens cifrados e contadores de quota. Apenas o binding
interno do Worker acessa o Durable Object; nenhuma rota pública de SQL ou método de inspeção é oferecida.

Renovação acontece com margem de trinta segundos, uma operação em andamento por cofre e exclusão mútua
com reautorização. Antes da troca, grava status refreshing em SQLite. Em falha incerta, deixa esse marcador
e exige reconexão; não reaproveita refresh token após reinício. Em 401, uma renovação e uma repetição da
leitura no máximo. Não há repetição automática em 429/5xx ou na emissão de tokens. O transporte tem prazo
de dez segundos. O provedor sintético é um modelo de teste, não uma implementação das regras oficiais.

## Contratos e ferramentas

Schemas JSON Schema 2020-12 e OpenAPI 3.1 em contracts/v1. `npm run contracts:generate` regenera os arquivos
versionados. `npm run contracts:compile` compila validadores estáticos em .wrangler para os testes, sem eval
no Worker. TypeScript e testes executam essa preparação automaticamente. AJV não integra o bundle da API.

A CI verifica código, contratos, testes, bundle e dependências, sem credenciais de produção ou implantação.
Para auditoria completa local, também executar Gitleaks no histórico e na árvore, conforme docs/security.md.

## Interrupção e limpeza

Encerrar apenas o processo local de Wrangler iniciado pelo operador. Para apagar estado sintético, parar o
servidor e remover apenas .wrangler/state; isso remove também tokens e states locais. Não apagar diretórios
com dados reais. As chaves locais podem ser recriadas removendo apenas a .dev.vars gerada nesta fase.
Não reutilizar chaves B0 em homologação ou produção. Não guardar novos dados em recursos de outras operações.
