import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Loader2, Lock, Mail } from "lucide-react";

import { AuthInput } from "@/components/auth/AuthInput";
import { AuthShell } from "@/components/auth/AuthShell";
import { toast } from "@/components/ui/sonner";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";

const REMEMBER_KEY = "ff_login_email";

const LoginPage = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState(() => localStorage.getItem(REMEMBER_KEY) ?? "");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [rememberMe, setRememberMe] = useState(() => Boolean(localStorage.getItem(REMEMBER_KEY)));
  const [sendingReset, setSendingReset] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");
    setSubmitting(true);

    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setSubmitting(false);

    if (error) {
      setErrorMessage(error.message === "Invalid login credentials" ? "E-mail ou senha incorretos." : error.message);
      return;
    }

    if (rememberMe) localStorage.setItem(REMEMBER_KEY, email.trim());
    else localStorage.removeItem(REMEMBER_KEY);

    navigate("/dashboard", { replace: true });
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      toast.error("Digite seu e-mail primeiro pra receber o link.");
      return;
    }
    setSendingReset(true);
    await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/login` });
    setSendingReset(false);
    toast.success("Se houver conta com esse e-mail, enviamos um link de redefinição.");
  };

  return (
    <AuthShell title="Bem-vindo de volta" subtitle="Entre para continuar no Finance Family">
      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthInput
          icon={Mail}
          type="email"
          aria-label="E-mail"
          autoComplete="email"
          inputMode="email"
          placeholder="Seu e-mail"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <AuthInput
          icon={Lock}
          isPassword
          aria-label="Senha"
          autoComplete="current-password"
          placeholder="Sua senha"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <div className="flex items-center justify-between pt-0.5">
          <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-white/60">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={() => setRememberMe((v) => !v)}
              className="h-4 w-4 rounded border-white/20 bg-white/5 accent-primary"
            />
            Lembrar de mim
          </label>
          <button
            type="button"
            onClick={() => void handleForgotPassword()}
            disabled={sendingReset}
            className="text-sm text-white/60 transition-colors hover:text-primary disabled:opacity-60"
          >
            {sendingReset ? "Enviando..." : "Esqueceu a senha?"}
          </button>
        </div>

        {!isSupabaseConfigured && (
          <p className="text-sm text-destructive">Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para autenticação.</p>
        )}
        {errorMessage && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{errorMessage}</p>
        )}

        <button
          type="submit"
          disabled={submitting || !isSupabaseConfigured}
          className="group/btn relative mt-1 flex h-12 w-full items-center justify-center gap-1.5 overflow-hidden rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground shadow-[0_8px_30px_-8px_hsl(142_70%_46%/0.7)] transition-all duration-200 hover:bg-primary-hover disabled:opacity-70"
        >
          {submitting ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <>
              Entrar
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover/btn:translate-x-1" />
            </>
          )}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-white/50">
        Não tem conta?{" "}
        <Link to="/register" className="font-semibold text-primary transition-opacity hover:opacity-80">
          Cadastre-se
        </Link>
      </p>
    </AuthShell>
  );
};

export default LoginPage;
