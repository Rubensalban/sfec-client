/**
 * Bootstrap des certificats mTLS pour les modes TCC et TFC.
 *
 * Endpoint : POST /v1/certificates/claim-with-token
 *
 * Securite :
 *  - L'objet retourne contient du materiel CRYPTOGRAPHIQUE :
 *    signingPrivateKey, encryptionMasterKey, mtlsClientPrivateKey.
 *    Il est wrappe : toJSON/inspect/toString retournent une vue masquee.
 *    L'utilisateur DOIT appeler .reveal() pour obtenir les valeurs en clair
 *    et les persister dans un secret store (Vault, AWS SM, etc.).
 *  - Aucun log par defaut. Aucun fichier ecrit.
 */

import { request } from './transport.js';
import { SfecValidationError, SfecHttpError } from './errors.js';
import { createErrors, requireString } from './validators/common.js';

const PATH_CLAIM = '/v1/certificates/claim-with-token';

/**
 * Reclame les certificats et cles mTLS via un token d'amorcage.
 *
 * @param {object} config - bootstrapConfig() suffit (pas d'auth requise)
 * @param {{ token: string, niu: string, terminalIdentifier?: string }} params
 * @param {{ hooks?: object }} [options]
 * @returns {Promise<Credentials>}
 */
export async function claimCertificates(config, params, options = {}) {
  const errors = createErrors();
  if (!params || typeof params !== 'object') {
    throw new SfecValidationError('claimCertificates : { token, niu } requis.', [
      { path: '', message: 'objet requis', code: 'REQUIRED' },
    ]);
  }
  requireString(params.token, 'token', errors);
  requireString(params.niu, 'niu', errors);
  if (params.terminalIdentifier !== undefined && params.terminalIdentifier !== null && params.terminalIdentifier !== '') {
    if (typeof params.terminalIdentifier !== 'string') {
      errors.push('terminalIdentifier', 'terminalIdentifier : chaine attendue si fourni.', 'INVALID_TYPE');
    }
  }
  if (errors.hasErrors()) {
    throw new SfecValidationError(
      `Parametres claimCertificates invalides : ${errors.list().length} probleme(s).`,
      errors.list(),
    );
  }

  const body = {
    token: params.token,
    niu: params.niu,
  };
  if (params.terminalIdentifier) {
    body.terminal_identifier = params.terminalIdentifier;
  }

  const { body: response } = await request({
    config,
    method: 'POST',
    path: PATH_CLAIM,
    body,
    hooks: wrapCredentialHooks(options.hooks),
  });

  return makeCredentials(response);
}

/**
 * Construit l'objet Credentials a partir de la reponse serveur.
 * Wrappe les champs sensibles pour empecher toute fuite via log/JSON.
 *
 * @param {object} response
 */
function makeCredentials(response) {
  const r = response && typeof response === 'object' ? response : {};

  const sensitive = {
    signingPrivateKey: r.signingPrivateKey ?? null,
    encryptionMasterKey: r.encryptionMasterKey ?? null,
    mtlsClientCertificate: r.mtlsClientCertificate ?? null,
    mtlsClientPrivateKey: r.mtlsClientPrivateKey ?? null,
  };

  const publicInfo = {
    taxpayerInfo: r.taxpayerInfo ?? null,
    mtlsEndpoints: r.mtlsEndpoints ?? null,
  };

  const credentials = {
    ...publicInfo,
    /**
     * Retourne le materiel cryptographique en clair. A appeler UNE FOIS,
     * puis persister immediatement dans un secret store securise.
     */
    reveal() {
      return { ...sensitive, ...publicInfo };
    },
    /**
     * Renvoie une copie {cert, key, ca?} prete a passer a loadConfig({ mtls }).
     */
    toMtls() {
      return {
        cert: sensitive.mtlsClientCertificate,
        key: sensitive.mtlsClientPrivateKey,
      };
    },
    toJSON() {
      return {
        signingPrivateKey: '***',
        encryptionMasterKey: '***',
        mtlsClientCertificate: '***',
        mtlsClientPrivateKey: '***',
        taxpayerInfo: publicInfo.taxpayerInfo,
        mtlsEndpoints: publicInfo.mtlsEndpoints,
      };
    },
    [Symbol.for('nodejs.util.inspect.custom')]() {
      return this.toJSON();
    },
  };
  Object.freeze(credentials);
  return credentials;
}

/**
 * Wrappe les hooks pour s'assurer que la reponse contenant les secrets
 * est redactee avant d'etre passee a l'utilisateur.
 */
function wrapCredentialHooks(hooks) {
  if (!hooks) return undefined;
  const wrapped = { ...hooks };
  if (hooks.onResponse) {
    const original = hooks.onResponse;
    wrapped.onResponse = (info) => {
      const masked = { ...info };
      if (masked.body && typeof masked.body === 'object') {
        masked.body = {
          ...masked.body,
          signingPrivateKey: '***',
          encryptionMasterKey: '***',
          mtlsClientCertificate: '***',
          mtlsClientPrivateKey: '***',
        };
      }
      original(masked);
    };
  }
  return wrapped;
}
