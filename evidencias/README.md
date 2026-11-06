# CONDUZ COBRE — I2-ID-FIX

**PASSA para a correção local e sintética. Sem publicação da implementação.**

Base: `b3df5def93688d9d68fad39a9a61e96b5c4ba437`.
Runtime: Node.js 24.22.1; somente dependências já instaladas.

A fixture usa `ref = I2_BASE` por padrão, conserva refs históricas explícitas e parte do inventário imutável de 178 arquivos. Os dez caminhos atuais são copiados, e o diff preparado é comparado à mesma base. A nova regressão executa os três testes originais de um candidato já commitado em repositório descartável e impede recursão por filtro exato. Nenhuma assertiva foi removida.

## Resultados

| Execução | Principais | Duração total | Saída |
| --- | --- | --- | --- |
| directed-historical-base | 3/3 | 6.850 s | 0 |
| directed-uncommitted | 4/4 | 13.149 s | 0 |
| directed-committed | 4/4 | 10.669 s | 0 |
| homologation-local | 245/245 | 133.810 s | 0 |
| homologation-committed | 245/245 | 136.084 s | 0 |

Os cenários I2 dirigidos também executam o filho da regressão 3/3. A base histórica conserva seus três testes existentes. A contagem principal completa aumentou exatamente de 244 para 245 por um novo test(). As contagens de filhos são separadas; não somar os resultados ao total principal.

| Filho | Homologação local | Duração | Homologação commitada | Duração |
| --- | --- | --- | --- | --- |
| lab/tests/boundaries.node.mjs | 62/62 | 2.225 s | 62/62 | 2.046 s |
| ../../tests/b4/m21-preservation.node.mjs | 54/54 | 1.903 s | 54/54 | 1.771 s |
| lab/tests/i2-identity.node.mjs | 11/11 | 17.507 s | 11/11 | 18.760 s |
| Regressão de candidato commitado | 3/3 | 5.563 s | 3/3 | 5.347 s |

Todas as execuções: zero falhas, cancelamentos, skips, todo e timeout. Uma tentativa por execução. Limite de grupo 300 segundos mantido. Limites existentes de subprocessos e fixtures mantidos; nova regressão usa o padrão já existente de teste 45 s e subprocesso 40 s.

O teste da fixture comprova `startingFiles=178`, pai I2_BASE, dez changedPaths iguais aos dez stagedPaths, árvore final correspondente aos bytes atuais de 184 arquivos e seleção real B4-I2. Preserva a seleção histórica B4-I1 e a rejeição CANDIDATE_INVENTORY ao misturar épocas.

## Artefatos e integridade

- `exclusive-fix.patch`: diff exclusivo desta correção, relativo ao patch anterior f4d67645...
- `complete.patch`: patch completo atualizado, relativo à base b3df5def...
- `ten-paths.json`: hashes SHA-256 dos dez caminhos do incremento.
- `inventory-184.json`: inventário fechado dos 184 arquivos e respectivos hashes.
- `final-state.json`: manifesto completo e resultados detalhados, com comandos e diretórios.
- `synthetic-commits.json`: nove commits sintéticos únicos, pais, árvores e procedência.
- `before.json` e `after.json`: HEAD, refs, status, bytes do índice, entradas preparadas, diffs e hashes antes/depois.

SHA-256 do patch completo: `ade5002bf130cb625f7146605e90efcc321377af57085647db4d24aacb41ff98`.
Autohash normalizado I2: `ab7209fc26bfdf1a118b912ee450f4cb1ae3f61b4f48efd216c71e167f7f8b55`.

Diff --check e autohash conferidos. O validador e os hashes históricos da I1 permanecem idênticos. Os outros oito caminhos do incremento I2 não mudaram. Inventário 184; preservação de 174 arquivos da I1 e 94 históricos comprovada pelas suítes.

## Checkouts monitorados

Nesta rodada, HEAD, refs, bytes dos índices, entradas dos índices, staging e status ficaram inalterados em todos os checkouts monitorados. No checkout de desenvolvimento somente os dois arquivos autorizados mudaram no working tree, como previsto; os logs/builds gerados ficam em caminhos ignorados.

O caminho real auxiliar é `/workspace/conduz-i1-handle-fix`. A variação anterior do índice binário de `2e725d09c3bc3fdb371b7693508f4efcbe4f396cdf9767a57ea32cead66ed804` para `4f92618d7cd6587724b3178aa4c46764b7b0aa09cc8f32f47f1be29dde7a5e8f`, sem alteração do conteúdo preparado, permanece preservada nos arquivos `diagnostic-*`. A causa segue indeterminada. O índice atual permaneceu no segundo hash nesta rodada; não foi normalizado ou restaurado.

## Commits sintéticos

Candidato para homologação completa: `be7d83339cc9f502a4e12b83b6e544f7e523fdf2`.
Pai: `b3df5def93688d9d68fad39a9a61e96b5c4ba437`.
Árvore: `f5d1dc12a8c87876b2a832d702f01350dcb98302`.
Snapshot das fixtures I2: `910f3e6748bd3c1df07406f54ad630372e648567`, mesmo pai e mesma árvore. Metadados e mensagem distintos explicam os SHAs diferentes.

Os demais commits históricos constam de synthetic-commits.json. Seus SHAs são reconstruídos dos argumentos reais de commit-tree registrados pelo Git Trace2 e da identidade/data fixa das fixtures, corroborados por operações Git bem-sucedidas; os snapshots e o candidato também têm confirmação direta em seus relatórios/objetos. Nenhum desses commits foi criado no repositório de desenvolvimento.

## Limites e pendências

Validação local sintética aprovada; nenhuma nova validação remota foi executada. Publicação da implementação, commit de desenvolvimento, push e PR dependem de autorização posterior. Após eventual publicação autorizada será necessária CI remota do novo SHA e conferência da árvore/base efetivamente testadas. Esta entrega não autoriza merge ou avanço de fase.

Não houve alteração da implementação do serviço de identidade, instalação, atualização de dependências, edição de workflows/dispatcher, deploy, conexões com Cloudflare/ChatGPT/Mercado Livre ou gastos.

## Diff exclusivo completo

```diff
--- a/prototype/mcp-local/tests/homologation.test.mjs
+++ b/prototype/mcp-local/tests/homologation.test.mjs
@@ -391,6 +391,7 @@
 
 // Actual Git object graphs, confined to disposable fixtures. No project commit or branch is created.
 const m20RoutingEvidence = [];
+const i2CommittedFixtureEvidence = [];
 const mainBeforeB4 = 'ed36da553b4dbd0c3c5d574e7db0b0d61fb1cd6d';
 const b3Checkpoint = 'a53f7f3af8c0edb0da856916b60706b342d0118a';
 test('M2.0: exact SQLite transformation preserves shell dollar and quote bytes', () => {
@@ -429,14 +430,15 @@
     return run(fixture);
   } finally { rmSync(directory, { recursive: true, force: true }); }
 }
-// Current I1 fixtures keep the verifier belonging to their 178-file tree.
+// Start from the immutable 178-file checkpoint even when the source HEAD is I2.
 // Only this disposable repository may receive a synthetic candidate commit.
-function i1GitFixture(run, { workingTree = false, ref = 'HEAD' } = {}) {
+function i1GitFixture(run, { workingTree = false, ref = I2_BASE } = {}) {
   return gitFixture(fixture => {
     const { git, repo } = fixture;
     assert.equal(git('rev-parse', '--is-shallow-repository'), 'false');
     assert.equal(git('merge-base', '--is-ancestor', I1_BASE, 'HEAD'), '');
-    assert.deepEqual(git('ls-files', '-z').split('\0').filter(Boolean).sort(), [...collected.i2Base.keys()].sort());
+    const startingPaths = git('ls-files', '-z').split('\0').filter(Boolean).sort();
+    assert.deepEqual(startingPaths, [...collected.i2Base.keys()].sort());
     if (workingTree) {
       const candidatePaths = Object.freeze([...I2_ADDED, ...I2_MODIFIED]);
       assert.deepEqual([...candidatePaths].sort(), [
@@ -446,6 +448,7 @@
         'prototype/mcp-local/scripts/homologation-harness.mjs', 'prototype/mcp-local/tests/homologation.test.mjs',
         'scripts/verify-b4-preservation.mjs', 'tests/b4/m21-preservation.node.mjs'].sort());
       const parent = git('rev-parse', 'HEAD'), changedPaths = [];
+      assert.equal(parent, I2_BASE);
       for (const path of candidatePaths) {
         const bytes = readFileSync(resolve(root, path));
         const previous = collected.i2Base.get(path);
@@ -453,7 +456,8 @@
         fixtureWrite(repo, path, bytes);
       }
       git('add', '--', ...candidatePaths);
-      assert.deepEqual(git('diff', '--cached', '--name-only').split('\n').filter(Boolean).sort(), changedPaths.sort());
+      const stagedPaths = git('diff', '--cached', '--name-only').split('\n').filter(Boolean).sort();
+      assert.deepEqual(stagedPaths, changedPaths.sort());
       const tree = git('write-tree'), commit = git('commit-tree', tree, '-p', parent, '-m', 'SYNTHETIC I1 WORKING CANDIDATE ONLY');
       git('checkout', '--quiet', '--detach', commit);
       assert.equal(git('rev-parse', 'HEAD^'), parent);
@@ -461,7 +465,8 @@
       assert.equal(git('merge-base', '--is-ancestor', I1_BASE, 'HEAD'), '');
       assert.equal(git('status', '--porcelain'), '');
       for (const path of candidatePaths) assert.deepEqual(readFileSync(resolve(repo, path)), readFileSync(resolve(root, path)));
-      fixture.candidateSnapshot = { parent, commit, tree, copiedPaths: [...candidatePaths], changedPaths, temporaryRepositoryOnly: true };
+      fixture.candidateSnapshot = { parent, commit, tree, startingFiles: startingPaths.length,
+        copiedPaths: [...candidatePaths], changedPaths, stagedPaths, temporaryRepositoryOnly: true };
     }
     return run(fixture);
   }, { ref, install: false });
@@ -587,6 +592,51 @@
   m20RoutingEvidence.push({ name: 'mixed I1 tree and historical verifier', expected: 'CANDIDATE_INVENTORY',
     exit: result.exit, signal: result.signal, noFallback: true, syntheticGitFixture: true });
 }));
+const committedFixtureTest = 'I2 fixture: committed candidate starts from the immutable base and selects its matching verifier';
+test(committedFixtureTest, { timeout: 45000 }, () => i1GitFixture(f => {
+  const sourceHead = f.git('rev-parse', 'HEAD'), sourceTree = f.git('rev-parse', 'HEAD^{tree}');
+  assert.notEqual(sourceHead, I2_BASE);
+  assert.equal(f.git('rev-parse', 'HEAD^'), I2_BASE);
+  assert.equal(f.git('ls-files', '-z').split('\0').filter(Boolean).length, 184);
+  assert.equal(f.candidateSnapshot.startingFiles, 178);
+  assert.deepEqual(f.candidateSnapshot.stagedPaths, [...I2_ADDED, ...I2_MODIFIED].sort());
+  for (const relative of ['node_modules', 'prototype/mcp-local/node_modules']) {
+    const installed = resolve(root, relative), destination = resolve(f.repo, relative);
+    mkdirSync(destination, { recursive: true });
+    for (const entry of readdirSync(installed)) symlinkSync(resolve(installed, entry), resolve(destination, entry));
+  }
+  const pattern = '^(?:M2.0-FIX: full published descendant retains the checkpoint and selects B4|I2 fixture: uncommitted candidate snapshot selects its matching verifier in a temporary descendant|I1 fixture: 178 files mixed with the historical 172-file verifier remain refused)$';
+  assert.equal(new RegExp(pattern).test(committedFixtureTest), false, 'The child must not recurse into this regression');
+  const childEnv = { ...process.env }; delete childEnv.NODE_TEST_CONTEXT;
+  const started = performance.now();
+  const stdout = execFileSync(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern=' + pattern,
+    'tests/homologation.test.mjs'], { cwd: resolve(f.repo, 'prototype/mcp-local'), env: childEnv,
+    stdio: ['ignore', 'pipe', 'pipe'], timeout: 40000, maxBuffer: 16 * 1024 * 1024 }).toString();
+  const directory = resolve(project, 'work/i2-id-fix'); mkdirSync(directory, { recursive: true });
+  writeFileSync(resolve(directory, 'committed-fixture.tap'), stdout);
+  const count = name => {
+    const matches = [...stdout.matchAll(new RegExp('^# ' + name + ' (\\d+)$', 'gm'))];
+    assert.equal(matches.length, 1); return Number(matches[0][1]);
+  };
+  assert.equal(count('tests'), 3); assert.equal(count('pass'), 3);
+  for (const name of ['fail', 'cancelled', 'skipped', 'todo']) assert.equal(count(name), 0);
+  const childEvidence = JSON.parse(readFileSync(resolve(f.repo, 'prototype/mcp-local/work/homologation/test-evidence.json')));
+  const routing = childEvidence.preservationRouting;
+  assert.equal(routing.length, 3);
+  assert.ok(routing.some(row => row.name === 'full published I1 descendant' && row.expected === 'B4-I1' && row.exit === 0));
+  assert.ok(routing.some(row => row.name === 'mixed I1 tree and historical verifier' && row.expected === 'CANDIDATE_INVENTORY' && row.exit === 1 && row.noFallback === true));
+  const current = routing.find(row => row.name === 'I2 working candidate snapshot');
+  assert.equal(current.expected, 'B4-I2'); assert.equal(current.exit, 0);
+  assert.equal(current.candidateSnapshot.parent, I2_BASE);
+  assert.equal(current.candidateSnapshot.startingFiles, 178);
+  assert.deepEqual(current.candidateSnapshot.stagedPaths, [...I2_ADDED, ...I2_MODIFIED].sort());
+  assert.equal(current.candidateSnapshot.tree, sourceTree);
+  assert.equal(f.git('rev-parse', 'HEAD'), sourceHead); assert.equal(f.git('status', '--porcelain'), '');
+  const row = { sourceHead, sourceParent: I2_BASE, sourceTree, sourceFiles: 184,
+    snapshot: current.candidateSnapshot, tests: count('tests'), pass: count('pass'), exit: 0,
+    milliseconds: Math.round(performance.now() - started), recursionExcluded: true };
+  i2CommittedFixtureEvidence.push(row); console.log('I2_ID_FIX_SUITE ' + JSON.stringify(row));
+}, { workingTree: true }));
 test('M2.0: a genuinely shallow clone never falls back', () => gitFixture(f => {
   const sourceHead = execFileSync('git', ['--no-replace-objects', 'rev-parse', 'HEAD'], { cwd: root, stdio: 'pipe' }).toString().trim();
   assert.notEqual(sourceHead, M20_BASE);
@@ -1480,5 +1530,5 @@
 after(() => writeFileSync(resolve(project, 'work/homologation/test-evidence.json'), JSON.stringify({
   syntheticOnly: true, productionReady: false, administrativeMfaProven: false, realQuorumProven: false,
   independentReferenceProven: false, completedScenarios: evidence, portEvidence, ciContexts: ciContextEvidence, cancellationEvidence,
-  preservationRouting: m20RoutingEvidence, i1qCIEvidence, gitBatchEvidence
+  preservationRouting: m20RoutingEvidence, i1qCIEvidence, gitBatchEvidence, i2CommittedFixtureEvidence
 }, null, 2) + '\n'));
--- a/scripts/verify-b4-preservation.mjs
+++ b/scripts/verify-b4-preservation.mjs
@@ -82,7 +82,7 @@
   'scripts/verify-b4-preservation.mjs',
   'tests/b4/m21-preservation.node.mjs'
 ]);
-const I2_VERIFIER_HASH = 'e7f89f6f91a14bdf205d681ef1a638effcf29cc95eb5489730ed5f8b11a830f0';
+const I2_VERIFIER_HASH = 'ab7209fc26bfdf1a118b912ee450f4cb1ae3f61b4f48efd216c71e167f7f8b55';
 const I2_CONTENT = Object.freeze({
   'prototype/mcp-local/i2/identity-worker.ts': 'ee78ad92c1cc7fe7da40f08aea50350400b446990a9140e2b3b1ed7f83a5c8d8',
   'prototype/mcp-local/i2/identity-config.ts': '52b16732e1d7f1f83a09512cd88e4312b3e6bccfed27516fc91caf75376089c2',
@@ -91,7 +91,7 @@
   'prototype/mcp-local/lab/tests/i2-identity.node.mjs': 'cf86aca09dd74baec8c9f710aa69a00706c641955cc5e3512ecc4a29ba32be53',
   'prototype/mcp-local/docs/i2-identity.md': '5b4dcd9457fe24a7c62fa2a90e3193fad6b5a41a1c9afac2f052423e4496a126',
   'prototype/mcp-local/scripts/homologation-harness.mjs': '4bc4b1574c713643e35cbaab74ac525de540fa086e425c231f54876d72a5a708',
-  'prototype/mcp-local/tests/homologation.test.mjs': 'edf6948e3f6c3ad7edd4ba9becf956a0f1266d5bbd00a56eaf0c86761db8d5b1',
+  'prototype/mcp-local/tests/homologation.test.mjs': 'f7c79ca493c93c246d1762110565e7308af677be81ccbed03be07ae01d2e5ac6',
   'tests/b4/m21-preservation.node.mjs': 'b6cb5883f23373723c496a2edb7320cf9ab894683e8470582dde379934121d9d',
 });
 export const M20_MODIFIED = Object.freeze(['.github/workflows/b3-sqlite.yml',
```
