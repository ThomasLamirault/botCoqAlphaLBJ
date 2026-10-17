import { describe, it, expect } from 'vitest';
import {
  getOpenDatesForCurrentAndNextMonth,
  getCategoryNameForDate,
  formatDateChannelName,
} from '../utils.js';

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

});
