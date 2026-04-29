import type { ReactNode } from "react";

type AuthShellProps = {
  children: ReactNode;
};

export const AuthShell = ({ children }: AuthShellProps) => {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <section className="w-full max-w-[420px] rounded-2xl border border-border bg-card p-8">
        {children}
      </section>
    </main>
  );
};
