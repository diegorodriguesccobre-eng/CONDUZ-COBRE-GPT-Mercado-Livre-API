# CONDUZ COBRE — evidências da identidade I2 local

Este material registra a implementação local e sintética do serviço privado de identidade e a correção mínima de sua fixture de homologação. Esta branch contém somente documentação e evidências; os patches estão disponíveis para leitura e não foram aplicados à main.

## Resultado

**PASSA na homologação local sintética após a correção da fixture.**

- Base da implementação: `b3df5def93688d9d68fad39a9a61e96b5c4ba437`.
- Implementação local: seis arquivos novos e quatro modificados, total de 184 arquivos; 174 arquivos da I1 preservados e 94 históricos idênticos.
- Correção desta rodada: somente `prototype/mcp-local/tests/homologation.test.mjs` e os hashes derivados I2 indispensáveis em `scripts/verify-b4-preservation.mjs`.
- O checkout de desenvolvimento continua sem commit da implementação. Os commits de teste ficaram exclusivamente nas fixtures descartáveis. O commit desta branch publica apenas o presente material documental.

| Validação após a correção | Resultado | Duração |
| --- | --- | --- |
| Teste dirigido da fixture anteriormente falha | 1/1 | 1,118 s |
| Typecheck da homologação | PASSA | Incluído no total |
| Homologação completa | 244/244 | 102,279 s, incluindo typecheck |
| Filho: fronteiras | 62/62 | 1,931 s |
| Filho: preservação | 54/54 | 1,425 s |
| Filho: identidade I2 | 11/11 | 13,393 s |

As contagens dos filhos são separadas. Cada execução ocorreu uma vez após a correção, sem retries oportunistas. Zero falhas, cancelamentos, skips, todo ou timeout. Limite de 300 segundos mantido.

## Ordem sugerida de leitura

1. [Relato da correção e dos limites](evidencias/README.txt).
2. [Diff exclusivo da correção da fixture](evidencias/fixture-fix.patch).
3. [Patch completo atualizado da implementação local](evidencias/complete.patch).
4. [Log do teste dirigido](evidencias/directed.log) e [seu resultado](evidencias/directed-result.json).
5. [Log integral da homologação](evidencias/homologation.log) e [resultado estruturado](evidencias/homologation-result.json).
6. [Manifesto final e hashes dos dez caminhos](evidencias/final-state.json).
7. [Manifestos antes](evidencias/homologation-before.json) e [depois](evidencias/homologation-after.json), idênticos durante a validação.
8. [Evidência da seleção real B4-I2](evidencias/homologation-test-evidence.json).

## Falha anterior preservada

A primeira homologação completa terminou com 243/244. A fixture tentou ler `HEAD:prototype/mcp-local/i2/identity-worker.ts`, embora o arquivo novo existisse somente no estado local sem commit; Git retornou 128. O [log anterior](evidencias/previous-full-homologation.log) foi preservado.

A correção copia os bytes locais atuais dos dez caminhos autorizados e compara diferenças com o snapshot imutável de `I2_BASE`, aceitando arquivos novos. Permanecem a seleção efetiva do verificador, a checagem da árvore e da ancestralidade e a recusa da mistura entre épocas. As fixtures históricas continuam por commits imutáveis. O validador e os hashes históricos da I1 não foram alterados nesta correção.

## Download e integridade

[Baixar o ZIP original](conduz-i2-identity-fixture-fix-evidence.zip?raw=true).

SHA-256 do ZIP:

```text
3b516e332a05fce60156aeb0a35b1f51f2adbc9b50c380fe3ddf3671019ca6eb
```

SHA-256 do patch completo atualizado:

```text
f4d67645389efed5a9ae600c45211d8219ead706c89e012c978fd89277a54fa0
```

Os hashes dos arquivos originais extraídos estão em [SHA256.json](evidencias/SHA256.json). O arquivo `reviewed-state.json` registra o estado anterior à validação desta rodada; `final-state.json` registra o resultado final. Commits e árvores identificados como sintéticos nos relatórios pertencem somente às fixtures temporárias e não são publicação da implementação.

## Alcance

Esta evidência cobre testes locais e sintéticos. A validação remota da implementação não foi executada. Permanecem fora do escopo deploy, serviços e credenciais reais, PITR real, MFA administrativo real, quorum real e referência independente real. A observabilidade privada e a causa da intermitência original permanecem ressalvas históricas documentadas.

A publicação deste material não aplica código à main, não constitui merge ou autorização de avanço de fase e não altera permissões ou regras do GitHub.
