/**
 * Mode TCC : Module de Controle (certification locale + sync differee).
 *
 * Facade fine au-dessus de terminal.js. Memes endpoints qu'en TFC,
 * sémantique distincte pour le code appelant : un appel tccSubmit indique
 * explicitement une integration TCC, ce qui facilite l'audit et les logs.
 */

import { terminalSubmit, terminalList } from './terminal.js';

export function tccSubmit(config, input, options) {
  return terminalSubmit(config, input, options);
}

export function tccList(config, params, options) {
  return terminalList(config, params, options);
}
