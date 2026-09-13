# 🐓 Bot Discord CoqAlpha LBJ

Bienvenue sur le dépôt officiel du bot Discord dédié au club **Coq Alpha LBJ**. Ce bot gère l'automatisation des salons pour les séances et propose des interactions ludiques (minigames) pour la communauté.

## ✨ Fonctionnalités

### 🗓 Automatisation des Salons (Channel Creator)
Le bot calcule automatiquement les dates d'ouverture du club pour le mois en cours et le suivant.
- Création automatique des channels : `août-x`, `septembre-y`, etc.
- Synchronisation hebdomadaire (Lundi & Dimanche).
- Permission par défaut : Visible/Envoyer des messages pour tout le monde (#everyone).

### 🎮 Minigame / Interactions
Le bot inclut une logique de jeu interactive (Pierre-Feuille-Ciseaux) adaptée au contexte, visible dans `game.js`.
Il supporte les composants Discord interactifs (sélecteurs, boutons).

## 🚀 Installation & Démarrage

Ce projet nécessite **Node.js >= 18** pour fonctionner.

### 1. Cloner le projet
```bash
git clone https://github.com/ThomasLamirault/botCoqAlphaLBJ.git
cd botCoqAlphaLBJ
```

### 2. Installer les dépendances
```bash
npm install
```

### 3. Configuration (Important)
Le bot a besoin de variables d'environnement pour s'authentifier. Créez un fichier `.env` à la racine :

| Clé | Description | Exemple |
|-----|-------------|---------|
| `DISCORD_TOKEN` | Le token secret de ton bot (Dashboard Discord) | `MTUyODgx...` |
| `APP_ID` | L'ID de l'application Discord | `152881639...` |
| `PUBLIC_KEY` | La clé publique du bot | `d0102b...` |

## 📂 Structure du code

- **`app.js`** : Le cœur du-bot. Gère le cycle de vie, la configuration des channels et les événements Discord (`clientReady`, `interactionCreate`).
- **`utils.js`** : Fonctions utilitaires pour la gestion des dates (`getOpenDays...`) et les requêtes API Discord.
- **`game.js`** : Logique pure du jeu (algorithme Pierre-Feuille-Ciseaux, verbes d'action, emojis).
- **`commands.js`** : Déclaration et installation des commandes globales auprès de l'API Discord.

## ⚡ Commandes Bot

| Commande | Description | Permission |
|----------|-------------|------------|
| `/test` | Vérifie que le bot écoute bien les événements. | Tous |
| `/create_channel` | Déclenche la génération des channels du mois. | Admin/Modérateur |

---
*Ce projet est sous licence MIT. Inspiré par [discord/getting-started] mais adapté pour l'usage local.*
