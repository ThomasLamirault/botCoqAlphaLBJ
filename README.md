# 🐓 Bot Discord CoqAlpha LBJ

Bienvenue sur le dépôt officiel du bot Discord dédié au club **Coq Alpha LBJ**. Ce bot gère l'automatisation des salons pour les séances du club.

## ✨ Fonctionnalités

### 🗓 Automatisation des Salons (Channel Creator)
Le bot calcule automatiquement les dates d'ouverture du club pour le mois en cours et le suivant.
- Création automatique des channels : `août-x`, `septembre-y`, etc.
- Synchronisation hebdomadaire (Lundi & Dimanche).
- Permission par défaut : Visible/Envoyer des messages pour tout le monde (#everyone).

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
- **`commands.js`** : Déclaration (source unique) des commandes globales (`ALL_COMMANDS`) : `/test` + `/create_channel`.
- **`register.js`** : Installation des commandes globales (`npm run register` — bulk overwrite).

## ⚡ Commandes Bot

| Commande | Description | Permission |
|----------|-------------|------------|
| `/test` | Vérifie que le bot écoute bien les événements. | Tous |
| `/create_channel` | Déclenche la génération des channels du mois. | Admin/Modérateur |

---
*Ce projet est sous licence MIT. Inspiré par [discord/getting-started] mais adapté pour l'usage local.*
