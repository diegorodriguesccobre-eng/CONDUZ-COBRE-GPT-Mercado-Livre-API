import { AppError } from '../errors';
import type { HttpTransport } from '../mercado-livre/synthetic-transport';
import { RealHttpTransport, RealRequestFactory } from './real-http-transport';
import { parseDraftIdentity, parseDraftItem, parseDraftSearch } from './draft-contracts';

// Not wired to either Worker entrypoint. Default transport is disabled; tests inject synthetic responses.
export class PreparedReadClient {
  private readonly requests = new RealRequestFactory();
  constructor(private readonly expectedSellerId: string, private readonly transport: HttpTransport = new RealHttpTransport()) {
    if (!/^[1-9]\d{0,14}$/.test(expectedSellerId)) throw new AppError('CONFIG_INVALID', 503, 'Vendedor esperado não configurado.');
  }
  private async response(request: Request): Promise<unknown> {
    const response = await this.transport.send(request);
    if (!response.ok) throw new AppError('UPSTREAM_ERROR', 502, 'Resposta do adaptador não disponível.', response.status === 429 || response.status >= 500);
    try { return await response.json(); }
    catch { throw new AppError('UPSTREAM_CONTRACT', 502, 'Contrato candidato incompatível.'); }
  }
  async identity(access: string) {
    return parseDraftIdentity(await this.response(this.requests.identity(access)), this.expectedSellerId);
  }
  async listings(access: string, limit: number, offset: number) {
    return parseDraftSearch(await this.response(this.requests.listings(this.expectedSellerId, access, limit, offset)), limit, offset);
  }
  async item(access: string, itemId: string) {
    return parseDraftItem(await this.response(this.requests.item(itemId, access)), this.expectedSellerId, itemId);
  }
}
