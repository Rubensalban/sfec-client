/**
 * Builder du payload final envoye a l'API SFEC.
 *
 * Garanties :
 *  - electronic_stamp_duty force a 0 (regle reglementaire)
 *  - Pas de mutation de l'input
 *  - Totaux toujours coherents avec les items
 */

import { randomUUID } from 'node:crypto';
import { validateInvoiceInput } from '../validators/invoice.js';
import { computeItemTotals, computeInvoiceTotals } from './totals.js';

/**
 * Construit le payload final pour POST /v1/invoices.
 *
 * @param {object} input - input utilisateur (sera valide)
 * @returns {object} payload pret a serialiser en JSON pour l'API
 */
export function buildInvoicePayload(input) {
  validateInvoiceInput(input);

  const invoiceType = input.invoice_type ?? 'salesInvoice';
  const invoiceId = input.invoice_id ?? randomUUID();

  // Recalcul des totaux item par item
  const computedItems = input.items.map((it) => {
    const totals = computeItemTotals(it);
    return {
      designation: it.designation,
      classification_code: it.classification_code ?? null,
      type: it.type,
      unit_price: it.unit_price,
      quantity: it.quantity,
      subtotal: totals.subtotal,
      discount_amount: totals.discount_amount,
      discount_type: it.discount_type ?? 'fixed',
      net_amount: totals.net_amount,
      amount_after_discount: totals.amount_after_discount,
      tax_rate: totals.tax_rate,
      tax_amount: totals.tax_amount,
      total_amount: totals.total_amount,
    };
  });

  const invoiceTotals = computeInvoiceTotals(computedItems);

  const recipient = input.recipient;
  const payment = input.payment;

  const payload = {
    // Identification
    taxpayer_niu: input.taxpayer_niu,
    invoice_id: invoiceId,
    invoice_type: invoiceType,
    invoice_subject: input.invoice_subject ?? null,
    invoice_due_date: input.invoice_due_date ?? null,
    invoice_status: 'pending',
    reference_invoice_id: input.reference_invoice_id ?? null,

    // Destinataire
    recipient_type: recipient.type,
    recipient_name: recipient.name,
    recipient_niu: recipient.niu ?? null,
    recipient_rccm: recipient.rccm ?? null,
    recipient_address: recipient.address ?? null,
    recipient_phone: recipient.phone ?? null,
    recipient_email: recipient.email ?? null,
    is_recipient_taxable: recipient.isTaxable ?? true,

    // Totaux (recalcules)
    subtotal: invoiceTotals.subtotal,
    total_tax_t_amount: invoiceTotals.total_tax_t_amount,
    total_tax_r_amount: 0,
    total_exempt_amount: 0,
    total_tax_amount: invoiceTotals.total_tax_amount,
    discount_amount: 0,
    total_line_discount_amount: invoiceTotals.total_line_discount_amount,
    additional_cent_tax: 0,
    electronic_stamp_duty: 0, // FORCE par decret, jamais surchargeable
    total_amount: invoiceTotals.total_amount,
    amount_due: invoiceTotals.amount_due,

    // Paiement
    currency: payment.currency,
    payment_method: payment.method,
    payment_reference: payment.reference ?? null,
    payment_date: payment.date ?? null,

    // Items recalcules
    items: computedItems,
  };

  return payload;
}
