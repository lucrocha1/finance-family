import { useMemo } from "react";

import { useTheme } from "@/contexts/ThemeContext";

export type ChartColors = {
  income: string;
  expense: string;
  primary: string;
  primarySoft: string;
  grid: string;
  axis: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  warning: string;
  info: string;
};

const LIGHT: ChartColors = {
  income: "#10B981",
  expense: "#EF4444",
  primary: "#10B981",
  primarySoft: "rgba(16, 185, 129, 0.12)",
  grid: "#F0F1F3",
  axis: "#9CA3AF",
  tooltipBg: "#FFFFFF",
  tooltipBorder: "#E5E7EB",
  tooltipText: "#111827",
  warning: "#F59E0B",
  info: "#3B82F6",
};

const DARK: ChartColors = {
  income: "#10B981",
  expense: "#EF4444",
  primary: "#10B981",
  primarySoft: "rgba(16, 185, 129, 0.18)",
  grid: "#22252F",
  axis: "#8B8FA3",
  tooltipBg: "#1A1D27",
  tooltipBorder: "#2A2D3A",
  tooltipText: "#F0F1F3",
  warning: "#F59E0B",
  info: "#3B82F6",
};

export const useChartColors = (): ChartColors => {
  const { isDark } = useTheme();
  return useMemo(() => (isDark ? DARK : LIGHT), [isDark]);
};
