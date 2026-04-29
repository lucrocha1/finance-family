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
type TypeMode = "detect" | "income" | "expense";

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
    const match = text.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  }

  const match = text.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/);
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
  const trimmed = value.trim();
  if (!trimmed) return null;

  const normalized =
    mode === "comma"
      ? trimmed.replace(/\./g, "").replace(/,/g, ".")
      : trimmed.replace(/,/g, "");

  const numeric = Number(normalized.replace(/[^0-9.-]/g, ""));
  if (Number.isNaN(numeric)) return null;
  return numeric;
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

const ImportCsvPage = () => {
  const { family } = useFamily();
  const { user } = useAuth();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);

  const [accounts, setAccounts] = useState<AccountRow[]>([]);
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
    const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
    return lines.map((line) => parseLine(line, delimiter));
  }, [csvText, delimiter]);

  const columnNames = useMemo(() => {
    if (!rowsRaw.length) return [] as string[];
    if (firstRowHeader) {
      return rowsRaw[0].map((value, index) => normalizeHeader(value, index));
    }
    const maxCols = Math.max(...rowsRaw.map((row) => row.length));
    return Array.from({ length: maxCols }, (_, idx) => `Coluna ${idx + 1}`);
  }, [rowsRaw, firstRowHeader]);

  const dataRows = useMemo(() => {
    if (!rowsRaw.length) return [] as string[][];
    return firstRowHeader ? rowsRaw.slice(1) : rowsRaw;
  }, [rowsRaw, firstRowHeader]);

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
        const normalized = typeCell.toLowerCase();
        if (["income", "receita", "entrada", "credit", "credito"].some((term) => normalized.includes(term))) nextType = "income";
        else if (["expense", "despesa", "saida", "debit", "débito", "debito"].some((term) => normalized.includes(term))) nextType = "expense";
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
      importable: ignoreErrors ? okRows.length : parsedRows.length,
    };
  }, [parsedRows, ignoreErrors]);

  const previewRows = useMemo(() => parsedRows.slice(0, 3), [parsedRows]);

  const selectedAccount = useMemo(() => accounts.find((acc) => acc.id === selectedAccountId) ?? null, [accounts, selectedAccountId]);

  const loadInitial = useCallback(async () => {
    if (!family?.id) return;

    setLoading(true);
    const [accountsRes, historyRes] = await Promise.all([
      supabase.from("accounts").select("id, name, institution").eq("family_id", family.id).order("name", { ascending: true }),
      supabase
        .from("csv_imports")
        .select("id, created_at, filename, status, rows_imported, rows_total, account_id")
        .eq("family_id", family.id)
        .order("created_at", { ascending: false }),
    ]);

    if (accountsRes.error) toast.error("Erro ao carregar contas");
    if (historyRes.error) toast.error("Erro ao carregar histórico de importações");

    setAccounts((accountsRes.data as AccountRow[] | null) ?? []);
    setHistory((historyRes.data as CsvImportRow[] | null) ?? []);
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

    const text = await incoming.text();
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

    const rowsToInsert = ignoreErrors ? parsedRows.filter((row) => row.status === "ok") : parsedRows;
    const validRows = rowsToInsert.filter((row) => row.status === "ok" && row.date && row.description && row.amount !== null && row.type);

    if (!validRows.length) {
      toast.error("Não há linhas válidas para importar");
      return;
    }

    setImporting(true);

    const payload = validRows.map((row) => ({
      description: row.description,
      amount: row.amount,
      type: row.type,
      date: row.date,
      account_id: selectedAccountId,
      status: "paid",
      user_id: user.id,
      family_id: family.id,
    }));

    const { error: insertTxError } = await supabase.from("transactions").insert(payload);

    const ignored = parsedRows.length - validRows.length;
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
      rows_imported: validRows.length,
      rows_total: parsedRows.length,
      column_mapping: mappingPayload,
      account_id: selectedAccountId,
      user_id: user.id,
      family_id: family.id,
    });

    setResult({
      status: "success",
      imported: validRows.length,
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
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setDeleteHistoryId(item.id)}>
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
  <div className="rounded-lg border border-border bg-secondary/20 p-3">
    <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
    <p className={cn("mt-1 font-semibold", tone === "success" && "text-success", tone === "destructive" && "text-destructive", tone === "muted" && "text-foreground")}>{value}</p>
  </div>
);

export default ImportCsvPage;
