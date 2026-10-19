import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import {
  getOpenDatesForCurrentAndNextMonth,
  formatDateChannelName,
  getCategoryNameForDate,
  InstallGlobalCommands,
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

// Étape 2 : Gestion des commandes (/create et /test)
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

  } catch (error) {
    console.error(error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Une erreur interne est survenue.', flags: 64 });
    }
  }
});

client.login(process.env.DISCORD_TOKEN); // Connexion au serveur Discord
