import { afterEach, beforeEach, vi } from 'vitest';
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  // Binding calls do not use global fetch; any accidental real egress fails.
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('B0_NETWORK_FORBIDDEN'));
});
afterEach(() => { vi.restoreAllMocks(); });
