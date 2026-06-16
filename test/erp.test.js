import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { erpSubmit, erpList } from '../src/modes/erp.js';
import { loadConfig } from '../src/config.js';
import { SfecHttpError, SfecValidationError, SfecConfigError } from '../src/errors.js';

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

function makeConfig(baseUrl, overrides = {}) {
  return loadConfig({
    baseUrl,
    apiKey: 'sk_test',
    timeoutMs: 1000,
    retry: { max: 0, baseDelayMs: 5 },
    processEnv: {},
    ...overrides,
  });
}

const validInput = {
  taxpayer_niu: 'M987654321',
  recipient: { type: 'business', name: 'ACME', niu: 'P123' },
  items: [{ designation: 'Service A', type: 'service', unit_price: 1000, quantity: 2, tax_rate: '18' }],
  payment: { method: 'mobile_money', currency: 'XAF' },
};

// --- erpSubmit ---

test('erpSubmit : envoie POST /v1/invoices avec X-API-Key et payload build', async () => {
  let received;
  const srv = await startServer((req, res) => {
    received = { method: req.method, url: req.url, apiKey: req.headers['x-api-key'], body: req.body };
    res.writeHead(201, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      invoice_id: 'srv-uuid',
      invoice_number: 'F-2026-0001',
      sfec_certification_number: 'CERT-XYZ',
      sfec_identifier: 'SH-AB12',
      sfec_qr_code: 'data:image/png;base64,iVBORw0KGgo=',
      certification_date: '2026-06-16T10:00:00Z',
    }));
  });
  try {
    const cfg = makeConfig(srv.baseUrl, { apiKey: 'sk_real_key' });
    const r = await erpSubmit(cfg, validInput);
    assert.equal(received.method, 'POST');
    assert.equal(received.url, '/v1/invoices');
    assert.equal(received.apiKey, 'sk_real_key');
    assert.equal(received.body.taxpayer_niu, 'M987654321');
    assert.equal(received.body.electronic_stamp_duty, 0);
    assert.equal(r.invoiceNumber, 'F-2026-0001');
    assert.equal(r.certificationNumber, 'CERT-XYZ');
    assert.equal(r.shortIdentifier, 'SH-AB12');
    assert.equal(r.qrCode, 'data:image/png;base64,iVBORw0KGgo=');
    assert.equal(r.certificationDate, '2026-06-16T10:00:00Z');
    assert.ok(r.raw);
  } finally {
    await srv.close();
  }
});

test('erpSubmit : valide l input AVANT tout appel reseau', async () => {
  const srv = await startServer(() => { throw new Error('ne devrait pas etre appele'); });
  try {
    const cfg = makeConfig(srv.baseUrl);
    await assert.rejects(
      () => erpSubmit(cfg, { items: [] }),
      SfecValidationError,
    );
    assert.equal(srv.getCount(), 0, 'aucun appel reseau si input invalide');
  } finally {
    await srv.close();
  }
});

test('erpSubmit : 409 (deja certifiee) remonte un SfecHttpError.isConflict()', async () => {
  const srv = await startServer((req, res) => {
    res.writeHead(409, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'invoice already certified' }));
  });
  try {
    const cfg = makeConfig(srv.baseUrl);
    try {
      await erpSubmit(cfg, { ...validInput, invoice_id: 'dup-1' });
      assert.fail('aurait du throw');
    } catch (err) {
      assert.ok(err instanceof SfecHttpError);
      assert.equal(err.isConflict(), true);
    }
  } finally {
    await srv.close();
  }
});

test('erpSubmit : 422 (validation serveur) remonte avec body redacte', async () => {
  const srv = await startServer((req, res) => {
    res.writeHead(422, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ apiKey: 'leak', detail: 'totaux incoherents' }));
  });
  try {
    const cfg = makeConfig(srv.baseUrl);
    try {
      await erpSubmit(cfg, validInput);
    } catch (err) {
      assert.ok(err instanceof SfecHttpError);
      assert.equal(err.isUnprocessable(), true);
      assert.equal(err.body.apiKey, '***');
      assert.equal(err.body.detail, 'totaux incoherents');
    }
  } finally {
    await srv.close();
  }
});

test('erpSubmit : refuse une config sans apiKey (mode mTLS pur)', async () => {
  const cfg = loadConfig({
    baseUrl: 'https://api.example.test',
    mtls: { cert: 'X', key: 'X' },
    processEnv: {},
  });
  await assert.rejects(
    () => erpSubmit(cfg, validInput),
    (err) => err instanceof SfecConfigError && err.code === 'SFEC_ERP_NO_API_KEY',
  );
});

test('erpSubmit : normalisation tolerante si certains champs serveur manquent', async () => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ invoice_id: 'id', invoice_number: 'INV-1' })); // pas de qr_code
  });
  try {
    const cfg = makeConfig(srv.baseUrl);
    const r = await erpSubmit(cfg, validInput);
    assert.equal(r.invoiceId, 'id');
    assert.equal(r.invoiceNumber, 'INV-1');
    assert.equal(r.qrCode, null);
    assert.equal(r.shortIdentifier, null);
  } finally {
    await srv.close();
  }
});

// --- erpList ---

test('erpList : appelle GET /v1/invoices avec query snake_case', async () => {
  let url;
  const srv = await startServer((req, res) => {
    url = req.url;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ invoices: [{ id: 1 }], page: 2, pageSize: 15, totalPages: 5 }));
  });
  try {
    const cfg = makeConfig(srv.baseUrl);
    const r = await erpList(cfg, {
      page: 2,
      pageSize: 15,
      invoiceType: 'salesInvoice',
      dateStart: '2026-01-01',
      dateEnd: '2026-01-31',
    });
    assert.ok(url.includes('page=2'));
    assert.ok(url.includes('pageSize=15'));
    assert.ok(url.includes('invoice_type=salesInvoice'));
    assert.ok(url.includes('date_start=2026-01-01'));
    assert.ok(url.includes('date_end=2026-01-31'));
    assert.equal(r.invoices.length, 1);
    assert.equal(r.totalPages, 5);
    assert.equal(r.page, 2);
  } finally {
    await srv.close();
  }
});

test('erpList : params invalides rejetes cote client', async () => {
  const srv = await startServer(() => { throw new Error('ne devrait pas etre appele'); });
  try {
    const cfg = makeConfig(srv.baseUrl);
    await assert.rejects(() => erpList(cfg, { page: 0 }), SfecValidationError);
    await assert.rejects(() => erpList(cfg, { pageSize: 21 }), SfecValidationError);
    await assert.rejects(() => erpList(cfg, { pageSize: 0 }), SfecValidationError);
    await assert.rejects(() => erpList(cfg, { invoiceType: 'wat' }), SfecValidationError);
    await assert.rejects(() => erpList(cfg, { dateStart: '31/12/2026' }), SfecValidationError);
    assert.equal(srv.getCount(), 0);
  } finally {
    await srv.close();
  }
});

test('erpList : sans params marche (defaut serveur)', async () => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ invoices: [], page: 1, pageSize: 10, totalPages: 0 }));
  });
  try {
    const cfg = makeConfig(srv.baseUrl);
    const r = await erpList(cfg);
    assert.equal(r.invoices.length, 0);
    assert.equal(r.page, 1);
    assert.equal(r.pageSize, 10);
  } finally {
    await srv.close();
  }
});

test('erpList : 401 remonte SfecHttpError.isUnauthorized()', async () => {
  const srv = await startServer((req, res) => {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid api key' }));
  });
  try {
    const cfg = makeConfig(srv.baseUrl);
    try {
      await erpList(cfg);
      assert.fail('aurait du throw');
    } catch (err) {
      assert.ok(err instanceof SfecHttpError);
      assert.equal(err.isUnauthorized(), true);
    }
  } finally {
    await srv.close();
  }
});

test('erpList : refuse config sans apiKey', async () => {
  const cfg = loadConfig({
    baseUrl: 'https://api.example.test',
    mtls: { cert: 'X', key: 'X' },
    processEnv: {},
  });
  await assert.rejects(
    () => erpList(cfg),
    (err) => err instanceof SfecConfigError && err.code === 'SFEC_ERP_NO_API_KEY',
  );
});

test('erpList : reponse mal formee retourne defaults (defensif)', async () => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('null');
  });
  try {
    const cfg = makeConfig(srv.baseUrl);
    const r = await erpList(cfg);
    assert.deepEqual(r.invoices, []);
    assert.equal(r.totalPages, 0);
  } finally {
    await srv.close();
  }
});
