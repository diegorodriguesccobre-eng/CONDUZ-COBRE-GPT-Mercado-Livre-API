import { SELLER_ID } from '../types';

// Entirely invented fixtures. No real seller, listing or application identifiers.
export const identity = { id: SELLER_ID, nickname: 'CONDUZ_COBRE_SINTETICO', site_id: 'MLB' };
export const items = [
  { id: 'MLB_SYNTH_001', seller_id: SELLER_ID, title: 'Cabo demonstrativo sintético',
    status: 'active', price: '129.90', currency_id: 'BRL', available_quantity: 3 },
  { id: 'MLB_SYNTH_002', seller_id: SELLER_ID, title: 'Conector demonstrativo sintético',
    status: 'active', price: '19.50', currency_id: 'BRL', available_quantity: 0 },
  { id: 'MLB_SYNTH_003', seller_id: SELLER_ID, title: 'Produto pausado sintético',
    status: 'paused', price: '42.00', currency_id: 'BRL', available_quantity: 1 }
] as const;
