import { createClient } from "@supabase/supabase-js";

const defaultSupabaseUrl = "https://vydjzvehxlkbtsciemtq.supabase.co";
const defaultSupabaseAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ5ZGp6dmVoeGxrYnRzY2llbXRxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0MTEyMzAsImV4cCI6MjA5Mjk4NzIzMH0.C0tvw5f-nSJpqJOcBpK3y4OqrsZ9P2lZGj87jkyGhOs";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? defaultSupabaseUrl;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? defaultSupabaseAnonKey;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = createClient(supabaseUrl, supabaseAnonKey);