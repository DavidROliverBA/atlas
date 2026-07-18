/**
 * Supabase client for the hosted deployment: GitHub SSO (auth gate) and,
 * later, multi-user workspaces via @atlas/storage-supabase. The anon key is
 * public by design — data access is enforced by Row Level Security.
 */

import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = "https://cbimxxazmoujtetkrpvk.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNiaW14eGF6bW91anRldGtycHZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzNDczODAsImV4cCI6MjA5OTkyMzM4MH0.S5yAEtC6qCzr1IyX_noTbGr3Bas8cO-oTPzz7tWVJ58";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/** The signed-in user's access token, if any (used to authorise the AI proxy). */
export async function sessionToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
