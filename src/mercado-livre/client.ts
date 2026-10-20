import { AppError, requireValue } from '../errors';
import { ACCOUNT_REF, SELLER_ID, type Listing } from '../types';
import type { HttpTransport } from './synthetic-transport';

export interface TokenResponse { access_token: string; refresh_token: string; expires_in: number; user_id: string }
export type TokenAccess = <T>(use: (access: string) => Promise<T>) => Promise<T>;

export class MercadoLivreClient {
  constructor(private readonly transport: HttpTransport, private readonly timeoutMs = 10000) {}

  private async json(path: string, init: RequestInit): Promise<unknown> {
    // path is exclusively assembled by the closed methods below; no generic public proxy.
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let response: Response;
    try {
      response = await Promise.race([
        this.transport.send(new Request(`https://api.mercadolibre.com${path}`, { ...init, signal: controller.signal })),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new AppError('UPSTREAM_TIMEOUT', 504, 'Transporte sintético excedeu o prazo.', true));
          }, this.timeoutMs);
        })
      ]);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('UPSTREAM_ERROR', 502, 'Falha no transporte sintético.', true);
    } finally { if (timer !== undefined) clearTimeout(timer); }
    if (response.status === 401) throw new AppError('UPSTREAM_UNAUTHORIZED', 401, 'Sessão sintética expirada.');
    if (response.status === 429) throw new AppError('RATE_LIMITED', 429, 'Limite sintético atingido.', true);
    if (!response.ok) throw new AppError('UPSTREAM_ERROR', 502, 'Falha no transporte sintético.', response.status >= 500);
    try { return await response.json(); }
    catch { throw new AppError('UPSTREAM_CONTRACT', 502, 'Resposta sintética incompatível com o contrato.'); }
  }

  async exchange(form: URLSearchParams): Promise<TokenResponse> {
    form.set('client_id', 'SYNTHETIC_CLIENT_B0');
    const value = await this.json('/oauth/token', { method: 'POST', body: form });
    requireValue(value && typeof value === 'object');
    const v = value as Partial<TokenResponse> & { token_type?: unknown };
    requireValue(typeof v.access_token === 'string' && v.access_token.startsWith('SYNTHETIC_ACCESS.')
      && typeof v.refresh_token === 'string' && v.refresh_token.startsWith('SYNTHETIC_REFRESH.')
      && typeof v.expires_in === 'number' && Number.isFinite(v.expires_in) && v.expires_in > 30
      && v.expires_in <= 86400 && typeof v.user_id === 'string' && v.token_type === 'Bearer');
    requireValue(v.user_id === SELLER_ID, 'SELLER_MISMATCH', 403, 'Vendedor não autorizado.');
    return v as TokenResponse;
  }

  async me(access: string): Promise<{ account_ref: string; seller_id: string; nickname: string }> {
    const v = await this.json('/users/me', { headers: { Authorization: `Bearer ${access}` } }) as Record<string, unknown>;
    requireValue(v && v.id === SELLER_ID, 'SELLER_MISMATCH', 403, 'Vendedor não autorizado.');
    requireValue(typeof v.nickname === 'string' && v.site_id === 'MLB');
    return { account_ref: ACCOUNT_REF, seller_id: SELLER_ID, nickname: v.nickname };
  }

  async listing(access: string, itemId: string): Promise<Listing> {
    requireValue(/^MLB_SYNTH_00[123]$/.test(itemId), 'NOT_FOUND', 404, 'Anúncio sintético não encontrado.');
    const v = await this.json(`/items/${itemId}`, { headers: { Authorization: `Bearer ${access}` } }) as Record<string, unknown>;
    requireValue(v && v.seller_id === SELLER_ID, 'SELLER_MISMATCH', 403, 'Vendedor não autorizado.');
    requireValue(v.id === itemId && typeof v.title === 'string' && v.title.length <= 200
      && (v.status === 'active' || v.status === 'paused') && typeof v.price === 'string'
      && /^\d{1,12}\.\d{2}$/.test(v.price) && v.currency_id === 'BRL'
      && Number.isSafeInteger(v.available_quantity) && Number(v.available_quantity) >= 0);
    return { item_id: itemId, title: v.title, status: v.status,
      price: { amount: v.price, currency: 'BRL' }, available_quantity: Number(v.available_quantity) };
  }

  async search(access: string, limit: number, offset: number): Promise<{ ids: string[]; total: number }> {
    const query = new URLSearchParams({ status: 'active', limit: String(limit), offset: String(offset) });
    const v = await this.json(`/users/${SELLER_ID}/items/search?${query}`, {
      headers: { Authorization: `Bearer ${access}` }
    }) as { results?: unknown; paging?: { total?: unknown; offset?: unknown; limit?: unknown } };
    requireValue(v && Array.isArray(v.results) && v.results.length <= limit
      && v.results.every(id => typeof id === 'string' && /^MLB_SYNTH_00[123]$/.test(id))
      && v.paging && Number.isSafeInteger(v.paging.total) && Number(v.paging.total) >= 0
      && v.paging.offset === offset && v.paging.limit === limit);
    return { ids: v.results as string[], total: Number(v.paging.total) };
  }
}
