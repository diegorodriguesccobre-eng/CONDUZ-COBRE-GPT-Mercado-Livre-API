# B4 M1 — composição local de homologação fictícia

Base publicada: 5f06c69dc3ace96419f4e78a9675d257cc12b45a.
Somente laboratório local. Não é configuração de implantação nem evidência de MFA, quorum,
independência do guardião ou recuperação de produção. Nenhuma conexão Mercado Livre/ChatGPT.

## Composição

O novo entrypoint homologation/worker.ts exporta somente fetch pelo export default.
Ele recebe sete bindings fechados: HML_MODE, HML_JWKS, HML_MATERIAL e os quatro serviços
HML_IDENTITY, HML_REGISTRY, HML_REFERENCE, HML_VAULTS. O modo obrigatório é
B4_M1_FICTIONAL_LOCAL_ONLY. As chaves públicas são locais, e o material de conta precisa
obedecer ao formato SYNTHETIC já aprovado. Binding extra, chave privada no JWKS ou
material fora desse perfil bloqueia a composição.

ports.ts declara capacidades de leitura explícitas. composition.ts converte essas capacidades
para as interfaces consumidas por integratedFetch, que permanece inalterado.
São reutilizados o registrador das três ferramentas, identidade JWT, comandos vinculados,
guardião, cofres, classificação QUERY, limites, buffering e revalidação final.
Não há uma segunda implementação dessas decisões de segurança.

A resolução de conta continua interna e fechada. A porta de registro deve retornar exatamente
o binding validado pela B4, inclusive vendedor, cofre, keyId, ambiente e revisão.
Nenhum parâmetro MCP/JWT/query/header fornece um namespace, vendedor, chave ou URL.
O facade não exporta nenhuma capacidade connect, refresh, seed, restore, grant ou admin.

O protocolo privado das portas usa service bindings, envelopes fechados e resposta limitada
a 16 KiB. O deadline local cobre cabeçalhos e corpo: um segundo para metadados e três
segundos para cofre e decisão persistente de permissões. O limite curto inicialmente
usado também nas operações SQLite/criptográficas interrompeu uma resposta legítima
de 1.119 ms; os testes preservam esse resultado lento sem convertê-lo em autorização.
O prazo total herdado do comando e todas as revalidações finais continuam inalterados.
Esses limites locais não constituem homologação de latência na infraestrutura real.
Redirects são manuais e respostas 3xx são recusadas. Exceção, envelope inválido, timeout e
indisponibilidade produzem erro constante de dependência; nunca provam read negado.

## Cancelamento e vida útil da Request — M1-03B

Cada chamada mantém sua Request numa coleção privada enquanto a operação correspondente
está ativa. Isso impede que o GC do Node/Undici colete o controlador dependente antes
do abort. O finally propaga o cancelamento com a Request ainda viva e só depois remove
a referência individual, inclusive em erro, timeout e falha de corpo. Nenhuma chamada
limpa referências de outras operações concorrentes; não há retenção permanente ou
registro de JWT, corpos ou materiais criptográficos nessa coleção.

Rejeição, chamada de AbortController.abort, evento no AbortSignal e interrupção física
de IO têm evidências diferentes. Os testes preservam as assertivas originais, forçam GC
em subprocessos isolados e conferem cancelamento HTTP local, ausência de resposta tardia,
coleta após limpeza e liberação em caminhos de sucesso/erro/corpo. Não há retry-until-pass.

O sinal exige cooperação do consumidor. Trabalho remoto já iniciado ou RPC sem API de
cancelamento não pode ser desfeito por Promise.race. Respostas tardias continuam sendo
descartadas; buffering, revogação e autorização final permanecem obrigatórios. Os testes
mantêm uma contraprova não cooperativa, que não é contada como cancelamento efetivo.
Node/Undici e workerd são avaliados separadamente; o GC não controlável do workerd local
não comprova equivalência nem homologação no Cloudflare real. Os limites de 1 s/3 s nas
portas, 5 min em integration e 10 min no job permanecem inalterados.

O fluxo aprovado continua dono de /mcp, apenas em HTTP de loopback 127.0.0.1.
O callback separado /oauth/mercadolivre/callback e /oauth/start não são absorvidos pelo M1.
Os entrypoints antigos e seus bloqueios de produção não são modificados.

## Separação do laboratório

O harness Node inicia uma frente workerd com o novo entrypoint e um backend workerd
privado com o fixture B4 existente. Cada serviço encaminha somente os métodos fechados
de identidade, registro, referência ou leitura de cofre. Nenhuma porta HTTP oferece o driver.
O build público não importa o harness, fixtures ou recovery/storage.ts e exporta somente default.
O backend compilado é artefato privado de teste, nunca candidato a deploy.

Provisionamento, seed, snapshots, faults e pausas pertencem exclusivamente ao driver Node.
Construtores, restart e requisições MCP não os executam automaticamente.
O driver identifica explicitamente sua aprovação administrativa como
LOCAL_SIMULATION_NOT_REAL_MFA_OR_QUORUM. Isso permite testar a composição local,
sem apresentar identidades fictícias como administradores reais em homologação operacional.

Ambos os runtimes negam e contam egress externo. Todos os tokens e chaves são gerados
como material fictício por fixture e não são gravados nos logs de evidência.
O ambiente de laboratório compartilha material fictício entre processos: não demonstra
segregação IAM, custódia operacional nem resistência a comprometimento do runtime.
Dados retornados continuam marcados como sintéticos/não confiáveis; textos não são executados.

O fechamento tenta liberar pausas e fechar clientes, requisições e ambos os Miniflares.
Testes conferem os recursos registrados e as portas fechadas. Nenhuma saída forçada
é usada para transformar processos pendentes em sucesso.

## Execução explícita

Node 24.22.1; dependências e lockfiles da base, sem atualização.

    # Instalação na raiz e depois em prototype/mcp-local:
    npm ci --ignore-scripts
    # A partir do subprojeto:
    node scripts/build-homologation.mjs
    npm exec -- tsc --noEmit -p tsconfig.homologation.json
    node --test tests/homologation.test.mjs
    # M1-02: inventário fechado e execução do grupo CI completo:
    node scripts/ci.mjs verify
    node scripts/ci.mjs run integration
    # Na raiz:
    node scripts/verify-b4-preservation.mjs

Usar arquivo/test runner para Miniflare, não execução do harness via --input-type=module
em stdin. O contexto de subprocessos/loopback deve estar autorizado; sem sudo ou
desativação de sandbox. Builds e estado temporário ficam em work/ ignorado.
Relatórios, logs e manifestos de entrega ficam fora da árvore de publicação.

## Preservação M1-01 e CI

Somente oito adições nominais e quatro modificações publicadas autorizadas no M1/M1-03:
verificador B4, dispatcher scripts/ci.mjs e workflows b3-sqlite.yml e b4-mcp-local.yml.
O M1-03 acrescenta somente o ajuste preventivo de timeout integration ao workflow MCP.
São exigidos 172 caminhos exatos, 160 dos 164 arquivos publicados idênticos,
94/97 históricos idênticos e as três exceções históricas já aprovadas.
O dispatcher e os dois workflows devem corresponder a transformações literais fechadas
da base aprovada; não são exceções genéricas. Os outros arquivos continuam byte a byte.
Hashes de dependências, script B3.1 original e bloqueios de produção continuam protegidos.
Testes exercitam recusas por arquivos ausentes/extras, caminhos incompatíveis, symlinks,
edição dos arquivos publicados e ativação indevida.

O dispatcher local M1-02 inclui nominalmente homologation.test.mjs no grupo integration,
mantendo os sete grupos e todos os comandos anteriores. Executa depois da integração
original o typecheck tsconfig.homologation.json e a suíte M1 em comando separado.
O inventário continua recursivo e comparado a uma lista fechada: arquivo novo não é
automaticamente aceito. Remoção do typecheck ou substituição da execução M1 por no-op
é rejeitada explicitamente. Alteração do próprio dispatcher fora da transformação
autorizada é rejeitada pelo preservador B4.

No SQLite, a seleção B4 usa ref, base_ref ou head_ref exatamente iguais à branch B4.
Isso cobre push B4, PR com destino B4 e PR B4 para main. Push main e PR comum para main
mantêm o verificador B3 original. Nenhum nome de branch é interpolado em comandos shell;
a expressão fornece somente um booleano ao bloco if existente.

No workflow b4-mcp-local.yml, somente o grupo integration passa de três para cinco minutos.
Recovery continua com cinco e os demais grupos com três. O job geral continua com dez
minutos, deixando cinco para preparação se integration consumir todo o seu limite.
Os limites de cada etapa são tetos individuais, não reservas nem garantia de tempo total.
Permissões, testes, parâmetros, auditorias, actions e demais limites permanecem intactos.
A aprovação local não é execução no GitHub Actions. O limite atual do grupo integration
é de cinco minutos: medir o grupo completo e interromper diante de estouro, sem reduzir
testes ou aumentar timeout automaticamente. Publicação e abertura do PR exigem autorização.
PR para revisão não autoriza merge; o comportamento de push main permanece B3 e qualquer
futura incorporação da B4 à main requer decisão separada sobre os gates de preservação.

## Plano técnico M2, não executado

Antes de qualquer configuração remota: aprovar domínio/Worker/DOs descartáveis próprios,
Access/Managed OAuth, issuer/audience/JWKS, políticas e proteção contra bypass de previews
e workers.dev; cadastrar identidades e papéis reais com MFA e quorum exigidos.
A referência independente, PITR, custódia, recuperação e uso de dados reais continuam
bloqueadores separados. W do laboratório não é uma referência independente.

A transição exige substituir os adaptadores privados por capacidades operacionais
autenticadas sem implantar o backend fixture ou reutilizar seus métodos administrativos.
Realizar primeiro revisão nominal dos bindings, egress, rotas e evidências requeridas.
Não mudar dependências, contratos ou políticas sem autorização.
OAuth Mercado Livre, conexão ChatGPT, implantação e M2–M5 não estão autorizados pelo M1.
