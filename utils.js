import 'dotenv/config';

export async function DiscordRequest(endpoint, options) {
  // append endpoint to root API URL
  const url = 'https://discord.com/api/v10/' + endpoint;
  // Stringify payloads
  if (options.body) options.body = JSON.stringify(options.body);
  // Use fetch to make requests
  const res = await fetch(url, {
    headers: {
      Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'User-Agent': 'BotLBJ (https://github.com/ThomasLamirault/botCoqAlphaLBJ, 0.1.0)',
    },
    ...options
  });
  // throw API errors
  if (!res.ok) {
    const data = await res.json();
    console.log(res.status);
    throw new Error(JSON.stringify(data));
  }
  // return original response
  return res;
}

export async function InstallGlobalCommands(appId, commands) {
  // API endpoint to overwrite global commands
  const endpoint = `applications/${appId}/commands`;

  try {
    // This is calling the bulk overwrite endpoint: https://discord.com/developers/docs/interactions/application-commands#bulk-overwrite-global-application-commands
    await DiscordRequest(endpoint, { method: 'PUT', body: commands });
  } catch (err) {
    console.error(err);
  }
}

// Simple method that returns a random emoji from list
export function getRandomEmoji() {
  const emojiList = ['😭','😄','😌','🤓','😎','😤','🤖','😶‍🌫️','🌏','📸','💿','👋','🌊','✨'];
  return emojiList[Math.floor(Math.random() * emojiList.length)];
}

/**
 * Retourne les dates (formatées en chaîne) pour lesquelles créer un channel.
 * Format : mois-jour (ex: aout-2)
 */
export function getOpenDaysForCurrentAndNextMonth(currentDate = new Date()) {
  const monthsFR = [
    'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'
  ];

  const dates = [];
  // On boucle sur le mois courant + le prochain (i < 2)
  for (let i = 0; i < 2; i++) {
    const month = currentDate.getMonth() + i;
    let date = new Date(currentDate.getFullYear(), month, 1);

    // On boucle tant qu'on est dans le mois visé
    while (date.getMonth() === (currentDate.getMonth() + i) % 12) {
      // getDay(): 0=Dimanche, 1=Lundi. C'est le club ouvert ces jours-là.
      if (date.getDay() === 0 || date.getDay() === 1) {
        const name = `${monthsFR[date.getMonth()].substring(0,5)}-${date.getDate()}`; 
        // Note: on prend les 5 lettres pour abréger si besoin, ou le nom complet normalisé
        dates.push(formatDateChannelName(date));
      }
      date.setDate(date.getDate() + 1);
    }
  }
  return dates;
}

export function formatDateChannelName(date) {
  const monthsFR = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  // Normalisation (sans accents) et minuscules
  const monthShort = monthsFR[date.getMonth()] 
    .normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  return `${monthShort}-${date.getDate()}`;
}

export function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
