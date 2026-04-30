// Pure helper: build CSV string and trigger browser download.
// Avoids pulling in papaparse since the cases here are simple.

const escape = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n;]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
};

export const buildCSV = <T extends Record<string, unknown>>(
  rows: T[],
  columns: { key: keyof T; label: string }[],
): string => {
  const header = columns.map((c) => escape(c.label)).join(";");
  const body = rows.map((row) => columns.map((c) => escape(row[c.key])).join(";")).join("\n");
  // BOM so Excel opens UTF-8 correctly
  return "﻿" + header + "\n" + body;
};

export const downloadCSV = (content: string, filename: string) => {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
