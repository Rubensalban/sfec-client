import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SfecError,
  SfecValidationError,
  SfecConfigError,
  SfecHttpError,
  SfecNetworkError,
  redactSensitive,
} from '../src/errors.js';

test('redactSensitive masque les cles sensibles (insensible a la casse)', () => {
  const input = {
    apiKey: 'sk_123',
    'X-API-Key': 'sk_456',
    Authorization: 'Bearer xxx',
    token: 'abc',
    signingPrivateKey: '-----BEGIN-----',
    safe: 'ok',
  };
  const out = redactSensitive(input);
  assert.equal(out.apiKey, '***');
  assert.equal(out['X-API-Key'], '***');
  assert.equal(out.Authorization, '***');
  assert.equal(out.token, '***');
  assert.equal(out.signingPrivateKey, '***');
  assert.equal(out.safe, 'ok');
});

test('redactSensitive est pure (ne mute pas l input)', () => {
  const input = { apiKey: 'sk_123', nested: { token: 't' } };
  const snapshot = JSON.stringify(input);
  redactSensitive(input);
  assert.equal(JSON.stringify(input), snapshot);
});

test('redactSensitive traverse arrays et objets imbriques', () => {
  const input = {
    headers: [{ name: 'X-API-Key', value: 'sk' }],
    nested: { deep: { secret: 'oops' } },
  };
  const out = redactSensitive(input);
  assert.equal(out.nested.deep.secret, '***');
  assert.equal(out.headers[0].name, 'X-API-Key');
  assert.equal(out.headers[0].value, 'sk');
});

test('redactSensitive gere les references circulaires', () => {
  const input = { a: 1 };
  input.self = input;
  const out = redactSensitive(input);
  assert.equal(out.a, 1);
  assert.equal(out.self, '[Circular]');
});

test('SfecError porte name, code et message', () => {
  const e = new SfecError('boom', { code: 'X', details: { foo: 'bar' } });
  assert.equal(e.name, 'SfecError');
  assert.equal(e.code, 'X');
  assert.equal(e.message, 'boom');
  assert.deepEqual(e.details, { foo: 'bar' });
});

test('SfecError.toJSON renvoie une forme safe', () => {
  const e = new SfecError('boom', { details: { apiKey: 'sk_123', ok: 1 } });
  const json = e.toJSON();
  assert.equal(json.details.apiKey, '***');
  assert.equal(json.details.ok, 1);
});

test('SfecValidationError expose fields et code stable', () => {
  const fields = [{ path: 'items[0].unit_price', message: 'requis', code: 'REQUIRED' }];
  const e = new SfecValidationError('payload invalide', fields);
  assert.equal(e.name, 'SfecValidationError');
  assert.equal(e.code, 'SFEC_VALIDATION_ERROR');
  assert.deepEqual(e.fields, fields);
  assert.deepEqual(e.toJSON().fields, fields);
});

test('SfecConfigError porte le bon code par defaut', () => {
  const e = new SfecConfigError('env manquante');
  assert.equal(e.code, 'SFEC_CONFIG_ERROR');
  assert.ok(e instanceof SfecError);
});

test('SfecHttpError redacte le body et expose les helpers', () => {
  const e = new SfecHttpError('unauthorized', {
    status: 401,
    body: { apiKey: 'sk_leak', detail: 'invalid' },
    url: 'https://api/v1/invoices',
    method: 'POST',
  });
  assert.equal(e.status, 401);
  assert.equal(e.code, 'SFEC_HTTP_401');
  assert.equal(e.body.apiKey, '***');
  assert.equal(e.body.detail, 'invalid');
  assert.equal(e.isUnauthorized(), true);
  assert.equal(e.isConflict(), false);
  assert.equal(e.isClientError(), true);
  assert.equal(e.isServerError(), false);
});

test('SfecHttpError helpers reconnaissent les statuts', () => {
  assert.equal(new SfecHttpError('m', { status: 403 }).isForbidden(), true);
  assert.equal(new SfecHttpError('m', { status: 404 }).isNotFound(), true);
  assert.equal(new SfecHttpError('m', { status: 409 }).isConflict(), true);
  assert.equal(new SfecHttpError('m', { status: 422 }).isUnprocessable(), true);
  assert.equal(new SfecHttpError('m', { status: 503 }).isServerError(), true);
});

test('SfecNetworkError distingue timeout et erreur generique', () => {
  const t = new SfecNetworkError('timeout', { timeout: true });
  assert.equal(t.code, 'SFEC_NETWORK_TIMEOUT');
  assert.equal(t.timeout, true);

  const n = new SfecNetworkError('econnrefused');
  assert.equal(n.code, 'SFEC_NETWORK_ERROR');
  assert.equal(n.timeout, false);
});

test('toutes les sous-classes sont instanceof SfecError', () => {
  assert.ok(new SfecValidationError('m') instanceof SfecError);
  assert.ok(new SfecConfigError('m') instanceof SfecError);
  assert.ok(new SfecHttpError('m', { status: 500 }) instanceof SfecError);
  assert.ok(new SfecNetworkError('m') instanceof SfecError);
});
