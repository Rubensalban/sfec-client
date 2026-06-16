/**
 * Validation de l'input utilisateur d'une facture (avant builder).
 *
 * Forme attendue :
 *   {
 *     taxpayer_niu: string (max 20),
 *     invoice_type?: 'salesInvoice'|'creditNote',  // defaut: 'salesInvoice'
 *     invoice_id?: string,                         // genere si absent
 *     invoice_subject?: string,
 *     invoice_due_date?: ISO8601,
 *     reference_invoice_id?: string,               // requis si creditNote
 *     recipient: { ... },                          // cf. recipient.js
 *     items: [ ... ],                              // cf. items.js
 *     payment: {
 *       method: 'bank_transfer'|'card'|'cash'|'mobile_money'|'cheque',
 *       currency: 'XAF'|'USD',
 *       reference?: string,
 *       date?: ISO8601,
 *     }
 *   }
 *
 * Throw SfecValidationError contenant TOUS les problemes (pas fail-fast).
 */

import { SfecValidationError } from '../errors.js';
import {
  INVOICE_TYPES,
  PAYMENT_METHODS,
  CURRENCIES,
  createErrors,
  requireString,
  requireEnum,
  requireMaxLength,
  optionalISO8601,
  isNonEmptyString,
} from './common.js';
import { validateRecipient } from './recipient.js';
import { validateItems } from './items.js';

/**
 * @param {unknown} input
 * @returns {void} throw SfecValidationError si invalide
 */
export function validateInvoiceInput(input) {
  const errors = createErrors();

  if (input === null || typeof input !== 'object') {
    errors.push('', 'input : objet facture requis.', 'INVALID_TYPE');
    throw new SfecValidationError('Payload de facture invalide.', errors.list());
  }

  const i = /** @type {Record<string, unknown>} */ (input);

  // Identification contribuable
  if (requireString(i.taxpayer_niu, 'taxpayer_niu', errors)) {
    requireMaxLength(i.taxpayer_niu, 'taxpayer_niu', 20, errors);
  }

  // Type de facture (defaut : salesInvoice si absent)
  const invoiceType = i.invoice_type ?? 'salesInvoice';
  requireEnum(invoiceType, 'invoice_type', INVOICE_TYPES, errors);

  // invoice_id : optionnel a l'input (sera genere par le builder si absent)
  if (i.invoice_id !== undefined && i.invoice_id !== null && i.invoice_id !== '') {
    if (typeof i.invoice_id !== 'string') {
      errors.push('invoice_id', 'invoice_id : chaine attendue si fourni.', 'INVALID_TYPE');
    }
  }

  // invoice_subject : optionnel
  if (i.invoice_subject !== undefined && i.invoice_subject !== null && i.invoice_subject !== '') {
    if (typeof i.invoice_subject !== 'string') {
      errors.push('invoice_subject', 'invoice_subject : chaine attendue si fourni.', 'INVALID_TYPE');
    }
  }

  // invoice_due_date : optionnel, ISO 8601
  optionalISO8601(i.invoice_due_date, 'invoice_due_date', errors);

  // creditNote : reference_invoice_id obligatoire
  if (invoiceType === 'creditNote') {
    if (!isNonEmptyString(i.reference_invoice_id)) {
      errors.push(
        'reference_invoice_id',
        'reference_invoice_id : requis pour un creditNote (id de la facture d origine).',
        'REQUIRED',
      );
    }
  } else if (i.reference_invoice_id !== undefined && i.reference_invoice_id !== null && i.reference_invoice_id !== '') {
    // Si fourni pour autre chose qu'un creditNote, on tolere mais on type-check
    if (typeof i.reference_invoice_id !== 'string') {
      errors.push('reference_invoice_id', 'reference_invoice_id : chaine attendue si fourni.', 'INVALID_TYPE');
    }
  }

  // Recipient
  validateRecipient(i.recipient, 'recipient', errors);

  // Items
  validateItems(i.items, 'items', errors);

  // Payment
  validatePayment(i.payment, 'payment', errors);

  if (errors.hasErrors()) {
    throw new SfecValidationError(
      `Payload de facture invalide : ${errors.list().length} probleme(s).`,
      errors.list(),
    );
  }
}

function validatePayment(payment, path, errors) {
  if (payment === null || typeof payment !== 'object') {
    errors.push(path, `${path} : objet paiement requis.`, 'REQUIRED');
    return;
  }
  const p = /** @type {Record<string, unknown>} */ (payment);

  requireEnum(p.method, `${path}.method`, PAYMENT_METHODS, errors);
  requireEnum(p.currency, `${path}.currency`, CURRENCIES, errors);

  if (p.reference !== undefined && p.reference !== null && p.reference !== '') {
    if (typeof p.reference !== 'string') {
      errors.push(`${path}.reference`, `${path}.reference : chaine attendue si fourni.`, 'INVALID_TYPE');
    }
  }

  optionalISO8601(p.date, `${path}.date`, errors);
}
