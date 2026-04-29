import type { LucideIcon } from "lucide-react";

type PagePlaceholderProps = {
  icon: LucideIcon;
  title: string;
};

export const PagePlaceholder = ({ icon: Icon, title }: PagePlaceholderProps) => {
  return (
    <div className="flex min-h-[calc(100vh-10rem)] items-center justify-center">
      <div className="space-y-3 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-secondary/40">
          <Icon className="h-16 w-16 text-[hsl(var(--placeholder-icon))]" aria-hidden="true" />
        </div>
        <h1 className="text-3xl font-bold text-foreground">{title}</h1>
        <p className="text-base text-[hsl(var(--placeholder-subtitle))]">Em breve...</p>
      </div>
    </div>
  );
};
