import { toast } from "@/components/ui/sonner";

type SupabaseLikeError = { message?: string; details?: string; hint?: string } | null | undefined;

export const errorMessage = (error: SupabaseLikeError, fallback = "Algo deu errado"): string => {
  if (!error) return fallback;
  return error.message || error.details || error.hint || fallback;
};

// Wraps an async block, toasting any thrown error or returned `{ error }`.
// Use when you want a single source of truth for error UX.
export const withErrorToast = async <T,>(
  fn: () => Promise<T>,
  options: { fallback?: string; success?: string } = {},
): Promise<T | null> => {
  try {
    const result = await fn();
    if (options.success) toast.success(options.success);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    toast.error(msg || options.fallback || "Algo deu errado");
    return null;
  }
};
