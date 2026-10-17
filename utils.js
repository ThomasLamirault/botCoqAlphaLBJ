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

const MONTHS_FR =  ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];

/**
 * Retourne les objets Date des dimanches (0) et des lunis (1)
 * du mois courant + du mois suivant.
 * Gère le passage à l'année suivante : déc. 2026 + janv. 2027.
 */
export function getOpenDatesForCurrentAndNextMonth(currentDate = new Date()) {
  const dates = [];

  // Mois courant + mois suivant
  for (let i = 0; i < 2; i++) {
    const targetMonth = currentDate.getMonth() + i;
    // Le % 12 gère le passage de décembre (11) à janvier (12 % 12 = 0)
    let date = new Date(currentDate.getFullYear(), targetMonth, 1);

    while (date.getMonth() === targetMonth % 12) {
      // getDay() : 0 = dimanche, 1 = lundi → jours ouverts du club
      if (date.getDay() === 0 || date.getDay() === 1) {
        dates.push(new Date(date));
      }
      date.setDate(date.getDate() + 1);
    }
  }

  return dates;
}

export function formatDateChannelName(date) {
  // Normalisation (sans accents) et minuscules
  const monthShort = MONTHS_FR[date.getMonth()]
    .normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  return `${monthShort}-${date.getDate()}`;
}

/**
 * Nom de la catégorie Discord à laquelle rattacher le salon d'une date.
 *  - dimanche → « Les DIMANCHE LBJ <année> »
 *  - lundi    → « Les LUNDI LBJ <année> »
 * L'année provient de la date du salon (2026, puis 2027 au 1er janvier…).
 */
export function getCategoryNameForDate(date) {
  const dayLabel = date.getDay() === 0 ? 'DIMANCHE' : 'LUNDI';
  return `Les ${dayLabel} LBJ ${date.getFullYear()}`;
}

export function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
