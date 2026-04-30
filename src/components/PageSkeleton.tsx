import { Skeleton } from "@/components/ui/skeleton";

type Props = {
  rows?: number;
  withHeader?: boolean;
};

// Generic loading state for full pages — replaces "Carregando..." text.
export const PageSkeleton = ({ rows = 4, withHeader = true }: Props) => (
  <div className="space-y-4">
    {withHeader && (
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-9 w-32" />
      </div>
    )}
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-24 rounded-xl" />
      ))}
    </div>
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-14 rounded-lg" />
      ))}
    </div>
  </div>
);
