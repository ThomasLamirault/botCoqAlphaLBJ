import { describe, it, expect } from 'vitest';
import { getOpenDaysForCurrentAndNextMonth, formatDateChannelName, getRandomEmoji } from '../utils.js';

describe('Tests utilitaires', () => {
  // Test de la logique de dates (channel creation)
  it('doit générer des dates pour les dimanches et lundis du mois courant + suivant', () => {
    // On simule une date au milieu d'août 2023 pour avoir un contexte stable
    const mockDate = new Date(2023, 7, 15); // 15 Août 2023

    const dates = getOpenDaysForCurrentAndNextMonth(mockDate);

    // Vérification basique : on doit avoir des chaînes de format valide
    expect(Array.isArray(dates)).toBe(true);
    expect(dates.length).toBeGreaterThan(0);

    // Au moins une date doit contenir "aout" ou "septembre" (nom abrégé)
    const hasAoutOrSept = dates.some(d => d.startsWith('aout') || d.startsWith('sept'));
    expect(hasAoutOrSept).toBe(true);
  });

  // Test de formatage de chaîne (sans accents)
  it('doit retirer les accents pour le nommage des channels', () => {
    const dateAoût = new Date(2023, 7, 15);
    expect(formatDateChannelName(dateAoût)).toBe('aout-15');

    const dateFévrier = new Date(2024, 1, 1);
    expect(formatDateChannelName(dateFévrier)).toBe('fevrier-1');
  });

  // Test de la fonction getRandomEmoji
  it('doit retourner une chaine non vide', () => {
    const emoji = getRandomEmoji();
    expect(emoji.length).toBeGreaterThan(0);
  });
});
