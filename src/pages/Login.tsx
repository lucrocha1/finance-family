import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";

import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";

const LoginPage = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setErrorMessage("");
    setSubmitting(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    setSubmitting(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    navigate("/dashboard", { replace: true });
  };

  return (
    <AuthShell>
      <div className="space-y-6">
        <div className="space-y-2 text-center">
          <p className="text-3xl font-bold text-primary">💰 Finance Family</p>
          <p className="text-sm text-muted-foreground">Gerencie suas finanças em família</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="email" className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">
              E-mail
            </label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="seu@email.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-11 rounded-lg border-border bg-input text-foreground placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0"
              required
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">
              Senha
            </label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-11 rounded-lg border-border bg-input pr-11 text-foreground placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground"
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {!isSupabaseConfigured && (
            <p className="text-sm text-destructive">Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para autenticação.</p>
          )}

          {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}

          <Button
            type="submit"
            className="h-11 w-full rounded-lg bg-primary font-semibold text-primary-foreground hover:bg-primary/90"
            disabled={submitting || !isSupabaseConfigured}
          >
            {submitting ? "Entrando..." : "Entrar"}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Não tem conta?{" "}
          <Link to="/register" className="font-semibold text-primary hover:text-primary/90">
            Cadastre-se
          </Link>
        </p>
      </div>
    </AuthShell>
  );
};

export default LoginPage;