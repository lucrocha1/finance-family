// Regra "sticky" de teto por mês, compartilhada entre orçamento de categoria e
// grupo de orçamento (Goals.tsx) e a Edge Function generate-notifications
// (que tem uma cópia IDÊNTICA em Deno — mantenha as duas em sincronia).
//
// O teto definido num (year, month) vale pros meses seguintes até um novo ser
// definido. pickSticky pega o registro vigente = o mais recente cujo
// (year*12+month) <= o mês visualizado. amount<=0 é marcador de FIM de vigência
// (sem teto), mas ainda "vence" a herança por ser o mais recente.

export type StickyRow = { amount: number; month: number; year: number };

export const pickSticky = <T extends StickyRow>(rows: T[], year: number, month: number): T | null => {
  const cap = year * 12 + month;
  let best: T | null = null;
  for (const r of rows) {
    const ord = r.year * 12 + r.month;
    if (ord > cap) continue;
    if (!best || ord > best.year * 12 + best.month) best = r;
  }
  return best;
};

// Teto ATIVO no mês (só quando amount > 0). Retorna null se não há teto vigente
// (nenhum registro <= mês, ou o vigente é marcador de fim de vigência amount=0).
export const activeStickyAmount = <T extends StickyRow>(rows: T[], year: number, month: number): number | null => {
  const row = pickSticky(rows, year, month);
  const amount = row ? Number(row.amount || 0) : 0;
  return amount > 0 ? amount : null;
};
