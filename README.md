# CONDUZ COBRE — I2-ID-FIX: evidências para supervisão

**PASSA LOCAL E SINTÉTICO. A validação remota da implementação permanece pendente.**

Esta branch publica exclusivamente documentos, patches e evidências. O patch não foi aplicado à main; a implementação continua sem commit no checkout de desenvolvimento. Os commits identificados nos testes são sintéticos e pertencem somente a repositórios temporários descartáveis. Nenhum PR de incorporação foi aberto.

- Base da implementação: `b3df5def93688d9d68fad39a9a61e96b5c4ba437`.
- Árvore candidata validada localmente: `f5d1dc12a8c87876b2a832d702f01350dcb98302`.
- Candidato sintético da homologação: `be7d83339cc9f502a4e12b83b6e544f7e523fdf2`, filho direto da base.
- Snapshot das fixtures I2: `910f3e6748bd3c1df07406f54ad630372e648567`, com o mesmo pai e árvore.
- Inventário: 184 arquivos; 174 arquivos da I1 preservados e 94 históricos idênticos.
- [Entrega anterior preservada, commit 69cc29c3…](https://github.com/diegorodriguesccobre-eng/CONDUZ-COBRE-GPT-Mercado-Livre-API/tree/69cc29c3cecbd9d6cfd6409c2b36c270275740d1).

## Resultado das validações já executadas

Nenhum teste foi repetido para publicar estas evidências.

| Execução | Resultado principal | Duração total |
| --- | --- | --- |
| Dirigidos — base histórica imutável | 3/3 | 6,850 s |
| Dirigidos — I2 sem commit | 4/4 | 13,149 s |
| Dirigidos — I2 commitada temporariamente | 4/4 | 10,669 s |
| Homologação completa local | 245/245 | 133,810 s |
| Homologação completa do candidato commitado | 245/245 | 136,084 s |

| Filho | Local | Commitado |
| --- | --- | --- |
| Fronteiras | 62/62 | 62/62 |
| Preservação | 54/54 | 54/54 |
| Identidade I2 | 11/11 | 11/11 |
| Subprocesso da nova regressão | 3/3 | 3/3 |

As contagens dos filhos são separadas. O total principal passou de 244 para 245 por exatamente um novo teste de regressão. Os typechecks do grupo passaram. Uma tentativa por execução, zero falhas, cancelamentos, skips, todo e timeouts; limite de 300 segundos mantido.

## O que foi corrigido

O diagnóstico anterior confirmou que `ref = 'HEAD'` fazia duas fixtures exigirem 178 arquivos quando o candidato commitado já tinha 184. Separadamente, o cálculo de dez `changedPaths` contra a base divergiria do índice vazio do candidato já commitado.

A correção autorizada fixa o padrão em `ref = I2_BASE`, preserva as referências históricas explicitamente fornecidas e monta o snapshot com os bytes atuais dos dez caminhos do incremento. Inventário, árvore, ancestralidade, bytes copiados, diff preparado, seleção real do verificador e rejeição de mistura de épocas continuam verificados. A nova regressão executa os três testes originais em um candidato commitado e impede recursão.

Somente `prototype/mcp-local/tests/homologation.test.mjs` e os dois hashes derivados I2 em `scripts/verify-b4-preservation.mjs` mudaram nesta correção. Os outros oito caminhos do incremento, o validador e os hashes históricos da I1 permanecem iguais.

## Ordem sugerida de revisão

1. [Relatório completo, incluindo diff exclusivo](evidencias/README.md).
2. [Diff exclusivo I2-ID-FIX](evidencias/exclusive-fix.patch) e [patch completo atualizado](evidencias/complete.patch).
3. [Manifesto dos dez caminhos](evidencias/ten-paths.json), [inventário de 184 arquivos](evidencias/inventory-184.json) e [estado final](evidencias/final-state.json).
4. [Homologação local: log integral](evidencias/homologation-local.log) e [resultado](evidencias/homologation-local-result.json).
5. [Homologação commitada: log integral](evidencias/homologation-committed.log) e [resultado](evidencias/homologation-committed-result.json).
6. Dirigidos: [base histórica](evidencias/directed-historical-base-result.json), [sem commit](evidencias/directed-uncommitted-result.json) e [commitado](evidencias/directed-committed-result.json). Os logs completos estão na mesma pasta.
7. [Manifesto dos commits sintéticos](evidencias/synthetic-commits.json), com pais, árvores e procedência.
8. [Conferência antes](evidencias/before.json) e [depois](evidencias/after.json), distinguindo bytes do índice, entradas preparadas, diffs, HEAD, referências e hashes dos arquivos.
9. [Diagnóstico anterior preservado](evidencias/diagnostic-result.json) e [conferência anterior do índice](evidencias/diagnostic-final-integrity.json).
10. [Inspeção e sanitização](SANITIZACAO.md).

## Registro do índice auxiliar

O caminho real é `/workspace/conduz-i1-handle-fix`. O diagnóstico anterior registrou mudança do hash binário do índice de `2e725d09c3bc3fdb371b7693508f4efcbe4f396cdf9767a57ea32cead66ed804` para `4f92618d7cd6587724b3178aa4c46764b7b0aa09cc8f32f47f1be29dde7a5e8f`, sem diferença do conteúdo preparado. A causa segue indeterminada. Nesta rodada I2-ID-FIX o índice permaneceu no segundo hash, sem normalização ou restauração. Os registros anteriores foram preservados integralmente.

## Download e hashes

[Baixar ZIP original das evidências](conduz-i2-id-fix-local-evidence.zip?raw=true).

SHA-256 do patch completo:

```text
ade5002bf130cb625f7146605e90efcc321377af57085647db4d24aacb41ff98
```

Autohash normalizado I2:

```text
ab7209fc26bfdf1a118b912ee450f4cb1ae3f61b4f48efd216c71e167f7f8b55
```

SHA-256 do ZIP original, preservado sem repacotamento:

```text
5c4a67cab3869eb5ab05f3424ac762eaa124664dc5371b6e5a70482ad2d76bee
```

[SHA256SUMS](SHA256SUMS) cobre todos os arquivos desta publicação. O [manifesto interno original](evidencias/SHA256.json) cobre os materiais originais extraídos do ZIP. Os nomes, conteúdo e hashes foram conferidos antes da publicação.

## Alcance e pendências

O resultado é local e sintético. Esta entrega documental não representa CI remota da implementação, publicação de código de desenvolvimento ou autorização de merge. Uma futura publicação do código requer autorização específica e nova validação remota do SHA então publicado.

Permanecem os limites históricos: observabilidade privada e causa original da intermitência inconclusiva; serviços, credenciais, PITR real, MFA administrativo, quorum e referência independente reais não foram homologados por esta prova. Os resultados antigos de CI não validam este patch novo.

Esta branch não contém workflows executáveis. Não houve deploy, serviços reais, alterações de regras do GitHub ou avanço de fase.
