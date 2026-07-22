import { useEffect, useMemo, useState } from "react";
import { Copy, Loader2, LogOut, PencilLine, Trash2, Users } from "lucide-react";
import { z } from "zod";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useFamily } from "@/contexts/FamilyContext";
import { supabase } from "@/integrations/supabase/client";

const familyNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Nome da família deve ter no mínimo 2 caracteres")
    .max(80, "Nome da família deve ter no máximo 80 caracteres"),
});

const formatDate = (isoDate?: string) => {
  if (!isoDate) return "--/--/----";
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return "--/--/----";
  return parsed.toLocaleDateString("pt-BR");
};

const FamilyPage = () => {
  const { family, members, currentUser, isAdmin, isOwner, loading, error, refetch } = useFamily();
  const { refreshProfile } = useAuth();
  const navigate = useNavigate();

  const [copied, setCopied] = useState(false);
  const [editingFamilyName, setEditingFamilyName] = useState(false);
  const [familyNameInput, setFamilyNameInput] = useState(family?.name ?? "");
  const [savingFamilyName, setSavingFamilyName] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null);
  const [leavingFamily, setLeavingFamily] = useState(false);

  const sortedMembers = useMemo(() => {
    return [...members].sort((a, b) => {
      if (a.role === b.role) return (a.profiles?.full_name ?? "").localeCompare(b.profiles?.full_name ?? "");
      return a.role === "admin" ? -1 : 1;
    });
  }, [members]);

  const membershipDate = useMemo(() => {
    const currentMembership = members.find((member) => member.user_id === currentUser?.id);
    return currentMembership?.created_at;
  }, [currentUser?.id, members]);

  useEffect(() => {
    setFamilyNameInput(family?.name ?? "");
  }, [family?.name]);

  const handleCopyCode = async () => {
    if (!family?.invite_code) return;
    try {
      await navigator.clipboard.writeText(family.invite_code);
      setCopied(true);
      toast.success("Copiado!");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Não foi possível copiar — copie o código manualmente.");
    }
  };

  const handleSaveFamilyName = async () => {
    if (!family) return;

    const parsed = familyNameSchema.safeParse({ name: familyNameInput });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Nome inválido");
      return;
    }

    setSavingFamilyName(true);
    const { error } = await supabase
      .from("families")
      .update({ name: parsed.data.name })
      .eq("id", family.id);

    if (error) {
      toast.error("Não foi possível atualizar o nome da família");
      setSavingFamilyName(false);
      return;
    }

    await refetch();
    setEditingFamilyName(false);
    setSavingFamilyName(false);
    toast.success("Nome da família atualizado");
  };

  // Remoção via RPC SECURITY DEFINER: além de apagar a linha de family_members,
  // limpa o profiles.family_id do removido (a RLS impede o admin de editar o
  // perfil alheio direto). A RPC também barra remover o dono.
  const handleRemoveMember = async (member: { id: string; user_id: string }) => {
    setRemovingMemberId(member.id);
    const { error } = await supabase.rpc("remove_family_member", { target_user_id: member.user_id });

    if (error) {
      toast.error(error.message || "Não foi possível remover o membro");
      setRemovingMemberId(null);
      return;
    }

    await refetch();
    setRemovingMemberId(null);
    toast.success("Membro removido da família");
  };

  const handleSetRole = async (member: { id: string; user_id: string }, newRole: "admin" | "member") => {
    setUpdatingRoleId(member.id);
    const { error } = await supabase.rpc("set_member_role", { target_user_id: member.user_id, new_role: newRole });
    if (error) {
      toast.error(error.message || "Não foi possível alterar o papel");
    } else {
      await refetch();
      toast.success(newRole === "admin" ? "Membro promovido a admin" : "Voltou a ser membro");
    }
    setUpdatingRoleId(null);
  };

  // Sair da própria família. Se for o dono e houver outros membros, a RPC
  // transfere a posse automaticamente. Depois, o usuário fica sem família e é
  // levado ao setup.
  const handleLeaveFamily = async () => {
    setLeavingFamily(true);
    const { error } = await supabase.rpc("leave_family");
    if (error) {
      toast.error(error.message || "Não foi possível sair da família");
      setLeavingFamily(false);
      return;
    }
    await refreshProfile();
    await refetch();
    toast.success("Você saiu da família");
    navigate("/setup-family", { replace: true });
  };

  if (loading) {
    return (
      <div className="flex min-h-[calc(100vh-10rem)] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="Carregando família" />
      </div>
    );
  }

  if (!family) {
    return (
      <div className="flex min-h-[calc(100vh-10rem)] items-center justify-center">
        <div className="text-center">
          <Users className="mx-auto h-16 w-16 text-[hsl(var(--placeholder-icon))]" />
          <p className="mt-4 text-lg text-muted-foreground">{error ? "Sem acesso à família no momento." : "Família não encontrada."}</p>
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
          <Button onClick={() => void refetch()} variant="outline" className="mt-4 border-border bg-secondary">
            Tentar novamente
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="rounded-xl border-border bg-card">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-foreground">Sua Família</CardTitle>
          <CardDescription className="text-muted-foreground">Compartilhe este código para convidar membros</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {editingFamilyName ? (
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                value={familyNameInput}
                onChange={(event) => setFamilyNameInput(event.target.value)}
                maxLength={80}
                className="h-11 border-border bg-input"
              />
              <div className="flex gap-2">
                <Button onClick={handleSaveFamilyName} disabled={savingFamilyName} className="h-11 rounded-lg">
                  {savingFamilyName ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditingFamilyName(false);
                    setFamilyNameInput(family.name);
                  }}
                  className="h-11 rounded-lg border-border bg-secondary"
                >
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-3xl font-bold text-foreground">{family.name}</h2>
              {isOwner && (
                <Button variant="outline" onClick={() => setEditingFamilyName(true)} className="h-9 rounded-lg border-border bg-secondary">
                  <PencilLine className="h-4 w-4" />
                  Editar nome da família
                </Button>
              )}
            </div>
          )}

          <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border bg-input p-4 sm:flex-row sm:items-center sm:justify-between">
            <code className="text-lg font-semibold uppercase tracking-normal text-foreground">{family.invite_code}</code>
            <Button variant="outline" onClick={handleCopyCode} className="h-10 rounded-lg border-border bg-secondary">
              <Copy className="h-4 w-4" />
              {copied ? "Copiado!" : "Copiar"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-xl border-border bg-card">
        <CardHeader>
          <CardTitle className="text-xl font-bold text-foreground">Lista de Membros</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {sortedMembers.map((member) => {
            const isCurrentUser = member.user_id === currentUser?.id;
            const isMemberOwner = family.owner_id === member.user_id;
            const fullName =
              member.profiles?.full_name?.trim() ||
              (isCurrentUser ? currentUser?.full_name?.trim() : "") ||
              member.profiles?.email ||
              "Usuário";
            const email = member.profiles?.email || (isCurrentUser ? currentUser?.email : "") || "Sem e-mail";
            const initials = fullName
              .split(/\s+/)
              .slice(0, 2)
              .map((part) => part[0]?.toUpperCase() ?? "")
              .join("") || "U";

            return (
              <div key={member.id} className="flex flex-col gap-3 rounded-xl border border-border bg-secondary/40 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{initials}</span>
                  <div>
                    <p className="font-semibold text-foreground">{fullName}</p>
                    <p className="text-sm text-muted-foreground">{email}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Badge
                    className={member.role === "admin" ? "border-transparent bg-primary/20 text-primary" : "border-border bg-secondary text-secondary-foreground"}
                  >
                    {isMemberOwner ? "Dono" : member.role === "admin" ? "Admin" : "Membro"}
                  </Badge>

                  {/* Ações de admin sobre OUTROS membros (nunca sobre o dono nem sobre si). */}
                  {isAdmin && !isCurrentUser && !isMemberOwner && (
                    <>
                      <Button
                        variant="outline"
                        className="h-9 rounded-lg border-border bg-secondary"
                        disabled={updatingRoleId === member.id}
                        onClick={() => handleSetRole(member, member.role === "admin" ? "member" : "admin")}
                      >
                        {updatingRoleId === member.id ? <Loader2 className="h-4 w-4 animate-spin" /> : member.role === "admin" ? "Tornar membro" : "Tornar admin"}
                      </Button>

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="destructive" className="h-9 rounded-lg" disabled={removingMemberId === member.id}>
                            {removingMemberId === member.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            Remover
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="rounded-xl border-border bg-card">
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remover membro?</AlertDialogTitle>
                            <AlertDialogDescription>Essa ação remove {fullName} da família. Os dados financeiros da pessoa continuam com ela (são por usuário).</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel className="border-border bg-secondary">Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleRemoveMember(member)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                              Remover
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="rounded-xl border-border bg-card">
        <CardHeader>
          <CardTitle className="text-xl font-bold text-foreground">Dados da conta</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">Você entrou em {formatDate(membershipDate ?? currentUser?.created_at)}</p>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="h-10 rounded-lg border-destructive/40 text-destructive hover:bg-destructive/10" disabled={leavingFamily}>
                {leavingFamily ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                Sair da família
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="rounded-xl border-border bg-card">
              <AlertDialogHeader>
                <AlertDialogTitle>Sair da família?</AlertDialogTitle>
                <AlertDialogDescription>
                  Você deixa de fazer parte de "{family.name}". Seus dados financeiros continuam com você (são por usuário).
                  {isOwner && members.length > 1 ? " Como você é o dono, a posse é transferida para outro membro." : ""}
                  {isOwner && members.length <= 1 ? " Você é o único membro; a família ficará vazia." : ""}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="border-border bg-secondary">Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={handleLeaveFamily} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Sair
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
};

export default FamilyPage;
