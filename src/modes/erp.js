/**
 * Mode ERP : integration en ligne avec authentification par cle API.
 *
 * Deux operations exposees :
 *  - erpSubmit(config, input)        -> POST /v1/invoices
 *  - erpList(config, params)         -> GET  /v1/invoices
 *
 * Toutes les reponses sont normalisees en camelCase pour la DX, mais le
 * payload brut serveur reste accessible via `result.raw`.
 */

import { request } from '../transport.js';
import { buildInvoicePayload } from '../builders/invoice.js';
import { SfecValidationError, SfecConfigError } from '../errors.js';
import { createErrors, INVOICE_TYPES, isISO8601 } from '../validators/common.js';

const PATH_INVOICES = '/v1/invoices';

/**
 * Soumet une facture pour certification en ligne.
 *
 * @param {object} config        - issu de loadConfig()
 * @param {object} input         - input utilisateur (cf. validators/invoice.js)
 * @param {{ hooks?: object }} [options]
 * @returns {Promise<{
 *   invoiceId: string,
 *   invoiceNumber: string,
 *   certificationNumber: string,
 *   shortIdentifier: string|null,
 *   qrCode: string|null,
 *   certificationDate: string,
 *   raw: object,
 * }>}
 */
export async function erpSubmit(config, input, options = {}) {
  if (!config.apiKey) {
    throw new SfecConfigError(
      'erpSubmit : config sans apiKey. Definir SFEC_CLIENT_API_KEY ou passer { apiKey }.',
      { code: 'SFEC_ERP_NO_API_KEY' },
    );
  }

  const payload = buildInvoicePayload(input);

  const { body } = await request({
    config,
    method: 'POST',
    path: PATH_INVOICES,
    body: payload,
    hooks: options.hooks,
  });

  return normalizeSubmitResponse(body);
}

/**
 * Liste les factures certifiees pour la cle API courante.
 *
 * @param {object} config
 * @param {{
 *   page?: number,
 *   pageSize?: number,
 *   invoiceType?: 'salesInvoice'|'creditNote',
 *   dateStart?: string,
 *   dateEnd?: string,
 * }} [params]
 * @param {{ hooks?: object }} [options]
 * @returns {Promise<{
 *   invoices: object[],
 *   page: number,
 *   pageSize: number,
 *   totalPages: number,
 *   raw: object,
 * }>}
 */
export async function erpList(config, params = {}, options = {}) {
  if (!config.apiKey) {
    throw new SfecConfigError(
      'erpList : config sans apiKey. Definir SFEC_CLIENT_API_KEY ou passer { apiKey }.',
      { code: 'SFEC_ERP_NO_API_KEY' },
    );
  }

  const validated = validateListParams(params);

  const { body } = await request({
    config,
    method: 'GET',
    path: PATH_INVOICES,
    query: validated,
    hooks: options.hooks,
  });

  return normalizeListResponse(body, validated);
}

/**
 * Valide les params de liste cote client. Throw SfecValidationError si KO.
 * Retourne un objet de query params propre (snake_case attendu par l'API).
 */
function validateListParams(params) {
  const errors = createErrors();
  const out = {};

  if (params.page !== undefined) {
    if (!Number.isInteger(params.page) || params.page < 1) {
      errors.push('page', 'page : entier >= 1 attendu.', 'OUT_OF_RANGE');
    } else {
      out.page = params.page;
    }
  }
  if (params.pageSize !== undefined) {
    if (!Number.isInteger(params.pageSize) || params.pageSize < 1 || params.pageSize > 20) {
      errors.push('pageSize', 'pageSize : entier entre 1 et 20 attendu.', 'OUT_OF_RANGE');
    } else {
      out.pageSize = params.pageSize;
    }
  }
  if (params.invoiceType !== undefined) {
    if (!INVOICE_TYPES.includes(params.invoiceType)) {
      errors.push(
        'invoiceType',
        `invoiceType : valeur invalide. Autorise : ${INVOICE_TYPES.join(', ')}.`,
        'INVALID_ENUM',
      );
    } else {
      out.invoice_type = params.invoiceType;
    }
  }
  if (params.dateStart !== undefined) {
    if (!isISO8601(params.dateStart)) {
      errors.push('dateStart', 'dateStart : format ISO 8601 attendu (YYYY-MM-DD).', 'INVALID_FORMAT');
    } else {
      out.date_start = params.dateStart;
    }
  }
  if (params.dateEnd !== undefined) {
    if (!isISO8601(params.dateEnd)) {
      errors.push('dateEnd', 'dateEnd : format ISO 8601 attendu (YYYY-MM-DD).', 'INVALID_FORMAT');
    } else {
      out.date_end = params.dateEnd;
    }
  }

  if (errors.hasErrors()) {
    throw new SfecValidationError(
      `Parametres de liste invalides : ${errors.list().length} probleme(s).`,
      errors.list(),
    );
  }
  return out;
}

/**
 * Normalise la reponse POST /v1/invoices en camelCase.
 * Tolerant : si un champ manque, retourne null plutot que de throw.
 */
function normalizeSubmitResponse(body) {
  const b = body && typeof body === 'object' ? body : {};
  return {
    invoiceId: b.invoice_id ?? null,
    invoiceNumber: b.invoice_number ?? null,
    certificationNumber: b.sfec_certification_number ?? b.certification_number ?? null,
    shortIdentifier: b.sfec_identifier ?? b.short_signature ?? null,
    qrCode: b.sfec_qr_code ?? b.qr_code ?? null,
    certificationDate: b.certification_date ?? null,
    raw: b,
  };
}

/**
 * Normalise la reponse GET /v1/invoices.
 * La doc indique { invoices, totalPages, page, pageSize }.
 */
function normalizeListResponse(body, requested) {
  const b = body && typeof body === 'object' ? body : {};
  return {
    invoices: Array.isArray(b.invoices) ? b.invoices : [],
    page: b.page ?? requested.page ?? 1,
    pageSize: b.pageSize ?? requested.pageSize ?? 10,
    totalPages: b.totalPages ?? 0,
    raw: b,
  };
}
