# DESIGN — Bot Discord « CoqAlpha LBJ »

> **Méthode** : découpage en modules profonds (seams, interfaces minces, implementation riche).
> **Source de vérité** : cette documentation est générée à partir de l'état réel du code
> (fix « source unique des commandes », fix `ChannelType`, ajout de la
> commande `/archive`, fix longueur de la description `/archive` (Discord 400
> / code 50035) ; `npm i -g npm@12.2.0` installé sur la machine du bot).
> Chaque section se base sur ce que le code fait **aujourd'hui**, pas sur ce qu'on aimerait.

---

## 0. Mission

Automatiser la gestion des **salons Discord** du serveur du club CoqAlpha LBJ.
À chaque exécution de `/create_channel`, garantir que, pour chaque **dimanche** et **lundi**
du mois courant + du mois suivant, il existe :

1. une **catégorie** `Les DIMANCHE LBJ <année>` / `Les LUNDI LBJ <année>`
2. un **salon texte** `aout-4`, `octobre-12`, `janvier-4` … dans la bonne catégorie
3. une permission par défaut : **tout le monde peut voir + envoyer**

Un deuxième pilotage — **`/archive`** — consolide les salons **révolus**
(mois précédent et plus anciens, à la date de l'appel) :
1. déplacement de ces salons dans une catégorie **`archive`** (créée si absente) ;
2. création d'un canal de **synthèse** par mois archivé : **`bilan-<mois>-<année>`**
   (ex. `bilan-septembre-2026`), qui regroupe le **dernier message** de chaque
   salon archivé.

Exemple concret (exécuté le 18/10/2026) : salons `octobre-18` et `octobre-19`
déplacés de `Les DIMANCHE LBJ 2025` → `Les DIMANCHE LBJ 2026`.

---

## 1. Vue d'ensemble de l'architecture

```
┌────────────────────────────────────────────────────────────┐
│  app.js — RUNTIME (point d'entrée unique, node app.js)     │
├──────────────────────────────┬─────────────────────────────┤
│ clientReady                  │ interactionCreate           │
│ • InstallGlobalCommands(     │ • /test  → reply immédiat   │
│   client.user.id,            │ • /create_channel →         │
│   ALL_COMMANDS)              │   deferReply()              │
│ • client.login()             │ • /archive  → deferReply()  │
│                              │   récap : X déplacés /      │
│                              │   Y bilans                  │
└──────────────────────────────┴─────────────────────────────┘
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
│ • CREATE_CHANNEL_COMMAND, TEST_COMMAND, ARCHIVE_COMMAND    │
│ • export ALL_COMMANDS (3 commandes, même shape)            │
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
| `utils.js` | Bibliothèque | 9 exports : `DiscordRequest`, `InstallGlobalCommands`, `getOpenDatesForCurrentAndNextMonth`, `formatDateChannelName`, `getCategoryNameForDate`, `parseChannelDate`, `getBilanNameForDate`, `getMonthNameFr`, `capitalize` |
| `commands.js` | Bibliothèque (définitions) | 1 export : `ALL_COMMANDS` (`/create_channel` + `/test` + `/archive`) |
| `register.js` | Script standalone | 1 appel : `InstallGlobalCommands(APP_ID, ALL_COMMANDS)` |
| `tests/utils.test.js` | vitest | 8 tests (tous sur `utils.js`) |
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
parseChannelDate(channelName: string, now?: Date): Date | null // "sept-30" → Date (année déduite)
getBilanNameForDate(date: Date): string          // "bilan-septembre-2026"
getMonthNameFr(date: Date): string               // "septembre"
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

Surface : 11 tests — 8 ciblant C1 (moteur calendrier : dates + utilitaires
d'archivage `parseChannelDate`, `getBilanNameForDate`, `getMonthNameFr`) + 3
ciblant C3 (inscription `InstallGlobalCommands` : name ≤ 32, description
≤ 100, bulk overwrite, `fetch` stubbed). C2 (cycle des salons) et le handler
`/archive` ne sont pas testés en unit (couplage au `Client`, au cache
`guild.channels` et au REST Discord).

---

## 3. Les Modules Profonds

### M1 — Moteur calendrier (`utils.js`)

```
┌────────────────────────────────────────────────────────────┐
│ SMALL INTERFACE                                            │
│  9 exports, chacun ≤ 2 paramètres (Date / payload)         │
│   → Date[] / string                                        │
├────────────────────────────────────────────────────────────┤
│ DEEP IMPLEMENTATION                                        │
│   • Itération 2 mois (courant + suivant)                   │
│   • % 12 sur le mois → passage d'année                     │
│     (déc. 2026 → janv. 2027 géré)                          │
│   • Filtre : dimanche (0) + lundi (1)                      │
│   • Nommage salon : mois FR, accents                       │
│     supprimés (NFD), minuscules, -jour                     │
│   • Nommage catégorie : Les {DIMANCHE|                     │
│     LUNDI} LBJ {année du salon}                            │
└────────────────────────────────────────────────────────────┘
```

- **Leverage** : élevé. Fonctions pures, injectables (`currentDate = new Date()`),
  interchangeables par de fake implementations (tests).
- **Localité** : élevée. Toute la « règle métier » du club (jours ouverts,
  naming, année) vit ici, et **nulle part ailleurs**.

### M2 — Cycle de vie des salons (`app.js`, interactionCreate, branche `create_channel`)

```
┌────────────────────────────────────────────────────────────┐
│ SMALL INTERFACE                                            │
│   interaction.chatInput /create_channel                    │
│   → 1 message récapitulatif                                │
│     (« X créés / Y déplacés »)                             │
├────────────────────────────────────────────────────────────┤
│ DEEP IMPLEMENTATION                                        │
│   • deferReply() public (anti-timeout)                     │
│   • for date of getOpenDates…() :                          │
│       • category = cache.find(                             │
│         type=GuildCategory && name=cat)                    │
│       │  non → migration : canal texte                     │
│       │  « cat » (bug) → renommé                           │
│       │  « [ancien] cat », puis                            │
│       │  create(type=GuildCategory)                        │
│       • channel  = cache.find(dateName)                    │
│         → absent : guild.channels.create                   │
│         │  (GuildText, parentId=cat,                       │
│         │  overwrites everyone:View+Send)                  │
│         → présent + parentId ≠ cat :                       │
│         │  guild.channels.edit(ch, {                       │
│         │    parent: category, reason })                   │
│         │  ← PATCH /channels/{id}+                         │
│         │     parent_id (gateway sync)                     │
│         → présent + parentId = cat : no-op                 │
│   • garde-fou : type cible==GuildCategory                  │
│   • erreur par date isolée (catch interne                  │
│     au for) → 1 date cassée ≠ tout le for                  │
└────────────────────────────────────────────────────────────┘
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
  = `/create_channel` + `/test` + `/archive`, même shape (type 1,
  integration_types [0,1], contexts [0,1,2]).
- **Entry point runtime** : `app.js` `clientReady` →
  `InstallGlobalCommands(client.user.id, ALL_COMMANDS)`.
- **Entry point script** : `register.js` (`npm run register`) →
  `InstallGlobalCommands(APP_ID, ALL_COMMANDS)`.

Plus d'écrasement croisé : les deux entry points enregistrent exactement
la même liste, au moment où ils s'exécutent.

### M4 — Archivage (`app.js`, interactionCreate, branche `archive`)

```
┌────────────────────────────────────────────────────────────┐
│ SMALL INTERFACE                                            │
│   interaction.chatInput /archive                           │
│   → 1 message récapitulatif                                │
│     (récap : X déplacés / Y bilans — voir §4.1)            │
├────────────────────────────────────────────────────────────┤
│ DEEP IMPLEMENTATION                                        │
│   • deferReply() public (anti-timeout)                     │
│   • now = new Date()                                       │
│   • catégorie « archive » : cache.find(                    │
│       type=GuildCategory && name='archive')                │
│     → non : channels.create({ type: GuildCategory,         │
│       position: dernière + 1 })                            │
│   • garde-fou : cible = vraie catégorie (type)             │
│   • toArchive = salons texte hors « archive » dont         │
│      jour) NON dans getOpenDatesForCurrentAndNextMonth(now)│
│      lastMessage = getLastMessage(channel)                 │
│      (= channel.messages.fetch({ limit: 1, cache: false }))│
│      → null si canal vide (console.warn)                   │
│      bilanName = getBilanNameForDate(date)                 │
│      channels.edit(channel, { parent: archiveCat,          │
│        reason: « archivage » (M/J YYYY) })                 │
│        ok → archivedCount++, console.log()                 │
│        entry { channel, date, lastMessage } push           │
│        dans groupsByBilan[bilanName]                       │
│        échec → console.error, skip (pas dans               │
│        le bilan)                                           │
│      try/catch isolé par salon (1 casse ≠ tout)            │
│   • for [bilanName, group] de groupsByBilan :              │
│       existing = cache.find(GuildText, name=bilanName,     │
│         parentId = archiveId)                              │
│       absent → channels.create({ type: GuildText,          │
│         parentId: archiveId })  (perms héritées)           │
│         (échec → skip ce groupe)                           │
│       body = [                                             │
│         « Bilan des salons archivés — {mois} {année} »     │
│         « (_{N} salon(s) archivé(s) _) »                   │
│         + « • {salon} → {content} » × N                    │
│         ].join('\n')  (📊 + gras — voir §4.1)              │
│       content : liens → [lien], retours à la ligne →       │
│         espaces, trim, slice(500); vide → (message         │
│         vide)                                              │
│       bilanChannel.send(body) → bilansPublies++            │
│       (un message par exécution : le canal accumule)       │
│   • isolation d'erreur par mois (try/catch)                │
│     → 1 bilan cassé ≠ toute l'exécution                    │
└────────────────────────────────────────────────────────────┘

- **Leverage** : moyen. Fortement couplé aux objets `Guild` et aux effets REST
  réels (lecture de l'historique, moves).
- **Localité** : élevée. Toute la règle « quel salon est révolu, où le mettre,
  quoi résumer » est concentrée ici — c'est le seul endroit à relire quand on
  change la règle (ex. archiver 2 mois en arrière, format du message bilan).


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
                          │  ① category ? ──oui──► utiliser (type=        │
                          │                      GuildCategory)            │
                          │     └ non → migration : canal texte « cat »  │
                          │       (bug) → renommé « [ancien] cat »,       │
                          │       puis create({ type: GuildCategory })    │
                          │  ② channel  ? ──non──► guild.channels.create(   │
                          │                      { type: GuildText,         │
                          │                        parentId: category.id,   │
                          │                        overwrites: everyone:     │
                          │                        ViewChannel + SendMessages│
                          │                      })   → createdCount++      │
                          │  ③ channel ? oui ──► parentId ≠ category.id ?  │
                          │     (garde-fou type cible==GuildCategory)     │
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

## 4.1 Flux d'exécution — `/archive`

```
[user] ── /archive ──► [interactionCreate]
                          │
                          ▼
                          deferReply()      ← public, timeout 3 s évité
                          │
                          now = new Date()
                          │
                          archiveCat = cache.find(
                             type=GuildCategory && name='archive')
                          │
                          non → channels.create({
                            type: GuildCategory,
                            position: dernière + 1 })
                            (échec → ❌ reply d'erreur)
                          │
                          garde-fou : archiveCat.type =
                          GuildCategory (sinon ❌ reply)
                          │
                          toArchive = salons texte hors « archive » dont
                          parseChannelDate(name, now) ≠ null ET (mois, jour)
                          NON dans getOpenDatesForCurrentAndNextMonth(now)
                          (slots actifs = dim + lun du mois courant + suivant)
                          │
                          toArchive = 0 → « Rien à archiver : … » (reply)
                          │
                     ┌────┴───────────────────────────────────────────────────────┐
                     │ POUR CHAQUE { channel, date } de toArchive :               │
                     │ ① lastMessage = getLastMessage(channel)                    │
                     │    = channel.messages.fetch({ limit: 1, cache: false })    │
                     │    → null si canal vide (console.warn)                     │
                     │ ② bilanName = getBilanNameForDate(date)                    │
                     │ ③ channels.edit(channel, {                                 │
                     │      parent: archiveCategory,                              │
                     │      reason: « Archivage de ... » (M/J YYYY)               │
                     │      ok → archivedCount++, console.log()                   │
                     │         entry { channel, date, lastMessage }               │
                     │         push dans groupsByBilan[bilanName]                 │
                     │      échec → console.error, skip (pas dans                 │
                     │      le bilan)                                             │
                     │ ④ try/catch isolé par salon (1 casse ≠ tout)               │
                     └────────────────────────────────────────────────────────────┘
                          │
                          FOR [bilanName, group] de groupsByBilan :
                          │
                     ┌────┴───────────────────────────────────────────────────────┐
                     │ existing = cache.find(GuildText, name=bilanName,           │
                     │   parentId = archiveId)                                    │
                     │                                                            │
                     │ absent → channels.create({ type: GuildText,                │
                     │   parentId: archiveId })  (perms héritées)                 │
                     │   (échec → skip ce groupe)                                 │
                     │                                                            │
                     │ body = [                                                   │
                     │   « 📊 **Bilan des salons archivés —                       │
                     │   {mois FR} {année} ** »,                                  │
                     │   « (_{N} salon(s) archivé(s) _) »,                        │
                     │   « • {salon} → {content} » (× N salons)                   │
                     │   ].join('\n')                                             │
                     │                                                            │
                     │ content : liens → [lien], retours à la ligne →             │
                     │   espaces, trim, slice(500) ; vide → (message              │
                     │   vide)                                                    │
                     │                                                            │
                     │ bilanChannel.send(body) → bilansPublies++                  │
                     │   (un message par exécution : le canal accumule)           │
                     │                                                            │
                     │ try/catch isolé par mois (1 casse ≠ tout)                  │
                     └────────────────────────────────────────────────────────────┘
                          │
                          ▼
                          summary = « ✅ Archivage terminé :
                            • X déplacé(s) dans « archive »
                            • Y canal(s) de bilan publié(s) »
                          editReply({ content: summary })

---

## 5. Testabilité — état actuel et préparation au TDD

### Ce qui est déjà testé (11/11, `tests/utils.test.js`)

Tout le **Moteur calendrier (C1/M1)** (8 tests), plus **3 tests d'inscription `InstallGlobalCommands`** (seam C3, `fetch` stubbed, sans réseau) :

| Test | Cible |
|---|---|
| Dates du mois courant + suivant (15/08/2023 → 16 dates, août+sept) | `getOpenDatesForCurrentAndNextMonth` |
| Passage d'année (15/12/2026 → 17 dates, déc 2026 + janv 2027) | `getOpenDatesForCurrentAndNextMonth` |
| Nommage catégorie (DIMANCHE/LUNDI + année du salon) | `getCategoryNameForDate` |
| Nommage salon (suppression d'accents : `aout-15`, `fevrier-1`) | `formatDateChannelName` |
| Parsing « mois-jour » → Date (année déduite, dim/lun) | `parseChannelDate` |
| Parsing invalide → null (jour inexistant, nom inconnu, `[ancien]`) | `parseChannelDate` |
| Nommage canal bilan (`bilan-septembre-2026`, sans accent) | `getBilanNameForDate` |
| Nom du mois avec accents (pour le contenu) | `getMonthNameFr` |
| Rejet : description > 100 chars (le 400 code 50035 Discord) | `InstallGlobalCommands` |
| Rejet : name > 32 chars | `InstallGlobalCommands` |
| Commande valide → PUT bulk-overwrite attendu (fetch stubbed) | `InstallGlobalCommands` |

✅ Règle d'or déjà respectée : **injection par défaut** (`currentDate = new Date()`).

### Ce qui n'est pas testé

**M2 — cycle de vie des salons** et le **handler `/archive` (M4)** :
couplés au `Client`, au cache `guild.channels`, à la **lecture du dernier
message via REST** (`getLastMessage` → `channel.messages.fetch({ limit: 1,
cache: false })`) et aux appels REST réels (moves, sends). Impossible de
tester en unit sans extraction (voir §5, préparation au TDD). En revanche,
la **seam d'inscription** (`InstallGlobalCommands`) est testée (3 tests,
`fetch` stubbed).

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

### 6.2 ✅ Résolu (18/10/2026) : catégories créées en CANAL TEXTE — constante
`GUILD_CATEGORY` undefined

**Symptom** : le bot créait bien les « catégories » `Les DIMANCHE/LUNDI LBJ
<année>` et les salons texte `novembre-30`…, mais le déplacement échouait
avec :
```
DiscordAPIError[50035]: Invalid Form Body
parent_id[CHANNEL_PARENT_INVALID_TYPE]: Not a category
requestBody.parent_id: '1561708…'
```

**Cause racine** : dans **discord.js 14.27.0** (basé sur
`discord-api-types/v10`), les constantes `ChannelType` sont en
**PascalCase** :
- `ChannelType.GuildText = 0`
- `ChannelType.GuildCategory = 4`
- `ChannelType.GUILD_CATEGORY = undefined` (nom MAJUSCULES inexistant)

Le code utilisait `ChannelType.GUILD_CATEGORY` → `undefined` :
- `guild.channels.create({ type: undefined })` → Discord crée un **canal
texte par défaut**, **pas** une catégorie.
- `cache.find(ch => ch.type === ChannelType.GUILD_CATEGORY)` → `=== undefined`
  → **toujours faux** → la « catégorie » n'est jamais retrouvée.
- `guild.channels.edit(salon, { parent: <canal texte> })` → Discord rejette :
  **`parent_id : Not a category`**.

**Fix appliqué** (app.js, branche `create_channel`) :
- `ChannelType.GUILD_CATEGORY` → **`ChannelType.GuildCategory`** (4) pour le
  `find` **et** le `create`.
- **Migration** : si aucune vraie catégorie mais qu'un **canal texte** porte le
  nom de la catégorie (débris du bug) → le bot le **renomme** en
  `[ancien] <nom>` (suffixe unique si collision), puis crée la **vraie**
  catégorie. Renommage (pas suppression) → **aucune perte de données**.
- **Garde-fou** : avant tout déplacement, vérifier
  `category?.type === ChannelType.GuildCategory` (log + `continue` sinon).
- Logs détaillés (ids, types) sur création/déplacement/erreur (diagnostic).

### 6.3 Deux clients Discord API (consolidation partiellement faite)

Après le fix §6.1, l'inscription des commandes passe par un **seul** client
(`utils.DiscordRequest`, fetch brut, User-Agent custom). Le REST de discord.js
n'est plus utilisé explicitement que par les managers `guild.channels.*`.
Résidu : `DiscordRequest` n'est utilisé que pour l'inscription des commandes.
→ **Action** (facultative) : migrer `InstallGlobalCommands` vers le REST de
discord.js (retries, auth intégrés) et supprimer `DiscordRequest` +
`capitalize`.

### 6.4 Code et config morts

| Élément | Statut |
|---|---|
| `utils.capitalize` | Jamais appelé |
| `.env : PUBLIC_KEY` (64 chars) | Aucune référence dans le code — legacy de l'auth PEM (commit `e0f5bea`) |
| `/test` (global) | Enregistré au runtime et par `register.js` (fix §6.1) |
| `npm run register` | Sûr : bulk overwrite de la même liste que le runtime — utile sans démarrer le bot |

### 6.5 Robustesse du runtime

- **Pas de null-check sur `interaction.guild`** : `/create_channel` est global
  (pas de restriction d'intégration dans le PUT de `clientReady`) → utilisable
  en DM ; `interaction.guild.channels` crasherait, catché par le `try/catch`
  (message générique « ❌ Une erreur interne… »).
- **Aucun retry** si l'inscription des commandes échoue à `clientReady`
  (erreur loggée, `/create_channel` inexistante jusqu'au prochain restart).
- **`npm start` sans `npm install`** : le premier `npm install` a **Killed** (OOM)
  sur la machine du bot (2 GiB RAM, 0 swap) — résolu en installant `npm@12.2.0`
  globalement ; à re-documenter pour les setups.
- **✅ Résolu — dernier message via REST (handler `/archive`)** : le handler
  ne lit plus le cache local `salon.history` ; `getLastMessage(channel)`
  fait `channel.messages.fetch({ limit: 1, cache: false })` (REST, sans
  intent `GuildMessages`). Canal vide → `null` → la ligne de bilan affiche
  `(message vide)`. Plus de `.last()` sur le cache local, donc ni crash ni
  message fantôme.

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
    └── interactions.ts       → seam mince : /test + /create_channel + /archive
                                 (defer → processCreateChannel → editReply)
app.js                        → ~10 lignes : createClient() + register()
                                + attachHandlers() + login()
tests/
├── calendar.test.ts          → les 8 tests C1 + 3 tests d'inscription
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
| `register` | `node register.js` | Bulk overwrite des 3 commandes globales |
| `test` | `vitest run` | 11 tests (8 M1 : dates + archivage, 3 `InstallGlobalCommands`) |

### C. Événements discord.js utilisés

| Événement | Intent requis | Usage |
|---|---|---|
| `clientReady` | `Guilds` | Inscription commandes, `login` |
| `interactionCreate` | `Guilds` | `/test`, `/create_channel`, `/archive` |
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
- (fix §6.2, 18/10) — **Catégories réellement créées** :
  `ChannelType.GUILD_CATEGORY` (undefined) → `ChannelType.GuildCategory` (4) ;
  migration (renommage `[ancien] <cat>` + création de la vraie catégorie) ;
  garde-fou type/id + logs détaillés avant déplacement.
- Machine du bot (Ubuntu, `/home/ubuntu/botCoqAlphaLBJ`) : installation
  `npm@12.2.0` globale (OOM résolé, 2 GiB RAM).
- (ajout `/archive`, 18/10/2026) — **Consolidation des salons révolus** :
  commande `/archive` (app.js, `commands.js`, `utils.js` : `parseChannelDate`,
  `getBilanNameForDate`, `getMonthNameFr`). Déplace les salons `mois-jour`
  dont le mois est antérieur au mois courant vers une catégorie `archive`,
  et crée/met à jour un canal `bilan-<mois>-<année>` par mois archivé
  (synthèse du dernier message de chaque salon, via `getLastMessage`). 4
  tests ajoutés dans `tests/utils.test.js`.
- (fix §6.4, 18/10/2026) — **Description `/archive` trop longue** (commit
  `8810aae`) : 130 chars > limite Discord (100) → 400 (code 50035) à
  `npm run register` ; raccourcie à 82 chars ; `InstallGlobalCommands`
  pré-valide désormais name ≤ 32 et description ≤ 100 avec un message clair ;
  `register.js` sort 1 en cas d'échec ; 3 tests ajoutés (fetch stubbed).
