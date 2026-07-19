/**
 * Supabase client for the hosted deployment: GitHub SSO (auth gate) and,
 * later, multi-user workspaces via @atlas/storage-supabase. The anon key is
 * public by design — data access is enforced by Row Level Security.
 */

import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = "https://gpklzsbyrvwgauvoolsx.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdwa2x6c2J5cnZ3Z2F1dm9vbHN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0Mzg5NTMsImV4cCI6MjEwMDAxNDk1M30.TFnrj83nzCVGidsnTnqW0m9VWFBxbm6V00ehvT_BH0U";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/** The signed-in user's access token, if any (used to authorise the AI proxy). */
export async function sessionToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
