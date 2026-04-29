import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  Camera,
  ChevronRight,
  Link2,
  PiggyBank,
  Plus,
  Trash2,
  TrendingUp,
  UserCircle2,
  Wallet,
} from "lucide-react";
import { Link } from "react-router-dom";

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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useFamily } from "@/contexts/FamilyContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type SettingsTab = "profile" | "accounts" | "categories" | "family" | "preferences";
type AccountType = "checking" | "savings" | "wallet" | "investment";
type CategoryType = "expense" | "income";

type AccountRow = {
  id: string;
  user_id: string;
  family_id: string;
  name: string;
  institution: string | null;
  balance: number;
  type: AccountType;
  color: string | null;
};

type CategoryRow = {
  id: string;
  user_id: string;
  family_id: string;
  name: string;
  type: CategoryType;
  icon: string | null;
  color: string | null;
};

const ptCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "profile", label: "Perfil" },
  { id: "accounts", label: "Contas Bancárias" },
  { id: "categories", label: "Categorias" },
  { id: "family", label: "Família" },
  { id: "preferences", label: "Preferências" },
];

const ACCOUNT_TYPE_META: Record<
  AccountType,
  { label: string; Icon: typeof Building2; badgeClass: string }
> = {
  checking: { label: "Corrente", Icon: Building2, badgeClass: "bg-info/20 text-info" },
  savings: { label: "Poupança", Icon: PiggyBank, badgeClass: "bg-success/20 text-success" },
  wallet: { label: "Carteira", Icon: Wallet, badgeClass: "bg-warning/20 text-warning" },
  investment: { label: "Investimento", Icon: TrendingUp, badgeClass: "bg-accent/20 text-accent" },
};

const ACCOUNT_COLORS = ["#06b6d4", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899", "#f97316"];
const CATEGORY_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#d946ef", "#ec4899", "#6b7280"];
const CATEGORY_EMOJIS = ["🍔", "🚗", "🏠", "💊", "📚", "🎮", "💡", "👕", "📱", "🎬", "✈️", "🐾", "💇", "🎁", "💰", "💻", "📈", "🏦", "💼", "📦"];

const DEFAULT_CATEGORIES: Array<{ name: string; type: CategoryType; icon: string; color: string }> = [
  { name: "Alimentação", type: "expense", icon: "🍔", color: "#ef4444" },
  { name: "Transporte", type: "expense", icon: "🚗", color: "#f97316" },
  { name: "Moradia", type: "expense", icon: "🏠", color: "#eab308" },
  { name: "Saúde", type: "expense", icon: "💊", color: "#22c55e" },
  { name: "Educação", type: "expense", icon: "📚", color: "#06b6d4" },
  { name: "Lazer", type: "expense", icon: "🎮", color: "#3b82f6" },
  { name: "Utilidades", type: "expense", icon: "💡", color: "#8b5cf6" },
  { name: "Vestuário", type: "expense", icon: "👕", color: "#d946ef" },
  { name: "Assinaturas", type: "expense", icon: "📱", color: "#ec4899" },
  { name: "Outros", type: "expense", icon: "📦", color: "#6b7280" },
  { name: "Salário", type: "income", icon: "💼", color: "#22c55e" },
  { name: "Freelance", type: "income", icon: "💻", color: "#06b6d4" },
  { name: "Investimentos", type: "income", icon: "📈", color: "#3b82f6" },
  { name: "Presente", type: "income", icon: "🎁", color: "#8b5cf6" },
  { name: "Outros", type: "income", icon: "💰", color: "#6b7280" },
];

const initialsFromName = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "U";

const moneyDigitsToValue = (digits: string) => Number(digits || "0") / 100;
const moneyValueToDigits = (value: number) => String(Math.round(value * 100));

const SettingsPage = () => {
  const { user, profile, refreshProfile } = useAuth();
  const { family } = useFamily();

  const [tab, setTab] = useState<SettingsTab>("profile");
  const [loading, setLoading] = useState(true);

  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);

  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [savingProfile, setSavingProfile] = useState(false);

  const [passwordOpen, setPasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [updatingPassword, setUpdatingPassword] = useState(false);

  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deleteAccountConfirm, setDeleteAccountConfirm] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);

  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<AccountRow | null>(null);
  const [accountName, setAccountName] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("checking");
  const [accountInstitution, setAccountInstitution] = useState("");
  const [accountBalanceDigits, setAccountBalanceDigits] = useState("0");
  const [accountColor, setAccountColor] = useState(ACCOUNT_COLORS[0]);
  const [savingAccount, setSavingAccount] = useState(false);

  const [deleteAccountId, setDeleteAccountId] = useState<string | null>(null);

  const [categoryTypeTab, setCategoryTypeTab] = useState<CategoryType>("expense");
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryRow | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [categoryType, setCategoryType] = useState<CategoryType>("expense");
  const [categoryIcon, setCategoryIcon] = useState("🍔");
  const [categoryColor, setCategoryColor] = useState(CATEGORY_COLORS[0]);
  const [savingCategory, setSavingCategory] = useState(false);
  const [deleteCategoryId, setDeleteCategoryId] = useState<string | null>(null);

  const [creatingDefaults, setCreatingDefaults] = useState(false);

  const [dateFormat, setDateFormat] = useState<"ddmmyyyy" | "mmddyyyy" | "yyyymmdd">("ddmmyyyy");
  const [notifyDay, setNotifyDay] = useState(true);
  const [notifyBudget, setNotifyBudget] = useState(false);

  const datePreview = useMemo(() => {
    const base = new Date(2026, 3, 28);
    if (dateFormat === "mmddyyyy") return base.toLocaleDateString("en-US");
    if (dateFormat === "yyyymmdd") return "2026-04-28";
    return base.toLocaleDateString("pt-BR");
  }, [dateFormat]);

  const filteredCategories = useMemo(
    () => categories.filter((cat) => cat.type === categoryTypeTab).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [categories, categoryTypeTab],
  );

  const loadData = useCallback(async () => {
    if (!family?.id) {
      setLoading(false);
      return;
    }

    setLoading(true);

    const [accountsRes, categoriesRes] = await Promise.all([
      supabase
        .from("accounts")
        .select("id, user_id, family_id, name, institution, balance, type, color")
        .eq("family_id", family.id)
        .order("name", { ascending: true }),
      supabase
        .from("categories")
        .select("id, user_id, family_id, name, type, icon, color")
        .eq("family_id", family.id)
        .order("name", { ascending: true }),
    ]);

    if (accountsRes.error) {
      const fallback = await supabase
        .from("accounts")
        .select("id, user_id, family_id, name, institution, balance")
        .eq("family_id", family.id)
        .order("name", { ascending: true });
      setAccounts(
        ((fallback.data as Record<string, unknown>[] | null) ?? []).map((row) => ({
          id: String(row.id ?? ""),
          user_id: String(row.user_id ?? ""),
          family_id: String(row.family_id ?? family.id),
          name: String(row.name ?? "Conta"),
          institution: (row.institution as string | null) ?? null,
          balance: Number(row.balance ?? 0),
          type: "checking",
          color: ACCOUNT_COLORS[0],
        })),
      );
    } else {
      setAccounts(
        ((accountsRes.data as Record<string, unknown>[] | null) ?? []).map((row) => ({
          id: String(row.id ?? ""),
          user_id: String(row.user_id ?? ""),
          family_id: String(row.family_id ?? family.id),
          name: String(row.name ?? "Conta"),
          institution: (row.institution as string | null) ?? null,
          balance: Number(row.balance ?? 0),
          type: ((row.type as AccountType | null) ?? "checking") as AccountType,
          color: (row.color as string | null) ?? ACCOUNT_COLORS[0],
        })),
      );
    }

    if (categoriesRes.error) {
      toast.error("Erro ao carregar categorias");
    } else {
      setCategories(
        ((categoriesRes.data as Record<string, unknown>[] | null) ?? []).map((row) => ({
          id: String(row.id ?? ""),
          user_id: String(row.user_id ?? ""),
          family_id: String(row.family_id ?? family.id),
          name: String(row.name ?? "Categoria"),
          type: ((row.type as CategoryType | null) ?? "expense") as CategoryType,
          icon: (row.icon as string | null) ?? "📦",
          color: (row.color as string | null) ?? CATEGORY_COLORS[0],
        })),
      );
    }

    setLoading(false);
  }, [family?.id]);

  useEffect(() => {
    setFullName(profile?.full_name ?? "");
  }, [profile?.full_name]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const saveProfile = async () => {
    if (!user?.id) return;
    if (fullName.trim().length < 2) {
      toast.error("Nome completo deve ter pelo menos 2 caracteres");
      return;
    }

    setSavingProfile(true);
    const { error } = await supabase.from("profiles").update({ full_name: fullName.trim() }).eq("id", user.id);
    setSavingProfile(false);

    if (error) {
      toast.error("Não foi possível atualizar o perfil");
      return;
    }

    await refreshProfile();
    toast.success("Perfil atualizado");
  };

  const updatePassword = async () => {
    if (newPassword.length < 6) {
      toast.error("Senha deve ter no mínimo 6 caracteres");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("As senhas não conferem");
      return;
    }

    setUpdatingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setUpdatingPassword(false);

    if (error) {
      toast.error("Não foi possível atualizar a senha");
      return;
    }

    setPasswordOpen(false);
    setNewPassword("");
    setConfirmPassword("");
    toast.success("Senha atualizada");
  };

  const signOutAllSessions = async () => {
    const { error } = await supabase.auth.signOut({ scope: "global" });
    if (error) {
      toast.error("Não foi possível encerrar as sessões");
      return;
    }
    toast.success("Sessões encerradas");
  };

  const deleteOwnAccount = async () => {
    if (!user?.id) return;
    if (deleteAccountConfirm !== "EXCLUIR") {
      toast.error("Digite EXCLUIR para confirmar");
      return;
    }

    setDeletingAccount(true);
    await supabase.from("family_members").delete().eq("user_id", user.id);
    await supabase.from("profiles").delete().eq("id", user.id);
    await supabase.auth.signOut({ scope: "global" });
    setDeletingAccount(false);
    toast.success("Conta removida dos dados do app");
    setDeleteAccountOpen(false);
  };

  const openCreateAccount = () => {
    setEditingAccount(null);
    setAccountName("");
    setAccountType("checking");
    setAccountInstitution("");
    setAccountBalanceDigits("0");
    setAccountColor(ACCOUNT_COLORS[0]);
    setAccountModalOpen(true);
  };

  const openEditAccount = (account: AccountRow) => {
    setEditingAccount(account);
    setAccountName(account.name);
    setAccountType(account.type);
    setAccountInstitution(account.institution ?? "");
    setAccountBalanceDigits(moneyValueToDigits(account.balance));
    setAccountColor(account.color ?? ACCOUNT_COLORS[0]);
    setAccountModalOpen(true);
  };

  const saveAccount = async () => {
    if (!family?.id || !user?.id) return;
    if (accountName.trim().length < 2) {
      toast.error("Nome da conta obrigatório");
      return;
    }

    const payload = {
      name: accountName.trim(),
      type: accountType,
      institution: accountInstitution.trim() || null,
      balance: moneyDigitsToValue(accountBalanceDigits),
      color: accountColor,
      user_id: user.id,
      family_id: family.id,
    };

    setSavingAccount(true);
    const { error } = editingAccount
      ? await supabase.from("accounts").update(payload).eq("id", editingAccount.id)
      : await supabase.from("accounts").insert(payload);
    setSavingAccount(false);

    if (error) {
      toast.error("Não foi possível salvar a conta");
      return;
    }

    toast.success(editingAccount ? "Conta atualizada" : "Conta criada");
    setAccountModalOpen(false);
    void loadData();
  };

  const deleteAccount = async () => {
    if (!deleteAccountId) return;
    await supabase.from("transactions").update({ account_id: null }).eq("account_id", deleteAccountId);
    const { error } = await supabase.from("accounts").delete().eq("id", deleteAccountId);
    if (error) {
      toast.error("Não foi possível excluir a conta");
      return;
    }
    toast.success("Conta excluída");
    setDeleteAccountId(null);
    void loadData();
  };

  const openCreateCategory = () => {
    setEditingCategory(null);
    setCategoryName("");
    setCategoryType(categoryTypeTab);
    setCategoryIcon(categoryTypeTab === "expense" ? "🍔" : "💰");
    setCategoryColor(CATEGORY_COLORS[0]);
    setCategoryModalOpen(true);
  };

  const openEditCategory = (category: CategoryRow) => {
    setEditingCategory(category);
    setCategoryName(category.name);
    setCategoryType(category.type);
    setCategoryIcon(category.icon ?? "📦");
    setCategoryColor(category.color ?? CATEGORY_COLORS[0]);
    setCategoryModalOpen(true);
  };

  const saveCategory = async () => {
    if (!family?.id || !user?.id) return;
    if (categoryName.trim().length < 2) {
      toast.error("Nome da categoria obrigatório");
      return;
    }

    const payload = {
      name: categoryName.trim(),
      type: categoryType,
      icon: categoryIcon,
      color: categoryColor,
      user_id: user.id,
      family_id: family.id,
    };

    setSavingCategory(true);
    const { error } = editingCategory
      ? await supabase.from("categories").update(payload).eq("id", editingCategory.id)
      : await supabase.from("categories").insert(payload);
    setSavingCategory(false);

    if (error) {
      toast.error("Não foi possível salvar a categoria");
      return;
    }

    toast.success(editingCategory ? "Categoria atualizada" : "Categoria criada");
    setCategoryModalOpen(false);
    void loadData();
  };

  const deleteCategory = async () => {
    if (!deleteCategoryId) return;
    await supabase.from("transactions").update({ category_id: null }).eq("category_id", deleteCategoryId);
    const { error } = await supabase.from("categories").delete().eq("id", deleteCategoryId);
    if (error) {
      toast.error("Não foi possível excluir a categoria");
      return;
    }
    toast.success("Categoria excluída");
    setDeleteCategoryId(null);
    void loadData();
  };

  const createDefaultCategories = async () => {
    if (!family?.id || !user?.id) return;
    setCreatingDefaults(true);
    const payload = DEFAULT_CATEGORIES.map((category) => ({
      ...category,
      family_id: family.id,
      user_id: user.id,
    }));
    const { error } = await supabase.from("categories").insert(payload);
    setCreatingDefaults(false);
    if (error) {
      toast.error("Não foi possível criar categorias padrão");
      return;
    }
    toast.success("Categorias padrão criadas");
    void loadData();
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-foreground">Configurações</h1>
        <p className="text-sm text-muted-foreground">Gerencie perfil, contas, categorias e preferências do app.</p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[200px_1fr]">
        <aside className="rounded-xl border border-border bg-secondary/30 p-2 lg:p-0 lg:pr-0">
          <nav className="flex gap-2 overflow-x-auto lg:flex-col lg:gap-0">
            {SETTINGS_TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  "whitespace-nowrap rounded-lg px-4 py-2 text-left text-sm font-medium lg:rounded-none lg:border-l-2 lg:py-3",
                  tab === item.id
                    ? "bg-accent/10 text-accent lg:border-accent"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground lg:border-transparent",
                )}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        <section className="space-y-6">
          {tab === "profile" ? (
            <>
              <Card className="rounded-xl border-border bg-card">
                <CardHeader>
                  <CardTitle className="text-lg">Perfil</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="group relative">
                      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/20 text-xl font-bold text-primary">
                        {initialsFromName(fullName || profile?.email || "Usuário")}
                      </div>
                      <div className="absolute inset-0 hidden items-center justify-center rounded-full bg-overlay/70 text-foreground group-hover:flex">
                        <Camera className="h-5 w-5" />
                      </div>
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">{fullName || "Seu nome"}</p>
                      <p className="text-sm text-muted-foreground">Passe o mouse para trocar foto (em breve)</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Nome completo</Label>
                      <Input value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Seu nome" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Email</Label>
                      <Input value={profile?.email ?? user?.email ?? ""} readOnly className="text-muted-foreground" />
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button onClick={() => void saveProfile()} disabled={savingProfile}>
                      Salvar
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-xl border-border bg-card">
                <CardHeader>
                  <CardTitle className="text-lg">Segurança</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Button variant="outline" onClick={() => setPasswordOpen(true)}>
                    Alterar senha
                  </Button>

                  <div className="space-y-2 border-t border-border pt-4">
                    <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void signOutAllSessions()}>
                      Sair de todas as sessões
                    </Button>
                    <Button variant="outline" className="border-destructive text-destructive hover:bg-destructive/10" onClick={() => setDeleteAccountOpen(true)}>
                      Excluir minha conta
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : null}

          {tab === "accounts" ? (
            <Card className="rounded-xl border-border bg-card">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg">Contas Bancárias</CardTitle>
                <Button onClick={openCreateAccount}>
                  <Plus className="mr-2 h-4 w-4" /> Nova Conta
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {loading ? (
                  <p className="text-sm text-muted-foreground">Carregando contas...</p>
                ) : accounts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma conta cadastrada</p>
                ) : (
                  accounts.map((account) => {
                    const meta = ACCOUNT_TYPE_META[account.type] ?? ACCOUNT_TYPE_META.checking;
                    const Icon = meta.Icon;
                    return (
                      <div key={account.id} className="rounded-lg border border-border bg-secondary/20 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 rounded-full p-2" style={{ backgroundColor: `${account.color ?? ACCOUNT_COLORS[0]}22` }}>
                              <Icon className="h-4 w-4" style={{ color: account.color ?? ACCOUNT_COLORS[0] }} />
                            </div>
                            <div>
                              <p className="font-semibold text-foreground">{account.name}</p>
                              <p className="text-sm text-muted-foreground">{account.institution || "Sem instituição"}</p>
                              <p className={cn("mt-1 text-sm font-semibold", account.balance >= 0 ? "text-success" : "text-destructive")}>
                                {ptCurrency.format(account.balance)}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <Badge className={meta.badgeClass}>{meta.label}</Badge>
                            <Button size="sm" variant="outline" onClick={() => openEditAccount(account)}>
                              Editar
                            </Button>
                            <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => setDeleteAccountId(account.id)}>
                              Excluir
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          ) : null}

          {tab === "categories" ? (
            <Card className="rounded-xl border-border bg-card">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-lg">Categorias</CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => void createDefaultCategories()} disabled={creatingDefaults || categories.length > 0}>
                    Criar categorias padrão
                  </Button>
                  <Button onClick={openCreateCategory}>
                    <Plus className="mr-2 h-4 w-4" /> Nova Categoria
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2 rounded-lg border border-border bg-secondary/20 p-1">
                  <button
                    type="button"
                    className={cn("flex-1 rounded-md py-2 text-sm font-medium", categoryTypeTab === "expense" ? "bg-destructive/15 text-destructive" : "text-muted-foreground")}
                    onClick={() => setCategoryTypeTab("expense")}
                  >
                    Despesas
                  </button>
                  <button
                    type="button"
                    className={cn("flex-1 rounded-md py-2 text-sm font-medium", categoryTypeTab === "income" ? "bg-success/15 text-success" : "text-muted-foreground")}
                    onClick={() => setCategoryTypeTab("income")}
                  >
                    Receitas
                  </button>
                </div>

                {filteredCategories.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma categoria neste tipo</p>
                ) : (
                  <div className="space-y-2">
                    {filteredCategories.map((category) => (
                      <div key={category.id} className="flex items-center justify-between rounded-lg border border-border bg-secondary/20 px-3 py-2">
                        <div className="flex items-center gap-3">
                          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: category.color ?? CATEGORY_COLORS[0] }} />
                          <span className="text-base">{category.icon || "📦"}</span>
                          <p className="font-medium text-foreground">{category.name}</p>
                          <Badge className={category.type === "expense" ? "bg-destructive/20 text-destructive" : "bg-success/20 text-success"}>
                            {category.type === "expense" ? "Despesa" : "Receita"}
                          </Badge>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => openEditCategory(category)}>
                            Editar
                          </Button>
                          <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => setDeleteCategoryId(category.id)}>
                            Excluir
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}

          {tab === "family" ? (
            <Card className="rounded-xl border-border bg-card">
              <CardHeader>
                <CardTitle className="text-lg">Família</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">Gerencie membros e convite da família na página dedicada.</p>
                <Button asChild>
                  <Link to="/family">
                    Ir para Família
                    <ChevronRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {tab === "preferences" ? (
            <Card className="rounded-xl border-border bg-card">
              <CardHeader>
                <CardTitle className="text-lg">Preferências</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-1.5">
                  <Label>Moeda</Label>
                  <Select value="brl" onValueChange={() => undefined}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="brl">BRL — Real Brasileiro (R$)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Mais moedas em breve</p>
                </div>

                <div className="space-y-1.5">
                  <Label>Formato de data</Label>
                  <Select value={dateFormat} onValueChange={(value) => setDateFormat(value as "ddmmyyyy" | "mmddyyyy" | "yyyymmdd")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ddmmyyyy">DD/MM/AAAA</SelectItem>
                      <SelectItem value="mmddyyyy">MM/DD/AAAA</SelectItem>
                      <SelectItem value="yyyymmdd">AAAA-MM-DD</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Hoje: {datePreview}</p>
                </div>

                <div className="space-y-2">
                  <Label>Tema</Label>
                  <div className="flex gap-2 rounded-lg border border-border bg-secondary/20 p-1">
                    <button type="button" className="flex-1 rounded-md bg-accent/20 py-2 text-sm font-medium text-accent">
                      Dark
                    </button>
                    <button type="button" className="flex-1 rounded-md py-2 text-sm font-medium text-muted-foreground" disabled>
                      Light (Em breve)
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  <Label>Notificações</Label>
                  <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/20 px-3 py-2">
                    <p className="text-sm text-foreground">Notificar compromissos do dia</p>
                    <Switch checked={notifyDay} onCheckedChange={setNotifyDay} />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/20 px-3 py-2">
                    <p className="text-sm text-foreground">Notificar quando estourar orçamento</p>
                    <Switch checked={notifyBudget} onCheckedChange={setNotifyBudget} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </section>
      </div>

      <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Alterar senha</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nova senha</Label>
              <Input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Confirmar nova senha</Label>
              <Input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void updatePassword()} disabled={updatingPassword}>
              Atualizar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={accountModalOpen} onOpenChange={setAccountModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editingAccount ? "Editar Conta" : "Nova Conta"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder="Ex: Nubank Conta Corrente" />
            </div>
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={accountType} onValueChange={(value) => setAccountType(value as AccountType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="checking">Corrente</SelectItem>
                  <SelectItem value="savings">Poupança</SelectItem>
                  <SelectItem value="wallet">Carteira</SelectItem>
                  <SelectItem value="investment">Investimento</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Instituição</Label>
              <Input value={accountInstitution} onChange={(event) => setAccountInstitution(event.target.value)} placeholder="Ex: Nubank, Itaú..." />
            </div>
            <div className="space-y-1.5">
              <Label>Saldo atual</Label>
              <Input value={ptCurrency.format(moneyDigitsToValue(accountBalanceDigits))} onChange={(event) => setAccountBalanceDigits(event.target.value.replace(/\D/g, ""))} placeholder="R$ 0,00" />
            </div>
            <div className="space-y-1.5">
              <Label>Cor</Label>
              <div className="flex flex-wrap gap-2">
                {ACCOUNT_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={cn("h-7 w-7 rounded-full border border-border", accountColor === color && "ring-2 ring-accent ring-offset-2 ring-offset-background")}
                    style={{ backgroundColor: color }}
                    onClick={() => setAccountColor(color)}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAccountModalOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void saveAccount()} disabled={savingAccount}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={categoryModalOpen} onOpenChange={setCategoryModalOpen}>
        <DialogContent className="sm:max-w-[540px]">
          <DialogHeader>
            <DialogTitle>{editingCategory ? "Editar Categoria" : "Nova Categoria"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="Ex: Alimentação" />
            </div>

            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <div className="flex gap-2 rounded-lg border border-border bg-secondary/20 p-1">
                <button
                  type="button"
                  className={cn("flex-1 rounded-md py-2 text-sm font-medium", categoryType === "expense" ? "bg-destructive/15 text-destructive" : "text-muted-foreground")}
                  onClick={() => setCategoryType("expense")}
                >
                  Despesa
                </button>
                <button
                  type="button"
                  className={cn("flex-1 rounded-md py-2 text-sm font-medium", categoryType === "income" ? "bg-success/15 text-success" : "text-muted-foreground")}
                  onClick={() => setCategoryType("income")}
                >
                  Receita
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Ícone</Label>
              <div className="grid grid-cols-10 gap-2">
                {CATEGORY_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className={cn("rounded-md border border-border py-1.5 text-base", categoryIcon === emoji && "border-accent bg-accent/10")}
                    onClick={() => setCategoryIcon(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Cor</Label>
              <div className="flex flex-wrap gap-2">
                {CATEGORY_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={cn("h-7 w-7 rounded-full border border-border", categoryColor === color && "ring-2 ring-accent ring-offset-2 ring-offset-background")}
                    style={{ backgroundColor: color }}
                    onClick={() => setCategoryColor(color)}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCategoryModalOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void saveCategory()} disabled={savingCategory}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteAccountId)} onOpenChange={(open) => !open && setDeleteAccountId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir conta?</AlertDialogTitle>
            <AlertDialogDescription>Transações nesta conta ficarão sem conta vinculada.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void deleteAccount()}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(deleteCategoryId)} onOpenChange={(open) => !open && setDeleteCategoryId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir categoria?</AlertDialogTitle>
            <AlertDialogDescription>Transações nesta categoria ficarão sem categoria.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void deleteCategory()}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteAccountOpen} onOpenChange={setDeleteAccountOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir minha conta</AlertDialogTitle>
            <AlertDialogDescription>Digite "EXCLUIR" para confirmar.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label>Confirmação</Label>
            <Input value={deleteAccountConfirm} onChange={(event) => setDeleteAccountConfirm(event.target.value)} placeholder="EXCLUIR" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void deleteOwnAccount()} disabled={deletingAccount || deleteAccountConfirm !== "EXCLUIR"}>
              Excluir conta
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default SettingsPage;
