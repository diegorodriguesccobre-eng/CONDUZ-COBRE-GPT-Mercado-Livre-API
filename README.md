# CONDUZ COBRE — R145-EVID: evidências originais para revisão independente

**Resultado recebido: PASSA LOCAL E SINTÉTICO. Validação remota deste patch: pendente e não executada.**

Esta branch publica exclusivamente material de revisão. O patch não foi aplicado à main e não foi criado commit no checkout da implementação. Nenhum teste foi repetido para esta publicação. Não há workflows ou configuração de deploy nesta branch.

## Originais recuperados e integridade

Os quatro arquivos foram encontrados nos caminhos autorizados, conferidos antes da publicação e copiados sem alteração de bytes:

| Caminho original completo | Arquivo publicado |
| --- | --- |
| /workspace/scratch/conduz-r145-local.patch | [Patch integral original](conduz-r145-local.patch) |
| /workspace/scratch/conduz-r145-manifest.json | [Manifesto original](conduz-r145-manifest.json) |
| /workspace/scratch/conduz-r145-report.md | [Relatório original, com diff integral](conduz-r145-report.md) |
| /workspace/scratch/conduz-r145-local-evidence.zip | [ZIP original](conduz-r145-local-evidence.zip?raw=true) |

Patch, manifesto e relatório correspondem byte a byte a candidate.patch, final-state.json e README.md dentro do ZIP original. As 126 entradas do ZIP foram verificadas por CRC e pelos hashes internos. O ZIP não foi reconstruído ou repacotado; os materiais extraídos em evidencias/ são cópias de seus bytes originais para facilitar a leitura pelo navegador.

SHA-256 obrigatório do patch:

```text
f5de8e0ff81c58b034202dbc6352b94f4607d1b3e3673de1c9b044a67042e1ef
```

SHA-256 do ZIP original:

```text
db30121bfc1fc2f2c7cf117a7f931292e6d487fc3e092b4dffcbbe1c2adc440e
```

[SHA256SUMS](SHA256SUMS) cobre os arquivos desta publicação; [o manifesto interno original](evidencias/SHA256.json) cobre os materiais do ZIP.

## Quatro caminhos do candidato e seis entradas de edição

A contagem das seis entradas vem do histórico de edição desta conversa. O manifesto e o patch comprovam o resultado consolidado: **quatro arquivos modificados, nenhuma adição e nenhuma exclusão**. Foram cinco entradas de edição nesses quatro arquivos, mais uma entrada de criação do coletor externo.

| Entrada | Caminho original completo | Classificação e correspondência |
| --- | --- | --- |
| 1 | /workspace/conduz-r1-45-fix/prototype/mcp-local/tests/recovery.test.mjs | Candidato: asserção de auditoria, percurso real R1-45 e onze regressões determinísticas. |
| 2 | /workspace/conduz-r1-45-fix/scripts/verify-b4-preservation.mjs | Candidato: nova revisão R145, pins exatos e autohash próprio, com regras I1/I2 preservadas. |
| 3 | /workspace/conduz-r1-45-fix/tests/b4/m21-preservation.node.mjs | Candidato: controles históricos e nove testes da nova revisão. Este caminho fica na raiz do repositório. |
| 4 | /workspace/conduz-r1-45-fix/prototype/mcp-local/tests/homologation.test.mjs | Primeira edição do mesmo arquivo candidato: separação dos validadores/bytes históricos, helper r145GitFixture e classificação das épocas. |
| 5 | /workspace/conduz-r1-45-fix/prototype/mcp-local/tests/homologation.test.mjs | Segunda edição do mesmo arquivo candidato: três testes novos, regressão em subprocesso, evidências e contagem do filho M2.1 de 54 para 63. Consolida-se com a entrada 4 em uma única modificação no diff final. |
| 6 | /tmp/conduz-r1-45-evidence/validate.py | Auxiliar externo: preparou fixtures descartáveis, executou comandos e coletou logs, tempos e integridade. Não integra o patch nem os 184 arquivos do candidato. Publicado apenas como evidência em evidencias/validate.py. |

Os caminhos relativos exatos autorizados são:

1. prototype/mcp-local/tests/recovery.test.mjs
2. scripts/verify-b4-preservation.mjs
3. tests/b4/m21-preservation.node.mjs
4. prototype/mcp-local/tests/homologation.test.mjs

O pacote contém o diff final consolidado e os backups anteriores desses quatro arquivos em evidencias/before/. As duas entradas de homologation.test.mjs são etapas da edição do mesmo caminho, não arquivos adicionais. Não foram fabricados snapshots intermediários para representar essas etapas.

A fixture commitada indicada em [setup.json](evidencias/setup.json) foi criada em `/tmp/conduz-r1-45-evidence/committed`, com repositório Git próprio. Seus commits são sintéticos e não são commits do checkout de desenvolvimento:

```text
Base da implementação: 9744bcaee5f999c7dfa907e6c3f9f3f0d31ce044
Commit sintético:      1db1f9fd45f6913f7a2221a6c344f867937ddce5
Pai direto:            9744bcaee5f999c7dfa907e6c3f9f3f0d31ce044
Árvore candidata:      5885d5765c093b990233d52ab17c1fd635811053
```

Os 184 arquivos e 180 caminhos preservados dizem respeito ao candidato da implementação. A árvore desta branch tem documentos, patch e evidências; não contém a implementação aplicada nem os repositórios Git das fixtures.

## Resultado local já produzido

| Execução | Aprovados/total | Skip | Duração total |
| --- | --- | --- | --- |
| R1-45 e regressões dirigidas | 12/12 | 0 | 2,079 s |
| Preservação M2.1 | 63/63 | 0 | 5,148 s |
| Preservação B4 existente | 16/16 | 0 | 0,468 s |
| Seleção dirigida sem commit | 7/7 | 0 | 20,107 s |
| Seleção dirigida commitada | 7/7 | 0 | 17,710 s |
| Recovery sem commit | 112/113 | 1 | 81,354 s |
| Recovery commitado | 112/113 | 1 | 75,857 s |
| Integration local | 82/82 | 0 | 56,578 s |
| Homologation sem commit | 248/248 | 0 | 139,862 s |
| Homologation commitado | 248/248 | 0 | 139,201 s |

Os tempos dos grupos completos incluem typecheck; tempos dos runners e subprocessos estão nos relatórios. Filhos das duas homologações: fronteiras 62/62, preservação 63/63, identidade I2 11/11, regressão histórica I2 3/3 e revisão R145 5/5, contabilizados separadamente. Não somar os filhos ao total principal ou contar duas vezes as execuções dos dois estados.

Foram mantidos os 102 casos existentes de recovery e acrescentados onze; a preservação recebeu nove testes e a homologação três. Os limites existentes foram preservados. O único skip é o histórico R1-78, PITR real. Não houve falha do runner, cancelamento ou timeout nas execuções declaradas.

## Registro obrigatório do coletor: 116 → 113

O coletor auxiliar inicialmente previa 116 testes por uma contagem estática incorreta: assumiu nove casos Q injetados onde a base tinha seis. O runner retornou código 0, com 113 testes, 112 aprovados e somente o skip R1-78. O coletor marcou passed=false por sua previsão incorreta; esse registro não foi apagado.

- [Script inicial do coletor, com previsão 116](evidencias/validate-initial-count.py).
- [Relatório inicial preservado](evidencias/recovery-local-result.json).
- [Log original completo do runner](evidencias/recovery-local.log).
- [Conciliação para 113 = 102 existentes + 11 novos](evidencias/recovery-local-reconciled.json).
- [Auxiliar externo após a correção da contagem](evidencias/validate.py).
- [Cobertura dos casos existentes](evidencias/recovery-local-work-recovery-coverage.json).
- [Execução independente do estado commitado](evidencias/recovery-committed-result.json).

A correção foi somente da interpretação externa. Nenhum código ou hash do candidato foi alterado e a execução local não foi repetida para corrigir a contagem.

## Ordem sugerida de revisão

1. [Relatório original com diagnóstico, manifesto e diff](conduz-r145-report.md).
2. [Patch original](conduz-r145-local.patch) e [manifesto final original](conduz-r145-manifest.json).
3. [Hashes dos quatro caminhos](evidencias/four-paths.json), [inventário de 184 arquivos](evidencias/inventory-184.json) e [preservação final](evidencias/final-preservation.json).
4. [Prova determinística do digest eYJ](evidencias/digest-proof.json), [log dirigido](evidencias/directed-audit.log) e [eventos efetivamente persistidos](evidencias/directed-persisted-audit.json).
5. Recovery: [log sem commit](evidencias/recovery-local.log) e [log commitado](evidencias/recovery-committed.log).
6. Homologation: [log sem commit](evidencias/homologation-local.log) e [log commitado](evidencias/homologation-committed.log).
7. [Preservação dos checkouts antes](evidencias/previous-checkouts-before.json) e [depois](evidencias/previous-checkouts-after.json), incluindo índices e conteúdo preparado.
8. [Commits sintéticos e sua procedência](evidencias/synthetic-commits.json) e [classificação dos snapshots auxiliares](evidencias/artifact-provenance.json).

## Limites e integridade editorial

Nenhum original foi reconstruído, substituído, sanitizado ou repacotado. O patch contém exemplos intencionalmente sintéticos de HMAC/PEM usados nas regressões negativas, incluindo a sequência literal SYNTHETIC-R145-KEY; não foram identificadas credenciais reais. Os bytes originais, falhas de interpretação do coletor, logs e limitações foram preservados.

Esta publicação não aplica a correção ao código de desenvolvimento, não valida CI remoto e não autoriza PR ou merge. PITR real permanece pendente. A observabilidade privada e a intermitência operacional histórica continuam separadas e inconclusivas. A prova cobre o contrato fechado e os canários do protótipo sintético, sem homologação de produção.
