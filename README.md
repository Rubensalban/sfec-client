# sfec-client

Client JavaScript pour l'API SFEC (Système de Facturation Électronique Certifiée, République du Congo).

Supporte les trois modes d'intégration documentés :

- **ERP en ligne** — authentification par clé API (`X-API-Key`)
- **TCC** (Module de Contrôle) — authentification mTLS
- **TFC** (Terminal Fiscal Certifié) — authentification mTLS renforcée

Documentation officielle de l'API : <https://docs.sfec.gouv.cg/>

## Caractéristiques

- **Zero-dependency** — repose uniquement sur Node.js natif (`fetch`, `crypto`, `undici`).
- **Sécurité par construction** — clé API et certificats wrappés, `JSON.stringify(client)` ne fuite jamais de secret.
- **Validation côté client** — payload vérifié avant tout appel réseau, erreurs typées avec chemins précis (`items[0].unit_price`).
- **Recalcul systématique des totaux** — impossible d'envoyer des montants incohérents.
- **`electronic_stamp_duty: 0`** garanti par construction (règle réglementaire).
- **Idempotence** — `invoice_id` UUID v4 généré automatiquement si absent.
- **Retry exponentiel** sur 5xx et erreurs réseau uniquement, jamais sur 4xx.
- **Pattern Façade + fonctions pures** — testable, prévisible.

## Installation

```bash
npm install sfec-client
```

Requiert **Node.js ≥ 18.0.0**.

## Configuration

### Variables d'environnement (mode ERP)

Créer un fichier `.env` à la racine du projet :

```
SFEC_CLIENT_BASE_URL=https://api.sfec.gouv.cg
SFEC_CLIENT_API_KEY=sk_votre_cle_api
SFEC_CLIENT_ENV=production
```

| Variable | Requis | Description |
|----------|--------|-------------|
| `SFEC_CLIENT_BASE_URL` | Oui | URL de base de l'API (HTTPS obligatoire, sauf `localhost`) |
| `SFEC_CLIENT_API_KEY` | Mode ERP | Clé API obtenue via le portail e-Facture |
| `SFEC_CLIENT_ENV` | Non | Label informatif (`sandbox`, `production`, ...) |

> **Important :** `SFEC_CLIENT_BASE_URL` n'est jamais codée en dur dans le package. C'est à vous de fournir l'URL exacte de votre environnement (sandbox ou production), conforme à la documentation officielle.

## Démarrage rapide — Mode ERP

```js
import { SfecClient } from 'sfec-client';

const sfec = SfecClient.fromEnv();

const result = await sfec.erp.submit({
  taxpayer_niu: 'M987654321',
  recipient: {
    type: 'business',
    name: 'ACME SARL',
    niu: 'P123456789',
    address: 'Brazzaville',
    email: 'contact@acme.cg',
  },
  items: [
    {
      designation: 'Prestation de conseil',
      type: 'service',
      unit_price: 50000,
      quantity: 2,
      tax_rate: '18',
    },
  ],
  payment: {
    method: 'mobile_money',
    currency: 'XAF',
    reference: 'MM-2026-0001',
  },
});

console.log(result.invoiceNumber);         // "F-2026-0042"
console.log(result.certificationNumber);   // "CERT-XYZ..."
console.log(result.qrCode);                // "data:image/png;base64,..."
```

## Démarrage rapide — Mode TCC / TFC (mTLS)

Deux étapes : bootstrap des certificats, puis utilisation.

### 1. Bootstrap (à exécuter une fois)

```js
import { bootstrapConfig, claimCertificates } from 'sfec-client';

const cfg = bootstrapConfig({ baseUrl: 'https://api.sfec.gouv.cg' });

const credentials = await claimCertificates(cfg, {
  token: 'token_obtenu_via_portail',
  niu: 'M987654321',
  terminalIdentifier: 'CAISSE-01', // optionnel
});

// IMPORTANT : reveal() expose le matériel cryptographique en clair.
// À persister IMMÉDIATEMENT dans un secret store sécurisé (Vault, AWS SM, etc.).
const secrets = credentials.reveal();
// secrets.signingPrivateKey
// secrets.encryptionMasterKey
// secrets.mtlsClientCertificate
// secrets.mtlsClientPrivateKey
```

### 2. Usage (après bootstrap)

```js
import { SfecClient } from 'sfec-client';

const sfec = SfecClient.create({
  baseUrl: 'https://api.sfec.gouv.cg',
  mtls: {
    cert: process.env.MTLS_CLIENT_CERTIFICATE, // lu depuis secret store
    key: process.env.MTLS_CLIENT_PRIVATE_KEY,
  },
});

// Mode TCC
await sfec.tcc.submit(invoiceInput);
const factures = await sfec.tcc.list({ page: 1, pageSize: 20 });

// Mode TFC (mêmes endpoints, sémantique différente)
await sfec.tfc.submit(invoiceInput);
```

## API Reference

### `SfecClient.fromEnv()`

Construit un client en lisant `process.env`. Mode ERP uniquement.

### `SfecClient.create(options)`

| Option | Type | Description |
|--------|------|-------------|
| `baseUrl` | `string` | URL de l'API (override de `SFEC_CLIENT_BASE_URL`) |
| `apiKey` | `string` | Clé API (override de `SFEC_CLIENT_API_KEY`) |
| `mtls` | `{ cert, key, ca? }` | Certificats PEM (Buffer ou string), pour TCC/TFC |
| `env` | `string` | Label informatif |
| `timeoutMs` | `number` | Timeout par requête (défaut : `30000`) |
| `retry` | `{ max, baseDelayMs }` | Retry exponentiel (défaut : `{ max: 3, baseDelayMs: 500 }`) |
| `hooks` | `{ onRequest, onResponse, onError }` | Callbacks de télémétrie |

### `sfec.erp.submit(input, options?)`

Soumet une facture au mode ERP en ligne.

**Retour :**

```js
{
  invoiceId: string,
  invoiceNumber: string,
  certificationNumber: string,
  shortIdentifier: string | null,
  qrCode: string | null,        // data URL base64 PNG
  certificationDate: string,    // ISO 8601
  raw: object,                  // réponse brute serveur
}
```

### `sfec.erp.list(params?, options?)`

Liste les factures certifiées de votre ERP.

| Paramètre | Type | Description |
|-----------|------|-------------|
| `page` | `number` | Page (défaut : 1) |
| `pageSize` | `number` | Entre 1 et 20 (défaut : 10) |
| `invoiceType` | `'salesInvoice' \| 'creditNote'` | Filtre par type |
| `dateStart` | `string` (ISO 8601) | Borne de début |
| `dateEnd` | `string` (ISO 8601) | Borne de fin |

### `sfec.tcc.submit / sfec.tcc.list / sfec.tfc.submit / sfec.tfc.list`

Mêmes signatures que `erp.*`, mais avec authentification mTLS.

### Schéma d'input facture

```js
{
  taxpayer_niu: string,                         // max 20 caractères
  invoice_type?: 'salesInvoice' | 'creditNote', // défaut : 'salesInvoice'
  invoice_id?: string,                          // UUID v4 généré si absent
  invoice_subject?: string,
  invoice_due_date?: string,                    // ISO 8601
  reference_invoice_id?: string,                // REQUIS si creditNote

  recipient: {
    type: 'business' | 'individual' | 'government' | 'foreign',
    name: string,
    niu?: string,                               // REQUIS si type=business (ou rccm)
    rccm?: string,
    address?: string,
    phone?: string,
    email?: string,
    isTaxable?: boolean,                        // défaut : true
  },

  items: [
    {
      designation: string,
      type: 'product' | 'service',
      unit_price: number,                       // >= 0
      quantity: number,                         // > 0
      tax_rate: string | number,                // taux TVA en %, ex: "18" ou 18
      classification_code?: string,
      discount_amount?: number,
      discount_type?: 'fixed' | 'percentage',   // REQUIS si discount_amount
    }
  ],

  payment: {
    method: 'bank_transfer' | 'card' | 'cash' | 'mobile_money' | 'cheque',
    currency: 'XAF' | 'USD',
    reference?: string,
    date?: string,                              // ISO 8601
  }
}
```

> Les totaux (`subtotal`, `total_amount`, etc.) sont **toujours recalculés** par le builder. Toute valeur fournie est silencieusement écrasée.

## Gestion d'erreurs

Toutes les erreurs héritent de `SfecError` et exposent `.code`, `.message`, `.toJSON()`.

```js
import {
  SfecValidationError,
  SfecHttpError,
  SfecNetworkError,
  SfecConfigError,
} from 'sfec-client';

try {
  await sfec.erp.submit(invoice);
} catch (err) {
  if (err instanceof SfecValidationError) {
    // Validation client : payload mal formé
    console.log(err.fields);
    // [{ path: 'items[0].quantity', message: '...', code: 'OUT_OF_RANGE' }, ...]
  } else if (err instanceof SfecHttpError) {
    if (err.isConflict())       /* 409 : facture déjà certifiée */;
    if (err.isUnauthorized())   /* 401 : clé API invalide */;
    if (err.isUnprocessable())  /* 422 : validation métier serveur */;
    if (err.isServerError())    /* 5xx : déjà retry, échec persistant */;
  } else if (err instanceof SfecNetworkError) {
    /* timeout ou réseau */
  } else if (err instanceof SfecConfigError) {
    /* mauvaise configuration */
  }
}
```

### Codes d'erreur stables

| Code | Origine |
|------|---------|
| `SFEC_VALIDATION_ERROR` | Validation client |
| `SFEC_CONFIG_*` | Configuration invalide |
| `SFEC_HTTP_<status>` | Réponse non-2xx (`SFEC_HTTP_401`, `SFEC_HTTP_409`, ...) |
| `SFEC_NETWORK_ERROR` | Erreur réseau |
| `SFEC_NETWORK_TIMEOUT` | Timeout |

## Sécurité

Le package est conçu pour minimiser le risque de fuite de secrets et empêcher les pratiques dangereuses.

### Garanties

1. **`X-API-Key` jamais loggable**
   - Wrappée dans un objet `Secret` dont `toString` / `toJSON` / `console.log` retournent `***`.
   - Lue uniquement au dernier moment via `.reveal()` pour construire les headers, jamais stockée en variable intermédiaire.

2. **Certificats mTLS jamais loggables**
   - Acceptés uniquement en mémoire (Buffer ou string PEM) — **pas de chemins de fichier**, empêche le path traversal et la lecture FS implicite.
   - `JSON.stringify(client.config.mtls)` retourne `{ cert: "***", key: "***" }`.

3. **Bodies redactés automatiquement**
   - `SfecHttpError.body` passe par `redactSensitive()` au constructeur.
   - Les hooks `onRequest` / `onResponse` / `onError` reçoivent uniquement des copies redactées.

4. **HTTPS obligatoire**
   - `baseUrl` doit être en `https://`. Exception : `localhost` / `127.0.0.1` / `::1` pour les tests locaux.
   - mTLS : `rejectUnauthorized: true` figé, impossible à désactiver.

5. **URL safe**
   - Construite via `new URL()` — refus si le chemin tente une injection de schéma.

6. **Client immuable**
   - `Object.freeze` sur le client et ses namespaces. Impossible à monkey-patcher après création.

### Recommandations utilisateur

- **Ne jamais commit** `.env` ou les fichiers de certificats. Le `.gitignore` du package bloque `.env`, `*.pem`, `*.key`, `*.crt`, `certs/`.
- **Persister `Credentials.reveal()`** immédiatement dans un secret store (Vault, AWS Secrets Manager, GCP Secret Manager) après bootstrap.
- **Ne pas activer** de hooks qui sérialisent `info.body` brut vers un service tiers sans vérifier qu'ils utilisent bien la version redactée fournie.

## Hooks d'observabilité

```js
const sfec = SfecClient.create({
  baseUrl: '...',
  apiKey: '...',
  hooks: {
    onRequest: (info) => {
      // info.headers['X-API-Key'] vaut '***'
      // info.body est déjà redacté
      console.log(`-> ${info.method} ${info.url} (tentative ${info.attempt})`);
    },
    onResponse: (info) => {
      console.log(`<- ${info.status}`);
    },
    onError: (info) => {
      // info.error.details.body est redacté
      myLogger.error(info.error);
    },
  },
});
```

Les hooks peuvent être configurés globalement (au niveau du client) **et** par appel :

```js
await sfec.erp.submit(invoice, {
  hooks: { onError: (info) => alertMonitoring(info) },
});
```

Les deux niveaux sont appelés (le global d'abord, puis le local).

## Recettes

### Idempotence

Pour éviter une double certification (par exemple si le réseau coupe juste après la requête mais avant la réponse), fournir un `invoice_id` stable :

```js
await sfec.erp.submit({
  invoice_id: `INV-${orderId}`, // toujours le même pour la même commande
  // ...
});
// Un second appel avec le même invoice_id retournera 409 (SfecHttpError.isConflict())
```

### Avoir (credit note)

```js
await sfec.erp.submit({
  invoice_type: 'creditNote',
  reference_invoice_id: 'INV-original-id', // REQUIS
  // ... reste du payload
});
```

### Utiliser le builder seul (sans appel réseau)

```js
import { buildInvoicePayload } from 'sfec-client';

const payload = buildInvoicePayload(input);
// Payload prêt à être envoyé ou stocké, totaux recalculés, UUID généré.
```

## Tests

```bash
npm test            # 145 tests, node:test natif
npm run test:watch  # mode watch
```

## Licence

MIT
