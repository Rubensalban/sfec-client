/**
 * Calcul des totaux d'une facture. Fonctions pures.
 *
 * Toutes les valeurs monetaires sont arrondies a 2 decimales avant retour
 * pour eviter les bavures de virgule flottante envoyees a l'API.
 */

/**
 * Arrondit a 2 decimales en evitant les artefacts IEEE 754.
 * @param {number} n
 * @returns {number}
 */
export function round2(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Parse un tax_rate en nombre. Accepte "18", "18.5" ou 18.
 * @param {string|number} raw
 * @returns {number}
 */
function parseTaxRate(raw) {
  if (typeof raw === 'number') return raw;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Calcule les totaux d'une ligne d'article.
 *
 * @param {{
 *   unit_price: number,
 *   quantity: number,
 *   tax_rate: string|number,
 *   discount_amount?: number,
 *   discount_type?: 'fixed'|'percentage',
 * }} item
 * @returns {{
 *   subtotal: number,
 *   discount_amount: number,
 *   net_amount: number,
 *   amount_after_discount: number,
 *   tax_rate: string,
 *   tax_amount: number,
 *   total_amount: number,
 * }}
 */
export function computeItemTotals(item) {
  const subtotal = item.unit_price * item.quantity;

  let discountResolved = 0;
  if (item.discount_amount !== undefined && item.discount_amount !== null) {
    if (item.discount_type === 'percentage') {
      discountResolved = (subtotal * item.discount_amount) / 100;
    } else if (item.discount_type === 'fixed') {
      discountResolved = item.discount_amount;
    }
  }
  if (discountResolved > subtotal) discountResolved = subtotal;
  if (discountResolved < 0) discountResolved = 0;

  const netAmount = subtotal - discountResolved;
  const taxRateNumber = parseTaxRate(item.tax_rate);
  const taxAmount = (netAmount * taxRateNumber) / 100;
  const totalAmount = netAmount + taxAmount;

  return {
    subtotal: round2(subtotal),
    discount_amount: round2(discountResolved),
    net_amount: round2(netAmount),
    amount_after_discount: round2(netAmount),
    tax_rate: String(taxRateNumber),
    tax_amount: round2(taxAmount),
    total_amount: round2(totalAmount),
  };
}

/**
 * Calcule les totaux globaux d'une facture a partir d'items deja calcules
 * (sortie de computeItemTotals).
 *
 * @param {ReturnType<typeof computeItemTotals>[]} computedItems
 * @returns {{
 *   subtotal: number,
 *   total_line_discount_amount: number,
 *   total_tax_t_amount: number,
 *   total_tax_amount: number,
 *   total_amount: number,
 *   amount_due: number,
 * }}
 */
export function computeInvoiceTotals(computedItems) {
  let subtotal = 0;
  let totalLineDiscount = 0;
  let totalTax = 0;
  let totalAmount = 0;

  for (const it of computedItems) {
    subtotal += it.net_amount;
    totalLineDiscount += it.discount_amount;
    totalTax += it.tax_amount;
    totalAmount += it.total_amount;
  }

  return {
    subtotal: round2(subtotal),
    total_line_discount_amount: round2(totalLineDiscount),
    total_tax_t_amount: round2(totalTax),
    total_tax_amount: round2(totalTax),
    total_amount: round2(totalAmount),
    amount_due: round2(totalAmount),
  };
}
