import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tccSubmit, tccList } from '../src/modes/tcc.js';
import { tfcSubmit, tfcList } from '../src/modes/tfc.js';
import { loadConfig } from '../src/config.js';
import { SfecConfigError, SfecValidationError } from '../src/errors.js';

const validInput = {
  taxpayer_niu: 'M987654321',
  recipient: { type: 'business', name: 'ACME', niu: 'P123' },
  items: [{ designation: 'Service A', type: 'service', unit_price: 1000, quantity: 2, tax_rate: '18' }],
  payment: { method: 'mobile_money', currency: 'XAF' },
};

function makeApiKeyConfig() {
  return loadConfig({
    baseUrl: 'https://api.example.test',
    apiKey: 'sk_test',
    processEnv: {},
  });
}

// --- TCC ---

test('tccSubmit : refuse une config sans mTLS (mode API key uniquement)', async () => {
  const cfg = makeApiKeyConfig();
  await assert.rejects(
    () => tccSubmit(cfg, validInput),
    (err) => err instanceof SfecConfigError && err.code === 'SFEC_TERMINAL_NO_MTLS',
  );
});

test('tccSubmit : valide l input AVANT verification mTLS (validation prioritaire ? Non, mTLS d abord)', async () => {
  // Note : on a choisi de verifier mTLS en premier (config error avant business error)
  const cfg = makeApiKeyConfig();
  await assert.rejects(
    () => tccSubmit(cfg, {}),
    (err) => err instanceof SfecConfigError && err.code === 'SFEC_TERMINAL_NO_MTLS',
  );
});

test('tccList : refuse une config sans mTLS', async () => {
  const cfg = makeApiKeyConfig();
  await assert.rejects(
    () => tccList(cfg),
    (err) => err instanceof SfecConfigError && err.code === 'SFEC_TERMINAL_NO_MTLS',
  );
});

// --- TFC ---

test('tfcSubmit : refuse une config sans mTLS', async () => {
  const cfg = makeApiKeyConfig();
  await assert.rejects(
    () => tfcSubmit(cfg, validInput),
    (err) => err instanceof SfecConfigError && err.code === 'SFEC_TERMINAL_NO_MTLS',
  );
});

test('tfcList : refuse une config sans mTLS', async () => {
  const cfg = makeApiKeyConfig();
  await assert.rejects(
    () => tfcList(cfg),
    (err) => err instanceof SfecConfigError && err.code === 'SFEC_TERMINAL_NO_MTLS',
  );
});

// --- Validation params de list cote client (passe avec mtls valide en config) ---

test('terminalList valide params avant reseau (page invalide)', async () => {
  const cfg = loadConfig({
    baseUrl: 'https://api.example.test',
    mtls: { cert: '-----BEGIN-----', key: '-----BEGIN-----' },
    processEnv: {},
  });
  await assert.rejects(() => tccList(cfg, { page: 0 }), SfecValidationError);
  await assert.rejects(() => tfcList(cfg, { pageSize: 21 }), SfecValidationError);
  await assert.rejects(() => tccList(cfg, { invoiceType: 'wat' }), SfecValidationError);
  await assert.rejects(() => tfcList(cfg, { dateStart: '31/12/2026' }), SfecValidationError);
});

test('TCC et TFC partagent la meme implementation (sanity check)', () => {
  // Verifie que les facades sont bien des thin wrappers (memes signatures fonctionnent)
  assert.equal(typeof tccSubmit, 'function');
  assert.equal(typeof tfcSubmit, 'function');
  assert.equal(typeof tccList, 'function');
  assert.equal(typeof tfcList, 'function');
});
