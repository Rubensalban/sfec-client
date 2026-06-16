import { loadConfig, bootstrapConfig } from './config.js';
import { erpSubmit, erpList } from './modes/erp.js';
import { tccSubmit, tccList } from './modes/tcc.js';
import { tfcSubmit, tfcList } from './modes/tfc.js';
import { claimCertificates } from './certificates.js';
import { buildInvoicePayload } from './builders/invoice.js';
import { computeItemTotals, computeInvoiceTotals } from './builders/totals.js';
import { SfecError, SfecValidationError, SfecConfigError, SfecHttpError, SfecNetworkError } from './errors.js';
import { INVOICE_TYPES, RECIPIENT_TYPES, PAYMENT_METHODS, CURRENCIES, ITEM_TYPES, DISCOUNT_TYPES } from './validators/common.js';

/**
 * Combine hooks globaux (config-level) et hooks ponctuels (call-level).
 * Les hooks ponctuels sont appeles APRES les globaux pour permettre une
 * specialisation par appel.
 */
function mergeHooks(global, local) {
  if (!global && !local) return undefined;
  if (!global) return local;
  if (!local) return global;
  const merged = {};
  for (const key of ['onRequest', 'onResponse', 'onError']) {
    const g = global[key];
    const l = local[key];
    if (g && l) {
      merged[key] = (info) => { g(info); l(info); };
    } else if (g) {
      merged[key] = g;
    } else if (l) {
      merged[key] = l;
    }
  }
  return merged;
}

/**
 * Construit un client d'une config validee.
 *
 * @param {ReturnType<typeof loadConfig>} config
 * @param {{ onRequest?: Function, onResponse?: Function, onError?: Function }} [hooks]
 */
function buildClient(config, hooks) {
  const callHooks = (local) => mergeHooks(hooks, local);

  const client = {
    config,

    /** Mode ERP en ligne (auth X-API-Key). */
    erp: Object.freeze({
      submit: (input, options = {}) =>
        erpSubmit(config, input, { ...options, hooks: callHooks(options.hooks) }),
      list: (params, options = {}) =>
        erpList(config, params, { ...options, hooks: callHooks(options.hooks) }),
    }),

    /** Mode TCC : module de controle (auth mTLS, certification locale). */
    tcc: Object.freeze({
      submit: (input, options = {}) =>
        tccSubmit(config, input, { ...options, hooks: callHooks(options.hooks) }),
      list: (params, options = {}) =>
        tccList(config, params, { ...options, hooks: callHooks(options.hooks) }),
    }),

    /** Mode TFC : terminal fiscal certifie (auth mTLS, materiel). */
    tfc: Object.freeze({
      submit: (input, options = {}) =>
        tfcSubmit(config, input, { ...options, hooks: callHooks(options.hooks) }),
      list: (params, options = {}) =>
        tfcList(config, params, { ...options, hooks: callHooks(options.hooks) }),
    }),

    /**
     * Utile pour logs/Sentry/debug.
     */
    toJSON() {
      return {
        baseUrl: config.baseUrl,
        env: config.env,
        hasApiKey: Boolean(config.apiKey),
        hasMtls: Boolean(config.mtls),
        timeoutMs: config.timeoutMs,
        retry: config.retry,
      };
    },
    [Symbol.for('nodejs.util.inspect.custom')]() {
      return this.toJSON();
    },
  };

  return Object.freeze(client);
}

export const SfecClient = Object.freeze({
  /**
   * Cree un client a partir d'options explicites (et/ou des variables d'env passees via processEnv, utile pour tests).
   *
   * @param {Parameters<typeof loadConfig>[0] & {
   *   hooks?: { onRequest?: Function, onResponse?: Function, onError?: Function }
   * }} [options]
   */
  create(options = {}) {
    const { hooks, ...configOptions } = options;
    const config = loadConfig(configOptions);
    return buildClient(config, hooks);
  },

  /**
   * Cree un client en lisant uniquement process.env :
   *  - SFEC_CLIENT_BASE_URL (requis)
   *  - SFEC_CLIENT_API_KEY  (ERP)
   *  - SFEC_CLIENT_ENV      (label optionnel)
   *
   * Pour le mode mTLS, utiliser SfecClient.create({ mtls, ... }) (les certificats
   * sont des secrets et ne se passent pas via env brutes).
   *
   * @param {{ hooks?: object }} [options]
   */
  fromEnv(options = {}) {
    const config = loadConfig();
    return buildClient(config, options.hooks);
  },
});

// Re-exports utiles

export {
  // Erreurs typees
  SfecError,
  SfecValidationError,
  SfecConfigError,
  SfecHttpError,
  SfecNetworkError,

  // Bootstrap mTLS (a utiliser hors client)
  bootstrapConfig,
  claimCertificates,

  // Builder direct (utilisateurs avancés qui veulent juste le payload)
  buildInvoicePayload,
  computeItemTotals,
  computeInvoiceTotals,

  // Enums tires de la doc SFEC
  INVOICE_TYPES,
  RECIPIENT_TYPES,
  PAYMENT_METHODS,
  CURRENCIES,
  ITEM_TYPES,
  DISCOUNT_TYPES,
};
