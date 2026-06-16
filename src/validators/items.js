/**
 * Validation du tableau d'articles (items).
 *
 * Forme attendue par article :
 *   {
 *     designation: string,
 *     type: 'product'|'service',
 *     unit_price: number (>= 0),
 *     quantity: number (> 0),
 *     tax_rate: string|number (taux TVA, requis),
 *     classification_code?: string,
 *     discount_amount?: number (>= 0),
 *     discount_type?: 'fixed'|'percentage',
 *   }
 */

import {
  ITEM_TYPES,
  DISCOUNT_TYPES,
  requireString,
  requireEnum,
  requirePositiveNumber,
  requireNonNegativeNumber,
} from './common.js';

/**
 * @param {unknown} items
 * @param {string} path
 * @param {ReturnType<import('../validators/common.js').createErrors>} errors
 */
export function validateItems(items, path, errors) {
  if (!Array.isArray(items)) {
    errors.push(path, `${path} : tableau d'articles requis.`, 'INVALID_TYPE');
    return;
  }
  if (items.length === 0) {
    errors.push(path, `${path} : au moins un article est requis.`, 'EMPTY_ARRAY');
    return;
  }

  items.forEach((item, idx) => {
    const itemPath = `${path}[${idx}]`;
    if (item === null || typeof item !== 'object') {
      errors.push(itemPath, `${itemPath} : objet article requis.`, 'INVALID_TYPE');
      return;
    }
    validateItem(item, itemPath, errors);
  });
}

function validateItem(item, path, errors) {
  const it = /** @type {Record<string, unknown>} */ (item);

  requireString(it.designation, `${path}.designation`, errors);
  requireEnum(it.type, `${path}.type`, ITEM_TYPES, errors);
  requireNonNegativeNumber(it.unit_price, `${path}.unit_price`, errors);
  requirePositiveNumber(it.quantity, `${path}.quantity`, errors);

  // tax_rate : accepte string ("18", "18.0") ou number. Doit etre >= 0.
  if (it.tax_rate === undefined || it.tax_rate === null || it.tax_rate === '') {
    errors.push(`${path}.tax_rate`, `${path}.tax_rate : requis (ex: "18" ou 18).`, 'REQUIRED');
  } else {
    const asNumber = typeof it.tax_rate === 'string' ? Number(it.tax_rate) : it.tax_rate;
    if (typeof asNumber !== 'number' || !Number.isFinite(asNumber) || asNumber < 0) {
      errors.push(`${path}.tax_rate`, `${path}.tax_rate : nombre >= 0 attendu.`, 'OUT_OF_RANGE');
    }
  }

  if (it.classification_code !== undefined && it.classification_code !== null && it.classification_code !== '') {
    if (typeof it.classification_code !== 'string') {
      errors.push(
        `${path}.classification_code`,
        `${path}.classification_code : chaine attendue si fourni.`,
        'INVALID_TYPE',
      );
    }
  }

  if (it.discount_amount !== undefined && it.discount_amount !== null) {
    requireNonNegativeNumber(it.discount_amount, `${path}.discount_amount`, errors);
  }

  if (it.discount_type !== undefined && it.discount_type !== null) {
    requireEnum(it.discount_type, `${path}.discount_type`, DISCOUNT_TYPES, errors);
  }

  // Si un discount_amount est fourni, discount_type doit l'etre aussi (sinon impossible de savoir si c'est un montant fixe ou un %).
  const hasAmount = it.discount_amount !== undefined && it.discount_amount !== null;
  const hasType = it.discount_type !== undefined && it.discount_type !== null;
  if (hasAmount && !hasType) {
    errors.push(
      `${path}.discount_type`,
      `${path}.discount_type : requis lorsque discount_amount est fourni.`,
      'REQUIRED',
    );
  }

  // Pour un discount_type "percentage", verifier que la valeur est entre 0 et 100.
  if (hasAmount && it.discount_type === 'percentage') {
    if (typeof it.discount_amount === 'number' && (it.discount_amount < 0 || it.discount_amount > 100)) {
      errors.push(
        `${path}.discount_amount`,
        `${path}.discount_amount : pourcentage entre 0 et 100 attendu.`,
        'OUT_OF_RANGE',
      );
    }
  }
}
