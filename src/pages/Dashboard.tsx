import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

const DashboardPage = () => {
  const navigate = useNavigate();
  const { profile, user } = useAuth();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <section className="w-full max-w-xl rounded-xl border border-border bg-card p-8 text-center">
        <p className="text-sm text-muted-foreground">{profile?.full_name ?? user?.email}</p>
        <h1 className="mt-2 text-3xl font-bold text-foreground">Dashboard — Em breve</h1>
        <Button onClick={handleLogout} variant="outline" className="mt-6 rounded-lg border-border bg-secondary text-secondary-foreground hover:bg-secondary/80">
          Sair
        </Button>
      </section>
    </main>
  );
};

export default DashboardPage;