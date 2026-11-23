import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } from 'discord.js';
import {
  getOpenDatesForCurrentAndNextMonth,
  formatDateChannelName,
  getCategoryNameForDate,
  InstallGlobalCommands,
  parseChannelDate,
  getBilanNameForDate,
  buildBilanMessages,
  buildSessionChannelCreateOptions,
  buildBilanChannelCreateOptions,
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
// Distingue un canal légitimement vide ({ ok: true, message: null }) d'une
// erreur de lecture API ({ ok: false, message: null }) afin de ne jamais
// supprimer un salon dont le dernier message n'a pas pu être lu.
async function getLastMessage(channel) {
  try {
    const messages = await channel.messages.fetch({ limit: 1, cache: false });
    if (!messages.size) return { ok: true, message: null };
    return { ok: true, message: messages.first() };
  } catch (err) {
    console.warn(
      `Impossible de lire le dernier message de « ${channel.name} » :`,
      err.message ?? err,
    );
    return { ok: false, message: null };
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
      if (!guild) {
        return await interaction.reply({
          content: '❌ Cette commande doit être utilisée dans un serveur.',
          flags: 64,
        });
      }
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
        return await interaction.reply({
          content: '❌ Permission requise : gérer les salons (Administrateur ou Modérateur).',
          flags: 64,
        });
      }
      
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
            const newChan = await guild.channels.create(
              buildSessionChannelCreateOptions({
                name: dateName,
                parentId: category.id,
                everyoneRoleId: guild.roles.everyone.id,
              }),
            );
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
        ? `✅ ${parts.join(' et ')} !`
        : 'ℹ️ Tous les salons existent déjà, et sont dans les bonnes catégories.';
        
      return await interaction.editReply({ content: message });
    }

    // --- Commande ARCHIVE (archivage des salons révolus) ---
    if (interaction.commandName === 'archive') {
      const guild = interaction.guild;
      if (!guild) {
        return await interaction.reply({
          content: '❌ Cette commande doit être utilisée dans un serveur.',
          flags: 64,
        });
      }
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
        return await interaction.reply({
          content: '❌ Permission requise : gérer les salons (Administrateur ou Modérateur).',
          flags: 64,
        });
      }
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
      // Tout salon dont (année, mois, jour) n'y figure pas est « révolu »
      // (mois précédent révolu et plus anciens) → à archiver.
      const activeDates = getOpenDatesForCurrentAndNextMonth(now);
      const isActiveSlot = (date) =>
        activeDates.some(
          (a) =>
            a.getFullYear() === date.getFullYear() &&
            a.getMonth() === date.getMonth() &&
            a.getDate() === date.getDate(),
        );

      // Canaux texte hors « archive », dont la date n'est plus dans la fenêtre active.
      const toArchive = [];
      for (const ch of guild.channels.cache.values()) {
        if (ch.type !== ChannelType.GuildText) continue;
        if (ch.parentId === archiveId) continue; // déjà archivé
        const date = parseChannelDate(ch.name, now);
        if (!date) continue; // pas un salon du bot (nom non « mois-jour »)
        if (isActiveSlot(date)) continue; // ouvert
        toArchive.push({ channel: ch, date });
      }

      if (toArchive.length === 0) {
        return await interaction.editReply({
          content: '✅ Rien à archiver : tous les salons ouverts sont déjà en place.',
        });
      }

      // 1. Lire le dernier message de chaque salon éligible et grouper par mois.
      // Sécurité : si la lecture échoue (erreur API/permission), on ignore le
      // salon pour ne ni publier de bilan incomplet ni le supprimer.
      let skippedReadCount = 0;
      const groupsByBilan = new Map(); // nomBilan -> { date, entries: [] }
      for (const { channel, date } of toArchive) {
        const { ok, message: lastMessage } = await getLastMessage(channel);
        if (!ok) {
          skippedReadCount++;
          continue;
        }
        const bilanName = getBilanNameForDate(date);
        if (groupsByBilan.has(bilanName)) {
          groupsByBilan.get(bilanName).entries.push({ channel, date, lastMessage });
        } else {
          groupsByBilan.set(bilanName, { date, entries: [{ channel, date, lastMessage }] });
        }
      }

      if (groupsByBilan.size === 0) {
        return await interaction.editReply({
          content: `❌ Impossible de lire les salons révolus (${skippedReadCount} erreur(s)) : aucun bilan publié et aucun salon supprimé.`,
        });
      }

      // 2. Pour chaque (mois, année) : publier D'ABORD le bilan dans
      // « bilan-<mois>-<année> » sous « archive », puis supprimer les salons
      // révolus correspondants uniquement si la publication a réussi.
      let bilansPublies = 0;
      let deletedCount = 0;
      let deleteFailedCount = 0;
      const sortedGroups = [...groupsByBilan.entries()].sort(
        ([, a], [, b]) => a.date - b.date,
      );

      for (const [bilanName, group] of sortedGroups) {
        group.entries.sort(
          (a, b) => a.date - b.date || a.channel.name.localeCompare(b.channel.name),
        );

        const existing = guild.channels.cache.find(
          (ch) =>
            ch.type === ChannelType.GuildText &&
            ch.name === bilanName &&
            ch.parentId === archiveId,
        );
        let bilanChannel = existing;
        if (!bilanChannel) {
          try {
            bilanChannel = await guild.channels.create(
              buildBilanChannelCreateOptions({
                name: bilanName,
                parentId: archiveId,
              }),
            );
            console.log(`Créé canal de bilan « ${bilanName} » [id=${bilanChannel.id}]`);
          } catch (err) {
            console.error(`Impossible de créer le canal de bilan « ${bilanName} » :`, err);
            continue; // bilan non créé : on ne supprime aucun salon de ce mois
          }
        }

        const messages = buildBilanMessages(
          group.date,
          group.entries.map((e) => ({
            channelName: e.channel.name,
            date: e.date,
            content: e.lastMessage?.content,
            hasAttachments: (e.lastMessage?.attachments?.size ?? 0) > 0,
            hasEmbeds: (e.lastMessage?.embeds?.length ?? 0) > 0,
          })),
        );
        try {
          for (const body of messages) {
            await bilanChannel.send(body);
          }
          bilansPublies++;
          console.log(`Bilan publié dans « ${bilanName} » [id=${bilanChannel.id}] (${messages.length} message(s))`);
        } catch (err) {
          console.error(`Impossible de publier le bilan « ${bilanName} » :`, err);
          continue; // bilan non publié : on ne supprime aucun salon de ce mois
        }

        // Bilan confirmé publié : suppression des salons révolus de ce mois.
        // Les catégories (ex. Les DIMANCHE LBJ <année>) sont conservées.
        for (const { channel, date } of group.entries) {
          try {
            await guild.channels.delete(
              channel,
              `Archivage de « ${channel.name} » (${date.getMonth() + 1}/${date.getDate()} ${date.getFullYear()}) : bilan publié dans « ${bilanName} »`,
            );
            deletedCount++;
            console.log(
              `Supprimé « ${channel.name} » [id=${channel.id}] (bilan publié dans « ${bilanName} »)`,
            );
          } catch (err) {
            deleteFailedCount++;
            console.error(`Impossible de supprimer « ${channel.name} » :`, err);
          }
        }
      }

      const summaryLines = [
        `✅ Archivage terminé :`,
        `• **${bilansPublies}** canal(s) de bilan ${bilansPublies === 1 ? 'publié' : 'publiés'} dans « ${ARCHIVE_NAME} »`,
        `• **${deletedCount}** salon(s) révolu(s) supprimé(s)`,
      ];
      if (skippedReadCount > 0) {
        summaryLines.push(
          `• ⚠️ **${skippedReadCount}** salon(s) conservé(s) (lecture du dernier message impossible)`,
        );
      }
      if (deleteFailedCount > 0) {
        summaryLines.push(`• ⚠️ **${deleteFailedCount}** suppression(s) en échec`);
      }
      return await interaction.editReply({ content: summaryLines.join('\n') });
    }

  } catch (error) {
    console.error(error);
    try {
      if (interaction.deferred && !interaction.replied) {
        await interaction.editReply({ content: '❌ Une erreur interne est survenue.' });
      } else if (!interaction.replied) {
        await interaction.reply({ content: '❌ Une erreur interne est survenue.', flags: 64 });
      }
    } catch (replyErr) {
      console.error('Impossible de répondre à l\'interaction en erreur :', replyErr);
    }
  }
});

client.login(process.env.DISCORD_TOKEN); // Connexion au serveur Discord
