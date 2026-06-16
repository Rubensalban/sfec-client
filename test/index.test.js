import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  SfecClient,
  SfecValidationError,
  SfecConfigError,
  SfecHttpError,
  bootstrapConfig,
  buildInvoicePayload,
  INVOICE_TYPES,
  CURRENCIES,
} from '../src/index.js';

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

const validInput = {
  taxpayer_niu: 'M987654321',
  recipient: { type: 'business', name: 'ACME', niu: 'P123' },
  items: [{ designation: 'Service A', type: 'service', unit_price: 1000, quantity: 2, tax_rate: '18' }],
  payment: { method: 'mobile_money', currency: 'XAF' },
};

// --- SfecClient.create ---

test('SfecClient.create : construit un client avec erp/tcc/tfc', () => {
  const client = SfecClient.create({
    baseUrl: 'https://api.example.test',
    apiKey: 'sk_test',
    processEnv: {},
  });
  assert.ok(client.erp);
  assert.ok(client.tcc);
  assert.ok(client.tfc);
  assert.equal(typeof client.erp.submit, 'function');
  assert.equal(typeof client.erp.list, 'function');
  assert.equal(typeof client.tcc.submit, 'function');
  assert.equal(typeof client.tfc.submit, 'function');
});

test('SfecClient.create : client gele, namespaces geles', () => {
  const client = SfecClient.create({
    baseUrl: 'https://api.example.test',
    apiKey: 'sk',
    processEnv: {},
  });
  assert.ok(Object.isFrozen(client));
  assert.ok(Object.isFrozen(client.erp));
  assert.ok(Object.isFrozen(client.tcc));
  assert.ok(Object.isFrozen(client.tfc));
});

test('SfecClient.create : toJSON masque les secrets', () => {
  const client = SfecClient.create({
    baseUrl: 'https://api.example.test',
    apiKey: 'sk_super_secret',
    processEnv: {},
  });
  const json = JSON.stringify(client);
  assert.ok(!json.includes('sk_super_secret'));
  const parsed = JSON.parse(json);
  assert.equal(parsed.baseUrl, 'https://api.example.test');
  assert.equal(parsed.hasApiKey, true);
  assert.equal(parsed.hasMtls, false);
});

test('SfecClient.create : config manquante throw SfecConfigError', () => {
  assert.throws(
    () => SfecClient.create({ processEnv: {} }),
    SfecConfigError,
  );
});

// --- SfecClient.fromEnv ---

test('SfecClient.fromEnv : utilise process.env (test via override)', () => {
  // On simule en mutant process.env temporairement
  const origUrl = process.env.SFEC_CLIENT_BASE_URL;
  const origKey = process.env.SFEC_CLIENT_API_KEY;
  process.env.SFEC_CLIENT_BASE_URL = 'https://from-env.example.test';
  process.env.SFEC_CLIENT_API_KEY = 'sk_from_env';
  try {
    const client = SfecClient.fromEnv();
    assert.equal(client.config.baseUrl, 'https://from-env.example.test');
    assert.equal(client.config.apiKey.reveal(), 'sk_from_env');
  } finally {
    if (origUrl === undefined) delete process.env.SFEC_CLIENT_BASE_URL;
    else process.env.SFEC_CLIENT_BASE_URL = origUrl;
    if (origKey === undefined) delete process.env.SFEC_CLIENT_API_KEY;
    else process.env.SFEC_CLIENT_API_KEY = origKey;
  }
});

// --- Integration end-to-end (erp.submit via facade) ---

test('SfecClient : erp.submit appelle bien le serveur et retourne la reponse normalisee', async () => {
  let received;
  const srv = await startServer((req, res) => {
    received = { method: req.method, body: req.body, apiKey: req.headers['x-api-key'] };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      invoice_id: 'srv-id',
      invoice_number: 'F-001',
      sfec_certification_number: 'CERT',
      sfec_identifier: 'SH',
      sfec_qr_code: 'data:image/png;base64,xxx',
      certification_date: '2026-06-16T10:00:00Z',
    }));
  });
  try {
    const client = SfecClient.create({
      baseUrl: srv.baseUrl,
      apiKey: 'sk_real',
      processEnv: {},
    });
    const r = await client.erp.submit(validInput);
    assert.equal(received.method, 'POST');
    assert.equal(received.apiKey, 'sk_real');
    assert.equal(r.invoiceNumber, 'F-001');
    assert.equal(r.certificationNumber, 'CERT');
  } finally {
    await srv.close();
  }
});

test('SfecClient : erp.list passe la pagination', async () => {
  let url;
  const srv = await startServer((req, res) => {
    url = req.url;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ invoices: [], page: 1, pageSize: 5, totalPages: 0 }));
  });
  try {
    const client = SfecClient.create({
      baseUrl: srv.baseUrl,
      apiKey: 'sk',
      processEnv: {},
    });
    await client.erp.list({ page: 1, pageSize: 5 });
    assert.ok(url.includes('page=1'));
    assert.ok(url.includes('pageSize=5'));
  } finally {
    await srv.close();
  }
});

test('SfecClient : tcc/tfc.submit refuse sans mTLS via la facade', async () => {
  const client = SfecClient.create({
    baseUrl: 'https://api.example.test',
    apiKey: 'sk',
    processEnv: {},
  });
  await assert.rejects(() => client.tcc.submit(validInput), SfecConfigError);
  await assert.rejects(() => client.tfc.submit(validInput), SfecConfigError);
});

// --- Hooks ---

test('SfecClient : hooks globaux + locaux sont tous deux appeles', async () => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ invoice_id: 'x', invoice_number: 'F', sfec_certification_number: 'C', certification_date: 'D' }));
  });
  try {
    let globalCalled = false;
    let localCalled = false;
    const client = SfecClient.create({
      baseUrl: srv.baseUrl,
      apiKey: 'sk',
      processEnv: {},
      hooks: { onRequest: () => { globalCalled = true; } },
    });
    await client.erp.submit(validInput, {
      hooks: { onRequest: () => { localCalled = true; } },
    });
    assert.equal(globalCalled, true);
    assert.equal(localCalled, true);
  } finally {
    await srv.close();
  }
});

test('SfecClient : hook global recoit body redacte (cle API jamais loggable)', async () => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ invoice_id: 'x', invoice_number: 'F', sfec_certification_number: 'C', certification_date: 'D' }));
  });
  try {
    let captured;
    const client = SfecClient.create({
      baseUrl: srv.baseUrl,
      apiKey: 'sk_super_secret',
      processEnv: {},
      hooks: { onRequest: (info) => { captured = info; } },
    });
    await client.erp.submit(validInput);
    assert.equal(captured.headers['X-API-Key'], '***');
  } finally {
    await srv.close();
  }
});

// --- Re-exports ---

test('re-exports : erreurs, builder, bootstrap, enums tous disponibles', () => {
  assert.equal(typeof SfecValidationError, 'function');
  assert.equal(typeof SfecHttpError, 'function');
  assert.equal(typeof SfecConfigError, 'function');
  assert.equal(typeof bootstrapConfig, 'function');
  assert.equal(typeof buildInvoicePayload, 'function');
  assert.deepEqual([...INVOICE_TYPES], ['salesInvoice', 'creditNote']);
  assert.deepEqual([...CURRENCIES], ['XAF', 'USD']);
});

test('re-export : buildInvoicePayload utilisable seul (sans client)', () => {
  const p = buildInvoicePayload(validInput);
  assert.equal(p.electronic_stamp_duty, 0);
  assert.equal(p.total_amount, 2360);
});

// --- Validation de la couche facade ---

test('SfecClient : input invalide rejete sans appel reseau', async () => {
  const srv = await startServer(() => { throw new Error('non appele'); });
  try {
    const client = SfecClient.create({
      baseUrl: srv.baseUrl,
      apiKey: 'sk',
      processEnv: {},
    });
    await assert.rejects(() => client.erp.submit({}), SfecValidationError);
    assert.equal(srv.getCount(), 0);
  } finally {
    await srv.close();
  }
});
