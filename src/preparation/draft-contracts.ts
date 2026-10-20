import { requireValue } from '../errors';

// Candidate contracts only. The current Mercado Livre portal is inaccessible; never label these live-verified.
function object(value: unknown): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}
export function parseDraftIdentity(value: unknown, expectedSellerId: string) {
  const v = object(value);
  requireValue(Number.isSafeInteger(v.id) && Number(v.id) > 0 && String(v.id) === expectedSellerId,
    'SELLER_MISMATCH', 403, 'Vendedor não autorizado.');
  requireValue(typeof v.nickname === 'string' && v.nickname.length <= 200 && v.site_id === 'MLB');
  return { sellerId: String(v.id), nickname: v.nickname, siteId: 'MLB' as const };
}
export function parseDraftItem(value: unknown, expectedSellerId: string, expectedItemId: string) {
  const v = object(value);
  requireValue(Number.isSafeInteger(v.seller_id) && String(v.seller_id) === expectedSellerId,
    'SELLER_MISMATCH', 403, 'Vendedor não autorizado.');
  requireValue(v.id === expectedItemId && /^MLB\d{4,20}$/.test(expectedItemId) && typeof v.title === 'string'
    && v.title.length <= 200 && ['active', 'paused', 'closed'].includes(String(v.status))
    && typeof v.price === 'number' && Number.isFinite(v.price) && v.currency_id === 'BRL');
  const decimal = String(v.price);
  requireValue(/^\d{1,12}(\.\d{1,2})?$/.test(decimal));
  const [whole, fraction = ''] = decimal.split('.');
  requireValue(v.available_quantity === undefined || v.available_quantity === null
    || (Number.isSafeInteger(v.available_quantity) && Number(v.available_quantity) >= 0));
  return { itemId: expectedItemId, title: v.title, status: String(v.status),
    price: { amount: `${whole}.${fraction.padEnd(2, '0')}`, currency: 'BRL' as const },
    availableQuantity: v.available_quantity === undefined || v.available_quantity === null ? null : Number(v.available_quantity) };
}
export function parseDraftSearch(value: unknown, limit: number, offset: number) {
  const v = object(value); const page = object(v.paging);
  requireValue(Array.isArray(v.results) && v.results.length <= limit
    && v.results.every(id => typeof id === 'string' && /^MLB\d{4,20}$/.test(id))
    && Number.isSafeInteger(page.total) && Number(page.total) >= 0 && page.limit === limit && page.offset === offset);
  return { ids: v.results as string[], total: Number(page.total), limit, offset };
}
