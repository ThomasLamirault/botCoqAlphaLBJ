import 'dotenv/config';
import { ALL_COMMANDS } from './commands.js';
import { InstallGlobalCommands } from './utils.js';

// Script `npm run register` : enregistre TOUTES les commandes globales
// (bulk overwrite, sans avoir à démarrer le bot).
// Liste unique : ALL_COMMANDS (commands.js).
InstallGlobalCommands(process.env.APP_ID, ALL_COMMANDS);
console.log(`✅ ${ALL_COMMANDS.length} commande(s) inscrite(s) globalement (APP_ID : ${process.env.APP_ID ?? 'MANQUANT'})`);
