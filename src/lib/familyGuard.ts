import { toast } from "@/components/ui/sonner";

export const ensureFamily = (
  familyId: string | null | undefined,
  userId: string | null | undefined,
): { familyId: string; userId: string } | null => {
  if (!familyId || !userId) {
    toast.error("Família não carregada. Recarregue a página e tente novamente.");
    return null;
  }
  return { familyId, userId };
};
