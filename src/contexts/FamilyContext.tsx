import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

type Family = {
  id: string;
  name: string;
  invite_code: string;
};

type CurrentUserProfile = {
  id: string;
  email: string;
  full_name: string | null;
  family_id: string | null;
  created_at: string;
};

type MemberProfile = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
};

type FamilyMember = {
  id: string;
  user_id: string;
  family_id: string;
  role: "admin" | "member";
  created_at: string;
  profiles: MemberProfile | null;
};

type FamilyContextValue = {
  family: Family | null;
  members: FamilyMember[];
  currentUser: CurrentUserProfile | null;
  isAdmin: boolean;
  loading: boolean;
  refetch: () => Promise<void>;
};

const FamilyContext = createContext<FamilyContextValue | undefined>(undefined);

type FamilyProviderProps = {
  children: ReactNode;
};

export const FamilyProvider = ({ children }: FamilyProviderProps) => {
  const { user, profile } = useAuth();

  const [family, setFamily] = useState<Family | null>(null);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [currentUser, setCurrentUser] = useState<CurrentUserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadFamilyData = useCallback(async () => {
    if (!user) {
      setFamily(null);
      setMembers([]);
      setCurrentUser(null);
      setLoading(false);
      return;
    }

    setLoading(true);

    const { data: profileData } = await supabase
      .from("profiles")
      .select("id, email, full_name, family_id, created_at")
      .eq("id", user.id)
      .maybeSingle();

    setCurrentUser(profileData ?? null);

    if (!profileData?.family_id) {
      setFamily(null);
      setMembers([]);
      setLoading(false);
      return;
    }

    const [{ data: familyData }, { data: membersData }] = await Promise.all([
      supabase.from("families").select("id, name, invite_code").eq("id", profileData.family_id).maybeSingle(),
      supabase
        .from("family_members")
        .select("id, user_id, family_id, role, created_at, profiles ( id, email, full_name, avatar_url )")
        .eq("family_id", profileData.family_id),
    ]);

    const normalizedMembers: FamilyMember[] = (membersData ?? []).map((member) => ({
      id: member.id,
      user_id: member.user_id,
      family_id: member.family_id,
      role: member.role,
      created_at: member.created_at,
      profiles: Array.isArray(member.profiles) ? (member.profiles[0] ?? null) : (member.profiles ?? null),
    }));

    setFamily(familyData ?? null);
    setMembers(normalizedMembers);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (!user) {
      setFamily(null);
      setMembers([]);
      setCurrentUser(null);
      setLoading(false);
      return;
    }

    void loadFamilyData();
  }, [loadFamilyData, profile?.family_id, user]);

  const isAdmin = useMemo(() => {
    if (!user) return false;
    return members.some((member) => member.user_id === user.id && member.role === "admin");
  }, [members, user]);

  const value = useMemo(
    () => ({
      family,
      members,
      currentUser,
      isAdmin,
      loading,
      refetch: loadFamilyData,
    }),
    [currentUser, family, isAdmin, loadFamilyData, loading, members],
  );

  return <FamilyContext.Provider value={value}>{children}</FamilyContext.Provider>;
};

export const useFamily = () => {
  const context = useContext(FamilyContext);

  if (!context) {
    throw new Error("useFamily must be used within a FamilyProvider.");
  }

  return context;
};
