import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateInvoiceInput } from '../src/validators/invoice.js';
import { validateRecipient } from '../src/validators/recipient.js';
import { validateItems } from '../src/validators/items.js';
import {
  createErrors,
  isISO8601,
  isEmail,
  isEnum,
  INVOICE_TYPES,
  PAYMENT_METHODS,
  CURRENCIES,
} from '../src/validators/common.js';
import { SfecValidationError } from '../src/errors.js';

const validRecipient = {
  type: 'business',
  name: 'ACME SARL',
  niu: 'P123456789',
  address: 'Brazzaville',
};

const validItem = {
  designation: 'Service de conseil',
  type: 'service',
  unit_price: 1000,
  quantity: 2,
  tax_rate: '18',
};

const validPayment = { method: 'mobile_money', currency: 'XAF' };

const validInput = {
  taxpayer_niu: 'M987654321',
  recipient: validRecipient,
  items: [validItem],
  payment: validPayment,
};

// --- common.js ---

test('createErrors accumule et expose list/hasErrors', () => {
  const e = createErrors();
  assert.equal(e.hasErrors(), false);
  e.push('foo', 'msg', 'CODE');
  assert.equal(e.hasErrors(), true);
  assert.deepEqual(e.list(), [{ path: 'foo', message: 'msg', code: 'CODE' }]);
});

test('isISO8601 accepte les dates valides et refuse le n importe quoi', () => {
  assert.equal(isISO8601('2026-01-15'), true);
  assert.equal(isISO8601('2026-01-15T10:30:00Z'), true);
  assert.equal(isISO8601('2026-01-15T10:30:00+01:00'), true);
  assert.equal(isISO8601('15/01/2026'), false);
  assert.equal(isISO8601('hier'), false);
  assert.equal(isISO8601(''), false);
  assert.equal(isISO8601(null), false);
});

test('isEmail rejette les formats invidents', () => {
  assert.equal(isEmail('a@b.co'), true);
  assert.equal(isEmail('a@b'), false);
  assert.equal(isEmail('@b.co'), false);
  assert.equal(isEmail('a b@c.co'), false);
  assert.equal(isEmail(null), false);
});

test('isEnum verifie l appartenance', () => {
  assert.equal(isEnum('XAF', CURRENCIES), true);
  assert.equal(isEnum('EUR', CURRENCIES), false);
});

// --- recipient ---

test('validateRecipient OK sur un business avec niu', () => {
  const e = createErrors();
  validateRecipient(validRecipient, 'recipient', e);
  assert.equal(e.hasErrors(), false);
});

test('validateRecipient signale type invalide', () => {
  const e = createErrors();
  validateRecipient({ ...validRecipient, type: 'wat' }, 'recipient', e);
  assert.ok(e.list().some((x) => x.path === 'recipient.type' && x.code === 'INVALID_ENUM'));
});

test('validateRecipient refuse business sans niu ni rccm', () => {
  const e = createErrors();
  validateRecipient({ type: 'business', name: 'ACME' }, 'recipient', e);
  assert.ok(e.list().some((x) => x.code === 'BUSINESS_IDENTIFICATION_REQUIRED'));
});

test('validateRecipient OK sur business avec rccm uniquement', () => {
  const e = createErrors();
  validateRecipient({ type: 'business', name: 'ACME', rccm: 'CG-BZV-01-2020' }, 'recipient', e);
  assert.equal(e.hasErrors(), false);
});

test('validateRecipient signale email invalide', () => {
  const e = createErrors();
  validateRecipient({ ...validRecipient, email: 'pas-un-email' }, 'recipient', e);
  assert.ok(e.list().some((x) => x.path === 'recipient.email'));
});

test('validateRecipient niu > 20 caracteres rejete', () => {
  const e = createErrors();
  validateRecipient({ ...validRecipient, niu: 'X'.repeat(21) }, 'recipient', e);
  assert.ok(e.list().some((x) => x.code === 'TOO_LONG'));
});

// --- items ---

test('validateItems exige un tableau non vide', () => {
  const e = createErrors();
  validateItems('pas un array', 'items', e);
  assert.ok(e.list().some((x) => x.code === 'INVALID_TYPE'));

  const e2 = createErrors();
  validateItems([], 'items', e2);
  assert.ok(e2.list().some((x) => x.code === 'EMPTY_ARRAY'));
});

test('validateItems valide chaque article avec son index', () => {
  const e = createErrors();
  validateItems([{ ...validItem }, { type: 'nope' }], 'items', e);
  // index 1 doit avoir des erreurs avec le bon path
  assert.ok(e.list().some((x) => x.path.startsWith('items[1].')));
  assert.ok(e.list().some((x) => x.path === 'items[1].designation'));
});

test('validateItems quantity doit etre > 0', () => {
  const e = createErrors();
  validateItems([{ ...validItem, quantity: 0 }], 'items', e);
  assert.ok(e.list().some((x) => x.path === 'items[0].quantity'));
});

test('validateItems unit_price >= 0 (zero autorise pour echantillon)', () => {
  const e = createErrors();
  validateItems([{ ...validItem, unit_price: 0 }], 'items', e);
  assert.equal(e.hasErrors(), false);

  const e2 = createErrors();
  validateItems([{ ...validItem, unit_price: -1 }], 'items', e2);
  assert.ok(e2.list().some((x) => x.path === 'items[0].unit_price'));
});

test('validateItems tax_rate accepte string ou number, rejette absent/invalide', () => {
  const ok1 = createErrors();
  validateItems([{ ...validItem, tax_rate: 18 }], 'items', ok1);
  assert.equal(ok1.hasErrors(), false);

  const ok2 = createErrors();
  validateItems([{ ...validItem, tax_rate: '18.5' }], 'items', ok2);
  assert.equal(ok2.hasErrors(), false);

  const ko = createErrors();
  validateItems([{ ...validItem, tax_rate: undefined }], 'items', ko);
  assert.ok(ko.list().some((x) => x.path === 'items[0].tax_rate'));

  const ko2 = createErrors();
  validateItems([{ ...validItem, tax_rate: 'abc' }], 'items', ko2);
  assert.ok(ko2.list().some((x) => x.path === 'items[0].tax_rate'));
});

test('validateItems discount_amount sans discount_type est rejete', () => {
  const e = createErrors();
  validateItems([{ ...validItem, discount_amount: 10 }], 'items', e);
  assert.ok(e.list().some((x) => x.path === 'items[0].discount_type'));
});

test('validateItems pourcentage > 100 est rejete', () => {
  const e = createErrors();
  validateItems(
    [{ ...validItem, discount_amount: 150, discount_type: 'percentage' }],
    'items',
    e,
  );
  assert.ok(e.list().some((x) => x.path === 'items[0].discount_amount' && x.code === 'OUT_OF_RANGE'));
});

// --- invoice (validateInvoiceInput) ---

test('validateInvoiceInput accepte un payload minimal valide', () => {
  assert.doesNotThrow(() => validateInvoiceInput(validInput));
});

test('validateInvoiceInput throw SfecValidationError avec fields', () => {
  try {
    validateInvoiceInput({});
    assert.fail('aurait du throw');
  } catch (err) {
    assert.ok(err instanceof SfecValidationError);
    assert.ok(err.fields.length > 0);
    assert.equal(err.code, 'SFEC_VALIDATION_ERROR');
  }
});

test('validateInvoiceInput collecte TOUTES les erreurs en une passe', () => {
  try {
    validateInvoiceInput({
      // taxpayer_niu manquant
      invoice_type: 'wat', // invalide
      recipient: { type: 'business', name: '' }, // niu manquant + name vide
      items: [], // vide
      payment: { method: 'inconnu', currency: 'EUR' }, // 2 invalides
    });
    assert.fail('aurait du throw');
  } catch (err) {
    assert.ok(err instanceof SfecValidationError);
    const paths = err.fields.map((f) => f.path);
    assert.ok(paths.includes('taxpayer_niu'));
    assert.ok(paths.includes('invoice_type'));
    assert.ok(paths.includes('items'));
    assert.ok(paths.includes('payment.method'));
    assert.ok(paths.includes('payment.currency'));
    // au moins 5 problemes collectes
    assert.ok(err.fields.length >= 5);
  }
});

test('validateInvoiceInput creditNote exige reference_invoice_id', () => {
  assert.throws(
    () => validateInvoiceInput({ ...validInput, invoice_type: 'creditNote' }),
    (err) =>
      err instanceof SfecValidationError &&
      err.fields.some((f) => f.path === 'reference_invoice_id' && f.code === 'REQUIRED'),
  );
});

test('validateInvoiceInput creditNote OK avec reference_invoice_id', () => {
  assert.doesNotThrow(() =>
    validateInvoiceInput({
      ...validInput,
      invoice_type: 'creditNote',
      reference_invoice_id: 'inv-orig-123',
    }),
  );
});

test('validateInvoiceInput taxpayer_niu > 20 caracteres', () => {
  assert.throws(
    () => validateInvoiceInput({ ...validInput, taxpayer_niu: 'X'.repeat(21) }),
    (err) => err.fields.some((f) => f.path === 'taxpayer_niu' && f.code === 'TOO_LONG'),
  );
});

test('validateInvoiceInput refuse input null/non-objet', () => {
  assert.throws(() => validateInvoiceInput(null), SfecValidationError);
  assert.throws(() => validateInvoiceInput('string'), SfecValidationError);
  assert.throws(() => validateInvoiceInput(42), SfecValidationError);
});

test('validateInvoiceInput accepte invoice_due_date ISO valide et refuse format libre', () => {
  assert.doesNotThrow(() =>
    validateInvoiceInput({ ...validInput, invoice_due_date: '2026-12-31' }),
  );
  assert.throws(
    () => validateInvoiceInput({ ...validInput, invoice_due_date: '31/12/2026' }),
    SfecValidationError,
  );
});

test('validateInvoiceInput refuse currency non supportee', () => {
  assert.throws(
    () =>
      validateInvoiceInput({
        ...validInput,
        payment: { ...validPayment, currency: 'EUR' },
      }),
    (err) => err.fields.some((f) => f.path === 'payment.currency'),
  );
});

test('validateInvoiceInput enums coherents avec la doc SFEC', () => {
  assert.deepEqual([...INVOICE_TYPES], ['salesInvoice', 'creditNote']);
  assert.deepEqual([...PAYMENT_METHODS], ['bank_transfer', 'card', 'cash', 'mobile_money', 'cheque']);
  assert.deepEqual([...CURRENCIES], ['XAF', 'USD']);
});
