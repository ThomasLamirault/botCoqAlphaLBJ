import { describe, it, expect, vi } from 'vitest';
import {
  getOpenDatesForCurrentAndNextMonth,
  getCategoryNameForDate,
  formatDateChannelName,
  parseChannelDate,
  getBilanNameForDate,
  getMonthNameFr,
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
});
