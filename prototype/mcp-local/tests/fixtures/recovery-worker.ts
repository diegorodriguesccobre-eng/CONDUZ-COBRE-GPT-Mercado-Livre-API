// Local-only composition: preserves both existing Worker entrypoints byte-for-byte.
import worker from '../../src/worker';
export { RecoveryGuardian, RecoveryReference, RecoveryData, RecoveryPartition } from '../../recovery/storage';
export default worker;
