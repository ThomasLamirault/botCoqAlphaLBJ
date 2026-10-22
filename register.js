import 'dotenv/config';
import { ALL_COMMANDS } from './commands.js';
import { InstallGlobalCommands } from './utils.js';

// Script `npm run register` : enregistre TOUTES les commandes globales
// (bulk overwrite, sans avoir à démarrer le bot).
// Liste unique : ALL_COMMANDS (commands.js).
let inscrit = false;
try {
  await InstallGlobalCommands(process.env.APP_ID, ALL_COMMANDS);
  inscrit = true;
} catch (err) {
  console.error(`❌ Inscription des commandes impossible : ${err.message}`);
  process.exit(1);
}
console.log(`✅ ${ALL_COMMANDS.length} commande(s) inscrite(s) globalement (APP_ID : ${process.env.APP_ID ?? 'MANQUANT'})`);
