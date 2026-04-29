import { useState, type FormEvent } from "react";
import { KeyRound, Loader2, Users } from "lucide-react";
import { z } from "zod";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

const createFamilySchema = z.object({
  familyName: z
    .string()
    .trim()
    .min(2, "Informe um nome com pelo menos 2 caracteres")
    .max(80, "Nome da família deve ter no máximo 80 caracteres"),
});

const joinFamilySchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{8}$/, "Código de convite inválido"),
});

const SetupFamilyPage = () => {
  const navigate = useNavigate();
  const { markFamilyLinked, refreshProfile } = useAuth();

  const [familyName, setFamilyName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);
  const [createError, setCreateError] = useState("");
  const [joinError, setJoinError] = useState("");

  const handleCreateFamily = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreateError("");

    const parsed = createFamilySchema.safeParse({ familyName });
    if (!parsed.success) {
      setCreateError(parsed.error.issues[0]?.message ?? "Dados inválidos");
      return;
    }

    setCreateLoading(true);

    const { error } = await supabase.rpc("create_family", {
      family_name: parsed.data.familyName,
    });

    if (error) {
      setCreateError(error.message || "Não foi possível criar a família");
      setCreateLoading(false);
      return;
    }

    markFamilyLinked();
    void refreshProfile();
    navigate("/dashboard", { replace: true });
  };

  const handleJoinFamily = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setJoinError("");

    const parsed = joinFamilySchema.safeParse({ code: inviteCode });
    if (!parsed.success) {
      setJoinError("Código de convite inválido");
      return;
    }

    setJoinLoading(true);

    const { error } = await supabase.rpc("join_family", {
      code: parsed.data.code,
    });

    if (error) {
      setJoinError("Código de convite inválido");
      setJoinLoading(false);
      return;
    }

    markFamilyLinked();
    void refreshProfile();
    navigate("/dashboard", { replace: true });
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <section className="w-full max-w-[600px] rounded-xl border border-border bg-card p-8">
        <div className="mb-6 space-y-2 text-center">
          <p className="text-3xl font-bold text-primary">💰 FinanceApp</p>
          <h1 className="text-3xl font-bold text-foreground">Configure sua família</h1>
          <p className="text-sm text-muted-foreground">Crie uma nova família ou entre em uma existente</p>
        </div>

        <Tabs defaultValue="create" className="w-full">
          <TabsList className="grid h-11 w-full grid-cols-2 bg-input">
            <TabsTrigger value="create" className="font-semibold data-[state=active]:bg-secondary">
              Criar Nova Família
            </TabsTrigger>
            <TabsTrigger value="join" className="font-semibold data-[state=active]:bg-secondary">
              Entrar com Código
            </TabsTrigger>
          </TabsList>

          <TabsContent value="create" className="mt-4">
            <Card className="rounded-xl border-border bg-card">
              <CardHeader className="items-center text-center">
                <Users className="h-10 w-10 text-primary" />
                <CardTitle className="text-xl text-foreground">Criar Nova Família</CardTitle>
                <CardDescription className="text-muted-foreground">Escolha um nome para começar a compartilhar finanças.</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-4" onSubmit={handleCreateFamily}>
                  <div className="space-y-2">
                    <label htmlFor="family-name" className="text-xs font-semibold uppercase text-muted-foreground">
                      Nome da família
                    </label>
                    <Input
                      id="family-name"
                      value={familyName}
                      onChange={(event) => setFamilyName(event.target.value)}
                      maxLength={80}
                      placeholder="Família Rocha"
                      className="h-11 border-border bg-input"
                    />
                  </div>

                  {createError && <p className="text-sm text-destructive">{createError}</p>}

                  <Button type="submit" className="h-11 w-full rounded-lg bg-primary text-primary-foreground hover:bg-primary-hover" disabled={createLoading}>
                    {createLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Criando...
                      </>
                    ) : (
                      "Criar família"
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="join" className="mt-4">
            <Card className="rounded-xl border-border bg-card">
              <CardHeader className="items-center text-center">
                <KeyRound className="h-10 w-10 text-[hsl(var(--info))]" />
                <CardTitle className="text-xl text-foreground">Entrar com Código</CardTitle>
                <CardDescription className="text-muted-foreground">Use o código da família para entrar como membro.</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-4" onSubmit={handleJoinFamily}>
                  <div className="space-y-2">
                    <label htmlFor="invite-code" className="text-xs font-semibold uppercase text-muted-foreground">
                      Código de convite
                    </label>
                    <Input
                      id="invite-code"
                      value={inviteCode}
                      onChange={(event) => setInviteCode(event.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase())}
                      maxLength={8}
                      placeholder="Ex: A1B2C3D4"
                      className="h-11 border-border bg-input uppercase"
                    />
                  </div>

                  {joinError && <p className="text-sm text-destructive">{joinError}</p>}

                  <Button
                    type="submit"
                    className="h-11 w-full rounded-lg bg-[hsl(var(--info))] text-primary-foreground hover:bg-[hsl(var(--info-hover))]"
                    disabled={joinLoading}
                  >
                    {joinLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Entrando...
                      </>
                    ) : (
                      "Entrar na família"
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </section>
    </main>
  );
};

export default SetupFamilyPage;
