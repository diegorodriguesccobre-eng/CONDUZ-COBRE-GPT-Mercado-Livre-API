import assert from 'node:assert/strict';

// Test-only contract: availability/transport errors never count as a successful CAS rejection.
export function expectSingleCasWinner(results) {
  assert.equal(results.length, 2);
  for (const result of results) if (result.status === 'rejected') {
    const error = result.reason;
    if (!(error instanceof Error) || error.name !== 'SyntheticRecoveryError' ||
        !['REVISION_CONFLICT', 'RECOVERY_REQUIRED'].includes(error.code) || error.message !== error.code) {
      throw error;
    }
  }
  const winners = results.flatMap((r, index) => r.status === 'fulfilled' ? [index] : []);
  const losers = results.flatMap((r, index) => r.status === 'rejected' ? [index] : []);
  assert.equal(winners.length, 1, 'Exactly one committed mutation is required');
  assert.equal(losers.length, 1, 'Exactly one classified CAS/fence conflict is required');
  assert.ok(results[winners[0]].value && typeof results[winners[0]].value === 'object');
  return { winner: winners[0], loser: losers[0], conflict: results[losers[0]].reason.code };
}
