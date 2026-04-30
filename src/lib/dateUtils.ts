// Centralized date helpers used across pages. Keep this file pure (no
// React imports) so it can be used in non-component code (lib, edge
// functions adapters etc.) too.

export const startOfMonth = (base: Date) => new Date(base.getFullYear(), base.getMonth(), 1);
export const endOfMonth = (base: Date) => new Date(base.getFullYear(), base.getMonth() + 1, 0);

export const toISODate = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

export const todayIso = () => toISODate(new Date());

export const addDays = (iso: string, days: number) => {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toISODate(date);
};

export const addMonths = (iso: string, months: number) => {
  const date = new Date(`${iso}T00:00:00`);
  date.setMonth(date.getMonth() + months);
  return toISODate(date);
};

export const formatMonthYear = (date: Date) => date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
export const formatDateDDMM = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
export const formatDateDDMMYYYY = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
export const formatDateShort = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");

export const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export const startOfWeekMonday = (base: Date) => {
  const copy = new Date(base);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

export const endOfWeekSunday = (base: Date) => {
  const start = startOfWeekMonday(base);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
};
