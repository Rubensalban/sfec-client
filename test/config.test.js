import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { loadConfig, resolveBaseUrl, wrapSecret } from '../src/config.js';
import { SfecConfigError } from '../src/errors.js';

const FAKE_PEM_CERT = '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----';
const FAKE_PEM_KEY = '-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----';

test('wrapSecret expose reveal() et masque toString/JSON/inspect', () => {
  const s = wrapSecret('sk_secret_123');
  assert.equal(s.reveal(), 'sk_secret_123');
  assert.equal(s.toString(), '***');
  assert.equal(JSON.stringify({ key: s }), '{"key":"***"}');
  assert.equal(inspect(s), '***');
  assert.equal(`${s}`, '***');
});

test('wrapSecret refuse les valeurs non-string ou vides', () => {
  assert.throws(() => wrapSecret(''), SfecConfigError);
  assert.throws(() => wrapSecret(123), SfecConfigError);
  assert.throws(() => wrapSecret(null), SfecConfigError);
  assert.throws(() => wrapSecret(undefined), SfecConfigError);
});

test('wrapSecret retourne un objet freeze (pas de mutation)', () => {
  const s = wrapSecret('abc');
  assert.ok(Object.isFrozen(s));
  assert.throws(() => {
    s.reveal = () => 'hacked';
  });
});

test('resolveBaseUrl mappe sandbox et production', () => {
  assert.equal(resolveBaseUrl('sandbox'), 'https://sandbox-sfecapi.akieni.tech/api');
  assert.equal(resolveBaseUrl('production'), 'https://sfec.gouv.cg/api');
});

test('resolveBaseUrl refuse tout autre nom (pas de defaut silencieux)', () => {
  assert.throws(() => resolveBaseUrl('dev'), SfecConfigError);
  assert.throws(() => resolveBaseUrl(''), SfecConfigError);
  assert.throws(() => resolveBaseUrl(undefined), SfecConfigError);
});

test('loadConfig lit env=sandbox + apiKey depuis processEnv injecte', () => {
  const cfg = loadConfig({
    processEnv: {
      SFEC_CLIENT_ENV: 'sandbox',
      SFEC_CLIENT_API_KEY: 'sk_test_abc',
    },
  });
  assert.equal(cfg.env, 'sandbox');
  assert.equal(cfg.baseUrl, 'https://sandbox-sfecapi.akieni.tech/api');
  assert.equal(cfg.apiKey.reveal(), 'sk_test_abc');
  assert.equal(cfg.timeoutMs, 30000);
  assert.deepEqual({ max: cfg.retry.max, baseDelayMs: cfg.retry.baseDelayMs }, {
    max: 3,
    baseDelayMs: 500,
  });
});

test('loadConfig options explicites surchargent processEnv', () => {
  const cfg = loadConfig({
    env: 'production',
    apiKey: 'sk_explicit',
    processEnv: { SFEC_CLIENT_ENV: 'sandbox', SFEC_CLIENT_API_KEY: 'sk_env' },
  });
  assert.equal(cfg.env, 'production');
  assert.equal(cfg.baseUrl, 'https://sfec.gouv.cg/api');
  assert.equal(cfg.apiKey.reveal(), 'sk_explicit');
});

test('loadConfig throw si SFEC_CLIENT_ENV manquante', () => {
  assert.throws(
    () => loadConfig({ processEnv: { SFEC_CLIENT_API_KEY: 'sk' } }),
    (err) => err instanceof SfecConfigError && err.code === 'SFEC_CONFIG_MISSING_ENV',
  );
});

test('loadConfig throw si aucune auth (ni apiKey ni mtls)', () => {
  assert.throws(
    () => loadConfig({ processEnv: { SFEC_CLIENT_ENV: 'sandbox' } }),
    (err) => err instanceof SfecConfigError && err.code === 'SFEC_CONFIG_MISSING_AUTH',
  );
});

test('loadConfig accepte mtls comme seule auth (mode TCC/TFC)', () => {
  const cfg = loadConfig({
    env: 'production',
    mtls: { cert: FAKE_PEM_CERT, key: FAKE_PEM_KEY },
    processEnv: {},
  });
  assert.equal(cfg.apiKey, undefined);
  assert.ok(cfg.mtls);
  assert.equal(cfg.mtls.cert, FAKE_PEM_CERT);
});

test('loadConfig accepte mtls en Buffer', () => {
  const cfg = loadConfig({
    env: 'sandbox',
    mtls: { cert: Buffer.from(FAKE_PEM_CERT), key: Buffer.from(FAKE_PEM_KEY) },
    processEnv: {},
  });
  assert.ok(Buffer.isBuffer(cfg.mtls.cert));
});

test('loadConfig mtls refuse chemin/string vide/type invalide', () => {
  const base = { env: 'sandbox', processEnv: {} };
  assert.throws(
    () => loadConfig({ ...base, mtls: { cert: '', key: FAKE_PEM_KEY } }),
    SfecConfigError,
  );
  assert.throws(
    () => loadConfig({ ...base, mtls: { cert: 123, key: FAKE_PEM_KEY } }),
    SfecConfigError,
  );
  assert.throws(() => loadConfig({ ...base, mtls: null }), SfecConfigError);
});

test('loadConfig mtls.toJSON et inspect masquent le materiel crypto', () => {
  const cfg = loadConfig({
    env: 'sandbox',
    mtls: { cert: FAKE_PEM_CERT, key: FAKE_PEM_KEY, ca: FAKE_PEM_CERT },
    processEnv: {},
  });
  const json = JSON.stringify(cfg.mtls);
  assert.ok(!json.includes('BEGIN'));
  assert.equal(JSON.parse(json).cert, '***');
  assert.equal(JSON.parse(json).key, '***');
  assert.equal(JSON.parse(json).ca, '***');
});

test('loadConfig timeoutMs et retry surchargeables et valides', () => {
  const cfg = loadConfig({
    env: 'sandbox',
    apiKey: 'sk',
    timeoutMs: 5000,
    retry: { max: 5, baseDelayMs: 100 },
    processEnv: {},
  });
  assert.equal(cfg.timeoutMs, 5000);
  assert.deepEqual({ max: cfg.retry.max, baseDelayMs: cfg.retry.baseDelayMs }, {
    max: 5,
    baseDelayMs: 100,
  });
});

test('loadConfig refuse timeoutMs invalide', () => {
  const base = { env: 'sandbox', apiKey: 'sk', processEnv: {} };
  assert.throws(() => loadConfig({ ...base, timeoutMs: 0 }), SfecConfigError);
  assert.throws(() => loadConfig({ ...base, timeoutMs: -1 }), SfecConfigError);
  assert.throws(() => loadConfig({ ...base, timeoutMs: 1.5 }), SfecConfigError);
});

test('loadConfig refuse retry invalide', () => {
  const base = { env: 'sandbox', apiKey: 'sk', processEnv: {} };
  assert.throws(() => loadConfig({ ...base, retry: { max: -1 } }), SfecConfigError);
  assert.throws(() => loadConfig({ ...base, retry: { baseDelayMs: 0 } }), SfecConfigError);
});

test('loadConfig retry.max=0 est autorise (desactive le retry)', () => {
  const cfg = loadConfig({ env: 'sandbox', apiKey: 'sk', retry: { max: 0 }, processEnv: {} });
  assert.equal(cfg.retry.max, 0);
});

test('config retournee est immutable (freeze)', () => {
  const cfg = loadConfig({ env: 'sandbox', apiKey: 'sk', processEnv: {} });
  assert.ok(Object.isFrozen(cfg));
  assert.ok(Object.isFrozen(cfg.retry));
  assert.throws(() => {
    cfg.env = 'production';
  });
});

test('JSON.stringify(config) ne fuite pas la cle API', () => {
  const cfg = loadConfig({ env: 'sandbox', apiKey: 'sk_super_secret', processEnv: {} });
  const json = JSON.stringify(cfg);
  assert.ok(!json.includes('sk_super_secret'));
  assert.ok(json.includes('***'));
});

test('SFEC_CLIENT_API_KEY vide est ignore (comme absent)', () => {
  assert.throws(
    () => loadConfig({ processEnv: { SFEC_CLIENT_ENV: 'sandbox', SFEC_CLIENT_API_KEY: '' } }),
    (err) => err.code === 'SFEC_CONFIG_MISSING_AUTH',
  );
});
