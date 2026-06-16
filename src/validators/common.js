/**
 * Briques de validation pures et accumulateur d'erreurs.
 *
 * Convention : chaque verificateur prend (value, path, errors) et pousse
 * une entree dans `errors` si la valeur est invalide. Retourne true si OK.
 * Cette approche permet de collecter TOUS les problemes en une passe
 * avant de throw, plutot que de fail-fast.
 */

/**
 * @typedef {{ path: string, message: string, code: string }} FieldError
 */

/**
 * Cree un accumulateur d'erreurs.
 * @returns {{
 *   push: (path: string, message: string, code: string) => void,
 *   list: () => FieldError[],
 *   hasErrors: () => boolean,
 * }}
 */
export function createErrors() {
  const list = [];
  return {
    push(path, message, code) {
      list.push({ path, message, code });
    },
    list() {
      return list;
    },
    hasErrors() {
      return list.length > 0;
    },
  };
}

export function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

export function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

export function isPositiveNumber(v) {
  return isFiniteNumber(v) && v > 0;
}

export function isNonNegativeNumber(v) {
  return isFiniteNumber(v) && v >= 0;
}

export function isPositiveInteger(v) {
  return Number.isInteger(v) && v > 0;
}

/**
 * Verifie un format ISO 8601 simple (date ou datetime). Ne valide pas la
 * justesse calendaire fine ; Date.parse suffit pour rejeter le n'importe quoi.
 */
export function isISO8601(v) {
  if (typeof v !== 'string' || v.length === 0) return false;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return false;
  return /^\d{4}-\d{2}-\d{2}/.test(v);
}
// Validation simple : presence d'un @ avec contenu de part et d'autre, un point apres
export function isEmail(v) {
  if (typeof v !== 'string') return false;

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/**
 * Verifie qu'une valeur appartient a un ensemble fini.
 * @template T
 * @param {unknown} v
 * @param {readonly T[]} allowed
 * @returns {boolean}
 */
export function isEnum(v, allowed) {
  return allowed.includes(v);
}

// Helpers de validation
export function requireString(value, path, errors, code = 'REQUIRED') {
  if (!isNonEmptyString(value)) {
    errors.push(path, `${path} : chaine non vide requise.`, code);
    return false;
  }
  return true;
}

export function requireMaxLength(value, path, max, errors) {
  if (typeof value === 'string' && value.length > max) {
    errors.push(path, `${path} : longueur max ${max} caracteres (recu ${value.length}).`, 'TOO_LONG');
    return false;
  }
  return true;
}

export function requireEnum(value, path, allowed, errors) {
  if (!isEnum(value, allowed)) {
    errors.push(
      path,
      `${path} : valeur invalide. Autorise : ${allowed.join(', ')}.`,
      'INVALID_ENUM',
    );
    return false;
  }
  return true;
}

export function requirePositiveNumber(value, path, errors) {
  if (!isPositiveNumber(value)) {
    errors.push(path, `${path} : nombre strictement positif requis.`, 'OUT_OF_RANGE');
    return false;
  }
  return true;
}

export function requireNonNegativeNumber(value, path, errors) {
  if (!isNonNegativeNumber(value)) {
    errors.push(path, `${path} : nombre >= 0 requis.`, 'OUT_OF_RANGE');
    return false;
  }
  return true;
}

export function optionalISO8601(value, path, errors) {
  if (value === undefined || value === null) return true;
  if (!isISO8601(value)) {
    errors.push(path, `${path} : format ISO 8601 attendu (ex: 2026-01-15 ou 2026-01-15T10:30:00Z).`, 'INVALID_FORMAT');
    return false;
  }
  return true;
}

export function optionalEmail(value, path, errors) {
  if (value === undefined || value === null || value === '') return true;
  if (!isEmail(value)) {
    errors.push(path, `${path} : email invalide.`, 'INVALID_FORMAT');
    return false;
  }
  return true;
}

// Constantes d'enums de la doc SFEC
export const INVOICE_TYPES = Object.freeze(['salesInvoice', 'creditNote']);
export const RECIPIENT_TYPES = Object.freeze(['business', 'individual', 'government', 'foreign']);
export const PAYMENT_METHODS = Object.freeze(['bank_transfer', 'card', 'cash', 'mobile_money', 'cheque']);
export const CURRENCIES = Object.freeze(['XAF', 'USD']);
export const ITEM_TYPES = Object.freeze(['product', 'service']);
export const DISCOUNT_TYPES = Object.freeze(['fixed', 'percentage']);
