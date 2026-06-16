/**
 * Erreurs typees du package sfec-client.
 *
 * Toutes les erreurs heritent de SfecError. Chaque erreur expose :
 *  - name    : nom de la classe
 *  - code    : code stable (string) pour switch/if
 *  - message : message lisible
 *  - toJSON(): representation safe (sans secrets) pour logs
 */

const SENSITIVE_KEYS = new Set([
  'apikey',
  'api_key',
  'x-api-key',
  'authorization',
  'token',
  'signingprivatekey',
  'signing_private_key',
  'encryptionmasterkey',
  'encryption_master_key',
  'mtlsclientprivatekey',
  'mtls_client_private_key',
  'mtlsclientcertificate',
  'mtls_client_certificate',
  'privatekey',
  'private_key',
  'secret',
  'password',
]);

const REDACTED = '***';

export function redactSensitive(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactSensitive(v, seen));
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) {
        out[k] = REDACTED;
      } else {
        out[k] = redactSensitive(v, seen);
      }
    }
    return out;
  }
  return REDACTED;
}

export class SfecError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, cause?: unknown, details?: Record<string, unknown> }} [options]
   */
  constructor(message, options = {}) {
    super(message);
    this.name = 'SfecError';
    this.code = options.code ?? 'SFEC_ERROR';
    if (options.cause !== undefined) this.cause = options.cause;
    this.details = options.details ? redactSensitive(options.details) : undefined;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

/**
 * fields : liste des problemes, chacun avec { path, message, code }
 *  - path  : chemin pointe (ex: "items[0].unit_price")
 *  - message : description lisible
 *  - code  : code stable (ex: "REQUIRED", "INVALID_TYPE", "OUT_OF_RANGE")
 */
export class SfecValidationError extends SfecError {
  /**
   * @param {string} message
   * @param {Array<{ path: string, message: string, code: string }>} fields
   */
  constructor(message, fields = []) {
    super(message, { code: 'SFEC_VALIDATION_ERROR' });
    this.name = 'SfecValidationError';
    this.fields = Array.isArray(fields) ? fields : [];
  }

  toJSON() {
    return {
      ...super.toJSON(),
      fields: this.fields,
    };
  }
}

/**
 * certificats absents pour un mode mTLS, etc.
 */
export class SfecConfigError extends SfecError {
  constructor(message, options = {}) {
    super(message, { ...options, code: options.code ?? 'SFEC_CONFIG_ERROR' });
    this.name = 'SfecConfigError';
  }
}

/**
 * Reponse HTTP non-2xx du serveur SFEC.
 * status : code HTTP (400, 401, 403, 404, 409, 422, 500, ...)
 * body   : corps de reponse parse (deja redacte)
 * requestId : si l'API renvoie un identifiant de correlation
 */
export class SfecHttpError extends SfecError {
  /**
   * @param {string} message
   * @param {{ status: number, body?: unknown, requestId?: string, url?: string, method?: string }} options
   */
  constructor(message, options) {
    super(message, {
      code: `SFEC_HTTP_${options.status}`,
      details: {
        status: options.status,
        url: options.url,
        method: options.method,
        body: options.body,
      },
    });
    this.name = 'SfecHttpError';
    this.status = options.status;
    this.body = options.body !== undefined ? redactSensitive(options.body) : undefined;
    this.requestId = options.requestId;
  }

  /** 401 : authentification manquante ou invalide. */
  isUnauthorized() {
    return this.status === 401;
  }
  /** 403 : authentifie mais non autorise (typiquement mTLS refuse). */
  isForbidden() {
    return this.status === 403;
  }
  /** 404 : ressource introuvable (certificat, terminal, facture). */
  isNotFound() {
    return this.status === 404;
  }
  /** 409 : conflit (facture deja certifiee = invoice_id deja vu). */
  isConflict() {
    return this.status === 409;
  }
  /** 422 : validation metier cote serveur (totaux incoherents, etc.). */
  isUnprocessable() {
    return this.status === 422;
  }
  /** 5xx : erreur serveur, candidat au retry. */
  isServerError() {
    return this.status >= 500 && this.status < 600;
  }
  /** 4xx : erreur client, ne pas retry. */
  isClientError() {
    return this.status >= 400 && this.status < 500;
  }
}

/**
 * Echec reseau : timeout, abort, DNS, TLS, connexion refusee.
 * Distinct de SfecHttpError : ici le serveur n'a pas repondu.
 */
export class SfecNetworkError extends SfecError {
  /**
   * @param {string} message
   * @param {{ cause?: unknown, url?: string, method?: string, timeout?: boolean }} [options]
   */
  constructor(message, options = {}) {
    super(message, {
      code: options.timeout ? 'SFEC_NETWORK_TIMEOUT' : 'SFEC_NETWORK_ERROR',
      cause: options.cause,
      details: { url: options.url, method: options.method, timeout: options.timeout },
    });
    this.name = 'SfecNetworkError';
    this.timeout = options.timeout === true;
  }
}
