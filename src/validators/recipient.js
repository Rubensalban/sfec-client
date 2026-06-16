/**
 * Validation du bloc destinataire (recipient).
 *
 * Forme attendue en input utilisateur :
 *   {
 *     type: 'business'|'individual'|'government'|'foreign',
 *     name: string,
 *     niu?: string,
 *     rccm?: string,
 *     address?: string,
 *     phone?: string,
 *     email?: string,
 *     isTaxable?: boolean,
 *   }
 */

import {
  RECIPIENT_TYPES,
  requireString,
  requireEnum,
  optionalEmail,
} from './common.js';

/**
 * @param {unknown} recipient
 * @param {string} path
 * @param {ReturnType<import('./common.js').createErrors>} errors
 */
export function validateRecipient(recipient, path, errors) {
  if (recipient === null || typeof recipient !== 'object') {
    errors.push(path, `${path} : objet destinataire requis.`, 'REQUIRED');
    return;
  }

  const r = /** @type {Record<string, unknown>} */ (recipient);

  requireEnum(r.type, `${path}.type`, RECIPIENT_TYPES, errors);
  requireString(r.name, `${path}.name`, errors);

  if (r.niu !== undefined && r.niu !== null && r.niu !== '') {
    if (typeof r.niu !== 'string') {
      errors.push(`${path}.niu`, `${path}.niu : chaine attendue si fourni.`, 'INVALID_TYPE');
    } else if (r.niu.length > 20) {
      errors.push(`${path}.niu`, `${path}.niu : longueur max 20 caracteres.`, 'TOO_LONG');
    }
  }

  if (r.rccm !== undefined && r.rccm !== null && r.rccm !== '' && typeof r.rccm !== 'string') {
    errors.push(`${path}.rccm`, `${path}.rccm : chaine attendue si fourni.`, 'INVALID_TYPE');
  }

  if (r.address !== undefined && r.address !== null && r.address !== '' && typeof r.address !== 'string') {
    errors.push(`${path}.address`, `${path}.address : chaine attendue si fourni.`, 'INVALID_TYPE');
  }

  if (r.phone !== undefined && r.phone !== null && r.phone !== '' && typeof r.phone !== 'string') {
    errors.push(`${path}.phone`, `${path}.phone : chaine attendue si fourni.`, 'INVALID_TYPE');
  }

  optionalEmail(r.email, `${path}.email`, errors);

  if (r.isTaxable !== undefined && typeof r.isTaxable !== 'boolean') {
    errors.push(`${path}.isTaxable`, `${path}.isTaxable : boolean attendu si fourni.`, 'INVALID_TYPE');
  }

  // Regle metier : un destinataire "business" sans niu ni rccm est suspect.
  // On le signale en erreur dure : evite des 422 cote serveur.
  if (r.type === 'business') {
    const hasNiu = typeof r.niu === 'string' && r.niu.length > 0;
    const hasRccm = typeof r.rccm === 'string' && r.rccm.length > 0;
    if (!hasNiu && !hasRccm) {
      errors.push(
        `${path}`,
        `${path} : un destinataire de type "business" doit avoir au moins un NIU ou un RCCM.`,
        'BUSINESS_IDENTIFICATION_REQUIRED',
      );
    }
  }
}
