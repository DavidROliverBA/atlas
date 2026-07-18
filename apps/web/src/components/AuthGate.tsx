/**
 * GitHub SSO gate for the hosted deployment. Enforced only in production
 * builds — local dev (and the Playwright suite) runs open, matching the
 * local-first principle. Sessions come from Supabase Auth's GitHub provider.
 */

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../supabase";

export const REQUIRE_AUTH = import.meta.env.PROD;

export function useSession(): Session | null {
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  return session;
}

function LoginScreen({ error }: { error: string | null }) {
  const [message, setMessage] = useState<string | null>(error);
  const signIn = async () => {
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: window.location.origin },
    });
    if (err) setMessage(err.message);
  };
  return (
    <div className="flex h-full flex-col items-center justify-center bg-slate-100">
      <div className="w-96 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-bold tracking-tight text-slate-800">Atlas</h1>
        <p className="mb-6 mt-1 text-sm text-slate-500">
          Model-first C4 architecture modelling
        </p>
        <button
          data-testid="github-signin"
          onClick={() => void signIn()}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700"
        >
          <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden>
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
          </svg>
          Sign in with GitHub
        </button>
        {message && (
          <p className="mt-4 text-xs leading-relaxed text-red-600" data-testid="auth-error">
            {message}
          </p>
        )}
        <p className="mt-6 text-[11px] leading-relaxed text-slate-400">
          A GitHub account is required. Your models stay in your browser; signing in only
          unlocks the app and its AI features.
        </p>
      </div>
    </div>
  );
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [checked, setChecked] = useState(!REQUIRE_AUTH);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!REQUIRE_AUTH) return;
    void supabase.auth
      .getSession()
      .then(({ data, error: err }) => {
        setSession(data.session);
        if (err) setError(err.message);
      })
      .finally(() => setChecked(true));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!REQUIRE_AUTH) return <>{children}</>;
  if (!checked) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-100 text-sm text-slate-400">
        Loading…
      </div>
    );
  }
  if (!session) return <LoginScreen error={error} />;
  return <>{children}</>;
}
