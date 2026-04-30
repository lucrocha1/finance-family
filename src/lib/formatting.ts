// Single instance of currency/number formatters reused across the app.

export const ptCurrency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export const ptNumber = new Intl.NumberFormat("pt-BR");

// Compact representation: "R$ 1,3 mil" instead of "R$ 1.300,00" — used in
// chart labels and tight spaces.
export const formatCompactBRL = (value: number) => {
  if (Math.abs(value) >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1).replace(".", ",")} mi`;
  if (Math.abs(value) >= 1_000) return `R$ ${(value / 1_000).toFixed(1).replace(".", ",")} mil`;
  return ptCurrency.format(value);
};

// Convert R$ 1.234,56 ↔ raw cents string used in form inputs.
export const moneyValueToDigits = (value: number) => String(Math.round(value * 100));
export const moneyDigitsToValue = (digits: string) => Number(digits || "0") / 100;
