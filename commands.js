import { PermissionFlagsBits } from 'discord.js';

// ─── Source unique de vérité des commandes du bot ─────────────────────────────
// Déclarée une fois, réutilisée par :
//   • app.js     (clientReady)          → inscription à chaque démarrage
//   • register.js (npm run register)    → inscription sans démarrer le bot
//
// Attention : l'inscription est un bulk overwrite (PUT
// applications/{id}/commands) — la liste ALL_COMMANDS est donc exhaustive.

const MANAGE_CHANNELS_PERM = PermissionFlagsBits.ManageChannels.toString();

const CREATE_CHANNEL_COMMAND = {
  name: 'create_channel',
  description: 'Créer les channels du club (dimanche & lundi) dans les bonnes catégories',
  type: 1,
  default_member_permissions: MANAGE_CHANNELS_PERM,
  integration_types: [0],
  contexts: [0],
};

const TEST_COMMAND = {
  name: 'test',
  description: 'Basic command',
  type: 1,
  integration_types: [0, 1],
  contexts: [0, 1, 2],
};

const ARCHIVE_COMMAND = {
  name: 'archive',
  description: 'Archiver les salons révolus dans la catégorie « archive » + canal de bilan mensuel',
  type: 1,
  default_member_permissions: MANAGE_CHANNELS_PERM,
  integration_types: [0],
  contexts: [0],
};

export const ALL_COMMANDS = [CREATE_CHANNEL_COMMAND, TEST_COMMAND, ARCHIVE_COMMAND];
