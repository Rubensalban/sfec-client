/**
 * Logique partagee entre les modes TCC et TFC.
 *
 * D'apres la doc SFEC, TCC et TFC utilisent :
 *  - POST /v1/invoices (meme endpoint que ERP, mais auth mTLS)
 *  - GET  /v1/terminals/invoices (specifique aux terminaux)
 *
 * Les differences metier (HSM, certification materielle) sont cote
 * infrastructure utilisateur, pas dans l'API REST.
 */

import { request } from '../transport.js';
import { buildInvoicePayload } from '../builders/invoice.js';
import { SfecValidationError, SfecConfigError } from '../errors.js';
import { createErrors, INVOICE_TYPES, isISO8601 } from '../validators/common.js';

const PATH_INVOICES = '/v1/invoices';
const PATH_TERMINAL_INVOICES = '/v1/terminals/invoices';

/**
 * Verifie que la config a bien un mTLS (sinon refus avant tout reseau).
 */
function requireMtls(config, fn) {
  if (!config.mtls) {
    throw new SfecConfigError(
      `${fn} : config sans mtls. Recuperer les certificats via claimCertificates() puis passer { mtls } a loadConfig.`,
      { code: 'SFEC_TERMINAL_NO_MTLS' },
    );
  }
}

/**
 * Soumet une facture pre-certifiee localement.
 * Meme payload qu'ERP, mais avec auth mTLS.
 *
 * @param {object} config
 * @param {object} input
 * @param {{ hooks?: object }} [options]
 */
export async function terminalSubmit(config, input, options = {}) {
  requireMtls(config, 'terminalSubmit');
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
 * Liste les factures associees au certificat (filtrage automatique par terminal).
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
 */
export async function terminalList(config, params = {}, options = {}) {
  requireMtls(config, 'terminalList');
  const validated = validateListParams(params);
  const { body } = await request({
    config,
    method: 'GET',
    path: PATH_TERMINAL_INVOICES,
    query: validated,
    hooks: options.hooks,
  });
  return normalizeListResponse(body, validated);
}

function validateListParams(params) {
  const errors = createErrors();
  const out = {};
  if (params.page !== undefined) {
    if (!Number.isInteger(params.page) || params.page < 1) {
      errors.push('page', 'page : entier >= 1 attendu.', 'OUT_OF_RANGE');
    } else out.page = params.page;
  }
  if (params.pageSize !== undefined) {
    if (!Number.isInteger(params.pageSize) || params.pageSize < 1 || params.pageSize > 20) {
      errors.push('pageSize', 'pageSize : entier entre 1 et 20.', 'OUT_OF_RANGE');
    } else out.pageSize = params.pageSize;
  }
  if (params.invoiceType !== undefined) {
    if (!INVOICE_TYPES.includes(params.invoiceType)) {
      errors.push('invoiceType', `invoiceType : valeur invalide.`, 'INVALID_ENUM');
    } else out.invoice_type = params.invoiceType;
  }
  if (params.dateStart !== undefined) {
    if (!isISO8601(params.dateStart)) {
      errors.push('dateStart', 'dateStart : ISO 8601 attendu.', 'INVALID_FORMAT');
    } else out.date_start = params.dateStart;
  }
  if (params.dateEnd !== undefined) {
    if (!isISO8601(params.dateEnd)) {
      errors.push('dateEnd', 'dateEnd : ISO 8601 attendu.', 'INVALID_FORMAT');
    } else out.date_end = params.dateEnd;
  }
  if (errors.hasErrors()) {
    throw new SfecValidationError(
      `Parametres de liste invalides : ${errors.list().length} probleme(s).`,
      errors.list(),
    );
  }
  return out;
}

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
