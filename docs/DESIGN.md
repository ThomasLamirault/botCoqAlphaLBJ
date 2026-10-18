# DESIGN — Bot Discord « CoqAlpha LBJ »

> **Méthode** : découpage en modules profonds (seams, interfaces minces, implementation riche).
> **Source de vérité** : cette documentation est générée à partir de l'état réel du code
> (commit `07597ef`, 18/10/2026 — `npm i -g npm@12.2.0` installé sur la machine du bot).
> Chaque section se base sur ce que le code fait **aujourd'hui**, pas sur ce qu'on aimerait.

---

## 0. Mission

Automatiser la gestion des **salons Discord** du serveur du club CoqAlpha LBJ.
À chaque exécution de `/create_channel`, garantir que, pour chaque **dimanche** et **lundi**
du mois courant + du mois suivant, il existe :

1. une **catégorie** `Les DIMANCHE LBJ <année>` / `Les LUNDI LBJ <année>`
2. un **salon texte** `aout-4`, `octobre-12`, `janvier-4` … dans la bonne catégorie
3. une permission par défaut : **tout le monde peut voir + envoyer**

Exemple concret (exécuté le 18/10/2026) : salons `octobre-18` et `octobre-19`
déplacés de `Les DIMANCHE LBJ 2025` → `Les DIMANCHE LBJ 2026`.

---

## 1. Vue d'ensemble de l'architecture

```
┌────────────────────────────────────────────────────────────┐
│ app.js — RUNTIME (point d'entrée unique, node app.js)      │
├──────────────────────────────┬─────────────────────────────┤
│ clientReady                  │ interactionCreate           │
│ • REST PUT (bulk overwrite)  │ • /test  → reply immédiat  │
│   /applications/{id}/commands│ • /create_channel →        │
│ • client.login()             │   deferReply()             │
│                              │   for date in dates:       │
└───────────────┬──────────────┤   • category ? sinon create│
                │              └─────────────────────────────┘
                ▼
┌────────────────────────────────────────────────────────────┐
│ discord.js Client (v14.27.0)                               │
│ • Gateway, intent : Guilds                                 │
│ • REST client (v10)                                        │
│ • guild.channels.create / edit (catégories + salons)       │
└──────────────────────────┬─────────────────────────────────┘
                           ▼
                  ┌───────────────────────┐
                  │  Discord API / Gateway │
                  └───────────────────────┘

┌────────────────────────────────────────────────────────────┐
│ commands.js — SCRIPT (npm run register)                     │
│ • ALL_COMMANDS = [ /test ]                                 │
│ • InstallGlobalCommands(APP_ID, ALL_COMMANDS)  [utils.js]  │
└────────────────────────────────────────────────────────────┘
```

**Fichiers et rôles :**

| Fichier | Nature | Surface (exports / effets) |
|---|---|---|
| `app.js` | Runtime (1 seul) | 2 événements + `login()` ; le seul code avec effet réel côté Discord |
| `utils.js` | Bibliothèque | 5 exports : `DiscordRequest`, `InstallGlobalCommands`, `getOpenDatesForCurrentAndNextMonth`, `formatDateChannelName`, `getCategoryNameForDate`, `capitalize` |
| `commands.js` | Script standalone | 1 appel : `InstallGlobalCommands(APP_ID, ALL_COMMANDS)` |
| `tests/utils.test.js` | vitest | 4 tests (tous sur `utils.js`) |
| `.env` | Configuration (gitignored) | `APP_ID`, `DISCORD_TOKEN`, `PUBLIC_KEY` |

**Dépendances** : `discord.js@14.27.0` (cœur), `vitest` (tests), `nodemon` (dev), `dotenv` (env).

---

## 2. Les Seams (interfaces de contact)

Un *seam* est un endroit où l'on peut modifier le comportement sans toucher au corps du code.
Cinq seams dans ce repo :

### C1 — Moteur calendrier (domaine pur, `utils.js`)

C'est ce que l'appelant (app.js) doit connaître — et rien d'autre :

```ts
getOpenDatesForCurrentAndNextMonth(currentDate?: Date): Date[]
formatDateChannelName(date: Date): string       // "aout-15"
getCategoryNameForDate(date: Date): string      // "Les DIMANCHE LBJ 2026"
```

L'implémentation est cachée (voir §3.M1). **C'est le module le plus réutilisable**
du repo (lever = élevé) : 100 % pur, 100 % testable, 1 paramètre injectable.

### C2 — Cycle de vie des salons (app.js, branche `create_channel`)

Interface externe : **1 interaction** `/create_channel` → **1 message récapitulatif**
+ un `deferReply()` public pour contourner le timeout Discord (3 s).

Intérieur : algorithme idempotent par date (voir §3.M2 et §4).

### C3 — Discord API (seam le plus instable du repo)

**Deux clients HTTP coexistent** (incohérence majeure, §6.1) :

| Utilisé par | Mécanisme | Endpoint |
|---|---|---|
| `app.js` (clientReady) | `REST` de discord.js (`PUT`) | `applications/{client.user.id}/commands` |
| `commands.js` (`npm run register`) | `fetch` brut via `utils.DiscordRequest` (`PUT`) | `applications/${APP_ID}/commands` |
| `app.js` (création/salon) | `guild.channels.create()` / `.edit()` | `channels`, `guilds/{id}/channels` |

### C4 — Configuration (`.env`, ignoré par Git)

| Clé | Consommée par | Statut |
|---|---|---|
| `DISCORD_TOKEN` | `app.js` (login + REST) | **Critique runtime** (72 chars) |
| `APP_ID` | `commands.js` (register script) | 19 chars — **pas utilisé par le runtime** (app.js utilise `client.user.id`) |
| `PUBLIC_KEY` | **Aucune ligne de code** | 64 chars — clé legacy (auth PEM, retirée du code par le commit `e0f5bea` « Cleanup: Remove secrets… ») |

### C5 — Tests (vitest)

Surface : 4 tests, tous ciblant C1 (moteur calendrier). C2 n'est pas testé.

---

## 3. Les Modules Profonds

### M1 — Moteur calendrier (`utils.js`, L45–93)

```
┌────────────────────────────────────────────┐
│ SMALL INTERFACE                           │
│   3 exports, chacun ≤ 1 paramètre (Date)  │
│   → Date[] / string                       │
├────────────────────────────────────────────┤
│ DEEP IMPLEMENTATION                       │
│   • Itération 2 mois (courant + suivant)  │
│   • % 12 sur le mois → passage d'année    │
│     (déc. 2026 → janv. 2027 géré)        │
│   • Filtre : dimanche (0) + lundi (1)     │
│   • Nommage salon : mois FR, accents      │
│     supprimés (NFD), minuscules, -jour    │
│   • Nommage catégorie : Les {DIMANCHE|    │
│     LUNDI} LBJ {année du salon}          │
└────────────────────────────────────────────┘
```

- **Leverage** : élevé. Fonctions pures, injectables (`currentDate = new Date()`),
  interchangeables par de fake implementations (tests).
- **Localité** : élevée. Toute la « règle métier » du club (jours ouverts,
  naming, année) vit ici, et **nulle part ailleurs**.

### M2 — Cycle de vie des salons (`app.js`, interactionCreate, branche `create_channel`)

```
┌────────────────────────────────────────────┐
│ SMALL INTERFACE                           │
│   interaction.chatInput /create_channel   │
│   → 1 message récapitulatif               │
│     (« X créés / Y déplacés »)          │
├────────────────────────────────────────────┤
│ DEEP IMPLEMENTATION                       │
│   • deferReply() public (anti-timeout)    │
│   • for date of getOpenDates…() :         │
│       • category = cache.find(name)       │
│         → sinon guild.channels.create     │
│         │  (type GUILD_CATEGORY)          │
│       • channel  = cache.find(dateName)   │
│         → absent : guild.channels.create  │
│         │  (GuildText, parentId=cat,      │
│         │  overwrites everyone:View+Send) │
│         → présent + parentId ≠ cat :      │
│         │  guild.channels.edit(ch, {      │
│         │    parent: category, reason })  │
│         │  ← API v14 qui a remplacé     │
│         │  channel.move() (supprimé)     │
│         → présent + parentId = cat : no-op│
│   • erreur par date isolée (catch interne │
│     au for) → 1 date cassée ≠ tout le for│
└────────────────────────────────────────────┘
```

- **Leverage** : moyen. Fortement couplé aux objets `Guild` de discord.js et aux
  effets de bord (écriture réelle sur le serveur).
- **Localité** : élevée. Toute la logique « quel est l'état correct d'un salon
  du club » est concentrée ici — c'est le seul endroit à relire quand on change
  la règle (ex. ajouter un jour « samedi »).

### M3 — Enregistrement des commandes (deux implémentations, 1 contrat)

Contrat : **bulk overwrite** des commandes globales de l'application Discord.

- Implémentation A (runtime) : `app.js` `clientReady` — `rest.put(
  Routes.applicationCommands(client.user.id), { body: [create_channel] })`.
  **Uniquement `/create_channel`.**
- Implémentation B (script) : `commands.js` — `InstallGlobalCommands(APP_ID,
  [test])`. **Uniquement `/test`.**

→ Deux listes disjoints qui écrasent l'autre (voir §6.1, risque critique).

---

## 4. Flux d'exécution — `/create_channel`

```
[user] ── /create_channel ──► [interactionCreate]
                                 │
                                 ▼
                          deferReply()          ← public, évite le timeout 3s
                                 │
                          getOpenDatesForCurrentAndNextMonth()
                          → 16 à 17 Date (ex. 18/10 à 26/10 + 4/11, 5/11)
                                 │
                          ┌──────┴──────────────────────────────────────────┐
                          │  POUR CHAQUE DATE                              │
                          │  categoryName = getCategoryNameForDate(date)    │
                          │  dateName     = formatDateChannelName(date)     │
                          ├─────────────────────────────────────────────────┤
                          │  ① category ? ──non──► guild.channels.create(   │
                          │                      { type: GUILD_CATEGORY })  │
                          │  ② channel  ? ──non──► guild.channels.create(   │
                          │                      { type: GuildText,         │
                          │                        parentId: category.id,   │
                          │                        overwrites: everyone:     │
                          │                        ViewChannel + SendMessages│
                          │                      })   → createdCount++      │
                          │  ③ channel ? oui ──► parentId ≠ category.id ?   │
                          │                        → guild.channels.edit(   │
                          │                           ch, { parent: category,│
                          │                             reason: « Réorg.   │
                          │                             « dateName » dans   │
                          │                             « categoryName » »  })│
                          │                        → movedCount++           │
                          │                        (équiv. PATCH            │
                          │                        /channels/{id} +          │
                          │                        parent_id ; le gateway    │
                          │                        synchronise le cache)    │
                          │  ④ erreur ? → catch par date (console.error),   │
                          │              la boucle continue                 │
                          └─────────────────────────────────────────────────┘
                                 │
                                 ▼
                          editReply(
                            parts.length
                              ? `✅ ${parts.join(' et')} !`
                              : « ℹ️ Tous les salons existent déjà… »
                          )
```

---

## 5. Testabilité — état actuel et préparation au TDD

### Ce qui est déjà testé (4/4, `tests/utils.test.js`)

Tout le **Moteur calendrier (C1/M1)** :

| Test | Cible |
|---|---|
| Dates du mois courant + suivant (15/08/2023 → 16 dates, août+sept) | `getOpenDatesForCurrentAndNextMonth` |
| Passage d'année (15/12/2026 → 17 dates, déc 2026 + janv 2027) | `getOpenDatesForCurrentAndNextMonth` |
| Nommage catégorie (DIMANCHE/LUNDI + année du salon) | `getCategoryNameForDate` |
| Nommage salon (suppression d'accents : `aout-15`, `fevrier-1`) | `formatDateChannelName` |

✅ Règle d'or déjà respectée : **injection par défaut** (`currentDate = new Date()`).

### Ce qui n'est pas testé

**M2 — cycle de vie des salons** : couplé au `Client`, au cache `guild.channels`,
aux appels REST réels. Impossible de tester en unit sans extraction.

### Préparation au TDD (règles d'or de la phase 3)

1. **Injection par défaut** — extraire l'algorithme de M2 :
   ```ts
   export async function processCreateChannel(
     channels: ChannelManager,   // injecté (ou Guild)
     dates?: Date[],             // injectable (défaut : getOpenDatesForCurrentAndNextMonth())
   ): Promise<{ created: number; moved: number }>
   ```
   `app.js` ne garde plus que le *seam* (defer, parse de l'interaction,
   `editReply`).
2. **Résultats purs** — `processCreateChannel` **retourne** `{ created, moved }`
   au lieu de faire l'effet de bord de la réponse ; le handler lit le résultat.
   → Testable avec un `FakeGuild` (mock de `channels.cache`) et un REST
   intercepté.
3. **Fakes de seam** — un `FakeChannelManager` implémentant `cache.find`,
   `create`, `edit` permet de tester l'idempotence (2e run → 0/0), le
   passage d'année (déc 2026 → salons de 2027 dans les catégories 2027)
   et l'isolation d'erreur (1 catégorie refusée ≠ boucle cassée).

---

## 6. Incohérences connues & dette technique

### 6.1 ⚠️ Critique : double enregistrement de commandes, bulk overwrite

`npm run register` **et** `clientReady` écrasent **l'ensemble** des commandes globales
(PUT = bulk overwrite sur `applications/{id}/commands`) :

| Source | Liste envoyée |
|---|---|
| `commands.js` (register) | `/test` |
| `app.js` (clientReady) | `/create_channel` |

**Conséquence** : le *dernier* enregistrement gagne. À chaque redémarrage du bot,
`/test` **disparaît** des commandes globales (seul `/create_channel` est
registré à runtime). Le handler de `/test` existe dans le code mais la commande
n'est plus exposée à Discord. De plus, si on lance `npm run register` **après**
un démarrage du bot, `/create_channel` disparaît globalement… jusqu'au
prochain restart.

→ **Action** : une seule source de vérité des commandes (module partagé, voir
§7), utilisée par `clientReady` **et** `commands.js`.

### 6.2 Deux clients Discord API

- `discord.js` REST (app.js) — recommandé, gère auth + retries.
- `fetch` brut (`utils.DiscordRequest`, commands.js) — User-Agent custom,
  `throw` avec JSON d'erreur.

→ **Action** : déléguer `InstallGlobalCommands` au REST de discord.js (ou
l'inverse) ; supprimer `DiscordRequest` s'il n'est plus nécessaire.

### 6.3 Code et config morts

| Élément | Statut |
|---|---|
| `utils.capitalize` | Jamais appelé |
| `.env : PUBLIC_KEY` (64 chars) | Aucune référence dans le code — legacy de l'auth PEM (commit `e0f5bea`) |
| `/test` (global) | Effectivement non enregistré au runtime (voir 6.1) |
| `npm run register` | Pédagogue mais piégeux (bulk overwrite) — voir 6.1 |

### 6.4 Robustesse du runtime

- **Pas de null-check sur `interaction.guild`** : `/create_channel` est global
  (pas de restriction d'intégration dans le PUT de `clientReady`) → utilisable
  en DM ; `interaction.guild.channels` crasherait, catché par le `try/catch`
  (message générique « ❌ Une erreur interne… »).
- **Aucun retry** si l'inscription des commandes échoue à `clientReady`
  (erreur loggée, `/create_channel` inexistante jusqu'au prochain restart).
- **`npm start` sans `npm install`** : le premier `npm install` a **Killed** (OOM)
  sur la machine du bot (2 GiB RAM, 0 swap) — résolu en installant `npm@12.2.0`
  globalement ; à re-documenter pour les setups.

---

## 7. Structure cible recommandée (horizon, si refactoring)

Objectif : chaque module **petite interface / implémentation riche**, et M2
devenant testable au premier TDD.

```
src/
├── commands/
│   └── index.ts              → UNIQUE source de vérité des commandes
│                               (definition + descriptions), exportée pour
│                               app.js (clientReady) ET commands.js
├── calendar/
│   └── index.ts              → C1 : getOpenDatesForCurrentAndNextMonth,
│                               formatDateChannelName, getCategoryNameForDate
│                               (purs, injectables — inchangé)
├── channels/
│   └── process.ts            → C2 extrait : processCreateChannel(
│                                 channels, dates?) → { created, moved }
│                               (résultat pur, effets isolés)
├── discord/
│   ├── client.ts             → Client + login (seam gateway)
│   └── api.ts                → UNIQUE client REST (remplace DiscordRequest
│                               + rest inline d'app.js)
└── handlers/
    └── interactions.ts       → seam mince : /test + /create_channel
                                 (defer → processCreateChannel → editReply)
app.js                        → ~10 lignes : createClient() + register()
                                + attachHandlers() + login()
tests/
├── calendar.test.ts          → les 4 tests existants (relocalisés)
├── channels.test.ts          → TDD : FakeChannelManager, idempotence,
│                               passage d'année, isolation d'erreur
└── interactions.test.ts      → handlers testés avec mock Client
```

**Critères de gain** (leverages) :
- `/test` et `/create_channel` ne peuvent plus diverger (1 source de vérité).
- M2 testable sans serveur Discord (fake + résultats puits).
- 1 seul client REST (localité des erreurs Discord).
- `app.js` < 20 lignes : lecture instantanée du runtime.

---

## Annexes

### A. Variables d'environnement

| Clé | Où | Obligatoire ? |
|---|---|---|
| `DISCORD_TOKEN` | `app.js` (login + REST) | ✅ sans elle le bot ne démarre pas |
| `APP_ID` | `commands.js` | ✅ sans lui `npm run register` échoue |
| `PUBLIC_KEY` | — (non utilisée) | ❌ (morte) |

### B. Scripts `package.json`

| Script | Commande | Effet |
|---|---|---|
| `start` | `node app.js` | Runtime du bot |
| `dev` | `nodemon app.js` | Runtime avec reload |
| `register` | `node commands.js` | Bulk overwrite `/test` globaux ⚠️ (voir 6.1) |
| `test` | `vitest run` | 4 tests (M1) |

### C. Événements discord.js utilisés

| Événement | Intent requis | Usage |
|---|---|---|
| `clientReady` | `Guilds` | Inscription commandes, `login` |
| `interactionCreate` | `Guilds` | `/test`, `/create_channel` |
| `channelUpdate` (implicite, via cache) | `Guilds` | Synchronisation du cache après `guild.channels.edit` (move REST) |

### D. Historique des fix majeurs

- `e0f5bea` — Cleanup : secrets, PEM, ignore.
- `78e75e6` — `/create_channel` + refactoring utilities (dates, catégories
  `Les DIMANCHE/LUNDI LBJ <année>`, `utils.js` testable).
- `07597ef` — **Fix crash** : `channel.move()` (supprimé en v14) →
  `guild.channels.edit(channel, { parent })`.
- Machine du bot (Ubuntu, `/home/ubuntu/botCoqAlphaLBJ`) : installation
  `npm@12.2.0` globale (OOM résolé, 2 GiB RAM).
