/**
 * Transport HTTP du package sfec-client.
 * Seul module avec un side-effect (fetch). Tout le reste est pur.
 *
 * Securite :
 *  - apiKey lue via .reveal() UNIQUEMENT au moment de construire les headers,
 *    jamais stockee dans une variable intermediaire.
 *  - mTLS : utilise undici.Agent natif (Node 18+), rejectUnauthorized fige a true.
 *  - URL construite via new URL(path, baseUrl) : bloque les redirections vers
 *    un autre host par un path malicieux.
 *  - Hooks onRequest/onResponse/onError recoivent des objets DEJA redactes
 *    (jamais le secret en clair, jamais le body brut non nettoye).
 *  - Erreurs SfecHttpError/SfecNetworkError redactent automatiquement leur body.
 *
 * Retry :
 *  - Uniquement sur 5xx + erreurs reseau/timeout
 *  - Jamais sur 4xx (erreur client, retry ne sert a rien)
 *  - Backoff exponentiel : baseDelayMs * 2^attempt
 */

import { SfecHttpError, SfecNetworkError, SfecConfigError, redactSensitive } from './errors.js';

const USER_AGENT = 'sfec-client/0.1.0';

/**
 * Sleep promise pour le backoff.
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Charge undici.Agent uniquement si mTLS est demande.
 *
 * @param {{ cert: string|Buffer, key: string|Buffer, ca?: string|Buffer }} mtls
 * @returns {Promise<object>} dispatcher pour fetch
 */
async function createMtlsDispatcher(mtls) {
  let undici;
  try {
    undici = await import('node:undici').catch(() => import('undici'));
  } catch {
    throw new SfecConfigError(
      'mTLS necessite Node.js 18+ avec undici disponible. Module introuvable.',
      { code: 'SFEC_TRANSPORT_NO_UNDICI' },
    );
  }
  return new undici.Agent({
    connect: {
      cert: mtls.cert,
      key: mtls.key,
      ca: mtls.ca,
      rejectUnauthorized: true, // fige : pas d'option pour desactiver
    },
  });
}

/**
 * Construit les headers d'une requete, en injectant la cle API au dernier moment.
 * La cle n'est jamais stockee : seul le retour de cette fonction la contient,
 * et il est consomme immediatement par fetch.
 *
 * @param {{ apiKey?: { reveal(): string } }} config
 * @param {Record<string, string>} [extra]
 */
function buildHeaders(config, extra = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': USER_AGENT,
    ...extra,
  };
  if (config.apiKey) {
    headers['X-API-Key'] = config.apiKey.reveal();
  }
  return headers;
}

/**
 * Parse le corps de reponse en fonction du content-type.
 * @param {Response} response
 * @returns {Promise<unknown>}
 */
async function parseBody(response) {
  const ct = response.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  try {
    const text = await response.text();
    return text.length === 0 ? null : text;
  } catch {
    return null;
  }
}

/**
 * Indique si une erreur reseau/timeout est retryable.
 * Les erreurs HTTP 5xx sont gerees separement (status >= 500).
 */
function isRetryableNetworkError(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return true;
  if (err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') return true;
  if (err.cause && (err.cause.code === 'UND_ERR_SOCKET' || err.cause.code === 'ECONNRESET')) return true;
  return false;
}

/**
 * Effectue une requete HTTP via la config fournie.
 *
 * @param {object} params
 * @param {object} params.config           - issu de loadConfig()
 * @param {'GET'|'POST'|'PUT'|'DELETE'} params.method
 * @param {string} params.path             - chemin relatif (commence par /)
 * @param {object} [params.body]           - serialise en JSON si fourni
 * @param {Record<string, string|number>} [params.query] - query params
 * @param {{
 *   onRequest?: (info: object) => void,
 *   onResponse?: (info: object) => void,
 *   onError?: (info: object) => void,
 * }} [params.hooks]
 * @returns {Promise<{ status: number, body: unknown, headers: Record<string,string> }>}
 */
export async function request({ config, method, path, body, query, hooks }) {
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new SfecConfigError(
      `transport.request : path doit commencer par "/", recu "${path}".`,
      { code: 'SFEC_TRANSPORT_INVALID_PATH' },
    );
  }

  // Construction URL safe : new URL refuse les schemes injectes par path
  const url = new URL(config.baseUrl + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const finalUrl = url.toString();

  // mTLS dispatcher si applicable
  let dispatcher;
  if (config.mtls) {
    dispatcher = await createMtlsDispatcher(config.mtls);
  }

  const retryMax = config.retry.max;
  const baseDelay = config.retry.baseDelayMs;
  let lastError;

  for (let attempt = 0; attempt <= retryMax; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

    const headers = buildHeaders(config);
    const init = {
      method,
      headers,
      signal: controller.signal,
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    if (dispatcher) {
      init.dispatcher = dispatcher;
    }

    // Hook onRequest : on passe une vue redactee
    if (hooks?.onRequest) {
      hooks.onRequest({
        method,
        url: finalUrl,
        attempt,
        headers: redactSensitive(headers),
        body: body !== undefined ? redactSensitive(body) : undefined,
      });
    }

    let response;
    try {
      response = await fetch(finalUrl, init);
    } catch (err) {
      clearTimeout(timeoutId);
      const isTimeout = err && err.name === 'AbortError';
      const networkErr = new SfecNetworkError(
        isTimeout ? `Timeout apres ${config.timeoutMs}ms` : `Erreur reseau : ${err.message ?? err}`,
        { cause: err, url: finalUrl, method, timeout: isTimeout },
      );

      if (hooks?.onError) {
        hooks.onError({ error: networkErr.toJSON(), attempt });
      }

      // Retry si on a encore des tentatives ET que l'erreur est retryable
      if (attempt < retryMax && (isTimeout || isRetryableNetworkError(err))) {
        lastError = networkErr;
        await sleep(baseDelay * Math.pow(2, attempt));
        continue;
      }
      throw networkErr;
    }
    clearTimeout(timeoutId);

    const parsedBody = await parseBody(response);
    const responseHeaders = {};
    for (const [k, v] of response.headers.entries()) {
      responseHeaders[k] = v;
    }

    if (hooks?.onResponse) {
      hooks.onResponse({
        status: response.status,
        url: finalUrl,
        attempt,
        body: redactSensitive(parsedBody),
      });
    }

    if (response.ok) {
      return { status: response.status, body: parsedBody, headers: responseHeaders };
    }

    const httpErr = new SfecHttpError(
      `Erreur HTTP ${response.status} sur ${method} ${path}`,
      {
        status: response.status,
        body: parsedBody,
        url: finalUrl,
        method,
        requestId: responseHeaders['x-request-id'],
      },
    );

    if (hooks?.onError) {
      hooks.onError({ error: httpErr.toJSON(), attempt });
    }

    // Retry uniquement sur 5xx
    if (response.status >= 500 && attempt < retryMax) {
      lastError = httpErr;
      await sleep(baseDelay * Math.pow(2, attempt));
      continue;
    }
    throw httpErr;
  }

  // Inatteignable en theorie (la boucle throw ou return), mais filet de securite
  throw lastError ?? new SfecNetworkError('Echec apres retries', { url: finalUrl, method });
}
