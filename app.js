import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import {
  getOpenDatesForCurrentAndNextMonth,
  formatDateChannelName,
  getCategoryNameForDate,
  InstallGlobalCommands,
  parseChannelDate,
  getBilanNameForDate,
  getMonthNameFr,
} from './utils.js';
import { ALL_COMMANDS } from './commands.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// Étape 1 : Démarrage et Installation des commandes
client.once('clientReady', async () => {
  console.log(`✅ ${client.user.tag} est en ligne (Mode Direct - Plus besoin de Cloudflare)`);

  // On dépose TOUTES les commandes globales immédiatement (source unique :
  // commands.js) pour qu'elles apparaissent rapidement.
  await InstallGlobalCommands(client.user.id, ALL_COMMANDS);
  console.log(`✅ ${ALL_COMMANDS.length} commande(s) installée(s) globalement`);
});

// Récupère le dernier (plus récent) message d'un canal de texte.
// `channel.messages.fetch({ limit: 1, cache: false })` retourne une
// Collection d'au plus un élément ; l'API Discord renvoie les messages du
// plus récent au plus ancien, donc ce unique élément est le dernier message.
async function getLastMessage(channel) {
  try {
    const messages = await channel.messages.fetch({ limit: 1, cache: false });
    if (!messages.size) return null;
    return messages.first();
  } catch (err) {
    console.warn(
      `Impossible de lire le dernier message de « ${channel.name} » :`,
      err.message ?? err,
    );
    return null;
  }
}

// Étape 2 : Gestion des commandes (/create, /test, /archive)
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    // --- Commande TEST (pour vérifier le fonctionnement) ---
    if (interaction.commandName === 'test') {
      return await interaction.reply(`🚀 Le bot répond ! Tout est connecté correctement.`);
    }

    // --- Commande CREATE_CHANNEL (Création des salons) ---
    if (interaction.commandName === 'create_channel') {
      const guild = interaction.guild;
      
      // 1. Récupérer les dates (dimanche/lundi) du mois courant et suivant
      const datesToCreate = getOpenDatesForCurrentAndNextMonth();

      // On dit au bot "Je travaille dessus..." pour éviter le timeout Discord (3s) - Public par défaut
      await interaction.deferReply(); 

      let createdCount = 0;
      let movedCount = 0;

      for (const date of datesToCreate) {
        const categoryName = getCategoryNameForDate(date);
        const dateName = formatDateChannelName(date); // ex: "aout-6", "janvier-4"

        // Catégorie du jour : « Les DIMANCHE LBJ <année> » ou « Les LUNDI LBJ <année> »
        // (l'année suit le salon : 2026 ou 2027 selon le mois)
        // NB : dans discord.js 14.27.0 (discord-api-types/v10), les constantes
        // ChannelType sont en PascalCase → ChannelType.GuildCategory (4) pour
        // une vraie catégorie. (ChannelType.GUILD_CATEGORY = undefined.)
        let category = guild.channels.cache.find(
          ch => ch.type === ChannelType.GuildCategory && ch.name === categoryName
        );

        // [migration] Les exécutions antérieures (bug ChannelType.GUILD_CATEGORY
        // = undefined → type par défaut = texte) ont créé des CANAUX TEXTE
        // nommés « Les DIMANCHE/LUNDI LBJ <année> » au lieu de vraies catégories.
        // On les renomme pour libérer le nom et éviter toute confusion.
        if (!category) {
          const fake = guild.channels.cache.find(
            ch => ch.type === ChannelType.GuildText && ch.name === categoryName
          );
          if (fake) {
            let newName = `[ancien] ${categoryName}`;
            let suffix = 2;
            while (guild.channels.cache.find(c => c.name === newName)) {
              newName = `[ancien] ${categoryName} ${suffix}`;
              suffix++;
            }
            try {
              await guild.channels.edit(fake, {
                name: newName,
                reason: `Migration bot : ancien canal texte créé par le bug, renommé en « ${newName} »`,
              });
              console.log(`[migration] Renommé « ${categoryName} » (canal texte, bug) → « ${newName} » [id=${fake.id}]`);
            } catch (err) {
              console.warn(`[migration] Impossible de renommer « ${categoryName} » :`, err.message ?? err);
            }
          }
        }

        // Crée la vraie catégorie si elle n'existe pas encore.
        if (!category) {
          try {
            category = await guild.channels.create({
              name: categoryName,
              type: ChannelType.GuildCategory,
            });
          } catch (err) {
            console.error(`Impossible de créer la catégorie « ${categoryName} » :`, err);
            continue;
          }
          console.log(`Créée catégorie « ${categoryName} » [id=${category.id}]`);
        }

        // Salon du jour, dans la catégorie
        const channelExists = guild.channels.cache.find(ch => ch.name === dateName);

        if (!channelExists) {
          try {
            const newChan = await guild.channels.create({
              name: dateName,
              type: ChannelType.GuildText,
              parentId: category.id,
              permissionOverwrites: [
                {
                  id: guild.roles.everyone.id, // Tout le monde
                  allow: ['ViewChannel', 'SendMessages'],
                },
              ],
            });
            createdCount++;
            console.log(`Créé « ${dateName} » [id=${newChan.id}] sous « ${categoryName} » [id=${category.id}]`);
          } catch (err) {
            console.error(`Impossible de créer ${dateName}:`, err);
          }
        } else if (channelExists.parentId !== category.id) {
          // Salon déjà existant mais hors de sa catégorie : le réorganiser.
          // discord.js v14 a supprimé channel.move() → on utilise
          // guild.channels.edit() (qui passe par PATCH /channels/{id} avec parent_id).
          // Garde-fou : ne déplace que si la cible est bien une vraie catégorie.
          if (category?.type !== ChannelType.GuildCategory) {
            console.error(`[déplacement] « ${dateName} » : cible non valide, type=${category?.type ?? 'undefined'}, id=${category?.id ?? 'null'}`);
            continue;
          }
          try {
            await guild.channels.edit(channelExists, {
              parent: category,
              reason: `Réorganisation de « ${dateName} » dans « ${categoryName} »`,
            });
            movedCount++;
            console.log(`Déplacé « ${dateName} » [id=${channelExists.id}] → « ${categoryName} » [id=${category.id}]`);
          } catch (err) {
            console.error(
              `Impossible de déplacer « ${dateName} » dans « ${categoryName} » :`,
              {
                categoryId: category?.id,
                categoryType: category?.type,
                channelId: channelExists?.id,
                channelType: channelExists?.type,
                channelParentId: channelExists?.parentId,
              },
              err,
            );
          }
        }
      }

      // Réponse une fois fini
      const parts = [];
      if (createdCount > 0) parts.push(`**${createdCount}** nouveau(s) salon(s) créé(s)`);
      if (movedCount > 0) parts.push(`**${movedCount}** salon(s) déplacé(s) dans la bonne catégorie`);
      const message = parts.length
        ? `✅ ${parts.join(' et')} !`
        : 'ℹ️ Tous les salons existent déjà, et sont dans les bonnes catégories.';
        
      return await interaction.editReply({ content: message });
    }

    // --- Commande ARCHIVE (archivage des salons révolus) ---
    if (interaction.commandName === 'archive') {
      const guild = interaction.guild;
      await interaction.deferReply();
      const now = new Date();

      const ARCHIVE_NAME = 'archive';
      let archiveCategory = guild.channels.cache.find(
        (ch) => ch.type === ChannelType.GuildCategory && ch.name === ARCHIVE_NAME,
      );
      if (!archiveCategory) {
        try {
          // On la positionne en bas de l'arborescence.
          const lastPos = Math.max(
            0,
            ...(guild.channels.cache.map((c) => c.position)),
          );
          archiveCategory = await guild.channels.create({
            name: ARCHIVE_NAME,
            type: ChannelType.GuildCategory,
            position: lastPos + 1,
          });
          console.log(`Créée catégorie « ${ARCHIVE_NAME} » [id=${archiveCategory.id}]`);
        } catch (err) {
          console.error(`Impossible de créer la catégorie « ${ARCHIVE_NAME} » :`, err);
          return await interaction.editReply({
            content: `❌ Impossible de créer la catégorie « ${ARCHIVE_NAME} » : ${err.message ?? err}`,
          });
        }
      }

      // Garde-fou : la cible doit être une vraie catégorie.
      if (archiveCategory.type !== ChannelType.GuildCategory) {
        return await interaction.editReply({
          content: `❌ « ${ARCHIVE_NAME} » n'est pas une catégorie valide (type=${archiveCategory.type}).`,
        });
      }
      const archiveId = archiveCategory.id;

      // Dates ouvertes = mois courant + suivant (getOpenDatesForCurrentAndNextMonth).
      // Tout salon dont (mois, jour) n'y figure pas est « révolu »
      // (mois précédent révolu et plus anciens) → à archiver.
      const activeDates = getOpenDatesForCurrentAndNextMonth(now);
      const isActiveSlot = (m, d) =>
        activeDates.some((a) => a.getMonth() === m && a.getDate() === d);

      // Canaux texte hors « archive », dont le (mois, jour) est non ouvert.
      const toArchive = [];
      for (const ch of guild.channels.cache.values()) {
        if (ch.type !== ChannelType.GuildText) continue;
        if (ch.parentId === archiveId) continue; // déjà archivé
        const date = parseChannelDate(ch.name, now);
        if (!date) continue; // pas un salon du bot (nom non « mois-jour »)
        if (isActiveSlot(date.getMonth(), date.getDate())) continue; // ouvert
        toArchive.push({ channel: ch, date });
      }

      if (toArchive.length === 0) {
        return await interaction.editReply({
          content: '✅ Rien à archiver : tous les salons ouverts sont déjà en place.',
        });
      }

      // Déplacer chaque salon dans « archive » + lire son dernier message.
      let archivedCount = 0;
      const groupsByBilan = new Map(); // nomBilan -> { date, entries: [] }
      for (const { channel, date } of toArchive) {
        const lastMessage = await getLastMessage(channel);
        const bilanName = getBilanNameForDate(date);
        try {
          await guild.channels.edit(channel, {
            parent: archiveCategory,
            reason: `Archivage de « ${channel.name} » (${date.getMonth() + 1}/${date.getDate()} ${date.getFullYear()}) dans « ${ARCHIVE_NAME} »`,
          });
          archivedCount++;
          console.log(
            `Archivé « ${channel.name} » [id=${channel.id}] → « ${ARCHIVE_NAME} » [id=${archiveId}]`,
          );
        } catch (err) {
          console.error(`Impossible d'archiver « ${channel.name} » :`, err);
          continue; // canal non déplacé : on ne le met pas dans le bilan
        }
        if (groupsByBilan.has(bilanName)) {
          groupsByBilan.get(bilanName).entries.push({ channel, date, lastMessage });
        } else {
          groupsByBilan.set(bilanName, { date, entries: [{ channel, date, lastMessage }] });
        }
      }

      // Un canal de synthèse par (mois, année) : bilan-<mois>-<année>.
      const SNIP = 500;
      const cleanMsg = (s) => {
        const t = (s || '(message vide)').replace(/https?:\/\/?\S+/g, '[lien]');
        return t.replace(/\r?\n/g, ' ').trim().slice(0, SNIP);
      };
      let bilansPublies = 0;
      for (const [bilanName, group] of groupsByBilan.entries()) {
        const existing = guild.channels.cache.find(
          (ch) =>
            ch.type === ChannelType.GuildText &&
            ch.name === bilanName &&
            ch.parentId === archiveId,
        );
        let bilanChannel = existing;
        if (!bilanChannel) {
          try {
            bilanChannel = await guild.channels.create({
              name: bilanName,
              type: ChannelType.GuildText,
              parentId: archiveId,
            });
            console.log(`Créé canal de bilan « ${bilanName} » [id=${bilanChannel.id}]`);
          } catch (err) {
            console.error(`Impossible de créer le canal de bilan « ${bilanName} » :`, err);
            continue;
          }
        }
        const lines = group.entries.map(
          (e) => `• ${e.channel.name} → ${cleanMsg(e.lastMessage?.content)}`,
        );
        const body = [
          `📊 **Bilan des salons archivés — ${getMonthNameFr(group.date)} ${group.date.getFullYear()}**`,
          `(_${group.entries.length} salon(s) archivé(s) _)`,
          '',
          ...lines,
        ].join('\n');
        try {
          await bilanChannel.send(body);
          bilansPublies++;
          console.log(`Bilan publié dans « ${bilanName} » [id=${bilanChannel.id}]`);
        } catch (err) {
          console.error(`Impossible de publier le bilan « ${bilanName} » :`, err);
        }
      }

      const summary = [
        `✅ Archivage terminé :`,
        `• **${archivedCount}** salon(s) déplacé(s) dans « ${ARCHIVE_NAME} »`,
        `• **${bilansPublies}** canal(s) de bilan ${bilansPublies === 1 ? 'publié' : 'publiés'}`,
      ].join('\n');
      return await interaction.editReply({ content: summary });
    }

  } catch (error) {
    console.error(error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Une erreur interne est survenue.', flags: 64 });
    }
  }
});

client.login(process.env.DISCORD_TOKEN); // Connexion au serveur Discord
