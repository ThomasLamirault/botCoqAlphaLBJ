# DESIGN — Bot Discord « CoqAlpha LBJ »

> **Méthode** : découpage en modules profonds (seams, interfaces minces, implementation riche).
> **Source de vérité** : cette documentation est générée à partir de l'état réel du code
> (18/10/2026, post-fix « source unique des commandes » ; `npm i -g npm@12.2.0`
> installé sur la machine du bot).
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
│ • InstallGlobalCommands(     │ • /test  → reply immédiat  │
│   client.user.id,            │ • /create_channel →        │
│   ALL_COMMANDS)              │   deferReply()             │
│ • client.login()             │                            │
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
│ commands.js — DÉFINITIONS (source unique)                  │
│ • CREATE_CHANNEL_COMMAND, TEST_COMMAND                     │
│ • export ALL_COMMANDS (2 commandes, même shape)            │
└────────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────────┐
│ register.js — SCRIPT (npm run register)                    │
│ • InstallGlobalCommands(APP_ID, ALL_COMMANDS)  [utils.js]  │
└────────────────────────────────────────────────────────────┘
```

**Fichiers et rôles :**

| Fichier | Nature | Surface (exports / effets) |
|---|---|---|
| `app.js` | Runtime (1 seul) | 2 événements + `login()` ; le seul code avec effet réel côté Discord |
| `utils.js` | Bibliothèque | 5 exports : `DiscordRequest`, `InstallGlobalCommands`, `getOpenDatesForCurrentAndNextMonth`, `formatDateChannelName`, `getCategoryNameForDate`, `capitalize` |
| `commands.js` | Bibliothèque (définitions) | 1 export : `ALL_COMMANDS` (`/create_channel` + `/test`) |
| `register.js` | Script standalone | 1 appel : `InstallGlobalCommands(APP_ID, ALL_COMMANDS)` |
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

### C3 — Discord API

**Une seule source de vérité des commandes** (`commands.js` → `ALL_COMMANDS`),
utilisée par deux points d'entrée qui enregistrent exactement la même liste :

| Point d'entrée | Mécanisme | Endpoint |
|---|---|---|
| `app.js` (`clientReady`) | `InstallGlobalCommands(client.user.id, ALL_COMMANDS)` (fetch) | `applications/{id}/commands` (PUT, bulk overwrite) |
| `register.js` (`npm run register`) | `InstallGlobalCommands(APP_ID, ALL_COMMANDS)` (fetch) | idem |
| `app.js` (création/salon) | `guild.channels.create()` / `.edit()` (discord.js) | `channels`, `guilds/{id}/channels` |

### C4 — Configuration (`.env`, ignoré par Git)

| Clé | Consommée par | Statut |
|---|---|---|
| `DISCORD_TOKEN` | `app.js` (login + REST) | **Critique runtime** (72 chars) |
| `APP_ID` | `register.js` (install script) | 19 chars — **non lu par le runtime** (clientReady utilise `client.user.id`, identique) |
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

### M3 — Enregistrement des commandes (1 contrat, 1 liste, 2 entry points)

Contrat : **bulk overwrite** des commandes globales de l'application Discord
(PUT `applications/{id}/commands`).

- **Définitions** : `ALL_COMMANDS` dans `commands.js` (seule source de vérité)
  = `/create_channel` + `/test`, même shape (type 1, integration_types [0,1],
  contexts [0,1,2]).
- **Entry point runtime** : `app.js` `clientReady` →
  `InstallGlobalCommands(client.user.id, ALL_COMMANDS)`.
- **Entry point script** : `register.js` (`npm run register`) →
  `InstallGlobalCommands(APP_ID, ALL_COMMANDS)`.

Plus d'écrasement croisé : les deux entry points enregistrent exactement
la même liste, au moment où ils s'exécutent.

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

### 6.1 ✅ Résolu (18/10/2026) : double enregistrement de commandes, bulk overwrite

**Symptom** : `npm run register` **et** `clientReady` écrasaient **l'ensemble**
des commandes globales (PUT = bulk overwrite sur `applications/{id}/commands`)
avant avec des listes disjointes (`/test` seul vs `/create_channel` seul).
Conséquence : à chaque redémarrage, `/test` disparaissait des commandes
globales (et `npm run register` après un démarrage écrasait
`/create_channel` jusqu'au prochain restart).

**Fix appliqué** :
- `commands.js` → **définitions pures** : export `ALL_COMMANDS`
  (`/create_channel` + `/test`, même shape).
- Nouveau `register.js` : le seul script d'installation
  (`InstallGlobalCommands(APP_ID, ALL_COMMANDS)`).
- `app.js` `clientReady` : `InstallGlobalCommands(client.user.id, ALL_COMMANDS)`.
- `package.json` : `"register": "node register.js"`.

Résultat : 1 contrat + 1 liste + 2 entry points identiques (voir §3.M3, §2.C3).

### 6.2 Deux clients Discord API (consolidation partiellement faite)

Après le fix §6.1, l'inscription des commandes passe par un **seul** client
(`utils.DiscordRequest`, fetch brut, User-Agent custom). Le REST de discord.js
n'est plus utilisé explicitement que par les managers `guild.channels.*`.
Résidu : `DiscordRequest` n'est utilisé que pour l'inscription des commandes.
→ **Action** (facultative) : migrer `InstallGlobalCommands` vers le REST de
discord.js (retries, auth intégrés) et supprimer `DiscordRequest` +
`capitalize`.

### 6.3 Code et config morts

| Élément | Statut |
|---|---|
| `utils.capitalize` | Jamais appelé |
| `.env : PUBLIC_KEY` (64 chars) | Aucune référence dans le code — legacy de l'auth PEM (commit `e0f5bea`) |
| `/test` (global) | Enregistré au runtime et par `register.js` (fix §6.1) |
| `npm run register` | Sûr : bulk overwrite de la même liste que le runtime — utile sans démarrer le bot |

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
├── commands (déjà en place, fix §6.1)
│   ├── commands.js           → UNIQUE source de vérité : ALL_COMMANDS
│   └── register.js           → entry point `npm run register`
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
- ✅ **Déjà acquis (fix §6.1)** : `/test` et `/create_channel` ne peuvent plus
  diverger (1 source de vérité, 2 entry points identiques).
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
| `register` | `node register.js` | Bulk overwrite des 2 commandes globales |
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
- (fix §6.1, 18/10) — **Source unique des commandes** : `commands.js` exporte
  `ALL_COMMANDS` ; nouveau `register.js` ; `clientReady` et `npm run register`
  enregistrent la même liste.
- Machine du bot (Ubuntu, `/home/ubuntu/botCoqAlphaLBJ`) : installation
  `npm@12.2.0` globale (OOM résolé, 2 GiB RAM).
