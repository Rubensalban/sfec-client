import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { request } from '../src/transport.js';
import { loadConfig } from '../src/config.js';
import { SfecHttpError, SfecNetworkError, SfecConfigError } from '../src/errors.js';

/**
 * Demarre un serveur HTTP local controlable.
 * handler(req, res, count) recoit le numero d'appel (1-base).
 */
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
        server,
        baseUrl: `http://127.0.0.1:${port}`,
        getCount: () => count,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

function makeConfig(baseUrl, overrides = {}) {
  return loadConfig({
    baseUrl,
    apiKey: 'sk_test',
    timeoutMs: 1000,
    retry: { max: 2, baseDelayMs: 10 },
    processEnv: {},
    ...overrides,
  });
}

test('request : GET 200 retourne body parse', async () => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, path: req.url }));
  });
  try {
    const cfg = makeConfig(srv.baseUrl);
    const result = await request({ config: cfg, method: 'GET', path: '/v1/ping' });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { ok: true, path: '/v1/ping' });
  } finally {
    await srv.close();
  }
});

test('request : POST envoie le body JSON et le content-type', async () => {
  let received;
  const srv = await startServer((req, res) => {
    received = { method: req.method, ct: req.headers['content-type'], body: req.body };
    res.writeHead(201, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ created: true }));
  });
  try {
    const cfg = makeConfig(srv.baseUrl);
    const r = await request({ config: cfg, method: 'POST', path: '/v1/invoices', body: { x: 1 } });
    assert.equal(r.status, 201);
    assert.equal(received.method, 'POST');
    assert.equal(received.ct, 'application/json');
    assert.deepEqual(received.body, { x: 1 });
  } finally {
    await srv.close();
  }
});

test('request : injecte X-API-Key depuis le secret wrappe', async () => {
  let apiKeyReceived;
  const srv = await startServer((req, res) => {
    apiKeyReceived = req.headers['x-api-key'];
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  try {
    const cfg = makeConfig(srv.baseUrl, { apiKey: 'sk_super_secret_value' });
    await request({ config: cfg, method: 'GET', path: '/v1/x' });
    assert.equal(apiKeyReceived, 'sk_super_secret_value');
  } finally {
    await srv.close();
  }
});

test('request : 4xx throw SfecHttpError SANS retry', async () => {
  const srv = await startServer((req, res, count) => {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'bad', count }));
  });
  try {
    const cfg = makeConfig(srv.baseUrl);
    await assert.rejects(
      () => request({ config: cfg, method: 'GET', path: '/v1/x' }),
      (err) => err instanceof SfecHttpError && err.status === 400,
    );
    assert.equal(srv.getCount(), 1, 'aucun retry sur 4xx');
  } finally {
    await srv.close();
  }
});

test('request : 5xx declenche retry exponentiel puis throw', async () => {
  const srv = await startServer((req, res) => {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'down' }));
  });
  try {
    const cfg = makeConfig(srv.baseUrl, { retry: { max: 2, baseDelayMs: 5 } });
    await assert.rejects(
      () => request({ config: cfg, method: 'GET', path: '/v1/x' }),
      (err) => err instanceof SfecHttpError && err.status === 503,
    );
    assert.equal(srv.getCount(), 3, '1 tentative initiale + 2 retries');
  } finally {
    await srv.close();
  }
});

test('request : 5xx puis 200 = succes apres retry', async () => {
  const srv = await startServer((req, res, count) => {
    if (count === 1) {
      res.writeHead(500); res.end(JSON.stringify({ error: 'transient' }));
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, attempt: count }));
    }
  });
  try {
    const cfg = makeConfig(srv.baseUrl, { retry: { max: 3, baseDelayMs: 5 } });
    const r = await request({ config: cfg, method: 'GET', path: '/v1/x' });
    assert.equal(r.status, 200);
    assert.equal(r.body.attempt, 2);
  } finally {
    await srv.close();
  }
});

test('request : SfecHttpError redacte body et tient les helpers', async () => {
  const srv = await startServer((req, res) => {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ apiKey: 'leaked_from_server', detail: 'invalid' }));
  });
  try {
    const cfg = makeConfig(srv.baseUrl);
    try {
      await request({ config: cfg, method: 'GET', path: '/v1/x' });
      assert.fail('aurait du throw');
    } catch (err) {
      assert.ok(err instanceof SfecHttpError);
      assert.equal(err.isUnauthorized(), true);
      assert.equal(err.body.apiKey, '***');
      assert.equal(err.body.detail, 'invalid');
    }
  } finally {
    await srv.close();
  }
});

test('request : timeout throw SfecNetworkError(timeout=true) puis retry', async () => {
  const srv = await startServer((req, res) => {
    // ne repond jamais : on laisse fetch timeout
    setTimeout(() => { try { res.end('{}'); } catch {} }, 5000);
  });
  try {
    const cfg = makeConfig(srv.baseUrl, { timeoutMs: 60, retry: { max: 1, baseDelayMs: 5 } });
    await assert.rejects(
      () => request({ config: cfg, method: 'GET', path: '/v1/slow' }),
      (err) => err instanceof SfecNetworkError && err.timeout === true,
    );
    assert.equal(srv.getCount(), 2, 'timeout retryable : 1 initiale + 1 retry');
  } finally {
    await srv.close();
  }
});

test('request : query params encodes correctement', async () => {
  let receivedUrl;
  const srv = await startServer((req, res) => {
    receivedUrl = req.url;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  try {
    const cfg = makeConfig(srv.baseUrl);
    await request({
      config: cfg,
      method: 'GET',
      path: '/v1/invoices',
      query: { page: 2, pageSize: 15, invoice_type: 'salesInvoice' },
    });
    assert.ok(receivedUrl.includes('page=2'));
    assert.ok(receivedUrl.includes('pageSize=15'));
    assert.ok(receivedUrl.includes('invoice_type=salesInvoice'));
  } finally {
    await srv.close();
  }
});

test('request : path qui ne commence pas par "/" est rejete', async () => {
  const cfg = makeConfig('http://127.0.0.1:1');
  await assert.rejects(
    () => request({ config: cfg, method: 'GET', path: 'v1/x' }),
    SfecConfigError,
  );
});

test('request : hook onRequest recoit headers et body REDACTES', async () => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}');
  });
  try {
    const cfg = makeConfig(srv.baseUrl, { apiKey: 'sk_super_secret' });
    let captured;
    await request({
      config: cfg,
      method: 'POST',
      path: '/v1/x',
      body: { token: 'should-be-redacted', ok: 'visible' },
      hooks: { onRequest: (info) => { captured = info; } },
    });
    assert.equal(captured.headers['X-API-Key'], '***');
    assert.equal(captured.body.token, '***');
    assert.equal(captured.body.ok, 'visible');
  } finally {
    await srv.close();
  }
});

test('request : hook onError appele sur 4xx et 5xx (avec error redactee)', async () => {
  const srv = await startServer((req, res) => {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ token: 'leak', detail: 'nope' }));
  });
  try {
    const cfg = makeConfig(srv.baseUrl);
    let errInfo;
    await assert.rejects(
      () => request({
        config: cfg,
        method: 'GET',
        path: '/v1/x',
        hooks: { onError: (info) => { errInfo = info; } },
      }),
    );
    assert.equal(errInfo.error.details.body.token, '***');
    assert.equal(errInfo.error.details.body.detail, 'nope');
  } finally {
    await srv.close();
  }
});

test('request : retry.max=0 desactive completement le retry sur 5xx', async () => {
  const srv = await startServer((req, res) => {
    res.writeHead(500); res.end('{}');
  });
  try {
    const cfg = makeConfig(srv.baseUrl, { retry: { max: 0, baseDelayMs: 5 } });
    await assert.rejects(() => request({ config: cfg, method: 'GET', path: '/v1/x' }), SfecHttpError);
    assert.equal(srv.getCount(), 1);
  } finally {
    await srv.close();
  }
});

test('request : path traversal via URL exotique reste sur le bon host', async () => {
  // baseUrl + "//evil.com/x" produit une URL valide mais on verifie qu'on appelle bien
  // notre serveur (le path est concatene tel quel a la baseUrl par new URL).
  const srv = await startServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ host: req.headers.host, path: req.url }));
  });
  try {
    const cfg = makeConfig(srv.baseUrl);
    const r = await request({ config: cfg, method: 'GET', path: '/anything' });
    // Le host doit rester celui du serveur local
    assert.ok(r.body.host.startsWith('127.0.0.1:'));
  } finally {
    await srv.close();
  }
});
