import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { loadConfig, validateBaseUrl, wrapSecret } from '../src/config.js';
import { SfecConfigError } from '../src/errors.js';

const FAKE_PEM_CERT = '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----';
const FAKE_PEM_KEY = '-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----';
const VALID_URL = 'https://api.example.test';

// --- wrapSecret ---

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

// --- validateBaseUrl ---

test('validateBaseUrl accepte une URL HTTPS valide', () => {
  assert.equal(validateBaseUrl('https://api.example.test'), 'https://api.example.test');
  assert.equal(validateBaseUrl('https://api.example.test/api/v1'), 'https://api.example.test/api/v1');
});

test('validateBaseUrl normalise le trailing slash', () => {
  assert.equal(validateBaseUrl('https://api.example.test/'), 'https://api.example.test');
  assert.equal(validateBaseUrl('https://api.example.test/api/'), 'https://api.example.test/api');
});

test('validateBaseUrl autorise http uniquement pour localhost / 127.0.0.1 / ::1', () => {
  assert.equal(validateBaseUrl('http://localhost:3000'), 'http://localhost:3000');
  assert.equal(validateBaseUrl('http://127.0.0.1:8080'), 'http://127.0.0.1:8080');
  assert.equal(validateBaseUrl('http://[::1]:9000'), 'http://[::1]:9000');
});

test('validateBaseUrl refuse http pour un domaine non-local', () => {
  assert.throws(
    () => validateBaseUrl('http://api.example.test'),
    (err) => err instanceof SfecConfigError && err.code === 'SFEC_CONFIG_INSECURE_BASE_URL',
  );
});

test('validateBaseUrl refuse les protocoles non HTTP(S)', () => {
  assert.throws(() => validateBaseUrl('ftp://api.example.test'), SfecConfigError);
  assert.throws(() => validateBaseUrl('file:///etc/passwd'), SfecConfigError);
  assert.throws(() => validateBaseUrl('javascript:alert(1)'), SfecConfigError);
});

test('validateBaseUrl refuse une URL invalide ou vide', () => {
  assert.throws(() => validateBaseUrl(''), SfecConfigError);
  assert.throws(() => validateBaseUrl('pas une url'), SfecConfigError);
  assert.throws(() => validateBaseUrl('//api.example.test'), SfecConfigError);
  assert.throws(() => validateBaseUrl(undefined), SfecConfigError);
  assert.throws(() => validateBaseUrl(null), SfecConfigError);
});

// --- loadConfig ---

test('loadConfig lit baseUrl et apiKey depuis processEnv injecte', () => {
  const cfg = loadConfig({
    processEnv: {
      SFEC_CLIENT_BASE_URL: VALID_URL,
      SFEC_CLIENT_API_KEY: 'sk_test_abc',
      SFEC_CLIENT_ENV: 'sandbox',
    },
  });
  assert.equal(cfg.baseUrl, VALID_URL);
  assert.equal(cfg.env, 'sandbox');
  assert.equal(cfg.apiKey.reveal(), 'sk_test_abc');
  assert.equal(cfg.timeoutMs, 30000);
  assert.deepEqual({ max: cfg.retry.max, baseDelayMs: cfg.retry.baseDelayMs }, {
    max: 3,
    baseDelayMs: 500,
  });
});

test('loadConfig env vaut "unknown" si non fourni', () => {
  const cfg = loadConfig({
    processEnv: { SFEC_CLIENT_BASE_URL: VALID_URL, SFEC_CLIENT_API_KEY: 'sk' },
  });
  assert.equal(cfg.env, 'unknown');
});

test('loadConfig options explicites surchargent processEnv', () => {
  const cfg = loadConfig({
    baseUrl: 'https://other.example.test',
    apiKey: 'sk_explicit',
    env: 'staging',
    processEnv: {
      SFEC_CLIENT_BASE_URL: VALID_URL,
      SFEC_CLIENT_API_KEY: 'sk_env',
      SFEC_CLIENT_ENV: 'sandbox',
    },
  });
  assert.equal(cfg.baseUrl, 'https://other.example.test');
  assert.equal(cfg.env, 'staging');
  assert.equal(cfg.apiKey.reveal(), 'sk_explicit');
});

test('loadConfig throw si SFEC_CLIENT_BASE_URL manquante', () => {
  assert.throws(
    () => loadConfig({ processEnv: { SFEC_CLIENT_API_KEY: 'sk' } }),
    (err) => err instanceof SfecConfigError && err.code === 'SFEC_CONFIG_MISSING_BASE_URL',
  );
});

test('loadConfig throw si baseUrl est invalide', () => {
  assert.throws(
    () => loadConfig({ processEnv: { SFEC_CLIENT_BASE_URL: 'pas-une-url', SFEC_CLIENT_API_KEY: 'sk' } }),
    SfecConfigError,
  );
  assert.throws(
    () => loadConfig({ processEnv: { SFEC_CLIENT_BASE_URL: 'http://insecure.example', SFEC_CLIENT_API_KEY: 'sk' } }),
    (err) => err.code === 'SFEC_CONFIG_INSECURE_BASE_URL',
  );
});

test('loadConfig throw si aucune auth (ni apiKey ni mtls)', () => {
  assert.throws(
    () => loadConfig({ processEnv: { SFEC_CLIENT_BASE_URL: VALID_URL } }),
    (err) => err instanceof SfecConfigError && err.code === 'SFEC_CONFIG_MISSING_AUTH',
  );
});

test('loadConfig accepte mtls comme seule auth (mode TCC/TFC)', () => {
  const cfg = loadConfig({
    baseUrl: VALID_URL,
    mtls: { cert: FAKE_PEM_CERT, key: FAKE_PEM_KEY },
    processEnv: {},
  });
  assert.equal(cfg.apiKey, undefined);
  assert.ok(cfg.mtls);
  assert.equal(cfg.mtls.cert, FAKE_PEM_CERT);
});

test('loadConfig accepte mtls en Buffer', () => {
  const cfg = loadConfig({
    baseUrl: VALID_URL,
    mtls: { cert: Buffer.from(FAKE_PEM_CERT), key: Buffer.from(FAKE_PEM_KEY) },
    processEnv: {},
  });
  assert.ok(Buffer.isBuffer(cfg.mtls.cert));
});

test('loadConfig mtls refuse string vide / type invalide / null', () => {
  const base = { baseUrl: VALID_URL, processEnv: {} };
  assert.throws(() => loadConfig({ ...base, mtls: { cert: '', key: FAKE_PEM_KEY } }), SfecConfigError);
  assert.throws(() => loadConfig({ ...base, mtls: { cert: 123, key: FAKE_PEM_KEY } }), SfecConfigError);
  assert.throws(() => loadConfig({ ...base, mtls: null }), SfecConfigError);
});

test('loadConfig mtls.toJSON et inspect masquent le materiel crypto', () => {
  const cfg = loadConfig({
    baseUrl: VALID_URL,
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
    baseUrl: VALID_URL,
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
  const base = { baseUrl: VALID_URL, apiKey: 'sk', processEnv: {} };
  assert.throws(() => loadConfig({ ...base, timeoutMs: 0 }), SfecConfigError);
  assert.throws(() => loadConfig({ ...base, timeoutMs: -1 }), SfecConfigError);
  assert.throws(() => loadConfig({ ...base, timeoutMs: 1.5 }), SfecConfigError);
});

test('loadConfig refuse retry invalide', () => {
  const base = { baseUrl: VALID_URL, apiKey: 'sk', processEnv: {} };
  assert.throws(() => loadConfig({ ...base, retry: { max: -1 } }), SfecConfigError);
  assert.throws(() => loadConfig({ ...base, retry: { baseDelayMs: 0 } }), SfecConfigError);
});

test('loadConfig retry.max=0 est autorise (desactive le retry)', () => {
  const cfg = loadConfig({ baseUrl: VALID_URL, apiKey: 'sk', retry: { max: 0 }, processEnv: {} });
  assert.equal(cfg.retry.max, 0);
});

test('config retournee est immutable (freeze)', () => {
  const cfg = loadConfig({ baseUrl: VALID_URL, apiKey: 'sk', processEnv: {} });
  assert.ok(Object.isFrozen(cfg));
  assert.ok(Object.isFrozen(cfg.retry));
  assert.throws(() => {
    cfg.baseUrl = 'https://hack.example';
  });
});

test('JSON.stringify(config) ne fuite pas la cle API', () => {
  const cfg = loadConfig({ baseUrl: VALID_URL, apiKey: 'sk_super_secret', processEnv: {} });
  const json = JSON.stringify(cfg);
  assert.ok(!json.includes('sk_super_secret'));
  assert.ok(json.includes('***'));
});

test('SFEC_CLIENT_API_KEY vide est ignore (comme absent)', () => {
  assert.throws(
    () => loadConfig({
      processEnv: { SFEC_CLIENT_BASE_URL: VALID_URL, SFEC_CLIENT_API_KEY: '' },
    }),
    (err) => err.code === 'SFEC_CONFIG_MISSING_AUTH',
  );
});

test('loadConfig normalise le trailing slash de la baseUrl', () => {
  const cfg = loadConfig({
    baseUrl: 'https://api.example.test/api/',
    apiKey: 'sk',
    processEnv: {},
  });
  assert.equal(cfg.baseUrl, 'https://api.example.test/api');
});
