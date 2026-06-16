import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInvoicePayload } from '../src/builders/invoice.js';
import { computeItemTotals, computeInvoiceTotals, round2 } from '../src/builders/totals.js';
import { SfecValidationError } from '../src/errors.js';

const baseInput = {
  taxpayer_niu: 'M987654321',
  recipient: { type: 'business', name: 'ACME', niu: 'P123' },
  items: [
    { designation: 'Service A', type: 'service', unit_price: 1000, quantity: 2, tax_rate: '18' },
  ],
  payment: { method: 'mobile_money', currency: 'XAF' },
};

// --- round2 ---

test('round2 arrondit a 2 decimales', () => {
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(round2(1234.5678), 1234.57);
});

test('round2 retourne 0 pour NaN/Infinity', () => {
  assert.equal(round2(NaN), 0);
  assert.equal(round2(Infinity), 0);
  assert.equal(round2(-Infinity), 0);
});

// --- computeItemTotals ---

test('computeItemTotals : calcul basique sans remise', () => {
  const r = computeItemTotals({ unit_price: 1000, quantity: 2, tax_rate: '18' });
  assert.equal(r.subtotal, 2000);
  assert.equal(r.discount_amount, 0);
  assert.equal(r.net_amount, 2000);
  assert.equal(r.tax_amount, 360);
  assert.equal(r.total_amount, 2360);
  assert.equal(r.tax_rate, '18');
});

test('computeItemTotals : remise en pourcentage', () => {
  const r = computeItemTotals({
    unit_price: 1000,
    quantity: 2,
    tax_rate: 18,
    discount_amount: 10,
    discount_type: 'percentage',
  });
  // subtotal 2000, remise 10% = 200, net 1800, TVA 324, total 2124
  assert.equal(r.subtotal, 2000);
  assert.equal(r.discount_amount, 200);
  assert.equal(r.net_amount, 1800);
  assert.equal(r.tax_amount, 324);
  assert.equal(r.total_amount, 2124);
});

test('computeItemTotals : remise montant fixe', () => {
  const r = computeItemTotals({
    unit_price: 500,
    quantity: 4,
    tax_rate: 18,
    discount_amount: 200,
    discount_type: 'fixed',
  });
  // subtotal 2000, remise 200, net 1800, TVA 324, total 2124
  assert.equal(r.discount_amount, 200);
  assert.equal(r.net_amount, 1800);
  assert.equal(r.total_amount, 2124);
});

test('computeItemTotals : remise plafonnee au subtotal', () => {
  const r = computeItemTotals({
    unit_price: 100,
    quantity: 1,
    tax_rate: 18,
    discount_amount: 500, // > subtotal
    discount_type: 'fixed',
  });
  assert.equal(r.discount_amount, 100);
  assert.equal(r.net_amount, 0);
  assert.equal(r.tax_amount, 0);
  assert.equal(r.total_amount, 0);
});

test('computeItemTotals : tax_rate 0 (exonere)', () => {
  const r = computeItemTotals({ unit_price: 1000, quantity: 1, tax_rate: '0' });
  assert.equal(r.tax_amount, 0);
  assert.equal(r.total_amount, 1000);
});

test('computeItemTotals : valeurs flottantes ne bavent pas', () => {
  const r = computeItemTotals({ unit_price: 0.1, quantity: 3, tax_rate: 18 });
  // subtotal 0.30 (et non 0.30000000004), TVA 0.054, total 0.354 -> 0.35
  assert.equal(r.subtotal, 0.3);
  assert.equal(r.total_amount, 0.35);
});

// --- computeInvoiceTotals ---

test('computeInvoiceTotals : somme correctement plusieurs items', () => {
  const i1 = computeItemTotals({ unit_price: 1000, quantity: 2, tax_rate: 18 });
  const i2 = computeItemTotals({ unit_price: 500, quantity: 1, tax_rate: 18 });
  const t = computeInvoiceTotals([i1, i2]);
  // i1 : net 2000, tva 360, total 2360 / i2 : net 500, tva 90, total 590
  assert.equal(t.subtotal, 2500);
  assert.equal(t.total_tax_t_amount, 450);
  assert.equal(t.total_tax_amount, 450);
  assert.equal(t.total_amount, 2950);
  assert.equal(t.amount_due, 2950);
  assert.equal(t.total_line_discount_amount, 0);
});

test('computeInvoiceTotals : agrege les remises de ligne', () => {
  const i1 = computeItemTotals({
    unit_price: 1000,
    quantity: 1,
    tax_rate: 18,
    discount_amount: 100,
    discount_type: 'fixed',
  });
  const i2 = computeItemTotals({
    unit_price: 500,
    quantity: 1,
    tax_rate: 18,
    discount_amount: 10,
    discount_type: 'percentage',
  });
  const t = computeInvoiceTotals([i1, i2]);
  assert.equal(t.total_line_discount_amount, 150); // 100 + 50
});

// --- buildInvoicePayload ---

test('buildInvoicePayload : payload complet sur input minimal', () => {
  const p = buildInvoicePayload(baseInput);
  assert.equal(p.taxpayer_niu, 'M987654321');
  assert.equal(p.invoice_type, 'salesInvoice');
  assert.equal(p.invoice_status, 'pending');
  assert.equal(p.recipient_type, 'business');
  assert.equal(p.recipient_name, 'ACME');
  assert.equal(p.recipient_niu, 'P123');
  assert.equal(p.currency, 'XAF');
  assert.equal(p.payment_method, 'mobile_money');
  assert.equal(p.items.length, 1);
  assert.equal(p.subtotal, 2000);
  assert.equal(p.total_amount, 2360);
});

test('buildInvoicePayload : invoice_id genere si absent (UUID v4)', () => {
  const p = buildInvoicePayload(baseInput);
  assert.match(p.invoice_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('buildInvoicePayload : invoice_id fourni est respecte', () => {
  const p = buildInvoicePayload({ ...baseInput, invoice_id: 'my-stable-id-123' });
  assert.equal(p.invoice_id, 'my-stable-id-123');
});

test('buildInvoicePayload : electronic_stamp_duty toujours 0 (non surchargeable)', () => {
  const p = buildInvoicePayload({ ...baseInput, electronic_stamp_duty: 9999 });
  assert.equal(p.electronic_stamp_duty, 0);
});

test('buildInvoicePayload : totaux utilisateurs ignores et recalcules', () => {
  const p = buildInvoicePayload({
    ...baseInput,
    subtotal: 99999,
    total_amount: 88888,
    total_tax_amount: 77777,
  });
  // Recalcul base sur items : 1000 * 2 = 2000 HT
  assert.equal(p.subtotal, 2000);
  assert.equal(p.total_amount, 2360);
  assert.equal(p.total_tax_amount, 360);
});

test('buildInvoicePayload : ne mute pas l input utilisateur', () => {
  const input = JSON.parse(JSON.stringify(baseInput));
  const snapshot = JSON.stringify(input);
  buildInvoicePayload(input);
  assert.equal(JSON.stringify(input), snapshot);
});

test('buildInvoicePayload : throw SfecValidationError si input invalide', () => {
  assert.throws(() => buildInvoicePayload({}), SfecValidationError);
  assert.throws(
    () => buildInvoicePayload({ ...baseInput, items: [] }),
    SfecValidationError,
  );
});

test('buildInvoicePayload : creditNote sans reference rejete', () => {
  assert.throws(
    () => buildInvoicePayload({ ...baseInput, invoice_type: 'creditNote' }),
    SfecValidationError,
  );
});

test('buildInvoicePayload : creditNote avec reference OK', () => {
  const p = buildInvoicePayload({
    ...baseInput,
    invoice_type: 'creditNote',
    reference_invoice_id: 'orig-001',
  });
  assert.equal(p.invoice_type, 'creditNote');
  assert.equal(p.reference_invoice_id, 'orig-001');
});

test('buildInvoicePayload : items remontent toutes les cles attendues par la doc', () => {
  const p = buildInvoicePayload(baseInput);
  const it = p.items[0];
  const expectedKeys = [
    'designation', 'classification_code', 'type', 'unit_price', 'quantity',
    'subtotal', 'discount_amount', 'discount_type', 'net_amount',
    'amount_after_discount', 'tax_rate', 'tax_amount', 'total_amount',
  ];
  for (const k of expectedKeys) {
    assert.ok(k in it, `cle item manquante : ${k}`);
  }
});

test('buildInvoicePayload : is_recipient_taxable defaut true', () => {
  const p = buildInvoicePayload(baseInput);
  assert.equal(p.is_recipient_taxable, true);

  const p2 = buildInvoicePayload({
    ...baseInput,
    recipient: { ...baseInput.recipient, isTaxable: false },
  });
  assert.equal(p2.is_recipient_taxable, false);
});

test('buildInvoicePayload : champs optionnels mis a null si absents', () => {
  const p = buildInvoicePayload(baseInput);
  assert.equal(p.invoice_subject, null);
  assert.equal(p.invoice_due_date, null);
  assert.equal(p.reference_invoice_id, null);
  assert.equal(p.recipient_address, null);
  assert.equal(p.recipient_phone, null);
  assert.equal(p.recipient_email, null);
  assert.equal(p.recipient_rccm, null);
  assert.equal(p.payment_reference, null);
  assert.equal(p.payment_date, null);
});

test('buildInvoicePayload : 2 appels avec meme invoice_id produisent payloads identiques (idempotence)', () => {
  const a = buildInvoicePayload({ ...baseInput, invoice_id: 'fixed-id' });
  const b = buildInvoicePayload({ ...baseInput, invoice_id: 'fixed-id' });
  assert.deepEqual(a, b);
});
