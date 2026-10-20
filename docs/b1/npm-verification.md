# B1 — assinaturas npm e proveniência

npm audit signatures foi executado novamente e falhou ao baixar metadados TUF: HTTP 403. A consulta direta
https://tuf-repo-cdn.sigstore.dev/timestamp.json confirmou o bloqueio de rede. Não houve erro de assinatura
ou checksum comprovado por esse comando; a verificação de proveniência não chegou a concluir.

O endpoint oficial https://registry.npmjs.org/-/npm/v1/keys é acessível. Foi acrescentado um verificador
separado para a assinatura ECDSA do registry, com Node crypto, sem dependência adicional de criptografia:

```sh
npm run test:registry
npm run audit:registry-signatures
```

Ele compara dist.integrity com o lockfile, confere name/version, usa chaves do registry obtidas por HTTPS e
verifica a assinatura do payload name@version:integrity. Para chaves com expiração, usa a data de publicação
do packument oficial, como npm/pacote, e recusa datas inválidas. Não altera checksums ou trust stores, não
relaxa TLS, não ignora assinatura inválida e não classifica pacote sem assinatura como aprovado.

Os testes usam pares de chaves efêmeros em memória: assinatura válida, conteúdo/integridade adulterados,
chave desconhecida/expirada, assinatura ausente e validade histórica. Nenhuma chave privada é salva em arquivo.
Relatório detalhado em /tmp/conduz-b1-registry-signatures.json, fora do repositório.

Resultado observado: 86 pacotes instalados verificados, zero falhas. As 73 entradas opcionais de outras
plataformas não instaladas foram registradas separadamente; não foram declaradas verificadas.

Essa verificação NÃO valida atestados Sigstore, identidade do publicador ou cadeia de proveniência. Não
substitui npm audit signatures, que continua pendente. Para concluir, permitir o hostname
`tuf-repo-cdn.sigstore.dev` na política de rede e repetir npm audit signatures, preservando a verificação
TUF e registrando eventuais outros destinos exigidos. Nenhuma alteração da política de rede foi feita.
