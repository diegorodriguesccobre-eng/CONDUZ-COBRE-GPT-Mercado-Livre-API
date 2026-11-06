# CONDUZ COBRE — R1-45: correção local e revisão de preservação

**PASSA LOCAL E SINTÉTICO. Sem publicação ou validação remota deste patch.**

Base obrigatória: `9744bcaee5f999c7dfa907e6c3f9f3f0d31ce044`.
Checkout isolado: `/workspace/conduz-r1-45-fix`, HEAD destacado na base, sem commit de desenvolvimento e sem staging.
Runtime: Node.js 24.22.1 / undici 7.30.1; dependências existentes reutilizadas, sem instalação ou atualização.

## Diagnóstico e correção

A asserção anterior serializava todo o histórico e rejeitava `/eyJ/i`. A expressão não distingue o prefixo de alguns JWTs de uma substring casual de um digest SHA-256/base64url. O mecanismo foi demonstrado deterministicamente pelo caso R1-45-A01:

```text
Entrada fixa SHA-256: SYNTHETIC-R145-DIGEST-3104
Digest legítimo: HXigGTGLKu_OM_j-FMFeYJJLfHwXhv0Gh_lVhvwkAO4
Substring: eYJ
Asserção anterior: rejeita
Asserção corrigida: aceita
```

Não há busca aleatória ou repetição até aprovação nos testes. A prova antiga foi mantida somente dentro da regressão que exige sua falha.

A asserção corrigida verifica uma união fechada de eventos reais da RecoveryReference: registros de estado com evento/sequence/gateRevision/root; decisões allow/deny com evento/account/subject/permission/sequence/root; e deny-fenced sem root. Confere campos exatos, objetos JSON simples, arrays densos, propriedades de dados, enums, identidades sintéticas permitidas, contadores inteiros seguros e digests canônicos de 32 bytes em base64url. Proíbe JWT/JWS completo, chaves/cabeçalhos/e-mail e os canários opacos sintéticos conhecidos. Campos extras e estruturas inesperadas são recusados. Isso é um contrato de asserção do laboratório, não um classificador universal de segredos opacos em produção.

O percurso original do R1-45 permanece setup → read real → revoke real → read denied. Não há filtro ou substituição de eventos: todos os eventos retornados por `h.stores.reference.events()` são inspecionados. Cada recovery completo registrou 11 eventos persistidos, com allow, deny e revocation-fenced presentes. O formato/schema foi confirmado sobre os objetos reais devolvidos pelo armazenamento SQLite do protótipo.

As onze regressões A01–A11 cobrem digest eYJ, formas válidas, JWT assinado determinístico, chaves, autorização, tokens, e-mail/dados comerciais sintéticos, campos extras, tipos/acessores, estruturas inesperadas e valores inválidos. Falhas esperadas devem ser ERR_ASSERTION, não timeout ou exceção arbitrária. Exemplos de chave/HMAC/PEM presentes no teste são exclusivamente canários sintéticos; nenhuma credencial real foi introduzida.

## Manifesto exato e justificativa

Quatro modificações, nenhuma adição ou exclusão; inventário permanece em 184 arquivos.

| Caminho | Justificativa |
| --- | --- |
| prototype/mcp-local/tests/recovery.test.mjs | Corrigir a asserção do R1-45; manter percurso e eventos persistidos; acrescentar onze regressões determinísticas e evidência de auditoria. |
| scripts/verify-b4-preservation.mjs | Acrescentar revisão R145 ancorada na base obrigatória, com quatro caminhos fechados, três pins de conteúdo e autohash próprio; preservar regras, pins e autohashes I1/I2. |
| tests/b4/m21-preservation.node.mjs | Manter os 54 controles I1/I2 sobre seus bytes imutáveis e seu validador; acrescentar nove testes da revisão R145, incluindo mutações nos 180 caminhos protegidos. |
| prototype/mcp-local/tests/homologation.test.mjs | Separar fixtures históricas imutáveis da revisão atual; acrescentar três testes de seleção/mistura/estado commitado; atualizar o filho M2.1 de 54 para os 63 testes efetivamente existentes. |

Nenhum arquivo do runtime foi alterado. Os outros 180 caminhos, dependências, lockfiles, workflows, dispatcher, configurações e contratos MCP permanecem idênticos à base.

| Caminho | SHA-256 final |
| --- | --- |
| `prototype/mcp-local/tests/homologation.test.mjs` | `4c37af6f26eba3af844ac3c60297e93640eadc1b134e2f21d10fb346896c7fbb` |
| `prototype/mcp-local/tests/recovery.test.mjs` | `e29db81536320fb4ab6bd98185e0e1ca3409b4833aefe9e9d45c97371db9528b` |
| `scripts/verify-b4-preservation.mjs` | `e5f781dccbed7171e9fb4b8f0c31e94a3f5e8d2d8f80c021fdf1bca480eabcd3` |
| `tests/b4/m21-preservation.node.mjs` | `84788896776ccae165eede363c20bf1e32982ab556fc0724f46c7b7dd27facda` |

SHA-256 do patch integral: `f5de8e0ff81c58b034202dbc6352b94f4607d1b3e3673de1c9b044a67042e1ef`.
Autohash normalizado R145: `e7b289b55ca4f6c663cdfd12a415fee8af0a91d47f9c00b9010f225ea3aae470`.
Os autohashes históricos I1 (`19df2de8…`) e I2 (`ab7209fc…`), seus pins e a lógica dos validadores permaneceram inalterados. O antigo entrypoint I2 foi nomeado validateI2Snapshot, e o entrypoint atual aplica a nova revisão. A CLI atual não oferece downgrade por argumento ou metadado de branch.

## Resultados observados

Teste dirigido da auditoria: **12/12**, 2,079 s, incluindo o R1-45 real e as onze regressões. Nenhum skip nesse filtro.

| Execução | Aprovados/total | Skips | Tempo total | Tempo do runner de testes |
| --- | --- | --- | --- | --- |
| Preservação M2.1 | 63/63 | 0 | 5.148 s | 5.074 s |
| Preservação B4 existente | 16/16 | 0 | 0.468 s | 0.406 s |
| Seleção dirigida sem commit | 7/7 | 0 | 20.107 s | 20.067 s |
| Seleção dirigida commitada | 7/7 | 0 | 17.710 s | 17.664 s |
| Recovery sem commit | 112/113 | 1 | 81.354 s | 79.713 s |
| Recovery commitado | 112/113 | 1 | 75.857 s | 74.136 s |
| Integration local | 82/82 | 0 | 56.578 s | 54.364 s |
| Homologation sem commit | 248/248 | 0 | 139.862 s | 137.503 s |
| Homologation commitado | 248/248 | 0 | 139.201 s | 136.585 s |


Nos grupos completos o tempo total inclui o typecheck. Todos os runners retornaram saída 0, zero falhas/cancelamentos/todo, sem timeout. Limites existentes preservados, incluindo 300 s por grupo, 30 s por caso R1 e padrões já existentes de 45 s/40 s para regressões de subprocesso. Não houve redução de testes ou aumento de budgets.

**Único skip: R1-78, PITR real.** Recovery conserva os 102 casos existentes (101 PASS + R1-78 pendente) e acrescenta 11 testes, totalizando 113. Preservação M2.1 passou de 54 para 63 por nove novos testes. Homologation passou de 245 para 248 por três novos testes. Nenhuma contagem foi forçada para o valor antigo.

### Filhos das homologações, contabilizados separadamente

| Filho | Sem commit | Duração | Commitado | Duração |
| --- | --- | --- | --- | --- |
| lab/tests/boundaries.node.mjs | 62/62 | 2.051 s | 62/62 | 2.063 s |
| ../../tests/b4/m21-preservation.node.mjs | 63/63 | 4.632 s | 63/63 | 4.310 s |
| lab/tests/i2-identity.node.mjs | 11/11 | 16.862 s | 11/11 | 17.027 s |
| Regressão I2 histórica | 3/3 | 4.795 s | 3/3 | 5.217 s |
| Regressão R145 | 5/5 | 5.703 s | 5/5 | 7.369 s |


Não somar filhos ao total principal ou duplicar os testes por serem executados nos dois estados.

### Correção do coletor externo de contagens

O coletor inicial previa erroneamente 116 testes de recovery, assumindo nove casos Q injetados onde a base contém seis. O runner real terminou com código 0: 113 testes, 112 PASS e o skip R1-78. A cobertura manteve os 102 IDs existentes, e os onze novos nomes A01–A11 constam do log.

O relatório inicial recovery-local-result.json (passed=false por previsão incorreta do coletor), o script inicial e o log original foram preservados. recovery-local-reconciled.json corrige somente a interpretação externa para 113 = 102 + 11. Nenhum código, hash do patch, log do runner ou suíte foi alterado/reexecutado para essa conciliação. A execução independente do estado commitado confirmou a mesma contagem.

## Preservação e controles negativos

A revisão valida primeiro o checkpoint I2 imutável, projeta somente os quatro caminhos autorizados para comprovar as regras históricas, verifica igualdade dos outros 180 caminhos e exige os novos hashes exatos/autohash R145. O inventário permanece fechado em 184. Há 94 históricos idênticos e ativação bloqueada. Contadores históricos I1/I2 descrevem checkpoints/projeções; o número atual de caminhos fora do manifesto preservados é 180.

As fixtures históricas I1/I2 usam bytes por commits imutáveis, nunca os quatro arquivos atuais misturados. A revisão atual parte explicitamente de 9744bca… e compara quatro changedPaths com quatro stagedPaths. Os testes cobrem o estado ainda sem commit e o candidato commitado, sem recursão.

| Controle | Resultado esperado e observado |
| --- | --- |
| Seleção histórica I1 | B4-I1, saída 0 |
| Seleção histórica I2 | B4-I2, saída 0 |
| Seleção atual R145 | B4-R145, saída 0 |
| Verificador I2 antigo + recovery novo | B4_BASE_CHANGED:prototype/mcp-local/tests/recovery.test.mjs, saída 1 |
| Verificador R145 novo + recovery antigo | R145_CONTENT_CHANGED:prototype/mcp-local/tests/recovery.test.mjs, saída 1 |
| Bytes corretos sem ancestralidade do checkpoint R145 | R145_BASE_DIVERGED, saída 1 |
| Byte extra nos quatro caminhos autorizados | R145_CONTENT_CHANGED, rejeição |
| Byte extra em qualquer um dos 180 caminhos fora do manifesto | Rejeição pelas regras históricas ou R145_PUBLISHED_CHANGED |
| Arquivo extra/deletado, checkpoint incompleto, autohash trocado | Rejeição explícita, sem fallback |

## Candidato e commits sintéticos

```text
Commit sintético do candidato: 1db1f9fd45f6913f7a2221a6c344f867937ddce5
Pai:                          9744bcaee5f999c7dfa907e6c3f9f3f0d31ce044
Árvore dos bytes testados:     5885d5765c093b990233d52ab17c1fd635811053
Snapshot das fixtures R145:    ef60d3e8970f0fcfb1a5c2bc3eeaac73d6a7a21f
```

O snapshot das fixtures tem o mesmo pai e árvore, com metadados/mensagem distintos. Os outros commits, incluindo os negativos deliberados, constam de synthetic-commits.json. Alguns SHAs de fixtures já removidas são reconstruídos de argumentos Git Trace2 e identidade/data fixas, com corroboração descrita; o candidato também foi verificado diretamente por cat-file.

Nos relatórios brutos de execuções sem commit, sourceTree registra a árvore do HEAD base (f5d1dc12…), não a working tree alterada. Os hashes dos 184 arquivos, o patch e a fixture commitada vinculam os bytes testados à árvore candidata 5885d576…; final-state.json explicita workingCandidateTree.

## Integridade dos checkouts e organização das evidências

Os seis checkouts anteriores permaneceram idênticos ao registro inicial, inclusive HEAD, referências, bytes dos índices, entradas preparadas, diffs e arquivos. before/after e os índices binários foram preservados. O checkout novo continua com HEAD na base, somente quatro arquivos modificados, sem untracked versionado e sem staging. Não houve normalização dos índices antigos.

O coletor também guardou cópias de artefatos já existentes no diretório work em fases que não os produziram. Esses snapshots são preservados por transparência e classificados em artifact-provenance.json; não são usados como prova de execução de outra fase. Fontes autoritativas: cada log/resultado do grupo efetivamente executado, o relatório de homologation da mesma fase e as evidências de recovery da respectiva execução. Não há reaproveitamento de resultados remotos.

## Navegação

- candidate.patch: diff integral aplicável à base obrigatória.
- four-paths.json / inventory-184.json: hashes dos quatro caminhos e inventário completo.
- final-state.json: comandos, resultados, contagens, tempos, contexto de HEAD e árvore.
- directed-audit.log / directed-persisted-audit.json / digest-proof.json: asserção, prova determinística e eventos reais.
- recovery-local.log / recovery-committed.log e respectivos arquivos work-recovery-*: runners completos, cobertura e auditoria.
- homologation-local.log / homologation-committed.log e respectivos homologation-test-evidence.json: runners e seleção de épocas.
- preservation.log / legacy-preservation.log / final-preservation.json: controles de preservação.
- previous-checkouts-before.json / previous-checkouts-after.json: preservação dos checkouts anteriores.
- SHA256.json: hashes dos artefatos do pacote.

## Alcance e pendências

Entrega exclusivamente local e revisável. Nenhum commit de desenvolvimento, push, PR, merge, reexecução de CI remoto, revert, deploy, mudança de dependência/workflow/permissão, serviço real ou gasto foi executado.

A prova demonstra o mecanismo do falso positivo do R1-45 e a correção de sua asserção no laboratório. Não constitui auditoria universal de qualquer segredo opaco nem homologação de produção. PITR real permanece pendente. Observabilidade privada e a causa da intermitência operacional histórica continuam separadas e inconclusivas; esta correção não as resolve.

Pendentes: revisão independente do patch e decisão expressa sobre qualquer publicação futura e sua validação remota. Não iniciar automaticamente outra fase.

## Diff integral

```diff
diff --git a/prototype/mcp-local/tests/homologation.test.mjs b/prototype/mcp-local/tests/homologation.test.mjs
index 5746258011de458c77e5d557d7b580b8e7e8df75..67d6bb4859bb12981a33dd1571a7cbc0a9832d6c 100644
--- a/prototype/mcp-local/tests/homologation.test.mjs
+++ b/prototype/mcp-local/tests/homologation.test.mjs
@@ -5,7 +5,9 @@ import { createHash } from 'node:crypto';
 import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, renameSync, readdirSync } from 'node:fs';
 import { resolve, dirname } from 'node:path';
 import { fileURLToPath, pathToFileURL } from 'node:url';
-import { collectSnapshot, readGitSnapshots, validateSnapshot, expectedSQLiteWorkflow, expectedCIDispatcher, M1_ADDED, M1_MODIFIED, M1_BASE, B31, B4, M20_BASE, M20_MODIFIED, I1_BASE, I1_CI_PATHS, I2_BASE, I2_ADDED, I2_MODIFIED } from '../../../scripts/verify-b4-preservation.mjs';
+import { collectSnapshot, readGitSnapshots, validateI2Snapshot as validateSnapshot, validateSnapshot as validateCurrentSnapshot,
+  expectedSQLiteWorkflow, expectedCIDispatcher, M1_ADDED, M1_MODIFIED, M1_BASE, B31, B4, M20_BASE, M20_MODIFIED,
+  I1_BASE, I1_CI_PATHS, I2_BASE, I2_ADDED, I2_MODIFIED, R145_BASE, R145_MODIFIED } from '../../../scripts/verify-b4-preservation.mjs';
 import { verifyInventory, suites } from '../scripts/ci.mjs';
 
 const project = fileURLToPath(new URL('..', import.meta.url));
@@ -23,7 +25,8 @@ const paths = [
 const collected = collectSnapshot(root);
 // Memory-only candidates let the verifier be checked before M1 implementation starts.
 const complete = () => {
-  const current = new Map(collected.current);
+  // Historical memory controls keep the I2 checkpoint and its unchanged validator.
+  const current = new Map(collected.r145Base);
   for (const p of paths) if (!current.has(p)) current.set(p, Buffer.from('MEMORY_ONLY_NEW_M1_PATH'));
   return { ...collected, current, m1Base: new Map(collected.m1Base), m20Base: new Map(collected.m20Base) };
 };
@@ -392,6 +395,7 @@ test('M1-02: actual SQLite shell preserves B3 selection on the unchanged histori
 // Actual Git object graphs, confined to disposable fixtures. No project commit or branch is created.
 const m20RoutingEvidence = [];
 const i2CommittedFixtureEvidence = [];
+const r145CommittedFixtureEvidence = [];
 const mainBeforeB4 = 'ed36da553b4dbd0c3c5d574e7db0b0d61fb1cd6d';
 const b3Checkpoint = 'a53f7f3af8c0edb0da856916b60706b342d0118a';
 test('M2.0: exact SQLite transformation preserves shell dollar and quote bytes', () => {
@@ -450,7 +454,7 @@ function i1GitFixture(run, { workingTree = false, ref = I2_BASE } = {}) {
       const parent = git('rev-parse', 'HEAD'), changedPaths = [];
       assert.equal(parent, I2_BASE);
       for (const path of candidatePaths) {
-        const bytes = readFileSync(resolve(root, path));
+        const bytes = collected.r145Base.get(path); // Immutable I2 epoch, never mixed with current R145 bytes.
         const previous = collected.i2Base.get(path);
         if (previous === undefined || !bytes.equals(previous)) changedPaths.push(path);
         fixtureWrite(repo, path, bytes);
@@ -464,9 +468,9 @@ function i1GitFixture(run, { workingTree = false, ref = I2_BASE } = {}) {
       assert.equal(git('rev-parse', 'HEAD^{tree}'), tree);
       assert.equal(git('merge-base', '--is-ancestor', I1_BASE, 'HEAD'), '');
       assert.equal(git('status', '--porcelain'), '');
-      for (const path of candidatePaths) assert.deepEqual(readFileSync(resolve(repo, path)), readFileSync(resolve(root, path)));
+      for (const path of candidatePaths) assert.deepEqual(readFileSync(resolve(repo, path)), collected.r145Base.get(path));
       fixture.candidateSnapshot = { parent, commit, tree, startingFiles: startingPaths.length,
-        copiedPaths: [...candidatePaths], changedPaths, stagedPaths, temporaryRepositoryOnly: true };
+        copiedPaths: [...candidatePaths], changedPaths, stagedPaths, historicalSource: R145_BASE, temporaryRepositoryOnly: true };
     }
     return run(fixture);
   }, { ref, install: false });
@@ -480,6 +484,33 @@ function selection(repo, extraEnv = {}) {
     return { exit: error.status, signal: error.signal, stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? '') };
   }
 }
+function r145GitFixture(run) {
+  return gitFixture(f => {
+    const { git, repo } = f, parent = git('rev-parse', 'HEAD');
+    assert.equal(parent, R145_BASE);
+    const startingPaths = git('ls-files', '-z').split('\0').filter(Boolean).sort();
+    assert.deepEqual(startingPaths, [...collected.r145Base.keys()].sort()); assert.equal(startingPaths.length, 184);
+    assert.deepEqual(R145_MODIFIED, ['prototype/mcp-local/tests/recovery.test.mjs', 'scripts/verify-b4-preservation.mjs',
+      'tests/b4/m21-preservation.node.mjs', 'prototype/mcp-local/tests/homologation.test.mjs']);
+    const changedPaths = [];
+    for (const path of R145_MODIFIED) {
+      const bytes = readFileSync(resolve(root, path));
+      if (!bytes.equals(collected.r145Base.get(path))) changedPaths.push(path);
+      fixtureWrite(repo, path, bytes);
+    }
+    git('add', '--', ...R145_MODIFIED);
+    const stagedPaths = git('diff', '--cached', '--name-only').split('\n').filter(Boolean).sort();
+    assert.deepEqual(stagedPaths, changedPaths.sort()); assert.deepEqual(stagedPaths, [...R145_MODIFIED].sort());
+    const tree = git('write-tree'), commit = git('commit-tree', tree, '-p', parent, '-m', 'SYNTHETIC R145 REVISION ONLY');
+    git('checkout', '--quiet', '--detach', commit);
+    assert.equal(git('rev-parse', 'HEAD^'), parent); assert.equal(git('rev-parse', 'HEAD^{tree}'), tree);
+    assert.equal(git('merge-base', '--is-ancestor', R145_BASE, 'HEAD'), ''); assert.equal(git('status', '--porcelain'), '');
+    for (const path of R145_MODIFIED) assert.deepEqual(readFileSync(resolve(repo, path)), readFileSync(resolve(root, path)));
+    f.candidateSnapshot = { parent, commit, tree, startingFiles: startingPaths.length,
+      copiedPaths: [...R145_MODIFIED], changedPaths, stagedPaths, temporaryRepositoryOnly: true };
+    return run(f);
+  }, { ref: R145_BASE, install: false });
+}
 function workflowFailure(result, code) {
   assert.equal(result.exit, 1); assert.equal(result.signal, null);
   assert.match(result.stderr, new RegExp('(?:^|\\n)PRESERVATION_SELECTION_FAILED:' + code + '(?:\\n|$)'));
@@ -497,19 +528,24 @@ function checkedB4Report(report, epoch) {
     assert.equal(report.originalVerifierPreserved, true);
     if (epoch === 'i1-ci') assert.deepEqual(report.i1ciAuthorizedPaths, I1_CI_PATHS);
   } else if (epoch === 'i2') {
+    assert.equal(Object.hasOwn(report, 'r145Base'), false, 'R145 must not masquerade as the historical I2 epoch');
     assert.equal(report.candidateFiles, 184); assert.equal(report.i2Base, I2_BASE);
     assert.equal(report.i2PublishedFiles, 178); assert.equal(report.i2ProtectedFiles, 174);
     assert.equal(report.i2Added, 6); assert.equal(report.originalVerifierPreserved, true);
+  } else if (epoch === 'r145') {
+    assert.equal(report.candidateFiles, 184); assert.equal(report.r145Base, R145_BASE);
+    assert.equal(report.r145PublishedFiles, 184); assert.equal(report.r145ProtectedFiles, 180); assert.equal(report.r145Added, 0);
+    assert.deepEqual(report.r145AuthorizedModifications, R145_MODIFIED); assert.equal(report.originalVerifierPreserved, true);
   } else assert.fail('Unknown preservation epoch');
 }
 function checkedSelection(fixture, name, expected, extraEnv) {
   const r = selection(fixture.repo, extraEnv);
-  if (expected === 'B4' || expected === 'B4-I1' || expected === 'B4-I1-CI' || expected === 'B4-I2' || expected === 'B3') {
+  if (expected === 'B4' || expected === 'B4-I1' || expected === 'B4-I1-CI' || expected === 'B4-I2' || expected === 'B4-R145' || expected === 'B3') {
     assert.equal(r.exit, 0, r.stderr); assert.equal(r.signal, null); const report = JSON.parse(r.stdout);
     if (expected !== 'B3') {
-      const epoch = expected === 'B4' ? 'historical' : expected === 'B4-I1' ? 'i1' : expected === 'B4-I2' ? 'i2' : 'i1-ci';
+      const epoch = expected === 'B4' ? 'historical' : expected === 'B4-I1' ? 'i1' : expected === 'B4-I2' ? 'i2' : expected === 'B4-R145' ? 'r145' : 'i1-ci';
       checkedB4Report(report, epoch);
-      for (const wrong of ['historical','i1','i1-ci','i2'].filter(other => other !== epoch))
+      for (const wrong of ['historical','i1','i1-ci','i2','r145'].filter(other => other !== epoch))
         assert.throws(() => checkedB4Report(report, wrong), { code: 'ERR_ASSERTION' });
     } else {
       assert.equal(report.base, 'f59081e223006f3eb0739d01073ed2eba824687e');
@@ -637,6 +673,77 @@ test(committedFixtureTest, { timeout: 45000 }, () => i1GitFixture(f => {
     milliseconds: Math.round(performance.now() - started), recursionExcluded: true };
   i2CommittedFixtureEvidence.push(row); console.log('I2_ID_FIX_SUITE ' + JSON.stringify(row));
 }, { workingTree: true }));
+const r145WorkingTest = 'R145 fixture: working candidate selects its verifier from the fixed merged checkpoint';
+const r145MixedTest = 'R145 fixture: mixed epochs and missing revision ancestry never select a permissive verifier';
+const r145CommittedTest = 'R145 fixture: committed candidate preserves current and historical selection without recursion';
+test(r145WorkingTest, () => {
+  const current = validateCurrentSnapshot(collected);
+  assert.equal(current.r145Base, R145_BASE); assert.equal(current.r145ProtectedFiles, 180);
+  r145GitFixture(f => {
+    checkedSelection(f, 'R145 working candidate snapshot', 'B4-R145');
+    Object.assign(m20RoutingEvidence.at(-1), { candidateSnapshot: f.candidateSnapshot });
+  });
+});
+test(r145MixedTest, () => r145GitFixture(f => {
+  const verifier = 'scripts/verify-b4-preservation.mjs', recovery = 'prototype/mcp-local/tests/recovery.test.mjs';
+  const refusedEpoch = (name, code) => {
+    const r = selection(f.repo);
+    assert.equal(r.exit, 1); assert.equal(r.signal, null); assert.equal(r.stdout.trim(), '');
+    assert.deepEqual(JSON.parse(r.stderr), { preservation: 'FAILED', code });
+    m20RoutingEvidence.push({ name, expected: code, exit: r.exit, signal: r.signal, noFallback: true, syntheticGitFixture: true });
+  };
+  fixtureWrite(f.repo, verifier, collected.r145Base.get(verifier));
+  refusedEpoch('R145 old verifier mixed with new bytes', 'B4_BASE_CHANGED:' + recovery);
+  fixtureWrite(f.repo, verifier, readFileSync(resolve(root, verifier)));
+  fixtureWrite(f.repo, recovery, collected.r145Base.get(recovery));
+  refusedEpoch('R145 new verifier mixed with old recovery bytes', 'R145_CONTENT_CHANGED:' + recovery);
+  fixtureWrite(f.repo, recovery, readFileSync(resolve(root, recovery)));
+  assert.equal(f.git('status', '--porcelain'), '');
+  const wrong = f.git('commit-tree', f.candidateSnapshot.tree, '-p', I2_BASE, '-m', 'SYNTHETIC R145 WRONG LINEAGE ONLY');
+  f.git('checkout', '--quiet', '--detach', wrong);
+  refusedEpoch('R145 missing revision ancestry', 'R145_BASE_DIVERGED');
+}));
+test(r145CommittedTest, { timeout: 45000 }, () => r145GitFixture(f => {
+  const sourceHead = f.git('rev-parse', 'HEAD'), sourceTree = f.git('rev-parse', 'HEAD^{tree}');
+  assert.equal(f.git('rev-parse', 'HEAD^'), R145_BASE);
+  assert.equal(f.git('ls-files', '-z').split('\0').filter(Boolean).length, 184);
+  for (const relative of ['node_modules', 'prototype/mcp-local/node_modules']) {
+    const installed = resolve(root, relative), destination = resolve(f.repo, relative);
+    mkdirSync(destination, { recursive: true });
+    for (const entry of readdirSync(installed)) symlinkSync(resolve(installed, entry), resolve(destination, entry));
+  }
+  const pattern = '^(?:M2.0-FIX: full published descendant retains the checkpoint and selects B4|I2 fixture: uncommitted candidate snapshot selects its matching verifier in a temporary descendant|I1 fixture: 178 files mixed with the historical 172-file verifier remain refused|'
+    + r145WorkingTest + '|' + r145MixedTest + ')$';
+  assert.equal(new RegExp(pattern).test(r145CommittedTest), false, 'Revision regression must not recurse');
+  const childEnv = { ...process.env }; delete childEnv.NODE_TEST_CONTEXT;
+  const started = performance.now();
+  const stdout = execFileSync(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern=' + pattern,
+    'tests/homologation.test.mjs'], { cwd: resolve(f.repo, 'prototype/mcp-local'), env: childEnv,
+    stdio: ['ignore', 'pipe', 'pipe'], timeout: 40000, maxBuffer: 16 * 1024 * 1024 }).toString();
+  const directory = resolve(project, 'work/r145'); mkdirSync(directory, { recursive: true });
+  writeFileSync(resolve(directory, 'committed-fixture.tap'), stdout);
+  const count = name => {
+    const matches = [...stdout.matchAll(new RegExp('^# ' + name + ' (\\d+)$', 'gm'))];
+    assert.equal(matches.length, 1); return Number(matches[0][1]);
+  };
+  assert.equal(count('tests'), 5); assert.equal(count('pass'), 5);
+  for (const name of ['fail', 'cancelled', 'skipped', 'todo']) assert.equal(count(name), 0);
+  const childEvidence = JSON.parse(readFileSync(resolve(f.repo, 'prototype/mcp-local/work/homologation/test-evidence.json')));
+  const routing = childEvidence.preservationRouting; assert.equal(routing.length, 7);
+  assert.ok(routing.some(row => row.expected === 'B4-I1' && row.exit === 0));
+  assert.ok(routing.some(row => row.expected === 'B4-I2' && row.exit === 0));
+  const current = routing.find(row => row.name === 'R145 working candidate snapshot');
+  assert.equal(current.expected, 'B4-R145'); assert.equal(current.exit, 0);
+  assert.equal(current.candidateSnapshot.parent, R145_BASE); assert.equal(current.candidateSnapshot.startingFiles, 184);
+  assert.deepEqual(current.candidateSnapshot.stagedPaths, [...R145_MODIFIED].sort());
+  assert.equal(current.candidateSnapshot.tree, sourceTree);
+  assert.equal(routing.filter(row => row.name.startsWith('R145 ') && row.noFallback === true && row.exit === 1).length, 3);
+  assert.equal(f.git('rev-parse', 'HEAD'), sourceHead); assert.equal(f.git('status', '--porcelain'), '');
+  const row = { sourceHead, sourceParent: R145_BASE, sourceTree, sourceFiles: 184,
+    snapshot: current.candidateSnapshot, tests: count('tests'), pass: count('pass'), exit: 0,
+    milliseconds: Math.round(performance.now() - started), recursionExcluded: true };
+  r145CommittedFixtureEvidence.push(row); console.log('R145_CI_SUITE ' + JSON.stringify(row));
+}));
 test('M2.0: a genuinely shallow clone never falls back', () => gitFixture(f => {
   const sourceHead = execFileSync('git', ['--no-replace-objects', 'rev-parse', 'HEAD'], { cwd: root, stdio: 'pipe' }).toString().trim();
   assert.notEqual(sourceHead, M20_BASE);
@@ -1509,7 +1616,7 @@ test('M1 public build exports only the handler and excludes private fixtures and
 const i1qCIEvidence = [];
 const i1qSuites = Object.freeze([
   Object.freeze({ file: 'lab/tests/boundaries.node.mjs', expectedTests: 62 }),
-  Object.freeze({ file: '../../tests/b4/m21-preservation.node.mjs', expectedTests: 54 }),
+  Object.freeze({ file: '../../tests/b4/m21-preservation.node.mjs', expectedTests: 63 }),
   Object.freeze({ file: 'lab/tests/i2-identity.node.mjs', expectedTests: 11 })
 ]);
 for (const suite of i1qSuites) test('I1-Q CI runs all tests in ' + suite.file, { timeout: 45000 }, () => {
@@ -1530,5 +1637,5 @@ for (const suite of i1qSuites) test('I1-Q CI runs all tests in ' + suite.file, {
 after(() => writeFileSync(resolve(project, 'work/homologation/test-evidence.json'), JSON.stringify({
   syntheticOnly: true, productionReady: false, administrativeMfaProven: false, realQuorumProven: false,
   independentReferenceProven: false, completedScenarios: evidence, portEvidence, ciContexts: ciContextEvidence, cancellationEvidence,
-  preservationRouting: m20RoutingEvidence, i1qCIEvidence, gitBatchEvidence, i2CommittedFixtureEvidence
+  preservationRouting: m20RoutingEvidence, i1qCIEvidence, gitBatchEvidence, i2CommittedFixtureEvidence, r145CommittedFixtureEvidence
 }, null, 2) + '\n'));
diff --git a/prototype/mcp-local/tests/recovery.test.mjs b/prototype/mcp-local/tests/recovery.test.mjs
index f03f0d5010bb51edf85bbe2061ee17797b271b42..6e21493663ceed25d671bdc36de769fcbdad1103 100644
--- a/prototype/mcp-local/tests/recovery.test.mjs
+++ b/prototype/mcp-local/tests/recovery.test.mjs
@@ -2,7 +2,7 @@ import { it, after } from 'node:test';
 import assert from 'node:assert/strict';
 import { mkdtemp, rm, writeFile, readdir, cp } from 'node:fs/promises';
 import { resolve, join } from 'node:path';
-import { randomUUID } from 'node:crypto';
+import { randomUUID, createHash, createHmac } from 'node:crypto';
 import { createConnection } from 'node:net';
 import { generateKeyPair } from 'jose';
 import { startRecovery, pairA, pairB, subjects, grantFor, approvalPlan, value } from '../scripts/recovery-harness.mjs';
@@ -12,6 +12,7 @@ import { expectSingleCasWinner } from './fixtures/concurrency-assertions.mjs';
 await import('../scripts/build-recovery.mjs');
 const coverage = [];
 const raceEvidence = [];
+const auditEvidence = [];
 async function portClosed(url) {
   await new Promise((resolve, reject) => {
     const socket = createConnection({ host: url.hostname, port: Number(url.port) });
@@ -342,10 +343,119 @@ check(44, 'lost reference history cannot be replaced by old grants', async t =>
   const { h } = await setup(t); await h.stores.reference.fixture({ kind: 'restore', value: { rows: [], events: [] } }); await denied(h);
   await rejects(h.recover(approvalPlan({ state: { seq: 2 }, root: 'old', gateRevision: 1 })), 'CORRUPT_OR_INVALID');
 });
+const auditRecordNames = new Set(['enrollment-simulated', 'hold', 'mutation-fenced', 'revocation-fenced',
+  'mutation-confirmed', 'recovery-started-simulated', 'recovery-completed-simulated']);
+const auditOpaqueCanaries = ['SYNTHETIC_ACCESS_TOKEN_R145', 'SYNTHETIC_KEY_R145', 'SYNTHETIC_COMMERCIAL_R145']
+  .map(value => value.padEnd(43, '0'));
+function assertReferenceAudit(events) {
+  assert.ok(Array.isArray(events)); assert.equal(Object.getPrototypeOf(events), Array.prototype);
+  assert.ok(events.length > 0);
+  assert.deepEqual(Reflect.ownKeys(events), [...Array.from({ length: events.length }, (_, i) => String(i)), 'length']);
+  for (let i = 0; i < events.length; i++) {
+    const entry = Object.getOwnPropertyDescriptor(events, String(i)); assert.ok(entry && Object.hasOwn(entry, 'value'));
+    const event = entry.value;
+    assert.ok(event !== null && typeof event === 'object'); assert.equal(Object.getPrototypeOf(event), Object.prototype);
+    const descriptors = Object.getOwnPropertyDescriptors(event), keys = Reflect.ownKeys(event);
+    assert.ok(keys.every(key => typeof key === 'string'));
+    for (const key of keys) assert.ok(Object.hasOwn(descriptors[key], 'value') && descriptors[key].enumerable);
+    assert.equal(typeof descriptors.event?.value, 'string');
+    const name = descriptors.event.value;
+    const record = auditRecordNames.has(name), decision = name === 'allow' || name === 'deny';
+    assert.ok(record || decision || name === 'deny-fenced', 'Unexpected persisted reference event');
+    const expected = record ? ['event', 'sequence', 'gateRevision', 'root']
+      : decision ? ['event', 'account', 'subject', 'permission', 'sequence', 'root'] : ['event', 'account', 'subject', 'sequence'];
+    assert.deepEqual([...keys].sort(), expected.sort());
+    for (const { value } of Object.values(descriptors)) if (typeof value === 'string') {
+      assert.doesNotMatch(value, /[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/, 'Complete JWT/JWS must never be audited');
+      assert.doesNotMatch(value, /-----BEGIN (?:[A-Z ]+)?PRIVATE KEY-----|(?:^|\s)(?:Authorization\s*:|Bearer\s+|Basic\s+)|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/i);
+      assert.ok(!auditOpaqueCanaries.includes(value), 'Forbidden synthetic opaque material');
+    }
+    assert.ok(Number.isSafeInteger(event.sequence) && event.sequence >= 0 && event.sequence < Number.MAX_SAFE_INTEGER);
+    if (record) assert.ok(Number.isSafeInteger(event.gateRevision) && event.gateRevision > 0 && event.gateRevision < Number.MAX_SAFE_INTEGER);
+    else {
+      assert.ok(['account-a', 'account-b'].includes(event.account)); assert.ok(subjects.includes(event.subject));
+      if (decision) assert.ok(['read', 'connect'].includes(event.permission));
+    }
+    if (record || decision) {
+      assert.equal(typeof event.root, 'string'); assert.match(event.root, /^[A-Za-z0-9_-]{43}$/);
+      const bytes = Buffer.from(event.root, 'base64url'); assert.equal(bytes.length, 32);
+      assert.equal(bytes.toString('base64url'), event.root, 'Digest must use canonical SHA-256/base64url encoding');
+    }
+  }
+}
 check(45, 'audit excludes JWTs, secrets and commercial data', async t => {
   const { h } = await setup(t); await read(h); await h.change('revoke'); await denied(h);
   const events = await h.stores.reference.events(); assert.ok(events.some(e => e.event === 'allow')); assert.ok(events.some(e => e.event === 'revocation-fenced'));
-  const text = JSON.stringify(events); assert.doesNotMatch(text, /eyJ|privateKey|authorization|SYNTHETIC ACCOUNT|price|access_token|refresh_token|@/i);
+  assertReferenceAudit(events);
+  auditEvidence.push({ caseId: 'R1-45', source: 'persisted RecoveryReference.events()', events });
+});
+const auditDigest = createHash('sha256').update('SYNTHETIC-R145-DIGEST-3104').digest('base64url');
+const auditDecision = () => ({ event: 'allow', ...pairA, permission: 'read', sequence: 2, root: auditDigest });
+const auditRefused = events => assert.throws(() => assertReferenceAudit(events), { code: 'ERR_ASSERTION' });
+it('R1-45-A01: a real fixed SHA-256 digest containing eYJ is accepted; the old assertion rejects it', () => {
+  assert.equal(auditDigest, 'HXigGTGLKu_OM_j-FMFeYJJLfHwXhv0Gh_lVhvwkAO4'); assert.ok(auditDigest.includes('eYJ'));
+  const events = [auditDecision()]; assertReferenceAudit(events);
+  assert.throws(() => assert.doesNotMatch(JSON.stringify(events), /eyJ|privateKey|authorization|SYNTHETIC ACCOUNT|price|access_token|refresh_token|@/i), { code: 'ERR_ASSERTION' });
+});
+it('R1-45-A02: every permitted persisted reference event shape and both permissions are accepted', () => {
+  const records = [...auditRecordNames].map(event => ({ event, sequence: 2, gateRevision: 3, root: auditDigest }));
+  for (const event of ['allow', 'deny']) for (const permission of ['read', 'connect'])
+    records.push({ ...auditDecision(), event, ...pairB, permission });
+  records.push({ event: 'deny-fenced', ...pairA, sequence: 2 }); assertReferenceAudit(records);
+});
+it('R1-45-A03: complete deterministic signed JWTs are rejected in every event value', () => {
+  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
+  const payload = Buffer.from(JSON.stringify({ sub: 'synthetic-operator-a', exp: 1800000000 })).toString('base64url');
+  const signed = header + '.' + payload;
+  const jwt = signed + '.' + createHmac('sha256', 'SYNTHETIC-R145-TEST-KEY-NOT-A-CREDENTIAL').update(signed).digest('base64url');
+  for (const key of Object.keys(auditDecision())) auditRefused([{ ...auditDecision(), [key]: jwt }]);
+  auditRefused([{ ...auditDecision(), root: 'Bearer ' + jwt }]);
+});
+it('R1-45-A04: private keys, JWKs and opaque synthetic key material are rejected', () => {
+  for (const root of ['-----BEGIN PRIVATE KEY-----\nSYNTHETIC-R145-KEY\n-----END PRIVATE KEY-----',
+    { kty: 'oct', k: 'SYNTHETIC-R145-KEY' }, new Uint8Array(32), auditOpaqueCanaries[1]])
+    auditRefused([{ ...auditDecision(), root }]);
+});
+it('R1-45-A05: authorization headers and bearer/basic credentials are rejected', () => {
+  for (const root of ['Authorization: Bearer synthetic-r145', 'Bearer synthetic-r145', 'Basic c3ludGhldGljOnIxNDU='])
+    auditRefused([{ ...auditDecision(), root }]);
+});
+it('R1-45-A06: access and refresh tokens cannot hide in fields or a digest-shaped value', () => {
+  assert.equal(Buffer.from(auditOpaqueCanaries[0], 'base64url').toString('base64url'), auditOpaqueCanaries[0]);
+  for (const root of ['synthetic-access-token-r145', 'synthetic-refresh-token-r145', auditOpaqueCanaries[0]])
+    auditRefused([{ ...auditDecision(), root }]);
+  for (const key of ['access_token', 'refresh_token']) auditRefused([{ ...auditDecision(), [key]: 'synthetic-r145' }]);
+});
+it('R1-45-A07: synthetic email and commercial data are rejected', () => {
+  for (const root of ['synthetic-r145@example.invalid', 'SYNTHETIC ACCOUNT A', 'SYNTHETIC COMMERCIAL LISTING R145',
+    { price: 99, seller_id: 'synthetic-seller', title: 'SYNTHETIC LISTING' }, auditOpaqueCanaries[2]])
+    auditRefused([{ ...auditDecision(), root }]);
+});
+it('R1-45-A08: extra fields, including non-enumerable and symbol fields, are rejected', () => {
+  for (const key of ['privateKey', 'authorization', 'price', 'email', 'extra', '__proto__', Symbol('extra')]) {
+    const event = auditDecision(); Object.defineProperty(event, key, { value: 'synthetic-r145', enumerable: true }); auditRefused([event]);
+  }
+  const event = auditDecision(); Object.defineProperty(event, 'hidden', { value: 'synthetic-r145' }); auditRefused([event]);
+});
+it('R1-45-A09: missing fields, invalid types and accessors are rejected without invoking getters', () => {
+  for (const key of Object.keys(auditDecision())) {
+    const missing = auditDecision(); delete missing[key]; auditRefused([missing]);
+    for (const value of [null, true, {}, [], new String('synthetic-r145')]) auditRefused([{ ...auditDecision(), [key]: value }]);
+  }
+  let calls = 0; const event = auditDecision(); Object.defineProperty(event, 'root', { get() { calls++; return auditDigest; }, enumerable: true });
+  auditRefused([event]); assert.equal(calls, 0);
+});
+it('R1-45-A10: unexpected containers, prototypes, nested events and sparse arrays are rejected', () => {
+  for (const value of [null, {}, '[]', [], [null], [[]], [new Date(0)], [Object.create(null)], [[auditDecision()]], new Array(1)]) auditRefused(value);
+  const extra = [auditDecision()]; extra.extra = 'synthetic-r145'; auditRefused(extra);
+  const cycle = auditDecision(); cycle.self = cycle; auditRefused([cycle]);
+});
+it('R1-45-A11: unknown events, identities, permissions, counters and noncanonical digests are rejected', () => {
+  for (const change of [{ event: 'unexpected' }, { account: 'synthetic-seller' }, { subject: auditDigest }, { permission: 'admin' },
+    ...[-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, '2'].map(sequence => ({ sequence })),
+    { root: auditDigest + '=' }, { root: auditDigest.slice(0, -1) + '5' }]) auditRefused([{ ...auditDecision(), ...change }]);
+  for (const gateRevision of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, '1'])
+    auditRefused([{ event: 'hold', sequence: 2, gateRevision, root: auditDigest }]);
 });
 check(46, 'ECONNRESET/timeout/refused never satisfy MCP negative helper', async () => {
   for (const code of ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED']) {
@@ -631,6 +741,7 @@ for (const [index, scenario, race] of [[0, 'R1-22', updateRace], [1, 'R1-65', re
   }
 }
 after(async () => {
+  await writeFile('work/recovery-audit-evidence.json', JSON.stringify({ syntheticOnly: true, persisted: auditEvidence }, null, 2) + '\n');
   await writeFile('work/recovery-concurrency-evidence.json', JSON.stringify(raceEvidence, null, 2) + '\n');
   coverage.sort((a,b) => a.id.localeCompare(b.id));
   await writeFile('work/recovery-coverage.json', JSON.stringify({ syntheticOnly: true, providerHomologated: false, scenarios: coverage }, null, 2) + '\n');
diff --git a/scripts/verify-b4-preservation.mjs b/scripts/verify-b4-preservation.mjs
index 492fbe53ad2dbc4718da950b1fb50978bfe35641..8f1a2c51c0ee8994e8208117f4cc3fc4ac6e3fa7 100644
--- a/scripts/verify-b4-preservation.mjs
+++ b/scripts/verify-b4-preservation.mjs
@@ -94,6 +94,21 @@ const I2_CONTENT = Object.freeze({
   'prototype/mcp-local/tests/homologation.test.mjs': 'f7c79ca493c93c246d1762110565e7308af677be81ccbed03be07ae01d2e5ac6',
   'tests/b4/m21-preservation.node.mjs': 'b6cb5883f23373723c496a2edb7320cf9ab894683e8470582dde379934121d9d',
 });
+// A separate revision authorizes only test/assertion bytes after the published I2 merge.
+// Historical I1/I2 declarations and validators retain their own immutable checkpoints.
+export const R145_BASE = '9744bcaee5f999c7dfa907e6c3f9f3f0d31ce044';
+export const R145_MODIFIED = Object.freeze([
+  'prototype/mcp-local/tests/recovery.test.mjs',
+  'scripts/verify-b4-preservation.mjs',
+  'tests/b4/m21-preservation.node.mjs',
+  'prototype/mcp-local/tests/homologation.test.mjs'
+]);
+const R145_VERIFIER_HASH = 'e7b289b55ca4f6c663cdfd12a415fee8af0a91d47f9c00b9010f225ea3aae470';
+const R145_CONTENT = Object.freeze({
+  'prototype/mcp-local/tests/recovery.test.mjs': 'e29db81536320fb4ab6bd98185e0e1ca3409b4833aefe9e9d45c97371db9528b',
+  'tests/b4/m21-preservation.node.mjs': '84788896776ccae165eede363c20bf1e32982ab556fc0724f46c7b7dd27facda',
+  'prototype/mcp-local/tests/homologation.test.mjs': '4c37af6f26eba3af844ac3c60297e93640eadc1b134e2f21d10fb346896c7fbb'
+});
 export const M20_MODIFIED = Object.freeze(['.github/workflows/b3-sqlite.yml',
   'scripts/verify-b4-preservation.mjs', 'prototype/mcp-local/tests/homologation.test.mjs']);
 export const M1_ADDED = Object.freeze([
@@ -291,7 +306,10 @@ export function collectSnapshot(root = process.cwd()) {
   let i2Ancestor = false;
   try { git(['merge-base','--is-ancestor',I2_BASE,'HEAD']); i2Ancestor = true; } catch { /* No historical downgrade. */ }
   const i2Base = readGitSnapshots(git, [I2_BASE]).get(I2_BASE);
-  return { ancestor, historical, base, current, m1Ancestor, m1Base, m20Ancestor, m20Base, i1Ancestor, i1Base, i2Ancestor, i2Base };
+  let r145Ancestor = false;
+  try { git(['merge-base','--is-ancestor',R145_BASE,'HEAD']); r145Ancestor = true; } catch { /* No revision downgrade. */ }
+  const r145Base = readGitSnapshots(git, [R145_BASE]).get(R145_BASE);
+  return { ancestor, historical, base, current, m1Ancestor, m1Base, m20Ancestor, m20Base, i1Ancestor, i1Base, i2Ancestor, i2Base, r145Ancestor, r145Base };
 }
 function validateI1Snapshot(s) {
   must(s.ancestor,'BASE_DIVERGED'); must(s.historical.size === 97 && s.base.size === 144,'HISTORICAL_INVENTORY');
@@ -366,7 +384,7 @@ function validateI1Snapshot(s) {
     m20Base:M20_BASE,m20PublishedFiles:172,m20ProtectedFiles:m20Identical,m20AuthorizedModifications:M20_MODIFIED,
     i1Base:I1_BASE,i1PublishedFiles:172,i1ProtectedFiles:i1Identical,i1Added:I1_ADDED.length,i1AuthorizedModifications:I1_MODIFIED,i1qAuthorizedPaths:I1Q_PATHS,i1ciAuthorizedPaths:I1_CI_PATHS };
 }
-export function validateSnapshot(s) {
+export function validateI2Snapshot(s) {
   must(s.i2Base instanceof Map && s.i2Base.size === 178, 'I2_BASE_INVENTORY');
   const expected = new Set([...s.i2Base.keys(), ...I2_ADDED]);
   must(s.current.size === 184 && expected.size === 184 && [...expected].every(p => s.current.has(p))
@@ -394,6 +412,35 @@ export function validateSnapshot(s) {
     i2Base: I2_BASE, i2PublishedFiles: 178, i2ProtectedFiles: 174, i2Added: I2_ADDED.length,
     i2AuthorizedModifications: I2_MODIFIED };
 }
+export function validateSnapshot(s) {
+  must(s.r145Ancestor, 'R145_BASE_DIVERGED');
+  must(s.r145Base instanceof Map && s.r145Base.size === 184, 'R145_BASE_INVENTORY');
+  must(s.current.size === 184 && [...s.r145Base.keys()].every(p => s.current.has(p))
+    && [...s.current.keys()].every(p => s.r145Base.has(p)), 'CANDIDATE_INVENTORY');
+  const checkpoint = validateI2Snapshot({ ...s, current: s.r145Base });
+  const projected = new Map(s.current);
+  for (const p of R145_MODIFIED) projected.set(p, s.r145Base.get(p));
+  validateI2Snapshot({ ...s, current: projected });
+  let unchanged = 0;
+  for (const [p, bytes] of s.r145Base) if (!R145_MODIFIED.includes(p)) {
+    must(sameBytes(s.current.get(p), bytes), 'R145_PUBLISHED_CHANGED:' + p); unchanged++;
+  }
+  must(unchanged === 180, 'R145_PUBLISHED_COUNT');
+  must(R145_MODIFIED.length === 4 && new Set(R145_MODIFIED).size === 4
+    && Object.keys(R145_CONTENT).length === 3 && R145_MODIFIED
+      .filter(p => p !== 'scripts/verify-b4-preservation.mjs').every(p => Object.hasOwn(R145_CONTENT, p)), 'R145_CONTENT_INVENTORY');
+  for (const [p, expected] of Object.entries(R145_CONTENT))
+    must(hash(s.current.get(p)) === expected, 'R145_CONTENT_CHANGED:' + p);
+  const bytes = s.current.get('scripts/verify-b4-preservation.mjs'), text = Buffer.from(bytes).toString('utf8');
+  const marker = /^const R145_VERIFIER_HASH = '[a-f0-9]{64}';$/m;
+  const normalized = text.replace(marker, "const R145_VERIFIER_HASH = '" + '0'.repeat(64) + "';");
+  must(sameBytes(Buffer.from(text), bytes) && marker.exec(text)?.[0] === "const R145_VERIFIER_HASH = '" + R145_VERIFIER_HASH + "';"
+    && hash(normalized) === R145_VERIFIER_HASH, 'R145_CONTENT_CHANGED:scripts/verify-b4-preservation.mjs');
+  return { ...checkpoint, candidateFiles: s.current.size,
+    historicalCountersDescribe: 'validated I2 checkpoint and R145 projection; actual unchanged revision files counted separately',
+    r145Base: R145_BASE, r145PublishedFiles: 184, r145ProtectedFiles: unchanged,
+    r145AuthorizedModifications: R145_MODIFIED, r145Added: 0 };
+}
 if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
   try { if(process.argv.length!==2)throw new Error('UNSUPPORTED_ARGUMENTS'); console.log(JSON.stringify(validateSnapshot(collectSnapshot()),null,2)); }
   catch (e) { console.error(JSON.stringify({preservation:'FAILED',code:e instanceof PreservationFailure?e.message:'PRESERVATION_UNVERIFIED'}));process.exitCode=1; }
diff --git a/tests/b4/m21-preservation.node.mjs b/tests/b4/m21-preservation.node.mjs
index eafbba4fbab8d2b01c5ba2e67e588e7d8153fb34..718c0bff95597d0391326fc8fad1bf492e8feadd 100644
--- a/tests/b4/m21-preservation.node.mjs
+++ b/tests/b4/m21-preservation.node.mjs
@@ -5,10 +5,14 @@ import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSyn
 import { createHash } from 'node:crypto';
 import { resolve, dirname } from 'node:path';
 import { fileURLToPath } from 'node:url';
-import { collectSnapshot, validateSnapshot, I1_BASE, I1_ADDED, I1_MODIFIED, I1Q_PATHS, I1_CI_PATHS, I2_BASE, I2_ADDED, I2_MODIFIED } from '../../scripts/verify-b4-preservation.mjs';
+import { collectSnapshot, validateI2Snapshot as validateSnapshot, validateSnapshot as validateCurrentSnapshot,
+  I1_BASE, I1_ADDED, I1_MODIFIED, I1Q_PATHS, I1_CI_PATHS, I2_BASE, I2_ADDED, I2_MODIFIED, R145_BASE, R145_MODIFIED } from '../../scripts/verify-b4-preservation.mjs';
 
 const root = fileURLToPath(new URL('../..', import.meta.url));
-const original = collectSnapshot(root), copy = () => ({ ...original, current: new Map(original.current), i1Base: new Map(original.i1Base) });
+const currentRevision = collectSnapshot(root);
+// Existing I1/I2 cases continue to check the immutable I2 bytes with their original validator.
+const original = { ...currentRevision, current: new Map(currentRevision.r145Base) };
+const copy = () => ({ ...original, current: new Map(original.current), i1Base: new Map(original.i1Base) });
 const sha = bytes => createHash('sha256').update(bytes).digest('hex');
 const added = ['prototype/mcp-local/integration/profile.ts','prototype/mcp-local/integration/identity-core.ts',
   'prototype/mcp-local/homologation/service-client.ts','prototype/mcp-local/lab/tests/boundaries.node.mjs','tests/b4/m21-preservation.node.mjs','prototype/mcp-local/recovery/core.ts'];
@@ -69,7 +73,7 @@ test('I1 base matches the original Git tree independently of the verifier counte
   const changed = [];
   for (const path of paths) {
     const expected = execFileSync('git',['--no-replace-objects','show',I1_BASE+':'+path], { cwd: root });
-    const current = readFileSync(resolve(root,path));
+    const current = original.current.get(path);
     if (!current.equals(expected)) changed.push(path);
   }
   assert.deepEqual(changed.sort(), [...new Set([...modified, ...I2_MODIFIED.filter(p => paths.includes(p))])].sort());
@@ -169,3 +173,82 @@ test('I2 content, ancestry, inventory and its own digest reject unapproved chang
     "const I2_VERIFIER_HASH = '"+'f'.repeat(64)+"';")));
   refused(v,/^I1_CONTENT_CHANGED:scripts\/verify-b4-preservation\.mjs$/);
 });
+
+const revision = () => ({ ...currentRevision, current: new Map(currentRevision.current), r145Base: new Map(currentRevision.r145Base) });
+const revisionRefused = (snapshot, pattern) => assert.throws(() => validateCurrentSnapshot(snapshot), error =>
+  error?.constructor.name === 'PreservationFailure' && pattern.test(error.message));
+test('R145 revision has a fixed 184-file checkpoint and exactly four content-authorized transformations', () => {
+  assert.equal(R145_BASE, '9744bcaee5f999c7dfa907e6c3f9f3f0d31ce044');
+  assert.deepEqual(R145_MODIFIED, ['prototype/mcp-local/tests/recovery.test.mjs', 'scripts/verify-b4-preservation.mjs',
+    'tests/b4/m21-preservation.node.mjs', 'prototype/mcp-local/tests/homologation.test.mjs']);
+  assert.ok(Object.isFrozen(R145_MODIFIED));
+  const r = validateCurrentSnapshot(revision());
+  assert.equal(r.r145Base, R145_BASE); assert.equal(r.candidateFiles, 184); assert.equal(r.r145PublishedFiles, 184);
+  assert.equal(r.r145ProtectedFiles, 180); assert.equal(r.r145Added, 0); assert.equal(r.byteIdentical, 94);
+  assert.equal(r.activationBlocked, true); assert.equal(r.originalVerifierPreserved, true);
+});
+test('R145 exact hashes reject an extra byte and a missing file in every authorized path', () => {
+  for (const path of R145_MODIFIED) {
+    const s = revision(); s.current.set(path, Buffer.concat([s.current.get(path), Buffer.from('\n')]));
+    revisionRefused(s, new RegExp('^R145_CONTENT_CHANGED:' + path.replaceAll('.', '\\.') + '$'));
+    const missing = revision(); missing.current.delete(path); revisionRefused(missing, /^CANDIDATE_INVENTORY$/);
+  }
+});
+test('R145 all 180 paths outside the manifest remain byte identical and reject mutation', () => {
+  let count = 0;
+  for (const [path, bytes] of currentRevision.r145Base) if (!R145_MODIFIED.includes(path)) {
+    assert.deepEqual(currentRevision.current.get(path), bytes);
+    const s = revision(); s.current.set(path, Buffer.concat([bytes, Buffer.from('\n')]));
+    revisionRefused(s, /^(?:HISTORICAL_CHANGED:|B4_BASE_CHANGED:|APPROVED_DEPENDENCY_CHANGED:|SQLITE_CHANGE_NOT_ALLOWED$|CI_CHANGE_NOT_ALLOWED$|MCP_WORKFLOW_CHANGE_NOT_ALLOWED$|M1_PUBLISHED_CHANGED:|M20_PUBLISHED_CHANGED:|I1_PUBLISHED_CHANGED:|I1_CONTENT_CHANGED:|I2_CONTENT_CHANGED:|R145_PUBLISHED_CHANGED:)/);
+    count++;
+  }
+  assert.equal(count, 180);
+});
+test('R145 retains I1/I2 content pins, self-hash declarations and the complete I2 validator body', () => {
+  const path = 'scripts/verify-b4-preservation.mjs', baseline = currentRevision.r145Base.get(path).toString();
+  const current = currentRevision.current.get(path).toString();
+  for (const pattern of [/^const I1_VERIFIER_HASH = '[a-f0-9]{64}';$/m, /^const I2_VERIFIER_HASH = '[a-f0-9]{64}';$/m,
+    /const I1_CONTENT = Object.freeze\(\{[\s\S]*?\}\);/, /const I2_CONTENT = Object.freeze\(\{[\s\S]*?\}\);/])
+    assert.equal(current.match(pattern)?.[0], baseline.match(pattern)?.[0]);
+  const legacy = baseline.slice(baseline.indexOf('export function validateSnapshot(s) {'),
+    baseline.indexOf('if (process.argv[1] && resolve(process.argv[1])'))
+    .replace('export function validateSnapshot(s) {', 'export function validateI2Snapshot(s) {');
+  assert.ok(current.includes(legacy), 'The I2 validator logic must remain unchanged');
+  assert.equal(validateSnapshot(copy()).candidateFiles, 184);
+});
+test('R145 independent Git oracle proves the checkpoint and exactly four changed paths', () => {
+  const paths = execFileSync('git', ['--no-replace-objects', 'ls-tree', '-r', '--name-only', '-z', R145_BASE], { cwd: root })
+    .toString().split('\0').filter(Boolean); assert.equal(paths.length, 184);
+  const changed = [];
+  for (const path of paths) {
+    const bytes = execFileSync('git', ['--no-replace-objects', 'show', R145_BASE + ':' + path], { cwd: root });
+    assert.deepEqual(bytes, currentRevision.r145Base.get(path));
+    if (!bytes.equals(readFileSync(resolve(root, path)))) changed.push(path);
+  }
+  assert.deepEqual(changed.sort(), [...R145_MODIFIED].sort());
+});
+test('R145 ancestry and baseline inventory cannot be replaced by metadata or a caller hint', () => {
+  revisionRefused({ ...revision(), r145Ancestor: false, branch: 'main', B4_PRESERVATION: true }, /^R145_BASE_DIVERGED$/);
+  const s = revision(); s.r145Base.delete('src/b3/adapter.ts'); revisionRefused(s, /^R145_BASE_INVENTORY$/);
+});
+test('R145 mixed epochs reject old bytes under the new verifier and new bytes under I2 rules', () => {
+  for (const path of R145_MODIFIED) {
+    const s = revision(); s.current.set(path, currentRevision.r145Base.get(path));
+    revisionRefused(s, /^R145_CONTENT_CHANGED:/);
+  }
+  refused(revision(), /^B4_BASE_CHANGED:prototype\/mcp-local\/tests\/recovery\.test\.mjs$/);
+  const old = { ...revision(), current: new Map(currentRevision.r145Base) };
+  revisionRefused(old, /^R145_CONTENT_CHANGED:/);
+});
+test('R145 normalized self-hash cannot authorize replacing its own declared digest', () => {
+  const s = revision(), path = 'scripts/verify-b4-preservation.mjs';
+  s.current.set(path, Buffer.from(s.current.get(path).toString().replace(/^const R145_VERIFIER_HASH = '[a-f0-9]{64}';$/m,
+    "const R145_VERIFIER_HASH = '" + 'f'.repeat(64) + "';")));
+  revisionRefused(s, /^R145_CONTENT_CHANGED:scripts\/verify-b4-preservation\.mjs$/);
+});
+test('R145 no extra publication path, deletion or replacement of the immutable checkpoint is enrolled', () => {
+  const extra = revision(); extra.current.set('private-evidence.zip', Buffer.from('UNAPPROVED')); revisionRefused(extra, /^CANDIDATE_INVENTORY$/);
+  const missing = revision(); missing.current.delete('src/b3/adapter.ts'); revisionRefused(missing, /^CANDIDATE_INVENTORY$/);
+  const checkpoint = revision(); checkpoint.r145Base.set('prototype/mcp-local/tests/recovery.test.mjs', Buffer.from('UNAPPROVED'));
+  revisionRefused(checkpoint, /^B4_BASE_CHANGED:prototype\/mcp-local\/tests\/recovery\.test\.mjs$/);
+});
```
