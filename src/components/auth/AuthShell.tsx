import type { ReactNode } from "react";
import { Wallet } from "lucide-react";

type AuthShellProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
};

// Splash de autenticação: fundo verde (token --primary) + card glass com borda
// animada. Usado por Login e Register. Responsivo (celular/tablet). Sempre dark.
export const AuthShell = ({ title, subtitle, children }: AuthShellProps) => {
  return (
    <div className="relative flex min-h-[100dvh] w-full items-center justify-center overflow-hidden bg-[#060807] px-4 py-8">
      {/* Fundo: gradiente verde + glows */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-primary/25 via-primary/[0.07] to-[#060807]" />
      <div className="pointer-events-none absolute left-1/2 top-0 h-[55vh] w-[120vw] -translate-x-1/2 rounded-b-[50%] bg-primary/20 blur-[90px]" />
      <div className="pointer-events-none absolute -bottom-24 left-1/2 h-[70vh] w-[70vh] -translate-x-1/2 animate-pulse rounded-full bg-primary/15 blur-[100px]" />
      <div className="pointer-events-none absolute right-[12%] top-[18%] hidden h-72 w-72 animate-pulse rounded-full bg-primary/10 blur-[90px] [animation-delay:1s] sm:block" />
      {/* Textura sutil */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04] mix-blend-soft-light"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          backgroundSize: "200px 200px",
        }}
      />

      <div className="relative z-10 w-full max-w-sm animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="relative">
          {/* Borda animada (feixe girando) */}
          <div className="absolute -inset-[1.5px] overflow-hidden rounded-[26px] opacity-70">
            <div className="absolute left-1/2 top-1/2 h-[220%] w-[220%] -translate-x-1/2 -translate-y-1/2 animate-[spin_7s_linear_infinite] bg-[conic-gradient(from_0deg,transparent,hsl(142_71%_50%/0.65),transparent_28%)]" />
          </div>

          {/* Card glass */}
          <div className="relative overflow-hidden rounded-[24px] border border-white/10 bg-black/50 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.04]"
              style={{
                backgroundImage:
                  "linear-gradient(135deg, white 0.5px, transparent 0.5px), linear-gradient(45deg, white 0.5px, transparent 0.5px)",
                backgroundSize: "30px 30px",
              }}
            />

            <div className="mb-6 space-y-1.5 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/30 bg-primary/15 text-primary shadow-[0_0_24px_-4px_hsl(142_70%_46%/0.6)]">
                <Wallet className="h-6 w-6" />
              </div>
              <h1 className="pt-1 text-2xl font-bold text-white">{title}</h1>
              <p className="text-sm text-white/50">{subtitle}</p>
            </div>

            {children}
          </div>
        </div>
      </div>
    </div>
  );
};
