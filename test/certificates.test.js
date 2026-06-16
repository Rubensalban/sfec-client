import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { inspect } from 'node:util';
import { claimCertificates } from '../src/certificates.js';
import { bootstrapConfig } from '../src/config.js';
import { SfecValidationError, SfecHttpError } from '../src/errors.js';

function startServer(handler) {
  return new Promise((resolve) => {
    let count = 0;
    const server = http.createServer((req, res) => {
      count += 1;
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try { req.body = body ? JSON.parse(body) : undefined; } catch { req.body = body; }
        handler(req, res, count);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        getCount: () => count,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

const FAKE_RESPONSE = {
  signingPrivateKey: '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----',
  encryptionMasterKey: 'deadbeef1234',
  mtlsClientCertificate: '-----BEGIN CERTIFICATE-----\nCERT\n-----END CERTIFICATE-----',
  mtlsClientPrivateKey: '-----BEGIN PRIVATE KEY-----\nMTLSKEY\n-----END PRIVATE KEY-----',
  taxpayerInfo: { tradeName: 'ACME', rccm: 'CG-BZV-01', currency: 'XAF' },
  mtlsEndpoints: { submit: 'https://api/v1/invoices' },
};

test('claimCertificates : POST /v1/certificates/claim-with-token avec body correct', async () => {
  let received;
  const srv = await startServer((req, res) => {
    received = { method: req.method, url: req.url, body: req.body };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(FAKE_RESPONSE));
  });
  try {
    const cfg = bootstrapConfig({ baseUrl: srv.baseUrl, processEnv: {} });
    const creds = await claimCertificates(cfg, {
      token: 'bootstrap_token_xxx',
      niu: 'M987654321',
      terminalIdentifier: 'TERMINAL-001',
    });
    assert.equal(received.method, 'POST');
    assert.equal(received.url, '/v1/certificates/claim-with-token');
    assert.equal(received.body.token, 'bootstrap_token_xxx');
    assert.equal(received.body.niu, 'M987654321');
    assert.equal(received.body.terminal_identifier, 'TERMINAL-001');
    assert.ok(creds);
  } finally {
    await srv.close();
  }
});

test('claimCertificates : Credentials masque les secrets en JSON/inspect', async () => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(FAKE_RESPONSE));
  });
  try {
    const cfg = bootstrapConfig({ baseUrl: srv.baseUrl, processEnv: {} });
    const creds = await claimCertificates(cfg, { token: 't', niu: 'n' });
    const json = JSON.stringify(creds);
    assert.ok(!json.includes('BEGIN PRIVATE KEY'));
    assert.ok(!json.includes('deadbeef'));
    assert.ok(!json.includes('MTLSKEY'));
    const parsed = JSON.parse(json);
    assert.equal(parsed.signingPrivateKey, '***');
    assert.equal(parsed.encryptionMasterKey, '***');
    assert.equal(parsed.mtlsClientCertificate, '***');
    assert.equal(parsed.mtlsClientPrivateKey, '***');
    assert.deepEqual(parsed.taxpayerInfo, FAKE_RESPONSE.taxpayerInfo);
    const inspected = inspect(creds);
    assert.ok(!inspected.includes('BEGIN PRIVATE KEY'));
  } finally {
    await srv.close();
  }
});

test('claimCertificates : reveal() retourne les secrets en clair', async () => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(FAKE_RESPONSE));
  });
  try {
    const cfg = bootstrapConfig({ baseUrl: srv.baseUrl, processEnv: {} });
    const creds = await claimCertificates(cfg, { token: 't', niu: 'n' });
    const all = creds.reveal();
    assert.ok(all.signingPrivateKey.includes('BEGIN PRIVATE KEY'));
    assert.equal(all.encryptionMasterKey, 'deadbeef1234');
    assert.ok(all.mtlsClientPrivateKey.includes('MTLSKEY'));
  } finally {
    await srv.close();
  }
});

test('claimCertificates : toMtls() retourne { cert, key } pret pour loadConfig', async () => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(FAKE_RESPONSE));
  });
  try {
    const cfg = bootstrapConfig({ baseUrl: srv.baseUrl, processEnv: {} });
    const creds = await claimCertificates(cfg, { token: 't', niu: 'n' });
    const mtls = creds.toMtls();
    assert.equal(mtls.cert, FAKE_RESPONSE.mtlsClientCertificate);
    assert.equal(mtls.key, FAKE_RESPONSE.mtlsClientPrivateKey);
  } finally {
    await srv.close();
  }
});

test('claimCertificates : params invalides rejetes AVANT reseau', async () => {
  const srv = await startServer(() => { throw new Error('non appele'); });
  try {
    const cfg = bootstrapConfig({ baseUrl: srv.baseUrl, processEnv: {} });
    await assert.rejects(() => claimCertificates(cfg, {}), SfecValidationError);
    await assert.rejects(() => claimCertificates(cfg, { token: 't' }), SfecValidationError);
    await assert.rejects(() => claimCertificates(cfg, { niu: 'n' }), SfecValidationError);
    await assert.rejects(() => claimCertificates(cfg, null), SfecValidationError);
    assert.equal(srv.getCount(), 0);
  } finally {
    await srv.close();
  }
});

test('claimCertificates : 401 (token invalide) remonte SfecHttpError', async () => {
  const srv = await startServer((req, res) => {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid token' }));
  });
  try {
    const cfg = bootstrapConfig({ baseUrl: srv.baseUrl, processEnv: {} });
    await assert.rejects(
      () => claimCertificates(cfg, { token: 'wrong', niu: 'n' }),
      (err) => err instanceof SfecHttpError && err.isUnauthorized(),
    );
  } finally {
    await srv.close();
  }
});

test('claimCertificates : Credentials est immutable (freeze)', async () => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(FAKE_RESPONSE));
  });
  try {
    const cfg = bootstrapConfig({ baseUrl: srv.baseUrl, processEnv: {} });
    const creds = await claimCertificates(cfg, { token: 't', niu: 'n' });
    assert.ok(Object.isFrozen(creds));
    assert.throws(() => { creds.reveal = () => 'hacked'; });
  } finally {
    await srv.close();
  }
});

test('claimCertificates : hook onResponse recoit body redacte (defense en profondeur)', async () => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(FAKE_RESPONSE));
  });
  try {
    const cfg = bootstrapConfig({ baseUrl: srv.baseUrl, processEnv: {} });
    let captured;
    await claimCertificates(cfg, { token: 't', niu: 'n' }, {
      hooks: { onResponse: (info) => { captured = info; } },
    });
    assert.equal(captured.body.signingPrivateKey, '***');
    assert.equal(captured.body.mtlsClientPrivateKey, '***');
  } finally {
    await srv.close();
  }
});

test('bootstrapConfig : refuse sans baseUrl', () => {
  assert.throws(
    () => bootstrapConfig({ processEnv: {} }),
    (err) => err.code === 'SFEC_CONFIG_MISSING_BASE_URL',
  );
});

test('bootstrapConfig : lit baseUrl depuis env', () => {
  const cfg = bootstrapConfig({
    processEnv: { SFEC_CLIENT_BASE_URL: 'https://api.example.test' },
  });
  assert.equal(cfg.baseUrl, 'https://api.example.test');
  assert.equal(cfg.apiKey, undefined);
  assert.equal(cfg.mtls, undefined);
});
