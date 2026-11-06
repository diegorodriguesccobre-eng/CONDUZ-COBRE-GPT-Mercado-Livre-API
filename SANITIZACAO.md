# Inspeção e sanitização

Os 63 arquivos do ZIP original foram conferidos por CRC, SHA-256 e igualdade com os arquivos locais revisados. Patch completo, diff exclusivo, oito caminhos preservados, inventário e autohash I2 foram reconferidos.

Foi realizada varredura de marcadores de credenciais GitHub/AWS, chaves privadas e JWTs, complementada pela inspeção das ocorrências de termos de autenticação. As ocorrências encontradas eram nomes de testes, descrições e classificações de autorização, como INTEGRATION_READ_DENIED. Não foram identificados segredos ou dados sensíveis que exigissem remoção.

**Sanitizações nesta publicação: nenhuma.** Os bytes do ZIP original e de todos os arquivos extraídos foram preservados. Não foram ocultadas falhas anteriores, resultados, caminhos locais de auditoria ou limitações. Os índices binários incluídos são registros de auditoria, não repositórios executáveis.

Os campos dos commits sintéticos distinguem IDs observados diretamente dos reconstruídos a partir dos argumentos Git Trace2 e da identidade/data fixas das fixtures, com corroboração descrita no manifesto.
