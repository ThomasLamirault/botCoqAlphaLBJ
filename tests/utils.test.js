import { describe, it, expect, vi } from 'vitest';
import { ChannelType, GuildChannelManager, PermissionFlagsBits, Role } from 'discord.js';
import {
  getOpenDatesForCurrentAndNextMonth,
  getCategoryNameForDate,
  formatDateChannelName,
  parseChannelDate,
  getBilanNameForDate,
  getMonthNameFr,
  buildBilanMessages,
  buildSessionChannelCreateOptions,
  buildBilanChannelCreateOptions,
  InstallGlobalCommands,
} from '../utils.js';
import { ALL_COMMANDS } from '../commands.js';

describe('Tests utilitaires', () => {
  // Test de la logique de dates (création des channels)
  it('doit retourner les dates des dimanches et lunis du mois courant + suivant', () => {
    // On simule une date au milieu d'août 2023 pour un contexte stable
    const mockDate = new Date(2023, 7, 15); // 15 août 2023

    const dates = getOpenDatesForCurrentAndNextMonth(mockDate);

    expect(Array.isArray(dates)).toBe(true);
    // août 2023 : 4 dim + 4 lun, septembre 2023 : 4 dim + 4 lun
    expect(dates.length).toBe(16);

    for (const date of dates) {
      expect([0, 1].includes(date.getDay())).toBe(true); // uniquement dimanche ou lundi
      expect(date.getFullYear()).toBe(2023);
      expect([7, 8].includes(date.getMonth())).toBe(true); // août ou septembre
    }
  });

  it('doit gérer le passage à l\'année suivante (décembre 2026 → janvier 2027)', () => {
    const dates = getOpenDatesForCurrentAndNextMonth(new Date(2026, 11, 15));

    // déc 2026 : 4 dim + 4 lun, janv 2027 : 5 dim + 4 lun
    expect(dates.length).toBe(17);
    expect(dates.some(d => d.getFullYear() === 2027)).toBe(true);
    expect(dates.some(d => d.getMonth() === 0)).toBe(true); // janvier
    for (const date of dates) {
      expect([0, 1].includes(date.getDay())).toBe(true);
    }
  });

  // Test du nommage des catégories
  it('doit retourner le bon nom de catégorie selon le jour et l\'année', () => {
    expect(getCategoryNameForDate(new Date(2026, 11, 6))).toBe('Les DIMANCHE LBJ 2026'); // 6 déc 2026 = dimanche
    expect(getCategoryNameForDate(new Date(2026, 11, 7))).toBe('Les LUNDI LBJ 2026'); // 7 déc 2026 = lundi
    expect(getCategoryNameForDate(new Date(2027, 0, 3))).toBe('Les DIMANCHE LBJ 2027'); // 3 jan 2027 = dimanche
    expect(getCategoryNameForDate(new Date(2027, 0, 4))).toBe('Les LUNDI LBJ 2027'); // 4 jan 2027 = lundi
  });

  // Test de formatage de chaîne (sans accents)
  it('doit retirer les accents pour le nommage des channels', () => {
    const dateAoût = new Date(2023, 7, 15);
    expect(formatDateChannelName(dateAoût)).toBe('aout-15');

    const dateFévrier = new Date(2024, 1, 1);
    expect(formatDateChannelName(dateFévrier)).toBe('fevrier-1');
  });

  // ─── Tests de l'archivage (/archive) ─────────────────────────────────────

  it('doit parser le nom d\'un canal « mois-jour » en Date (année déduite)', () => {
    const now = new Date(2026, 9, 19); // 19 octobre 2026

    // sept-30 : la plus récente année <= 2026 où le 30 sept. est dim/lun = 2024.
    const d = parseChannelDate('septembre-30', now);
    expect(d).not.toBeNull();
    expect(d.getMonth()).toBe(8); // septembre
    expect(d.getDate()).toBe(30);

    // nov-1 : 2026-11-01 est un dimanche (mois suivant) -> année 2026.
    const d2 = parseChannelDate('novembre-1', new Date(2026, 10, 19));
    expect(d2).not.toBeNull();
    expect(d2.getMonth()).toBe(10); // novembre
    expect(d2.getDate()).toBe(1);
    expect(d2.getFullYear()).toBe(2026);
  });

  it('doit retourner null pour les noms qui ne correspondent à aucun salon', () => {
    const now = new Date(2026, 9, 19);
    expect(parseChannelDate('salon', now)).toBeNull();
    expect(parseChannelDate('invalid-99', now)).toBeNull();
    expect(parseChannelDate('janvier-42', now)).toBeNull();
    expect(parseChannelDate('septembre-00', now)).toBeNull();
    // date inexistante (30 février)
    expect(parseChannelDate('fevrier-30', now)).toBeNull();
    // canal déjà archivé (préfixe [ancien])
    expect(parseChannelDate('[ancien] Les DIMANCHE LBJ 2026', now)).toBeNull();
    // suffixe non numérique
    expect(parseChannelDate('janvier-15a', now)).toBeNull();
  });

  it('doit accepter un appel à parseChannelDate sans paramètre now (valeur par défaut)', () => {
    const d = parseChannelDate('septembre-30');
    expect(d).toBeInstanceOf(Date);
    expect([0, 1]).toContain(d.getDay());
  });

  it('ne doit pas déduire une année future hors fenêtre lors du passage d\'année', () => {
    // En janvier 2027, « decembre-6 » correspond au 6 déc. 2026 (dimanche),
    // pas au 6 déc. 2027 (lundi, 11 mois dans le futur).
    const dec = parseChannelDate('decembre-6', new Date(2027, 0, 15));
    expect(dec).not.toBeNull();
    expect(dec.getFullYear()).toBe(2026);
    expect(dec.getMonth()).toBe(11);
    expect(dec.getDate()).toBe(6);

    // En décembre 2026, « janvier-4 » correspond bien au 4 janv. 2027 (mois suivant).
    const jan = parseChannelDate('janvier-4', new Date(2026, 11, 15));
    expect(jan).not.toBeNull();
    expect(jan.getFullYear()).toBe(2027);
    expect(jan.getMonth()).toBe(0);
    expect(jan.getDate()).toBe(4);
  });

  it('doit formater les messages de bilan (liens, messages vides, pièces jointes)', () => {
    const msgs = buildBilanMessages(new Date(2026, 8, 1), [
      { channelName: 'septembre-6', content: 'Voir https://example.com/test\nsuper séance !' },
      { channelName: 'septembre-7', content: '   \n  ' },
      { channelName: 'septembre-13', content: '', hasAttachments: true },
      { channelName: 'septembre-14', content: null, hasEmbeds: true },
    ]);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain('septembre 2026');
    expect(msgs[0]).toContain('• septembre-6 → Voir [lien] super séance !');
    expect(msgs[0]).toContain('• septembre-7 → (message vide)');
    expect(msgs[0]).toContain('• septembre-13 → (pièce jointe)');
    expect(msgs[0]).toContain('• septembre-14 → (embed)');
  });

  it('doit découper un bilan trop long en plusieurs messages <= 2000 caractères', () => {
    const entries = Array.from({ length: 8 }, (_, i) => ({
      channelName: `septembre-${i + 1}`,
      content: 'a'.repeat(500),
    }));
    const msgs = buildBilanMessages(new Date(2026, 8, 1), entries);
    expect(msgs.length).toBeGreaterThan(1);
    for (const msg of msgs) {
      expect(msg.length).toBeLessThanOrEqual(2000);
    }
    expect(msgs.join('\n')).toContain('septembre-1');
    expect(msgs.join('\n')).toContain('septembre-8');
  });

  it('doit trier les entrées du bilan par ordre chronologique quand date est fournie', () => {
    const msgs = buildBilanMessages(new Date(2026, 9, 1), [
      { channelName: 'octobre-19', date: new Date(2026, 9, 19), content: 'Séance 4' },
      { channelName: 'octobre-4', date: new Date(2026, 9, 4), content: 'Séance 1' },
      { channelName: 'octobre-12', date: new Date(2026, 9, 12), content: 'Séance 3' },
      { channelName: 'octobre-5', date: new Date(2026, 9, 5), content: 'Séance 2' },
    ]);
    expect(msgs).toHaveLength(1);
    const body = msgs[0];
    expect(body.indexOf('octobre-4')).toBeLessThan(body.indexOf('octobre-5'));
    expect(body.indexOf('octobre-5')).toBeLessThan(body.indexOf('octobre-12'));
    expect(body.indexOf('octobre-12')).toBeLessThan(body.indexOf('octobre-19'));
  });

  it('doit produire le bon nom de canal de bilan (mois sans accent)', () => {
    expect(getBilanNameForDate(new Date(2026, 8, 30))).toBe('bilan-septembre-2026');
    expect(getBilanNameForDate(new Date(2026, 11, 3))).toBe('bilan-decembre-2026');
    expect(getBilanNameForDate(new Date(2026, 7, 19))).toBe('bilan-aout-2026');
    expect(getBilanNameForDate(new Date(2024, 1, 1))).toBe('bilan-fevrier-2024');
  });

  it('doit retourner le nom du mois avec accents (pour le contenu)', () => {
    expect(getMonthNameFr(new Date(2026, 8, 30))).toBe('septembre');
    expect(getMonthNameFr(new Date(2026, 11, 3))).toBe('décembre');
    expect(getMonthNameFr(new Date(2024, 1, 1))).toBe('février');
    expect(getMonthNameFr(new Date(2027, 0, 3))).toBe('janvier');
  });

  // ─── Tests de l'inscription des commandes (npm run register) ────────────────

  it('doit refuser une description > 100 caractères (limite Discord, 400 50035)', async () => {
    const bad = [
      { name: 'test', description: 'ok', type: 1, integration_types: [0, 1], contexts: [0, 1, 2] },
      { name: 'archive', description: 'x'.repeat(101), type: 1, integration_types: [0, 1], contexts: [0, 1, 2] },
    ];
    await expect(InstallGlobalCommands('1234567890', bad)).rejects.toThrow(
      /description trop longue \(101 > 100\)/
    );
  });

  it('doit refuser un nom de commande > 32 caractères', async () => {
    const bad = [
      { name: 'a'.repeat(33), description: 'ok', type: 1, integration_types: [0, 1], contexts: [0, 1, 2] },
    ];
    await expect(InstallGlobalCommands('1234567890', bad)).rejects.toThrow(
      /name trop long \(33 > 32\)/
    );
  });

  it('doit envoyer le bulk overwrite quand les commandes sont valides (fetch intercepté)', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await InstallGlobalCommands('1234567890', ALL_COMMANDS);
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe('https://discord.com/api/v10/applications/1234567890/commands');
      expect(opts.method).toBe('PUT');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('doit restreindre /create_channel et /archive au serveur avec la permission ManageChannels', () => {
    const restricted = ALL_COMMANDS.filter((c) => ['create_channel', 'archive'].includes(c.name));
    expect(restricted).toHaveLength(2);
    for (const cmd of restricted) {
      expect(cmd.default_member_permissions).toBe(PermissionFlagsBits.ManageChannels.toString());
      expect(cmd.contexts).toEqual([0]);
      expect(cmd.integration_types).toEqual([0]);
    }
  });

  // ─── Tests de régression discord.js v14 (parent_id envoyé au REST) ──────────

  it('doit transmettre parent_id à l\'API REST Discord lors de la création d\'un salon de séance', async () => {
    const postMock = vi.fn(async (_route, { body }) => ({ id: 'chan-1', ...body }));
    const fakeRole = Object.assign(Object.create(Role.prototype), { id: 'guild-1' });
    const fakeManager = {
      guild: {
        id: 'guild-1',
        roles: { resolve: (id) => (id === 'guild-1' ? fakeRole : null) },
        client: { users: { resolve: () => null } },
      },
      client: {
        channels: { resolveId: (ch) => (typeof ch === 'string' ? ch : ch.id) },
        rest: { post: postMock },
        actions: { ChannelCreate: { handle: (data) => ({ channel: data }) } },
      },
    };

    const options = buildSessionChannelCreateOptions({
      name: 'novembre-22',
      parentId: 'cat-dimanche-2026',
      everyoneRoleId: 'guild-1',
    });
    await GuildChannelManager.prototype.create.call(fakeManager, options);

    expect(postMock).toHaveBeenCalledTimes(1);
    const [, { body }] = postMock.mock.calls[0];
    expect(body.name).toBe('novembre-22');
    expect(body.type).toBe(ChannelType.GuildText);
    expect(body.parent_id).toBe('cat-dimanche-2026');
  });

  it('doit transmettre parent_id à l\'API REST Discord lors de la création d\'un canal de bilan sous archive', async () => {
    const postMock = vi.fn(async (_route, { body }) => ({ id: 'chan-2', ...body }));
    const fakeManager = {
      guild: { id: 'guild-1' },
      client: {
        channels: { resolveId: (ch) => (typeof ch === 'string' ? ch : ch.id) },
        rest: { post: postMock },
        actions: { ChannelCreate: { handle: (data) => ({ channel: data }) } },
      },
    };

    const options = buildBilanChannelCreateOptions({
      name: 'bilan-octobre-2026',
      parentId: 'cat-archive',
    });
    await GuildChannelManager.prototype.create.call(fakeManager, options);

    expect(postMock).toHaveBeenCalledTimes(1);
    const [, { body }] = postMock.mock.calls[0];
    expect(body.name).toBe('bilan-octobre-2026');
    expect(body.type).toBe(ChannelType.GuildText);
    expect(body.parent_id).toBe('cat-archive');
  });
});
