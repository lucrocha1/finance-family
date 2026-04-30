// Character limits used across forms. Centralize so Zod schemas and
// HTML maxLength attributes stay in sync.

export const LIMITS = {
  description: 120,
  accountName: 80,
  cardName: 80,
  debtName: 120,
  goalName: 120,
  categoryName: 60,
  notes: 600,
  shortNote: 200,
  counterpartName: 100,
} as const;
