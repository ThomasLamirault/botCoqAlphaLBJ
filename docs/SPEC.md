# SPEC — Bot Discord « CoqAlpha LBJ »

> **Format** : spécification fonctionnelle et technique reconstruite depuis le code actuel (`HEAD`), présentée comme le **compte-rendu final d'une session `/grill-me`** (arbre de décisions intégralement parcouru, frontière vide, aucune hypothèse implicite).
> **Périmètre couvert** : [app.js](../app.js), [commands.js](../commands.js), [utils.js](../utils.js), [register.js](../register.js), [tests/utils.test.js](../tests/utils.test.js).

---

## 1. Arbre de décisions (Design Tree)

```text
Bot CoqAlpha LBJ
├── 1. Modèle d'exécution & environnement
│   ├── D1.1 Mission produit (gestion des salons de séances du club)
│   ├── D1.2 Transport Discord (Gateway direct discord.js, sans webhook)
│   ├── D1.3 Intents & prérequis portail (Guilds + Message Content REST)
│   └── D1.4 Runtime & configuration (.env, Node >= 18 ESM)
├── 2. Commandes slash & contrôle d'accès
│   ├── D2.1 Source unique & bulk overwrite global
│   ├── D2.2 Pré-validation des limites Discord
│   ├── D2.3 Catalogue des 3 commandes (/test, /create_channel, /archive)
│   └── D2.4 Défense en profondeur (contexte serveur + ManageChannels)
├── 3. Règles métier calendrier (domaine pur)
│   ├── D3.1 Jours ouverts (dimanche + lundi)
│   ├── D3.2 Fenêtre active (mois courant + mois suivant, passage d'année)
│   ├── D3.3 Nommage des salons (<mois>-<jour>)
│   ├── D3.4 Nommage des catégories (Les {DIMANCHE|LUNDI} LBJ <année>)
│   └── D3.5 Parsing inverse & déduction d'année (parseChannelDate)
├── 4. Commande /create_channel
│   ├── D4.1 Réponse différée publique (anti-timeout 3 s)
│   ├── D4.2 Résolution & migration d'anciennes catégories texte ([ancien])
│   ├── D4.3 Cycle de vie idempotent des salons (créer / déplacer / no-op)
│   └── D4.4 Isolation des erreurs & format du récapitulatif
├── 5. Commande /archive
│   ├── D5.1 Catégorie cible « archive » (création en bas de liste)
│   ├── D5.2 Critère d'éligibilité des salons révolus (hors « archive »)
│   ├── D5.3 Lecture REST sécurisée du dernier message (distinction vide vs erreur)
│   ├── D5.4 Publication préalable du bilan mensuel trié (≤ 2000 chars) sous « archive »
│   └── D5.5 Suppression post-bilan des salons révolus & conservation des catégories
├── 6. Gestion d'erreurs & observabilité
│   ├── D6.1 Catch global (réponse différée vs immédiate)
│   └── D6.2 Journalisation opérationnelle
└── 7. Vérification & hors-périmètre explicite
    ├── D7.1 Contrat de tests unitaires (vitest)
    └── D7.2 Non-goals assumés
```

---

## 2. Décisions tranchées par branche

### Branche 1 — Modèle d'exécution & environnement

#### D1.1 — Mission produit
- **Décision** : Automatiser sur un serveur Discord la création, le classement et l'archivage des salons hebdomadaires du club **CoqAlpha LBJ**, ainsi que la génération d'un canal de synthèse mensuel lors de l'archivage.
- **Critère d'acceptation** : Deux opérations métier manuelles (`/create_channel`, `/archive`) + une commande de diagnostic (`/test`).

#### D1.2 — Transport Discord
- **Décision** : Bot connecté directement au Gateway Discord via `discord.js` (`v14`), sans serveur HTTP entrant ni tunnel externe (pas de webhook Interactions Endpoint).
- **Justification** : Déploiement local / VPS léger sans exposition de port public ni gestion de signature PEM.

#### D1.3 — Intents & prérequis portail Discord
- **Décision** : Le client Gateway ne demande que `GatewayIntentBits.Guilds`. Il ne demande **pas** `GuildMessages` ni l'intent privilégié `MessageContent` côté Gateway.
- **Contrainte d'exploitation** : La lecture du dernier message lors de `/archive` passe par un appel REST (`channel.messages.fetch({ limit: 1, cache: false })`). Le toggle **Message Content Intent** doit être activé sur le portail Discord Developer si l'on souhaite lire le texte des messages postés par des utilisateurs non-bot (sinon Discord renvoie une chaîne vide).

#### D1.4 — Runtime & configuration
- **Décision** : Node.js `>= 18` en modules ES (`"type": "module"`), configuration chargée via `dotenv/config` depuis `.env` (non versionné).
- **Variables** :
  - `DISCORD_TOKEN` : obligatoire pour le runtime (`app.js`) et les requêtes API (`utils.js`).
  - `APP_ID` : obligatoire pour le script `npm run register` (`register.js`). Non utilisé par `app.js` qui lit `client.user.id`.

---

### Branche 2 — Commandes slash & contrôle d'accès

#### D2.1 — Source unique & enregistrement bulk overwrite
- **Décision** : Toutes les commandes sont définies dans un unique tableau `ALL_COMMANDS` ([commands.js](../commands.js)).
- **Points d'entrée** :
  1. Automatique au démarrage (`client.once('clientReady')` → `InstallGlobalCommands(client.user.id, ALL_COMMANDS)`).
  2. Manuel sans démarrer le bot (`npm run register` → `InstallGlobalCommands(process.env.APP_ID, ALL_COMMANDS)`).
- **Contrat API** : `PUT https://discord.com/api/v10/applications/{appId}/commands` (remplacement global exhaustif). Aucun écart possible entre les deux points d'entrée.

#### D2.2 — Pré-validation des limites Discord
- **Décision** : Avant d'appeler l'API Discord, `InstallGlobalCommands` vérifie pour chaque commande :
  - `name.length <= 32`
  - `description.length <= 100`
- **Comportement en échec** : Lève une `Error` explicite indiquant l'index, le nom et la longueur fautive. `register.js` journalise l'erreur et quitte avec le code `1`.

#### D2.3 — Catalogue des commandes
| Commande | Type | Contextes autorisés | Types d'intégration | Permission Discord par défaut |
|---|---|---|---|---|
| `/test` | ChatInput (`1`) | Serveur, DM bot, DM privé (`[0, 1, 2]`) | Guild & User (`[0, 1]`) | Aucune (tous) |
| `/create_channel` | ChatInput (`1`) | Serveur uniquement (`[0]`) | Guild uniquement (`[0]`) | `ManageChannels` (`16`) |
| `/archive` | ChatInput (`1`) | Serveur uniquement (`[0]`) | Guild uniquement (`[0]`) | `ManageChannels` (`16`) |

#### D2.4 — Défense en profondeur au runtime
- **Décision** : En plus des métadonnées Discord, `/create_channel` et `/archive` vérifient explicitement **avant** `deferReply()` :
  1. `interaction.guild` est défini → sinon réponse éphémère (`flags: 64`) : `❌ Cette commande doit être utilisée dans un serveur.`
  2. `interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)` → sinon réponse éphémère (`flags: 64`) : `❌ Permission requise : gérer les salons (Administrateur ou Modérateur).`
- **Effet** : Un utilisateur administrateur passe automatiquement (Discord inclut toutes les permissions dans `Administrator`).

---

### Branche 3 — Règles métier calendrier (domaine pur)

#### D3.1 — Jours d'ouverture du club
- **Décision** : Le club ouvre uniquement les **dimanches** (`day === 0`) et **lundis** (`day === 1`). Aucun autre jour de la semaine n'est géré.

#### D3.2 — Fenêtre active
- **Décision** : `getOpenDatesForCurrentAndNextMonth(currentDate = new Date())` retourne tous les dimanches et lundis du **mois courant** et du **mois suivant** (typiquement 16 à 18 dates).
- **Cas limite tranché** : Passage d'année (`décembre N` → `janvier N+1`) géré nativement via le débordement de `new Date(year, month + 1, 1)` et la comparaison `date.getMonth() === targetMonth % 12`.

#### D3.3 — Nommage des salons
- **Décision** : `formatDateChannelName(date)` produit `<mois-fr-sans-accent-minuscule>-<jour>` (normalisation Unicode NFD, suppression des diacritiques, minuscules, jour sans zéro initial).
- **Exemples** : `aout-15`, `fevrier-1`, `decembre-6`, `janvier-4`.

#### D3.4 — Nommage des catégories
- **Décision** : `getCategoryNameForDate(date)` produit :
  - Dimanche → `Les DIMANCHE LBJ <année>`
  - Lundi → `Les LUNDI LBJ <année>`
- **Règle d'année** : `<année>` est toujours l'année de la **date du salon**, pas celle de la date d'exécution (en décembre 2026, les séances de janvier 2027 vont dans `Les DIMANCHE/LUNDI LBJ 2027`).

#### D3.5 — Parsing inverse & déduction d'année (`parseChannelDate`)
- **Décision** : `parseChannelDate(channelName, now = new Date())` reconnaît un salon généré par le bot et retrouve sa `Date` complète bien que l'année soit absente du nom.
- **Validation stricte** :
  - Retourne `null` si `channelName` n'est pas une chaîne, ne comporte pas exactement 2 segments séparés par `-`, si le mois n'est pas dans les 12 mois FR sans accent, si le jour ne matche pas `/^\d{1,2}$/` ou est hors `1..31`, ou si la date calendaire n'existe pas (ex. `fevrier-30`).
- **Résolution d'année** :
  - Borne supérieure `maxDate` = dernier jour du mois suivant par rapport à `now` (`new Date(now.getFullYear(), now.getMonth() + 2, 0)`).
  - Balayage descendant sur 11 années (`startYear` à `startYear - 10`, avec `startYear = maxDate.getFullYear()`).
  - Retourne la première date `<= maxDate` qui existe réellement et tombe un dimanche ou un lundi ; sinon `null`.
- **Cas limites tranchés** :
  - En janvier 2027, `decembre-6` résout vers `2026-12-06` (et jamais `2027-12-06`, bien que ce soit un lundi futur).
  - En décembre 2026, `janvier-4` résout vers `2027-01-04` (mois suivant dans la fenêtre active).

---

### Branche 4 — Commande `/create_channel`

#### D4.1 — Stratégie de réponse
- **Décision** : Après les gardes-fous (D2.4), appelle `await interaction.deferReply()` (réponse publique) pour éviter le timeout Discord de 3 secondes, puis publie le résultat via `editReply()`.

#### D4.2 — Résolution et migration des catégories
- **Décision** : Pour chaque date de la fenêtre active, recherche une catégorie existante (`type === GuildCategory && name === categoryName`).
- **Migration héritée (sans perte de données)** : Si aucune catégorie n'existe mais qu'un canal texte (`GuildText`) porte exactement `categoryName` (vestige d'un ancien bug `ChannelType.GUILD_CATEGORY`), le bot le **renomme** en `[ancien] <categoryName>` (ou `[ancien] <categoryName> 2`, `3`… en cas de collision), puis crée la vraie `GuildCategory`. Le canal existant n'est jamais supprimé.

#### D4.3 — Idempotence par salon
- **Décision** : Recherche d'un salon existant dans le cache par nom (`ch.name === dateName`).
  1. **Absent** : création d'un `GuildText` sous `parentId = category.id` avec `permissionOverwrites` accordant `ViewChannel` et `SendMessages` au rôle `@everyone`. Incrémente `createdCount`.
  2. **Présent hors catégorie (`parentId !== category.id`)** : garde-fou vérifiant `category?.type === GuildCategory`, puis déplacement via `guild.channels.edit(channel, { parent: category, reason })`. Incrémente `movedCount`.
  3. **Présent dans la bonne catégorie** : aucune action (no-op).
- **Propriété** : Relancer `/create_channel` immédiatement après un succès produit `0` création et `0` déplacement.

#### D4.4 — Isolation d'erreur & récapitulatif
- **Décision** :
  - L'échec de création d'une catégorie saute uniquement cette date (`continue`).
  - L'échec de création ou de déplacement d'un salon est journalisé avec contexte (IDs, types, `parentId`) sans interrompre les autres dates.
  - Message final :
    - Si `createdCount > 0` et/ou `movedCount > 0` : `✅ **X** nouveau(s) salon(s) créé(s) et **Y** salon(s) déplacé(s) dans la bonne catégorie !` (en omettant les compteurs nuls).
    - Sinon : `ℹ️ Tous les salons existent déjà, et sont dans les bonnes catégories.`

---

### Branche 5 — Commande `/archive`

#### D5.1 — Catégorie cible `archive`
- **Décision** : Recherche une `GuildCategory` nommée exactement `archive`. Seuls les canaux de synthèse `#bilan-<mois>-<année>` sont placés sous cette catégorie.
- **Création** : Si absente, créée en dernière position (`position: Math.max(0, ...positions) + 1`).
- **Erreur bloquante** : Si la création échoue ou si la cible trouvée n'est pas de type `GuildCategory`, la commande s'arrête immédiatement et répond `❌ ...` via `editReply()`.

#### D5.2 — Critère d'éligibilité à l'archivage
- **Décision** : Un salon du serveur est sélectionné pour archivage si et seulement si **toutes** ces conditions sont réunies :
  1. `ch.type === ChannelType.GuildText`
  2. `ch.parentId !== archiveId` (la catégorie `archive` est ignorée : ni les `#bilan-*` ni d'éventuels salons déjà dans `archive` ne sont touchés)
  3. `date = parseChannelDate(ch.name, now)` est non nul (c'est un salon de séance du bot ; exclut donc les salons génériques, les `bilan-*`, les `[ancien] *`, etc.)
  4. `(date.getFullYear(), date.getMonth(), date.getDate())` **n'appartient pas** à `getOpenDatesForCurrentAndNextMonth(now)`.
- **Cas vide** : Si aucun salon n'est éligible → `✅ Rien à archiver : tous les salons ouverts sont déjà en place.`

#### D5.3 — Lecture REST sécurisée du dernier message
- **Décision** : Avant toute suppression, `getLastMessage(channel)` lit le dernier message via REST sans cache (`channel.messages.fetch({ limit: 1, cache: false })`) et distingue explicitement :
  - **Canal légitimement vide** : `{ ok: true, message: null }` → inclus dans le bilan comme `(message vide)` et éligible à la suppression.
  - **Erreur de lecture API / permission** : `{ ok: false, message: null }` → loggé en `console.warn`, **exclu du bilan et conservé** (jamais supprimé) afin d'éviter toute perte de données.
- **Groupement** : Les salons lus avec succès sont regroupés par `bilanName = getBilanNameForDate(date)` (`bilan-<mois-sans-accent>-<année>`). Si tous les salons éligibles ont échoué en lecture → `❌ Impossible de lire les salons révolus (...) : aucun bilan publié et aucun salon supprimé.`

#### D5.4 — Publication préalable du bilan mensuel trié (`buildBilanMessages`)
- **Décision** : Pour chaque mois archivé (traité dans l'ordre chronologique) :
  - Les entrées du mois sont **triées par ordre chronologique croissant** (`date` croissante, ex. `octobre-4`, `octobre-5`, `octobre-11`, `octobre-12`…).
  - Le canal texte `bilan-<mois-sans-accent>-<année>` est recherché sous `archive` (réutilisé s'il existe déjà, créé sinon avec permissions héritées).
  - **Nettoyage par salon** (`• <nom-salon> → <extrait>`) :
    - URLs `http(s)://...` remplacées par `[lien]`.
    - Retours à la ligne remplacés par un espace, `trim()`, troncature à **500 caractères**.
    - Si texte résultant vide : `(pièce jointe)` si le message comporte des attachments, `(embed)` s'il comporte des embeds, sinon `(message vide)`.
  - **En-tête** :
    ```text
    📊 **Bilan des salons archivés — <mois FR avec accents> <année>**
    (_<N> salon(s) archivé(s)_)
    ```
  - **Limite Discord (2000 caractères)** : `buildBilanMessages` découpe automatiquement en plusieurs messages `<= 2000` caractères, envoyés séquentiellement dans `bilanChannel` (comportement cumulatif si le canal existe déjà).
  - **Garde-fou anti-perte** : Si la création du canal bilan ou l'envoi d'un des messages échoue, le bot journalise l'erreur et passe au mois suivant **sans supprimer aucun salon de ce mois**.

#### D5.5 — Suppression post-bilan des salons révolus & conservation des catégories
- **Décision** : Une fois — et **uniquement** une fois — le bilan du mois publié avec succès dans `#bilan-<mois>-<année>` :
  - Chaque salon de ce mois (ex. `#octobre-4`) est **supprimé** via `guild.channels.delete(channel, reason)` (erreur isolée par salon).
  - Les catégories de séances (`Les DIMANCHE LBJ <année>`, `Les LUNDI LBJ <année>`) sont **conservées** même si tous leurs salons ont été supprimés.
- **Récapitulatif final** :
  ```text
  ✅ Archivage terminé :
  • **<Y>** canal(s) de bilan publié(s) dans « archive »
  • **<X>** salon(s) révolu(s) supprimé(s)
  ```
  *(complété le cas échéant par les compteurs d'avertissement `⚠️` si des lectures ou suppressions ont échoué).*

---

### Branche 6 — Gestion globale des erreurs & observabilité

#### D6.1 — Filet de sécurité `interactionCreate`
- **Décision** : Toute exception non interceptée dans le handler est catchée globalement :
  - Journalisation via `console.error(error)`.
  - Si `interaction.deferred && !interaction.replied` → `editReply({ content: '❌ Une erreur interne est survenue.' })` (évite l'état bloqué *« réfléchit… »*).
  - Sinon si `!interaction.replied` → `reply({ content: '❌ Une erreur interne est survenue.', flags: 64 })`.
  - L'envoi de la réponse d'erreur est lui-même protégé par un `try/catch` pour éviter tout rejet non géré.

#### D6.2 — Observabilité
- **Décision** : Journalisation console (`console.log` / `console.warn` / `console.error`) retraçant démarrage, nombre de commandes enregistrées, chaque création/renommage/déplacement/bilan/suppression avec noms et IDs Discord.

---

### Branche 7 — Vérification & hors-périmètre explicite

#### D7.1 — Contrat de tests unitaires
- **Décision** : Suite `vitest` (`npm test`) dans [tests/utils.test.js](../tests/utils.test.js) couvrant **17 cas** sans accès réseau ni serveur Discord :
  - Moteur calendrier : fenêtres courante/suivante, passage d'année, nommage catégories et salons sans accent.
  - Archivage & bilans : `parseChannelDate` (cas valides, invalides, `now` par défaut, passage d'année sans faux positif futur), `getBilanNameForDate`, `getMonthNameFr`, `buildBilanMessages` (nettoyage liens/vides/pièces jointes/embeds, découpage ≤ 2000 chars, tri chronologique).
  - Enregistrement & sécurité : pré-validation `name ≤ 32` et `description ≤ 100`, payload `PUT` bulk overwrite (`fetch` stubbed), restrictions serveur + `ManageChannels` sur `/create_channel` et `/archive`.

#### D7.2 — Hors-périmètre assumé (Non-goals)
- **Pas de déclenchement automatique (cron / scheduler)** : toutes les actions sont déclenchées manuellement par commande slash.
- **Pas de suppression des catégories ni des anciens canaux `[ancien]`** : seuls les salons de séances révolus dont le bilan a bien été publié sont supprimés ; les catégories vides restent en place.
- **Pas de base de données externe** : l'état du serveur Discord (noms des salons, catégories, dernier message) est l'unique source de vérité.
- **Pas de retry automatique** si l'inscription des commandes échoue au `clientReady`.
- **Pas de tests d'intégration/mock des handlers `app.js`** (logique Discord non encore extraite du handler).

---

## 3. Pistes ouvertes pour un prochain `/grill-me` (si évolution souhaitée)

Si tu souhaites faire évoluer le bot au-delà de la spec actuelle, voici les prochaines questions de frontière naturelles :
1. **Automatisation calendaire** : faut-il garder un déclenchement 100 % manuel ou planifier `/create_channel` et `/archive` en début de mois ?
2. **Permissions des canaux `#bilan-*`** : faut-il laisser les permissions héritées de la catégorie `archive`, ou verrouiller automatiquement les `#bilan-*` en lecture seule pour `@everyone` ?
3. **Extraction testable des handlers (`app.js`)** : faut-il extraire la logique métier de `/create_channel` et `/archive` derrière des fonctions injectables pour les couvrir par tests unitaires ?
