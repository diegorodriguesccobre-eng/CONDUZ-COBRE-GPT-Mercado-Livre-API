import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { verifyRegistrySignature } from '../../scripts/audit-registry-signatures.mjs';
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const integrity = 'sha512-SYNTHETIC_INTEGRITY';
const sig = sign('sha256', Buffer.from(`synthetic-package@1.0.0:${integrity}`), privateKey).toString('base64');
const keys = [{ keyid: 'synthetic-key', key: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), expires: null }];
const manifest = { name: 'synthetic-package', version: '1.0.0', dist: { integrity, signatures: [{ keyid: 'synthetic-key', sig }] } };
test('verifica assinatura ECDSA pelo payload oficial npm', () => assert.equal(verifyRegistrySignature(manifest, integrity, keys), 'verified'));
test('recusa pacote ou integridade adulterados', () => {
  assert.throws(() => verifyRegistrySignature({ ...manifest, version: '2.0.0' }, integrity, keys));
  assert.throws(() => verifyRegistrySignature(manifest, 'sha512-TAMPERED', keys));
});
test('recusa chave desconhecida ou expirada', () => {
  assert.throws(() => verifyRegistrySignature(manifest, integrity, []));
  assert.throws(() => verifyRegistrySignature(manifest, integrity, [{ ...keys[0], expires: '2000-01-01T00:00:00Z' }]));
});
test('ausência de assinatura é classificada, nunca como verificada', () => {
  assert.equal(verifyRegistrySignature({ ...manifest, dist: { integrity } }, integrity, keys), 'unsigned');
});

test('validade histórica segue publicação, conforme npm/pacote', () => {
  assert.equal(verifyRegistrySignature(manifest, integrity, [{ ...keys[0], expires: '2000-01-01T00:00:00Z' }], '1999-01-01T00:00:00Z'), 'verified');
});
test('recusa data de expiração de chave inválida sem relaxar a verificação', () => {
  assert.throws(() => verifyRegistrySignature(manifest, integrity, [{ ...keys[0], expires: 'invalid' }], '1999-01-01T00:00:00Z'));
});
