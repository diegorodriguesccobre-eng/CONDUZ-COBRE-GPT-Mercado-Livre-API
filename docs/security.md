# Segurança B0 e procedimento de auditoria

- Operação CONDUZ COBRE fixa no servidor, sem integração com outras empresas.
- Somente transporte sintético; não há fetch externo no código de aplicação.
- Configuração live, produção, seller real ou callback remoto é recusada.
- Bearer interno obrigatório; comparação por HMAC com verificação nativa. Chave separada da de cifragem.
- State aleatório de 256 bits, hash na chave SQL, verifier cifrado, cinco minutos e consumo atômico.
- PKCE S256 validado pelo emissor sintético; vendedor conferido na emissão e em /users/me antes de persistir.
- AES-256-GCM, nonce aleatório de 96 bits por cifra, contexto autenticado por operação/ambiente/conta/finalidade,
  versão de envelope v1. Alteração de ciphertext/contexto/finalidade é rejeitada. Rotação de chave com keyring
  é pendência de produção; não está simulada como uma capacidade já implantada.
- Refresh serializado, gravação SQLite de intenção antes da troca e exigência de reconexão em resultado incerto.
- Sem proxy genérico, sem seller_id informado pelo consumidor e sem operações comerciais de escrita.
- Logs por allowlist de seis campos: evento, request_id, operação, status, duração e source. Não registrar URL,
  query, cabeçalhos, corpo de requisição/resposta, tokens, code ou state. Revisar logs de borda antes de deploy.
  Os logs de depuração do Wrangler usam diretório temporário removido ao encerrar a ferramenta, pois
  seu protocolo local registra o segredo efêmero MF-Proxy-Shared-Secret. Esse segredo não é token da API.
- Cache no-store, referrer no-referrer, CSP restritiva e sem CORS. Navegador não é um consumidor B0 habilitado.
- Chaves determinísticas dos testes são claramente sintéticas. setup:local gera chaves locais novas; não
  fornece nem aceita credenciais reais de Mercado Livre. .dev.vars e os dados locais não podem ser publicados.

## Auditoria antes de qualquer pedido de push

1. `npm run audit:workspace`: inventaria arquivos versionados, novos e ignorados, verifica regras de ignore,
   nomes de bindings locais e quantidade de commits. Não imprime valores.
2. Gitleaks oficial v8.30.1 (binário obtido do release oficial, SHA256 comparado ao arquivo oficial de checksums):
   - `gitleaks git . --log-opts=--all --redact --report-format=json --report-path=/tmp/b0-history.json`
   - `gitleaks dir . --redact --report-format=json --report-path=/tmp/b0-tree.json`
   Essa segunda verificação inclui arquivos ignorados e dependências locais. Não adicionar allowlist ampla
   para esconder achados. Classificar fixtures de terceiros e chaves sintéticas locais, se detectadas.
3. `git fsck --full`, inspeção de refs, reflogs e diferenças do workspace para não omitir commits locais.
4. `npm audit --audit-level=low` para todas as dependências, incluindo desenvolvimento; verificar integridade
   de instalação e assinatura de pacotes quando disponíveis. Lockfile e versões exatas devem ser preservados.
5. Inspeção manual do adaptador, rotas, logs, criptografia, CI e contratos; executar testes de segurança.

Relatórios locais de scanner ficam em /tmp ou security-reports/ ignorado, com redação. O resumo revisável
fica em docs/b0-validation.md. Auditoria reduz risco e registra o estado observado; não é certificação de
produção nem prova absoluta da inexistência de segredos. Reexecutar após novas alterações.

A Direção autorizou expressamente o primeiro push da Fase B0 ao repositório público, substituindo a
restrição anterior de visibilidade. Antes de publicar, repetir auditoria de conteúdo e histórico, testes,
TypeScript e build local; preservar o histórico remoto e não usar force. Deploy, serviços pagos, contas
reais e credenciais continuam fora do escopo. Integrações existentes permanecem independentes e inalteradas.
