import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { isIosDevice, isStandalonePwa } from "@/lib/pwa";

// No iOS (16.4+) o Web Push SÓ funciona com o app instalado na tela de início
// (rodando standalone). Em aba normal do Safari, window.PushManager é undefined
// e o toggle de push fica "não suportado". Este componente detecta o caso e
// mostra o caminho — no Android, oferece o prompt nativo de instalação.

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export const InstallPushGuide = () => {
  const [standalone] = useState(isStandalonePwa);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);

  // Já instalado: nada a fazer.
  if (standalone) return null;

  if (isIosDevice()) {
    return (
      <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
        <p className="font-medium text-foreground">Instale o app pra receber notificações no iPhone</p>
        <ol className="mt-2 space-y-1 text-xs text-muted-foreground">
          <li>1. Abra este site no <span className="font-semibold text-foreground">Safari</span> — no iPhone só ele instala o app direito, mesmo que você use o Chrome no dia a dia.</li>
          <li>2. Toque em <span className="font-semibold text-foreground">Compartilhar</span> (ícone de caixa com seta ↑).</li>
          <li>3. Escolha <span className="font-semibold text-foreground">Adicionar à Tela de Início</span>.</li>
          <li>4. Abra o app pelo novo ícone e volte aqui pra <span className="font-semibold text-foreground">Ativar</span>.</li>
        </ol>
        <p className="mt-2 text-[11px] text-muted-foreground">No iPhone o push só funciona com o app aberto pela tela de início (iOS 16.4+). Depois de instalado, você usa pelo ícone — não importa qual navegador.</p>
      </div>
    );
  }

  // Android/desktop: prompt nativo de instalação, se disponível.
  if (deferred) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
        <p className="text-sm text-foreground">Instale o app pra receber alertas mesmo com ele fechado.</p>
        <Button
          size="sm"
          onClick={() => {
            void deferred.prompt();
            setDeferred(null);
          }}
        >
          Instalar
        </Button>
      </div>
    );
  }

  return null;
};
