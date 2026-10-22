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
    throw new Error(`Discord API ${res.status}: ${JSON.stringify(data)}`);
  }
  // return original response
  return res;
}

export async function InstallGlobalCommands(appId, commands) {
  // API endpoint to overwrite global commands
  const endpoint = `applications/${appId}/commands`;

  // Pré-validation des limites Discord : nom ≤ 32, description ≤ 100.
  // Sinon, l'API renvoie un 400 opaque (code 50035, BASE_TYPE_MAX_LENGTH)
  // qui ne précise pas laquelle des commandes est trop longue.
  for (const [i, c] of commands.entries()) {
    if (c.name.length > 32) {
      throw new Error(
        `commande[${i}] « ${c.name} » : name trop long (${c.name.length} > 32)`
      );
    }
    if (c.description.length > 100) {
      throw new Error(
        `commande[${i}] « ${c.name} » : description trop longue (${c.description.length} > 100)`
      );
    }
  }

  // This is calling the bulk overwrite endpoint: https://discord.com/developers/docs/interactions/application-commands#bulk-overwrite-global-application-commands
  await DiscordRequest(endpoint, { method: 'PUT', body: commands });
}

const MONTHS_FR =  ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];

// Mois sans accents : correspond à la façon dont les canaux sont nommés
// par formatDateChannelName (ex : « aout-15 », « decembre-3 »).
const MONTHS_FR_NO_ACCENT = MONTHS_FR.map(
  (name) => name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase(),
);

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

/**
 * Parse le nom d'un canal de salon (ex : « septembre-30 », « novembre-1 »)
 * en une Date, en déduisant l'année.
 *
 * Le nom ne contient pas l'année : elle est retrouvée comme la plus récente
 * (<= l'année de `now`) dans laquelle ce (mois, jour) tombait un dimanche ou
 * un lundi — c'est-à-dire l'année dans laquelle le canal a pu être créé par
 * le bot. (Un même (mois, jour) ne tombe pas deux fois de suite sur dim/lun,
 * donc cette année est unique sur une fenêtre raisonnable.)
 *
 * @param {string} channelName Nom du canal (ex : « septembre-30 »)
 * @param {Date} now Date de référence
 * @returns {Date|null} Date correspondante, ou null si le nom ne correspond
 *   pas à un salon du bot.
 */
export function parseChannelDate(channelName, now) {
  if (typeof channelName !== 'string') return null;

  const parts = channelName.split('-');
  if (parts.length !== 2) return null;

  const monthPart = parts[0];
  const day = parseInt(parts[1], 10);
  if (Number.isNaN(day) || day < 1 || day > 31) return null;

  const monthIndex = MONTHS_FR_NO_ACCENT.indexOf(monthPart);
  if (monthIndex === -1) return null;

  const yearNow = now.getFullYear();
  for (let y = yearNow; y >= yearNow - 10; y--) {
    const d = new Date(y, monthIndex, day);
    // Écarte les dates inexistantes (ex : « 31 février »).
    if (d.getFullYear() !== y || d.getMonth() !== monthIndex || d.getDate() !== day) {
      continue;
    }
    // 0 = dimanche, 1 = lundi → jours ouverts du club.
    if (d.getDay() === 0 || d.getDay() === 1) return d;
  }

  return null;
}

/**
 * Nom du canal de synthèse pour une date : « bilan-<mois sans accent>-<année> ».
 * Ex : `bilan-septembre-2026`, `bilan-aout-2025`, `bilan-decembre-2026`.
 *
 * @param {Date} date Date du salon archivé
 * @returns {string} Nom du canal de bilan
 */
export function getBilanNameForDate(date) {
  const monthNoAccent = MONTHS_FR[date.getMonth()]
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  return `bilan-${monthNoAccent}-${date.getFullYear()}`;
}

/**
 * Nom du mois en français (avec accents), pour un usage dans le contenu
 * (ex : le message du bilan). Distinct du nom sans accent utilisé pour le canal.
 *
 * @param {Date} date
 * @returns {string}
 */
export function getMonthNameFr(date) {
  return MONTHS_FR[date.getMonth()];
}

export function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
