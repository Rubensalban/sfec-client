/**
 * Mode TFC : Terminal Fiscal Certifie (materiel certifie + mTLS renforce).
 *
 * Memes endpoints que TCC. Le distingo metier (HSM, traçabilite) est
 * gere cote infrastructure utilisateur.
 */

import { terminalSubmit, terminalList } from './terminal.js';

export function tfcSubmit(config, input, options) {
  return terminalSubmit(config, input, options);
}

export function tfcList(config, params, options) {
  return terminalList(config, params, options);
}
