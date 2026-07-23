import { useState, type ComponentProps } from "react";
import { Eye, EyeOff, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type AuthInputProps = Omit<ComponentProps<"input">, "type"> & {
  icon: LucideIcon;
  type?: string;
  /** Ativa o olho de mostrar/ocultar (ignora `type`). */
  isPassword?: boolean;
  error?: string;
};

// Input estilizado do splash de auth: ícone à esquerda (fica verde no foco),
// borda verde no foco, olho opcional pra senha e mensagem de erro embaixo.
export const AuthInput = ({ icon: Icon, isPassword, error, className, type, ...props }: AuthInputProps) => {
  const [show, setShow] = useState(false);
  const [focused, setFocused] = useState(false);

  return (
    <div>
      <div className="relative">
        <Icon
          className={cn(
            "absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 transition-colors duration-200",
            focused ? "text-primary" : "text-white/40",
          )}
        />
        <input
          {...props}
          type={isPassword ? (show ? "text" : "password") : type}
          onFocus={(e) => {
            setFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            props.onBlur?.(e);
          }}
          className={cn(
            "h-12 w-full rounded-xl border bg-white/5 pl-11 text-[15px] text-white outline-none transition-all duration-200 placeholder:text-white/30 focus:bg-white/[0.07] focus:ring-2 focus:ring-primary/20",
            isPassword ? "pr-11" : "pr-3",
            error ? "border-destructive/60" : "border-white/10 focus:border-primary/60",
            className,
          )}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? "Ocultar senha" : "Mostrar senha"}
            className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center text-white/40 transition-colors hover:text-white"
          >
            {show ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
          </button>
        )}
      </div>
      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
    </div>
  );
};
