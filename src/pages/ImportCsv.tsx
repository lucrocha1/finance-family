import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  FileUp,
  Loader2,
  Trash2,
  XCircle,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useFamily } from "@/contexts/FamilyContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Step = 1 | 2 | 3 | 4;
type DateFormat = "ddmmyyyy" | "yyyymmdd" | "mmddyyyy" | "ddmmyy";
type DecimalSeparator = "comma" | "dot";

type AccountRow = { id: string; name: string; institution: string | null };

type MappingField = "date" | "description" | "amount" | "type" | "category";

type ColumnMapping = Record<MappingField, string>;

type ParsedRow = {
  index: number;
  raw: string[];
  date: string | null;
  description: string | null;
  amount: number | null;
  type: "income" | "expense" | null;
  categoryName: string | null;
  status: "ok" | "error";
  error?: string;
};

type CsvImportRow = {
  id: string;
  created_at: string;
  filename: string;
  status: "done" | "error";
  rows_imported: number;
  rows_total: number;
  account_id: string;
};

const ptCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const normalizeHeader = (value: string, index: number) => {
  const cleaned = value.trim();
  return cleaned ? cleaned : `Coluna ${index + 1}`;
};

const parseLine = (line: string, delimiter: string) => {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
};

// Parser CSV que respeita aspas ATRAVÉS de quebras de linha (um campo entre
// aspas pode conter \n). Antes, o texto era quebrado por linha ANTES de tratar
// aspas, desalinhando as colunas de qualquer linha com \n embutido (F37).
const parseCsv = (text: string, delimiter: string): string[][] => {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const pushField = () => {
    row.push(field.trim());
    field = "";
  };
  const pushRow = () => {
    pushField();
    if (row.some((cell) => cell !== "")) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === delimiter) {
      pushField();
      continue;
    }
    if (char === "\r") continue;
    if (char === "\n") {
      pushRow();
      continue;
    }
    field += char;
  }
  if (field.length > 0 || row.length > 0) pushRow();
  return rows;
};

const detectDelimiter = (text: string) => {
  const sample = text.split(/\r?\n/).filter(Boolean).slice(0, 8);
  const candidates = [",", ";", "\t", "|"];
  let best: { delimiter: string; score: number } = { delimiter: ",", score: -1 };

  candidates.forEach((candidate) => {
    const counts = sample.map((line) => parseLine(line, candidate).length);
    const avg = counts.length ? counts.reduce((sum, value) => sum + value, 0) / counts.length : 0;
    const score = avg > 1 ? avg : 0;
    if (score > best.score) best = { delimiter: candidate, score };
  });

  return best.delimiter;
};

const parseDateByFormat = (value: string, format: DateFormat) => {
  const text = value.trim();
  if (!text) return null;

  if (format === "yyyymmdd") {
    const match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  }

  const match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (!match) return null;

  const first = Number(match[1]);
  const second = Number(match[2]);
  const thirdRaw = Number(match[3]);
  const year = format === "ddmmyy" && thirdRaw < 100 ? 2000 + thirdRaw : thirdRaw;

  const day = format === "mmddyyyy" ? second : first;
  const month = format === "mmddyyyy" ? first : second;

  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;

  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
};

const parseAmount = (value: string, mode: DecimalSeparator) => {
  let trimmed = value.trim();
  if (!trimmed) return null;

  // Sinal negativo à direita ("150,00-") ou parênteses contábeis ("(150,00)")
  // marcam débito em vários extratos BR — normaliza pro sinal à esquerda (F36).
  let negative = false;
  if (/^\(.*\)$/.test(trimmed)) {
    negative = true;
    trimmed = trimmed.slice(1, -1);
  }
  if (/-\s*$/.test(trimmed)) {
    negative = true;
    trimmed = trimmed.replace(/-\s*$/, "");
  }

  const normalized =
    mode === "comma"
      ? trimmed.replace(/\./g, "").replace(/,/g, ".")
      : trimmed.replace(/,/g, "");

  const numeric = Number(normalized.replace(/[^0-9.-]/g, ""));
  if (Number.isNaN(numeric)) return null;
  return negative ? -Math.abs(numeric) : numeric;
};

const STEP_ITEMS = [
  { step: 1 as Step, label: "Upload" },
  { step: 2 as Step, label: "Mapeamento" },
  { step: 3 as Step, label: "Preview" },
  { step: 4 as Step, label: "Resultado" },
];

const DEFAULT_MAPPING: ColumnMapping = {
  date: "",
  description: "",
  amount: "",
  type: "__detect__",
  category: "__none__",
};

// Casa os nomes de coluna (cabeçalho) com sinônimos comuns, sem acento/caixa,
// pra pré-preencher o mapeamento automaticamente.
const MAPPING_SYNONYMS: Record<MappingField, string[]> = {
  date: ["data", "date", "dt", "vencimento", "dia", "data mov", "data lancamento"],
  description: ["descricao", "historico", "description", "memo", "lancamento", "detalhe", "estabelecimento", "titulo"],
  amount: ["valor", "amount", "montante", "quantia", "total"],
  type: ["tipo", "type", "natureza", "operacao", "d c", "c d"],
  category: ["categoria", "category", "classificacao"],
};
const normForMatch = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const autoDetectMapping = (columnNames: string[]): Partial<ColumnMapping> => {
  const result: Partial<ColumnMapping> = {};
  (Object.keys(MAPPING_SYNONYMS) as MappingField[]).forEach((field) => {
    const match = columnNames.find((col) => {
      const n = normForMatch(col);
      return MAPPING_SYNONYMS[field].some((syn) => n === syn || n.includes(syn));
    });
    if (match) result[field] = match;
  });
  return result;
};

const ImportCsvPage = () => {
  const { family } = useFamily();
  const { user } = useAuth();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);

  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");

  const [file, setFile] = useState<File | null>(null);
  const [csvText, setCsvText] = useState("");
  const [delimiter, setDelimiter] = useState(",");

  const [firstRowHeader, setFirstRowHeader] = useState(true);
  const [dateFormat, setDateFormat] = useState<DateFormat>("ddmmyyyy");
  const [decimalSeparator, setDecimalSeparator] = useState<DecimalSeparator>("comma");
  const [mapping, setMapping] = useState<ColumnMapping>(DEFAULT_MAPPING);

  const [ignoreErrors, setIgnoreErrors] = useState(true);
  const [confirmImportOpen, setConfirmImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  const [result, setResult] = useState<{ status: "success" | "error"; imported: number; ignored: number; message?: string } | null>(null);

  const [history, setHistory] = useState<CsvImportRow[]>([]);
  const [deleteHistoryId, setDeleteHistoryId] = useState<string | null>(null);

  const rowsRaw = useMemo(() => {
    if (!csvText.trim()) return [] as string[][];
    return parseCsv(csvText, delimiter);
  }, [csvText, delimiter]);

  const columnNames = useMemo(() => {
    if (!rowsRaw.length) return [] as string[];
    const base = firstRowHeader
      ? rowsRaw[0].map((value, index) => normalizeHeader(value, index))
      : Array.from({ length: Math.max(...rowsRaw.map((row) => row.length)) }, (_, idx) => `Coluna ${idx + 1}`);
    // Desambigua cabeçalhos repetidos (ex.: duas colunas "Valor") pra o
    // mapeamento por nome selecionar a coluna certa, não sempre a 1ª (F38).
    const seen = new Map<string, number>();
    return base.map((name) => {
      const count = seen.get(name) ?? 0;
      seen.set(name, count + 1);
      return count === 0 ? name : `${name} (${count + 1})`;
    });
  }, [rowsRaw, firstRowHeader]);

  const dataRows = useMemo(() => {
    if (!rowsRaw.length) return [] as string[][];
    return firstRowHeader ? rowsRaw.slice(1) : rowsRaw;
  }, [rowsRaw, firstRowHeader]);

  // Auto-detecção de colunas por cabeçalho: preenche os campos ainda não
  // mapeados (não sobrescreve escolha manual do usuário). Roda ao (re)carregar o
  // arquivo ou trocar delimitador/cabeçalho, quando columnNames muda.
  useEffect(() => {
    if (columnNames.length === 0) return;
    const auto = autoDetectMapping(columnNames);
    setMapping((prev) => {
      const next = { ...prev };
      (["date", "description", "amount"] as MappingField[]).forEach((k) => {
        if (!prev[k] && auto[k]) next[k] = auto[k]!;
      });
      if (auto.type && prev.type === "__detect__") next.type = auto.type;
      if (auto.category && prev.category === "__none__") next.category = auto.category;
      return next;
    });
  }, [columnNames]);

  const parsedRows = useMemo<ParsedRow[]>(() => {
    if (!dataRows.length) return [];

    const getValue = (raw: string[], columnName: string) => {
      const idx = columnNames.findIndex((item) => item === columnName);
      if (idx < 0) return "";
      return raw[idx] ?? "";
    };

    return dataRows.map((raw, idx) => {
      const lineIndex = idx + 1;
      const dateCell = getValue(raw, mapping.date);
      const descriptionCell = getValue(raw, mapping.description);
      const amountCell = getValue(raw, mapping.amount);
      const typeCell = mapping.type === "__detect__" ? "" : getValue(raw, mapping.type);
      const categoryCell = mapping.category === "__none__" ? "" : getValue(raw, mapping.category);

      const parsedDate = parseDateByFormat(dateCell, dateFormat);
      if (!parsedDate) {
        return {
          index: lineIndex,
          raw,
          date: null,
          description: descriptionCell || null,
          amount: null,
          type: null,
          categoryName: categoryCell || null,
          status: "error",
          error: "Data inválida",
        };
      }

      const parsedAmount = parseAmount(amountCell, decimalSeparator);
      if (parsedAmount === null) {
        return {
          index: lineIndex,
          raw,
          date: parsedDate,
          description: descriptionCell || null,
          amount: null,
          type: null,
          categoryName: categoryCell || null,
          status: "error",
          error: "Valor não numérico",
        };
      }

      if (parsedAmount === 0) {
        // Valor zero não é receita nem despesa — sinaliza como erro em vez de
        // classificar como receita de R$ 0,00 (F35).
        return {
          index: lineIndex,
          raw,
          date: parsedDate,
          description: descriptionCell || null,
          amount: 0,
          type: null,
          categoryName: categoryCell || null,
          status: "error",
          error: "Valor zero",
        };
      }

      if (!descriptionCell.trim()) {
        return {
          index: lineIndex,
          raw,
          date: parsedDate,
          description: null,
          amount: parsedAmount,
          type: null,
          categoryName: categoryCell || null,
          status: "error",
          error: "Descrição vazia",
        };
      }

      let nextType: "income" | "expense";
      if (mapping.type === "__detect__") {
        nextType = parsedAmount < 0 ? "expense" : "income";
      } else {
        // Remove acentos antes de comparar: "Crédito"/"Saída" (com acento) não
        // casavam com os termos sem acento e a linha virava "Tipo inválido" —
        // com "ignorar linhas com erro" ligado, sumia receita/despesa em silêncio.
        const normalized = typeCell.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
        if (normalized === "c" || ["income", "receita", "entrada", "credit", "credito"].some((term) => normalized.includes(term))) nextType = "income";
        else if (normalized === "d" || ["expense", "despesa", "saida", "debit", "debito"].some((term) => normalized.includes(term))) nextType = "expense";
        else {
          return {
            index: lineIndex,
            raw,
            date: parsedDate,
            description: descriptionCell,
            amount: Math.abs(parsedAmount),
            type: null,
            categoryName: categoryCell || null,
            status: "error",
            error: "Tipo inválido",
          };
        }
      }

      return {
        index: lineIndex,
        raw,
        date: parsedDate,
        description: descriptionCell,
        amount: Math.abs(parsedAmount),
        type: nextType,
        categoryName: categoryCell || null,
        status: "ok",
      };
    });
  }, [columnNames, dataRows, dateFormat, decimalSeparator, mapping]);

  const stats = useMemo(() => {
    const okRows = parsedRows.filter((row) => row.status === "ok");
    const errorRows = parsedRows.filter((row) => row.status === "error");

    const incomes = okRows.filter((row) => row.type === "income");
    const expenses = okRows.filter((row) => row.type === "expense");

    const incomesTotal = incomes.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const expensesTotal = expenses.reduce((sum, row) => sum + Number(row.amount || 0), 0);

    return {
      total: parsedRows.length,
      ok: okRows.length,
      errors: errorRows.length,
      incomesCount: incomes.length,
      expensesCount: expenses.length,
      incomesTotal,
      expensesTotal,
      importable: okRows.length,
    };
  }, [parsedRows]);

  const previewRows = useMemo(() => parsedRows.slice(0, 3), [parsedRows]);

  const selectedAccount = useMemo(() => accounts.find((acc) => acc.id === selectedAccountId) ?? null, [accounts, selectedAccountId]);

  const loadInitial = useCallback(async () => {
    if (!family?.id) return;

    setLoading(true);
    // Dados por usuário: a RLS (user_id = auth.uid()) já isola. Filtrar por
    // family_id era redundante e escondia contas/categorias/histórico com
    // family_id defasado (ex.: criados antes de trocar de família) — a conta
    // sumia do Select e a categoria não casava no import.
    const [accountsRes, historyRes, categoriesRes] = await Promise.all([
      supabase.from("accounts").select("id, name, institution").order("name", { ascending: true }),
      supabase
        .from("csv_imports")
        .select("id, created_at, filename, status, rows_imported, rows_total, account_id")
        .order("created_at", { ascending: false }),
      supabase.from("categories").select("id, name"),
    ]);

    if (accountsRes.error) toast.error("Erro ao carregar contas");
    if (historyRes.error) toast.error("Erro ao carregar histórico de importações");
    if (categoriesRes.error) toast.error("Erro ao carregar categorias — a categorização por nome pode não funcionar");

    setAccounts((accountsRes.data as AccountRow[] | null) ?? []);
    setHistory((historyRes.data as CsvImportRow[] | null) ?? []);
    setCategories((categoriesRes.data as { id: string; name: string }[] | null) ?? []);
    setLoading(false);
  }, [family?.id]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const handleFile = async (incoming: File) => {
    const lower = incoming.name.toLowerCase();
    if (!(lower.endsWith(".csv") || lower.endsWith(".txt"))) {
      toast.error("Arquivo inválido. Use .csv ou .txt");
      return;
    }

    // Detecta encoding: lê os bytes e tenta UTF-8; se aparecer o caractere de
    // substituição (U+FFFD), refaz como Windows-1252/Latin-1 — comum em extratos
    // de bancos BR exportados pelo Excel. Antes, .text() assumia sempre UTF-8 e
    // corrompia acentos (F33).
    const buffer = await incoming.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let text = new TextDecoder("utf-8").decode(bytes);
    if (text.includes("�")) {
      try {
        text = new TextDecoder("windows-1252").decode(bytes);
      } catch {
        /* mantém UTF-8 se o runtime não suportar windows-1252 */
      }
    }
    const nextDelimiter = detectDelimiter(text);

    setFile(incoming);
    setCsvText(text);
    setDelimiter(nextDelimiter);
    setMapping(DEFAULT_MAPPING);
    setStep(1);
    setResult(null);
  };

  const onDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) await handleFile(dropped);
  };

  const onFileInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (selected) await handleFile(selected);
  };

  const validateStep2 = () => {
    if (!mapping.date || !mapping.description || !mapping.amount) {
      toast.error("Mapeie Data, Descrição e Valor para continuar");
      return false;
    }
    return true;
  };

  const goToStep2 = () => {
    if (!file || !selectedAccountId) return;
    setStep(2);
  };

  const goToStep3 = () => {
    if (!validateStep2()) return;
    setStep(3);
  };

  const executeImport = async () => {
    if (!family?.id || !user?.id || !file || !selectedAccountId) return;

    // "Ignorar linhas com erro" desmarcado = tudo-ou-nada: se houver QUALQUER
    // linha com erro, bloqueia em vez de importar só as válidas silenciosamente,
    // contrariando a escolha do usuário (F34).
    const errorCount = parsedRows.filter((row) => row.status === "error").length;
    if (!ignoreErrors && errorCount > 0) {
      toast.error(`${errorCount} linha(s) com erro. Corrija-as ou marque "Ignorar linhas com erro".`);
      return;
    }

    const validRows = parsedRows.filter((row) => row.status === "ok" && row.date && row.description && row.amount !== null && row.type);

    if (!validRows.length) {
      toast.error("Não há linhas válidas para importar");
      return;
    }

    setImporting(true);

    // Deduplicação (F31): busca transações já existentes na conta no intervalo de
    // datas do arquivo e pula linhas com mesma (date, amount, type, description).
    // Reimportar o mesmo extrato (ou um com período sobreposto) não duplica mais.
    const dates = validRows.map((row) => row.date as string).sort();
    const { data: existingTx, error: dedupError } = await supabase
      .from("transactions")
      .select("date, amount, type, description")
      .eq("account_id", selectedAccountId)
      .gte("date", dates[0])
      .lte("date", dates[dates.length - 1]);
    // Se a checagem de duplicatas falhar, aborta em vez de prosseguir sem
    // deduplicar (o que duplicaria tudo numa reimportação).
    if (dedupError) {
      setImporting(false);
      toast.error("Não foi possível verificar duplicatas. Tente novamente.");
      return;
    }
    const keyOf = (d: string, a: number, t: string, desc: string | null) =>
      `${d}|${Number(a).toFixed(2)}|${t}|${(desc ?? "").trim().toLowerCase()}`;
    // Contagem por chave (não Set): pula apenas o que JÁ existe no banco e
    // preserva N ocorrências legítimas iguais dentro do arquivo (ex.: dois
    // cafés de R$5 no mesmo dia com a mesma descrição).
    const existingCount = new Map<string, number>();
    (existingTx ?? []).forEach((t: { date: string; amount: number; type: string; description: string | null }) => {
      const k = keyOf(t.date, Number(t.amount), t.type, t.description);
      existingCount.set(k, (existingCount.get(k) ?? 0) + 1);
    });
    const dedupedRows = validRows.filter((row) => {
      const key = keyOf(row.date as string, Number(row.amount), row.type as string, row.description);
      const remaining = existingCount.get(key) ?? 0;
      if (remaining > 0) {
        existingCount.set(key, remaining - 1);
        return false;
      }
      return true;
    });

    if (!dedupedRows.length) {
      setImporting(false);
      toast.info("Todas as transações do arquivo já existem na conta — nada a importar.");
      return;
    }

    // Resolve a categoria mapeada (categoryName -> category_id), case-insensitive.
    // Antes, a coluna Categoria era mapeada e parseada mas descartada no insert,
    // então o usuário achava que categorizava e as transações entravam sem
    // categoria (F32). Sem correspondência, entra sem categoria.
    const categoryByName = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c.id]));
    const payload = dedupedRows.map((row) => ({
      description: row.description,
      amount: row.amount,
      type: row.type,
      date: row.date,
      account_id: selectedAccountId,
      category_id: row.categoryName ? categoryByName.get(row.categoryName.trim().toLowerCase()) ?? null : null,
      status: "paid",
      user_id: user.id,
      family_id: family.id,
    }));

    const { error: insertTxError } = await supabase.from("transactions").insert(payload);

    const ignored = parsedRows.length - dedupedRows.length;
    const mappingPayload = {
      ...mapping,
      delimiter,
      firstRowHeader,
      dateFormat,
      decimalSeparator,
    };

    if (insertTxError) {
      await supabase.from("csv_imports").insert({
        filename: file.name,
        status: "error",
        rows_imported: 0,
        rows_total: parsedRows.length,
        error_message: insertTxError.message,
        column_mapping: mappingPayload,
        account_id: selectedAccountId,
        user_id: user.id,
        family_id: family.id,
      });

      setResult({
        status: "error",
        imported: 0,
        ignored: parsedRows.length,
        message: insertTxError.message,
      });
      setImporting(false);
      setStep(4);
      void loadInitial();
      return;
    }

    await supabase.from("csv_imports").insert({
      filename: file.name,
      status: "done",
      rows_imported: dedupedRows.length,
      rows_total: parsedRows.length,
      column_mapping: mappingPayload,
      account_id: selectedAccountId,
      user_id: user.id,
      family_id: family.id,
    });

    setResult({
      status: "success",
      imported: dedupedRows.length,
      ignored,
    });

    setImporting(false);
    setStep(4);
    void loadInitial();
  };

  const resetWizard = () => {
    setStep(1);
    setFile(null);
    setCsvText("");
    setMapping(DEFAULT_MAPPING);
    setResult(null);
    setIgnoreErrors(true);
  };

  const deleteHistory = async () => {
    if (!deleteHistoryId) return;
    const { error } = await supabase.from("csv_imports").delete().eq("id", deleteHistoryId);
    if (error) {
      toast.error("Não foi possível excluir o registro");
      return;
    }

    toast.success("Registro de importação excluído");
    setDeleteHistoryId(null);
    void loadInitial();
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-foreground">Importar CSV</h1>
        <p className="text-sm text-muted-foreground">Importe extratos bancários em 4 etapas com preview antes de criar transações.</p>
      </header>

      <div className="rounded-xl border border-border bg-card p-4">
        <ol className="flex flex-wrap items-center gap-2 md:gap-0">
          {STEP_ITEMS.map((item, idx) => {
            const done = step > item.step;
            const active = step === item.step;
            return (
              <li key={item.step} className="flex items-center">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold",
                      done && "bg-success text-success-foreground",
                      active && "bg-accent text-accent-foreground",
                      !done && !active && "bg-secondary text-muted-foreground",
                    )}
                  >
                    {done ? <Check className="h-4 w-4" /> : item.step}
                  </span>
                  <span className={cn("text-sm font-medium", active ? "text-foreground" : done ? "text-success" : "text-muted-foreground")}>{item.label}</span>
                </div>
                {idx < STEP_ITEMS.length - 1 ? <span className="mx-3 hidden h-[1px] w-10 bg-border md:block" /> : null}
              </li>
            );
          })}
        </ol>
      </div>

      {step === 1 ? (
        <Card className="mx-auto max-w-3xl rounded-xl border-border bg-card">
          <CardHeader>
            <CardTitle className="text-lg">1. Upload</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              className="group flex h-[200px] cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-secondary/10 text-center hover:border-accent hover:bg-accent/5"
              onDrop={(event) => void onDrop(event)}
              onDragOver={(event) => event.preventDefault()}
              onClick={() => inputRef.current?.click()}
            >
              <FileUp className="h-10 w-10 text-muted-foreground" />
              <p className="font-medium text-foreground">Arraste seu arquivo CSV aqui</p>
              <p className="text-sm text-muted-foreground">ou clique para selecionar</p>
              <input ref={inputRef} type="file" accept=".csv,.txt" className="hidden" onChange={(event) => void onFileInputChange(event)} />
            </div>

            {file ? (
              <div className="flex items-center justify-between rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm">
                <div>
                  <p className="font-medium text-foreground">{file.name}</p>
                  <p className="text-muted-foreground">{formatFileSize(file.size)}</p>
                </div>
                <CheckCircle2 className="h-5 w-5 text-success" />
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label>Conta destino</Label>
              <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Em qual conta esse extrato foi gerado?" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name}
                      {account.institution ? ` • ${account.institution}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-end">
              <Button onClick={goToStep2} disabled={!file || !selectedAccountId}>
                Próximo →
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card className="rounded-xl border-border bg-card">
          <CardHeader>
            <CardTitle className="text-lg">2. Mapeamento de Colunas</CardTitle>
            <p className="text-sm text-muted-foreground">
              Encontradas {dataRows.length} linhas e {columnNames.length} colunas no arquivo
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="flex items-center gap-2">
                <Checkbox id="first-header" checked={firstRowHeader} onCheckedChange={(value) => setFirstRowHeader(Boolean(value))} />
                <Label htmlFor="first-header">Primeira linha é cabeçalho</Label>
              </div>

              <div className="space-y-1">
                <Label>Separador de colunas</Label>
                <Select value={delimiter} onValueChange={setDelimiter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value=",">Vírgula ( , )</SelectItem>
                    <SelectItem value=";">Ponto e vírgula ( ; )</SelectItem>
                    <SelectItem value={"\t"}>Tabulação</SelectItem>
                    <SelectItem value="|">Barra ( | )</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label>Formato de data</Label>
                <Select value={dateFormat} onValueChange={(value) => setDateFormat(value as DateFormat)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ddmmyyyy">DD/MM/AAAA</SelectItem>
                    <SelectItem value="yyyymmdd">AAAA-MM-DD</SelectItem>
                    <SelectItem value="mmddyyyy">MM/DD/AAAA</SelectItem>
                    <SelectItem value="ddmmyy">DD/MM/AA</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1 md:col-span-2">
                <Label>Separador decimal</Label>
                <Select value={decimalSeparator} onValueChange={(value) => setDecimalSeparator(value as DecimalSeparator)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="comma">Vírgula (1.000,50)</SelectItem>
                    <SelectItem value="dot">Ponto (1,000.50)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-muted-foreground">
                  <tr>
                    <th className="p-3 text-left">Campo Finance Family</th>
                    <th className="p-3 text-left">Coluna do CSV</th>
                  </tr>
                </thead>
                <tbody>
                  <MappingRow
                    label="Data (obrigatório)"
                    value={mapping.date}
                    onChange={(value) => setMapping((prev) => ({ ...prev, date: value }))}
                    options={columnNames}
                  />
                  <MappingRow
                    label="Descrição (obrigatório)"
                    value={mapping.description}
                    onChange={(value) => setMapping((prev) => ({ ...prev, description: value }))}
                    options={columnNames}
                  />
                  <MappingRow
                    label="Valor (obrigatório)"
                    value={mapping.amount}
                    onChange={(value) => setMapping((prev) => ({ ...prev, amount: value }))}
                    options={columnNames}
                  />
                  <MappingRow
                    label="Tipo"
                    value={mapping.type}
                    onChange={(value) => setMapping((prev) => ({ ...prev, type: value }))}
                    options={columnNames}
                    extraOptions={[{ value: "__detect__", label: "Detectar pelo sinal (+/-)" }]}
                  />
                  <MappingRow
                    label="Categoria"
                    value={mapping.category}
                    onChange={(value) => setMapping((prev) => ({ ...prev, category: value }))}
                    options={columnNames}
                    extraOptions={[{ value: "__none__", label: "Não mapear" }]}
                  />
                </tbody>
              </table>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Preview (3 linhas)</p>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-muted-foreground">
                    <tr>
                      <th className="p-2 text-left">Data</th>
                      <th className="p-2 text-left">Descrição</th>
                      <th className="p-2 text-right">Valor</th>
                      <th className="p-2 text-left">Tipo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row) => (
                      <tr key={row.index} className="border-t border-border">
                        <td className="p-2">{row.date ?? "—"}</td>
                        <td className="p-2">{row.description ?? "—"}</td>
                        <td className="p-2 text-right">{row.amount !== null ? ptCurrency.format(row.amount) : "—"}</td>
                        <td className="p-2">{row.type === "income" ? "Receita" : row.type === "expense" ? "Despesa" : "—"}</td>
                      </tr>
                    ))}
                    {previewRows.length === 0 ? (
                      <tr>
                        <td className="p-3 text-muted-foreground" colSpan={4}>
                          Sem dados para preview
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>
                ← Voltar
              </Button>
              <Button onClick={goToStep3}>Próximo →</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 3 ? (
        <Card className="rounded-xl border-border bg-card">
          <CardHeader>
            <CardTitle className="text-lg">3. Preview e Confirmação</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <MetricCard label="Total de linhas" value={String(stats.total)} />
              <MetricCard label="Receitas encontradas" value={`${stats.incomesCount} (${ptCurrency.format(stats.incomesTotal)})`} tone="success" />
              <MetricCard label="Despesas encontradas" value={`${stats.expensesCount} (${ptCurrency.format(stats.expensesTotal)})`} tone="destructive" />
              <MetricCard label="Erros/ignoradas" value={String(stats.errors)} tone={stats.errors > 0 ? "destructive" : "muted"} />
            </div>

            <div className="max-h-[400px] overflow-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/30 text-muted-foreground">
                  <tr>
                    <th className="p-2 text-left">#</th>
                    <th className="p-2 text-left">Data</th>
                    <th className="p-2 text-left">Descrição</th>
                    <th className="p-2 text-right">Valor</th>
                    <th className="p-2 text-left">Tipo</th>
                    <th className="p-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.map((row) => (
                    <tr key={row.index} className={cn("border-t border-border", row.status === "error" && "bg-destructive/10")}>
                      <td className="p-2">{row.index}</td>
                      <td className="p-2">{row.date ?? "—"}</td>
                      <td className="p-2">{row.description ?? "—"}</td>
                      <td className="p-2 text-right">{row.amount !== null ? ptCurrency.format(row.amount) : "—"}</td>
                      <td className="p-2">{row.type === "income" ? "Receita" : row.type === "expense" ? "Despesa" : "—"}</td>
                      <td className="p-2">
                        {row.status === "ok" ? (
                          <span className="inline-flex items-center gap-1 text-success">
                            <CheckCircle2 className="h-4 w-4" /> OK
                          </span>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex cursor-help items-center gap-1 text-destructive">
                                <AlertTriangle className="h-4 w-4" /> Erro
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>{row.error || "Linha inválida"}</TooltipContent>
                          </Tooltip>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox id="ignore-errors" checked={ignoreErrors} onCheckedChange={(value) => setIgnoreErrors(Boolean(value))} />
              <Label htmlFor="ignore-errors">Ignorar linhas com erro</Label>
            </div>

            <div className="flex items-center justify-between">
              <Button variant="outline" onClick={() => setStep(2)}>
                ← Voltar
              </Button>
              <Button onClick={() => setConfirmImportOpen(true)} disabled={stats.importable === 0 || importing}>
                {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Importar {stats.importable} transações
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 4 ? (
        <Card className="rounded-xl border-border bg-card">
          <CardContent className="flex min-h-[260px] flex-col items-center justify-center gap-3 text-center">
            {result?.status === "success" ? (
              <>
                <CheckCircle2 className="h-14 w-14 text-success" />
                <h3 className="text-xl font-bold text-foreground">Importação concluída!</h3>
                <p className="text-muted-foreground">{result.imported} transações importadas com sucesso</p>
                {result.ignored > 0 ? <p className="text-sm text-muted-foreground">{result.ignored} linhas ignoradas</p> : null}
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => navigate("/transactions")}>Ver transações →</Button>
                  <Button variant="outline" onClick={resetWizard}>
                    Importar outro arquivo
                  </Button>
                </div>
              </>
            ) : (
              <>
                <XCircle className="h-14 w-14 text-destructive" />
                <h3 className="text-xl font-bold text-foreground">Erro na importação</h3>
                <p className="max-w-lg text-sm text-muted-foreground">{result?.message || "Não foi possível concluir a importação."}</p>
                <Button onClick={() => setStep(3)}>Tentar novamente</Button>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card className="rounded-xl border-border bg-card">
        <CardHeader>
          <CardTitle className="text-lg">Importações Anteriores</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma importação registrada</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-muted-foreground">
                  <tr>
                    <th className="p-2 text-left">Data</th>
                    <th className="p-2 text-left">Arquivo</th>
                    <th className="p-2 text-left">Conta</th>
                    <th className="p-2 text-left">Linhas</th>
                    <th className="p-2 text-left">Status</th>
                    <th className="p-2 text-left">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((item) => {
                    const account = accounts.find((acc) => acc.id === item.account_id);
                    return (
                      <tr key={item.id} className="border-t border-border">
                        <td className="p-2">{new Date(item.created_at).toLocaleString("pt-BR")}</td>
                        <td className="p-2">{item.filename}</td>
                        <td className="p-2">{account?.name ?? "Conta"}</td>
                        <td className="p-2">{item.rows_imported} importadas</td>
                        <td className="p-2">
                          {item.status === "done" ? <Badge className="bg-success/20 text-success">Concluído</Badge> : <Badge className="bg-destructive/20 text-destructive">Erro</Badge>}
                        </td>
                        <td className="p-2">
                          <Button size="icon" variant="ghost" aria-label="Excluir registro de importação" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setDeleteHistoryId(item.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmImportOpen} onOpenChange={setConfirmImportOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar importação?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza? {stats.importable} transações serão criadas na conta {selectedAccount?.name ?? "selecionada"}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                setConfirmImportOpen(false);
                void executeImport();
              }}
            >
              Importar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(deleteHistoryId)} onOpenChange={(open) => !open && setDeleteHistoryId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir registro?</AlertDialogTitle>
            <AlertDialogDescription>Isso remove apenas o histórico da importação, sem apagar transações já criadas.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void deleteHistory();
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

const MappingRow = ({
  label,
  value,
  onChange,
  options,
  extraOptions,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  extraOptions?: Array<{ value: string; label: string }>;
}) => (
  <tr className="border-t border-border">
    <td className="p-3 text-foreground">{label}</td>
    <td className="p-3">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Selecione" />
        </SelectTrigger>
        <SelectContent>
          {extraOptions?.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
          {options.map((column) => (
            <SelectItem key={column} value={column}>
              {column}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </td>
  </tr>
);

const MetricCard = ({ label, value, tone = "muted" }: { label: string; value: string; tone?: "muted" | "success" | "destructive" }) => (
  <div className="glass-card rounded-lg border border-border bg-secondary/20 p-3">
    <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
    <p className={cn("mt-1 font-semibold", tone === "success" && "text-success", tone === "destructive" && "text-destructive", tone === "muted" && "text-foreground")}>{value}</p>
  </div>
);

export default ImportCsvPage;
