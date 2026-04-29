import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";

type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  family_id: string | null;
};

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  hasFamilyAccess: boolean;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  markFamilyLinked: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

type AuthProviderProps = {
  children: ReactNode;
};

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [familyLinkedOverride, setFamilyLinkedOverride] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (userId: string) => {
    const { data } = await supabase.from("profiles").select("id, email, full_name, family_id").eq("id", userId).maybeSingle();
    return data;
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user) {
      setProfile(null);
      return;
    }

    const profileData = await fetchProfile(user.id);
    setProfile(profileData);
  }, [fetchProfile, user]);

  const markFamilyLinked = useCallback(() => {
    setFamilyLinkedOverride(true);
  }, []);

  useEffect(() => {
    let isMounted = true;

    const syncAuthState = async (nextSession: Session | null) => {
      if (!isMounted) {
        return;
      }

      setSession(nextSession);
      setUser(nextSession?.user ?? null);

      if (nextSession?.user) {
        const profileData = await fetchProfile(nextSession.user.id);
        if (isMounted) {
          setProfile(profileData);
          setFamilyLinkedOverride(Boolean(profileData?.family_id));
        }
      } else {
        setProfile(null);
        setFamilyLinkedOverride(false);
      }

      if (isMounted) {
        setLoading(false);
      }
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      void syncAuthState(currentSession);
    });

    void supabase.auth.getSession().then(({ data }) => {
      void syncAuthState(data.session);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(
    () => ({
      user,
      session,
      profile,
      hasFamilyAccess: Boolean(profile?.family_id || familyLinkedOverride),
      loading,
      refreshProfile,
      markFamilyLinked,
    }),
    [familyLinkedOverride, loading, markFamilyLinked, profile, refreshProfile, session, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider.");
  }

  return context;
};