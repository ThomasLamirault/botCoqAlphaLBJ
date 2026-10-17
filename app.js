import 'dotenv/config';
import { Client, GatewayIntentBits, REST, Routes, ChannelType } from 'discord.js';
import {
  getOpenDatesForCurrentAndNextMonth,
  formatDateChannelName,
  getCategoryNameForDate,
} from './utils.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// Étape 1 : Démarrage et Installation des commandes
client.once('clientReady', async () => {
  console.log(`✅ ${client.user.tag} est en ligne (Mode Direct - Plus besoin de Cloudflare)`);

  // On dépose la commande /create_channel immédiatement pour qu'elle apparaisse rapidement
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const commands = [{ 
    name: 'create_channel',
    description: 'Créer les channels du club (dimanche & lundi) dans les bonnes catégories'
  }];

  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: commands },
  );
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
        let category = guild.channels.cache.find(
          ch => ch.type === ChannelType.GUILD_CATEGORY && ch.name === categoryName
        );
        if (!category) {
          try {
            category = await guild.channels.create({ name: categoryName, type: ChannelType.GUILD_CATEGORY });
          } catch (err) {
            console.error(`Impossible de créer la catégorie « ${categoryName} » :`, err);
            continue;
          }
        }

        // Salon du jour, dans la catégorie
        const channelExists = guild.channels.cache.find(ch => ch.name === dateName);

        if (!channelExists) {
          try {
            await guild.channels.create({
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
          } catch (err) {
            console.error(`Impossible de créer ${dateName}:`, err);
          }
        } else if (channelExists.parentId !== category.id) {
          // Salon déjà existant mais hors de sa catégorie : le réorganiser
          try {
            await channelExists.move({ channelId: category.id });
            movedCount++;
          } catch (err) {
            console.error(`Impossible de déplacer ${dateName} dans « ${categoryName} » :`, err);
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
