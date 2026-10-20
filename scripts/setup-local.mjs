import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
// Synthetic local keys only; exclusive creation protects existing configuration.
try {
  writeFileSync('.dev.vars', `# B0 local-only generated keys, never provider credentials\nINTERNAL_AUTH_KEY=${randomBytes(32).toString('base64url')}\nTOKEN_ENCRYPTION_KEY=${randomBytes(32).toString('base64url')}\n`, { flag: 'wx', mode: 0o600 });
  console.log('Configuração local sintética criada em .dev.vars (ignorada pelo Git). Valores não exibidos.');
} catch (error) {
  if (error.code === 'EEXIST') console.log('.dev.vars já existe; arquivo preservado.');
  else throw error;
}
