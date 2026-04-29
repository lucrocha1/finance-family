import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

import { useAuth } from "@/contexts/AuthContext";

type ProtectedRouteProps = {
  children: ReactNode;
};

export const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { loading, user, profile } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="Carregando sessão" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!profile?.family_id) {
    return <Navigate to="/setup-family" replace />;
  }

  return <>{children}</>;
};

type PublicAuthRouteProps = {
  children: ReactNode;
};

export const PublicAuthRoute = ({ children }: PublicAuthRouteProps) => {
  const { loading, user, profile } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="Carregando sessão" />
      </div>
    );
  }

  if (user) {
    if (!profile?.family_id) {
      return <Navigate to="/setup-family" replace />;
    }

    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};

type SetupFamilyRouteProps = {
  children: ReactNode;
};

export const SetupFamilyRoute = ({ children }: SetupFamilyRouteProps) => {
  const { loading, user, profile } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="Carregando sessão" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (profile?.family_id) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};