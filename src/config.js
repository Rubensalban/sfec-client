/**
 * Fonction pure principale :
 *   loadConfig(options?) -> Config immutable.
 *
 * Sources d'input (par ordre de priorite) :
 *  1. Argument options explicite
 *  2. Variables d'environnement (process.env)
 *
 *
 * Securite :
 *  - apiKey wrappee dans un Secret : .reveal() pour lire, toString/JSON = "***"
 *  - baseUrl impose HTTPS (sauf localhost/127.0.0.1 pour tests)
 *  - mTLS accepte uniquement des Buffer/string PEM en memoire (pas de chemins)
 *  - L'objet config retourne est Object.freeze() : immutable
 */

import { SfecConfigError } from './errors.js';

const DEFAULTS = Object.freeze({
  timeoutMs: 30000,
  retry: Object.freeze({ max: 3, baseDelayMs: 500 }),
  env: 'unknown',
});

const ENV_VAR_API_KEY = 'SFEC_CLIENT_API_KEY';
const ENV_VAR_BASE_URL = 'SFEC_CLIENT_BASE_URL';
const ENV_VAR_ENV = 'SFEC_CLIENT_ENV';

/**
 * Wrapper de secret. Empeche les fuites accidentelles via log/JSON.stringify.
 * Le seul moyen de lire la valeur est d'appeler .reveal().
 */
export function wrapSecret(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SfecConfigError('wrapSecret: la valeur doit etre une chaine non vide', {
      code: 'SFEC_CONFIG_INVALID_SECRET',
    });
  }
  const inner = value;
  const secret = {
    reveal() {
      return inner;
    },
    toString() {
      return '***';
    },
    toJSON() {
      return '***';
    },
    [Symbol.for('nodejs.util.inspect.custom')]() {
      return '***';
    },
  };
  Object.freeze(secret);
  return secret;
}

/**
 * Valide et normalise une base URL fournie par l'utilisateur.
 * - Doit etre une URL absolue
 * - HTTPS obligatoire (sauf localhost / 127.0.0.1 pour tests locaux)
 * - Le slash final est supprime pour faciliter la concatenation
 *
 * @param {string} value
 * @returns {string} URL normalisee
 */
export function validateBaseUrl(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SfecConfigError(
      `${ENV_VAR_BASE_URL} doit etre une URL non vide.`,
      { code: 'SFEC_CONFIG_INVALID_BASE_URL' },
    );
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new SfecConfigError(
      `${ENV_VAR_BASE_URL} n'est pas une URL valide : "${value}".`,
      { code: 'SFEC_CONFIG_INVALID_BASE_URL' },
    );
  }
  const isLocal =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '::1' ||
    url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !isLocal) {
    throw new SfecConfigError(
      `${ENV_VAR_BASE_URL} doit utiliser HTTPS (recu : ${url.protocol}//${url.hostname}). HTTP autorise uniquement pour localhost.`,
      { code: 'SFEC_CONFIG_INSECURE_BASE_URL' },
    );
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new SfecConfigError(
      `${ENV_VAR_BASE_URL} : protocole non supporte (${url.protocol}).`,
      { code: 'SFEC_CONFIG_INVALID_BASE_URL' },
    );
  }
  // Normalise : supprime trailing slash
  let normalized = url.toString();
  if (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  return normalized;
}

/**
 * Valide un bloc mTLS et le normalise.
 * @param {{ cert: string|Buffer, key: string|Buffer, ca?: string|Buffer }} mtls
 */
function validateMtls(mtls) {
  if (!mtls || typeof mtls !== 'object') {
    throw new SfecConfigError('mtls doit etre un objet { cert, key, ca? }', {
      code: 'SFEC_CONFIG_INVALID_MTLS',
    });
  }
  const { cert, key, ca } = mtls;
  for (const [name, val] of [['cert', cert], ['key', key]]) {
    if (typeof val !== 'string' && !Buffer.isBuffer(val)) {
      throw new SfecConfigError(
        `mtls.${name} doit etre une chaine PEM ou un Buffer (chemins de fichiers non acceptes).`,
        { code: 'SFEC_CONFIG_INVALID_MTLS' },
      );
    }
    if ((typeof val === 'string' && val.length === 0) || (Buffer.isBuffer(val) && val.length === 0)) {
      throw new SfecConfigError(`mtls.${name} est vide.`, { code: 'SFEC_CONFIG_INVALID_MTLS' });
    }
  }
  if (ca !== undefined && typeof ca !== 'string' && !Buffer.isBuffer(ca)) {
    throw new SfecConfigError('mtls.ca doit etre une chaine PEM ou un Buffer si fourni.', {
      code: 'SFEC_CONFIG_INVALID_MTLS',
    });
  }
  const wrapped = {
    cert,
    key,
    ca,
    toJSON() {
      return { cert: '***', key: '***', ca: ca === undefined ? undefined : '***' };
    },
    [Symbol.for('nodejs.util.inspect.custom')]() {
      return { cert: '***', key: '***', ca: ca === undefined ? undefined : '***' };
    },
  };
  Object.freeze(wrapped);
  return wrapped;
}

function validatePositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new SfecConfigError(`${name} doit etre un entier positif (recu : ${value}).`, {
      code: 'SFEC_CONFIG_INVALID_NUMBER',
    });
  }
}

function validateNonNegativeInteger(value, name) {
  if (!Number.isInteger(value) || value < 0) {
    throw new SfecConfigError(`${name} doit etre un entier >= 0 (recu : ${value}).`, {
      code: 'SFEC_CONFIG_INVALID_NUMBER',
    });
  }
}

/**
 * Charge et valide la configuration.
 *
 * @param {{
 *   baseUrl?: string,
 *   env?: string,
 *   apiKey?: string,
 *   mtls?: { cert: string|Buffer, key: string|Buffer, ca?: string|Buffer },
 *   timeoutMs?: number,
 *   retry?: { max?: number, baseDelayMs?: number },
 *   processEnv?: Record<string, string|undefined>,
 * }} [options]
 * @returns {Readonly<{
 *   env: string,
 *   baseUrl: string,
 *   apiKey?: { reveal(): string },
 *   mtls?: object,
 *   timeoutMs: number,
 *   retry: { max: number, baseDelayMs: number },
 * }>}
 */
export function loadConfig(options = {}) {
  const env = options.processEnv ?? (typeof process !== 'undefined' ? process.env : {});

  const rawBaseUrl = options.baseUrl ?? env[ENV_VAR_BASE_URL];
  if (!rawBaseUrl) {
    throw new SfecConfigError(
      `Variable ${ENV_VAR_BASE_URL} manquante. Definir l'URL de l'API SFEC (.env) ou passer { baseUrl } a loadConfig.`,
      { code: 'SFEC_CONFIG_MISSING_BASE_URL' },
    );
  }
  const baseUrl = validateBaseUrl(rawBaseUrl);

  const envName = options.env ?? env[ENV_VAR_ENV] ?? DEFAULTS.env;
  if (typeof envName !== 'string' || envName.length === 0) {
    throw new SfecConfigError(`${ENV_VAR_ENV} doit etre une chaine non vide si fourni.`, {
      code: 'SFEC_CONFIG_INVALID_ENV',
    });
  }

  let apiKey;
  const rawApiKey = options.apiKey ?? env[ENV_VAR_API_KEY];
  if (rawApiKey !== undefined && rawApiKey !== '') {
    if (typeof rawApiKey !== 'string') {
      throw new SfecConfigError(`${ENV_VAR_API_KEY} doit etre une chaine.`, {
        code: 'SFEC_CONFIG_INVALID_API_KEY',
      });
    }
    apiKey = wrapSecret(rawApiKey);
  }

  let mtls;
  if (options.mtls !== undefined) {
    mtls = validateMtls(options.mtls);
  }

  if (!apiKey && !mtls) {
    throw new SfecConfigError(
      `Aucune methode d'authentification fournie. Definir ${ENV_VAR_API_KEY} (mode ERP) ou passer { mtls } (mode TCC/TFC).`,
      { code: 'SFEC_CONFIG_MISSING_AUTH' },
    );
  }

  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  validatePositiveInteger(timeoutMs, 'timeoutMs');

  const retryMax = options.retry?.max ?? DEFAULTS.retry.max;
  const retryBase = options.retry?.baseDelayMs ?? DEFAULTS.retry.baseDelayMs;
  validateNonNegativeInteger(retryMax, 'retry.max');
  validatePositiveInteger(retryBase, 'retry.baseDelayMs');

  const config = {
    env: envName,
    baseUrl,
    apiKey,
    mtls,
    timeoutMs,
    retry: Object.freeze({ max: retryMax, baseDelayMs: retryBase }),
  };
  return Object.freeze(config);
}

/**
 * Config minimale pour appels publics (sans auth) : uniquement
 * pour le bootstrap des certificats mTLS via /v1/certificates/claim-with-token.
 *
 * Ne sert qu'a un seul cas d'usage : recuperer les certificats. Ne pas l'utiliser
 * pour d'autres appels.
 *
 * @param {{ baseUrl?: string, timeoutMs?: number, retry?: object, processEnv?: object }} [options]
 */
export function bootstrapConfig(options = {}) {
  const envSource = options.processEnv ?? (typeof process !== 'undefined' ? process.env : {});
  const rawBaseUrl = options.baseUrl ?? envSource[ENV_VAR_BASE_URL];
  if (!rawBaseUrl) {
    throw new SfecConfigError(
      `Variable ${ENV_VAR_BASE_URL} manquante pour le bootstrap des certificats.`,
      { code: 'SFEC_CONFIG_MISSING_BASE_URL' },
    );
  }
  const baseUrl = validateBaseUrl(rawBaseUrl);

  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  validatePositiveInteger(timeoutMs, 'timeoutMs');

  const retryMax = options.retry?.max ?? DEFAULTS.retry.max;
  const retryBase = options.retry?.baseDelayMs ?? DEFAULTS.retry.baseDelayMs;
  validateNonNegativeInteger(retryMax, 'retry.max');
  validatePositiveInteger(retryBase, 'retry.baseDelayMs');

  return Object.freeze({
    env: 'bootstrap',
    baseUrl,
    apiKey: undefined,
    mtls: undefined,
    timeoutMs,
    retry: Object.freeze({ max: retryMax, baseDelayMs: retryBase }),
  });
}
