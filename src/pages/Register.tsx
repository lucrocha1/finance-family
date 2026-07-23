import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Loader2, Lock, Mail, User } from "lucide-react";

import { AuthInput } from "@/components/auth/AuthInput";
import { AuthShell } from "@/components/auth/AuthShell";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";

type FormErrors = {
  fullName?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
};

const RegisterPage = () => {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState("");

  const validate = () => {
    const nextErrors: FormErrors = {};
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!fullName.trim()) nextErrors.fullName = "Nome completo é obrigatório.";
    if (!emailRegex.test(email.trim())) nextErrors.email = "Informe um e-mail válido.";
    if (password.length < 6) nextErrors.password = "A senha deve ter no mínimo 6 caracteres.";
    if (confirmPassword !== password) nextErrors.confirmPassword = "As senhas não conferem.";
    setFormErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError("");
    if (!validate()) return;

    setSubmitting(true);
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName.trim() } },
    });
    setSubmitting(false);

    if (error) {
      setSubmitError(error.message);
      return;
    }

    navigate("/dashboard", { replace: true });
  };

  return (
    <AuthShell title="Criar conta" subtitle="Comece a organizar suas finanças">
      <form onSubmit={handleSubmit} className="space-y-3.5" noValidate>
        <AuthInput
          icon={User}
          type="text"
          aria-label="Nome completo"
          autoComplete="name"
          placeholder="Seu nome completo"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          error={formErrors.fullName}
        />
        <AuthInput
          icon={Mail}
          type="email"
          aria-label="E-mail"
          autoComplete="email"
          inputMode="email"
          placeholder="Seu e-mail"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={formErrors.email}
        />
        <AuthInput
          icon={Lock}
          isPassword
          aria-label="Senha"
          autoComplete="new-password"
          placeholder="Mínimo 6 caracteres"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={formErrors.password}
        />
        <AuthInput
          icon={Lock}
          isPassword
          aria-label="Confirmar senha"
          autoComplete="new-password"
          placeholder="Confirmar senha"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          error={formErrors.confirmPassword}
        />

        {!isSupabaseConfigured && (
          <p className="text-sm text-destructive">Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para autenticação.</p>
        )}
        {submitError && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{submitError}</p>
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
              Criar conta
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover/btn:translate-x-1" />
            </>
          )}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-white/50">
        Já tem conta?{" "}
        <Link to="/login" className="font-semibold text-primary transition-opacity hover:opacity-80">
          Entrar
        </Link>
      </p>
    </AuthShell>
  );
};

export default RegisterPage;
