import 'dotenv/config';
import { Client, GatewayIntentBits, REST, Routes, ChannelType } from 'discord.js';
import { getOpenDaysForCurrentAndNextMonth } from './utils.js'; // On importe la logique de dates créée précédemment

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// Étape 1 : Démarrage et Installation des commandes
client.once('ready', async () => {
  console.log(`✅ ${client.user.tag} est en ligne (Mode Direct - Plus besoin de Cloudflare)`);

  // On dépose la commande /createChannel immédiatement pour qu'elle apparaisse rapidement
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const commands = [{ 
    name: 'createChannel', 
    description: 'Créer les channels pour les jours du club (Lundi & Dimanche)' 
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
    if (interaction.commandName === 'createChannel') {
      const guild = interaction.guild;
      
      // 1. Récupérer les dates du mois courant et suivant via ton code utilitaire
      const datesToCreate = getOpenDaysForCurrentAndNextMonth();

      // On dit au bot "Je travaille dessus..." pour éviter le timeout Discord (3s)
      await interaction.deferReply({ flags: 64 }); 

      let createdCount = 0;
      
      for (const dateName of datesToCreate) {
        const channelExists = guild.channels.cache.find(ch => ch.name === dateName);

        if (!channelExists) {
          try {
            await guild.channels.create({
              name: dateName, // ex: "aout-2" ou "septembre-7"
              type: ChannelType.GuildText, // Salon texte classique (8 dans certains contextes API, mais 0 ici généralement)
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
        }
      }

      // Réponse une fois fini
      const message = createdCount > 0 
        ? `✅ **${createdCount}** nouveaux channel(s) créé(s) pour le club !` 
        : "ℹ️ Tous les channels existent déjà, rien à faire.";
        
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
