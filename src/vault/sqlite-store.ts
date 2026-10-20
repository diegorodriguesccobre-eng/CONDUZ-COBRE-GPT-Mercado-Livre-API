import { AppError } from '../errors';
import type { StateRow, TokenRow, VaultStore } from '../types';

export class SqliteStore implements VaultStore {
  constructor(private readonly storage: DurableObjectStorage, private readonly now = Date.now) {
    storage.sql.exec('CREATE TABLE IF NOT EXISTS tokens (id INTEGER PRIMARY KEY CHECK (id = 1), ciphertext TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN (\'ready\',\'refreshing\')))');
    storage.sql.exec('CREATE TABLE IF NOT EXISTS oauth_states (hash TEXT PRIMARY KEY, ciphertext TEXT NOT NULL, expires_at INTEGER NOT NULL)');
    storage.sql.exec('CREATE TABLE IF NOT EXISTS quotas (subject TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL)');
  }
  putState(hash: string, value: StateRow): void {
    this.storage.transactionSync(() => {
      this.storage.sql.exec('DELETE FROM oauth_states WHERE expires_at <= ?', this.now());
      const count = this.storage.sql.exec<{ count: number }>('SELECT count(*) AS count FROM oauth_states').one().count;
      if (count >= 20) throw new AppError('RATE_LIMITED', 429, 'Limite de conexões temporárias atingido.', true);
      this.storage.sql.exec('INSERT INTO oauth_states (hash,ciphertext,expires_at) VALUES (?,?,?)', hash, value.ciphertext, value.expiresAt);
    });
  }
  takeState(hash: string): StateRow | undefined {
    return this.storage.transactionSync(() => {
      const rows = this.storage.sql.exec<{ ciphertext: string; expires_at: number }>(
        'DELETE FROM oauth_states WHERE hash = ? RETURNING ciphertext,expires_at', hash).toArray();
      return rows[0] ? { ciphertext: rows[0].ciphertext, expiresAt: rows[0].expires_at } : undefined;
    });
  }
  getTokens(): TokenRow | undefined {
    return this.storage.sql.exec<{ ciphertext: string; status: 'ready' | 'refreshing' }>('SELECT ciphertext,status FROM tokens WHERE id=1').toArray()[0];
  }
  putTokens(row: TokenRow): void {
    this.storage.sql.exec('INSERT INTO tokens (id,ciphertext,status) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET ciphertext=excluded.ciphertext,status=excluded.status', row.ciphertext, row.status);
  }
  quota(subject: string): void {
    this.storage.transactionSync(() => {
      const window = Math.floor(this.now() / 60000);
      this.storage.sql.exec('DELETE FROM quotas WHERE window < ?', window);
      const row = this.storage.sql.exec<{ count: number; window: number }>('SELECT count,window FROM quotas WHERE subject=?', subject).toArray()[0];
      if ((row?.count ?? 0) >= 30) throw new AppError('RATE_LIMITED', 429, 'Limite interno atingido.', true);
      this.storage.sql.exec('INSERT INTO quotas (subject,window,count) VALUES (?,?,1) ON CONFLICT(subject) DO UPDATE SET count=count+1,window=excluded.window', subject, window);
    });
  }
}
