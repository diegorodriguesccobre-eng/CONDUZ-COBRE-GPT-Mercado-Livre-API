Correção mínima da fixture I2 — PASSA local e sintético
Base/HEAD: b3df5def93688d9d68fad39a9a61e96b5c4ba437. Nenhum commit no checkout de desenvolvimento.
Somente homologation.test.mjs e os dois hashes derivados I2 em verify-b4-preservation.mjs foram alterados nesta correção. Os outros 182 hashes de arquivos não mudaram.
A montagem copia bytes atuais dos dez caminhos autorizados, inclusive os seis novos. A comparação usa collected.i2Base (snapshot do commit imutável I2_BASE), sem exigir existência dos arquivos novos em HEAD.
As fixtures históricas continuam por commits imutáveis. Continuam as verificações de paths exatos, staged diff, pai, árvore, ancestralidade, bytes copiados, seleção real do verificador e recusa de épocas misturadas.
Histórico: execução completa anterior 243/244, falha de git show HEAD para arquivo novo. Log preservado em previous-full-homologation.log.
Após correção: teste dirigido uma execução, 1/1, saída 0, 1.118 s. Seleção real B4-I2 comprovada no repositório sintético temporário.
Depois: homologation completo uma execução, saída 0, 244/244, 102.279 s incluindo typecheck. Filhos: fronteiras 62/62, preservação 54/54, I2 identidade 11/11. Contagens dos filhos não se somam ao grupo pai. Sem fail/cancel/skip/todo/timeout. Limite existente 300 s.
Diff --check aprovado. Patch e hashes conferidos antes/depois; snapshots de arquivos, HEAD, refs, índice e status idênticos durante ambas as validações. Checkouts originais preservados.
O commit/tree em homologation-test-evidence.json pertence exclusivamente à fixture temporária descartável; não é commit de desenvolvimento ou publicado.
Nenhuma dependência, teste, contagem, timeout, budget, workflow ou validador foi alterado para obter aprovação. Nenhum push, publicação, serviço real, deploy ou gasto.
Este parecer cobre a correção da fixture e a validação local sintética. Não constitui validação remota ou autorização de publicação.
