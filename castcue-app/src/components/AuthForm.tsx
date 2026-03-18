"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type AuthMode = "login" | "signup";

export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const action =
      mode === "login"
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({ email, password });

    const { error: authError } = await action;

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    router.push("/");
    router.refresh();
  }

  async function onGoogleSignIn() {
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (oauthError) {
      setError(oauthError.message);
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] px-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8">
        <h1 className="text-2xl font-semibold">{mode === "login" ? "Welcome back" : "Create account"}</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          {mode === "login" ? "Sign in to access your Freq feed." : "Create an account to start curating clips."}
        </p>

        <div className="mt-6">
          <button
            type="button"
            onClick={onGoogleSignIn}
            disabled={loading}
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--elevated)] px-4 py-2 font-medium text-[var(--text-primary)] transition hover:border-[var(--accent)] disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
              <path
                fill="#EA4335"
                d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.8-6-6.2s2.7-6.2 6-6.2c1.9 0 3.2.8 3.9 1.5l2.6-2.5C16.8 2.9 14.6 2 12 2 6.9 2 2.8 6.5 2.8 12s4.1 10 9.2 10c5.3 0 8.9-3.8 8.9-9.1 0-.6-.1-1-.2-1.5H12z"
              />
              <path
                fill="#34A853"
                d="M3.8 7.3l3.2 2.4C7.8 8 9.7 6.5 12 6.5c1.9 0 3.2.8 3.9 1.5l2.6-2.5C16.8 2.9 14.6 2 12 2 8.4 2 5.3 4.1 3.8 7.3z"
              />
              <path
                fill="#FBBC05"
                d="M12 22c2.5 0 4.7-.8 6.3-2.3l-2.9-2.4c-.8.6-1.9 1-3.4 1-3.8 0-5.2-2.6-5.5-3.9l-3.3 2.6C4.8 20.1 8.1 22 12 22z"
              />
              <path
                fill="#4285F4"
                d="M20.9 12.9c0-.6-.1-1-.2-1.5H12v3.9h5.5c-.3 1.4-1.2 2.5-2.1 3.1l2.9 2.4c1.7-1.6 2.6-4 2.6-7.9z"
              />
            </svg>
            {loading ? "Working..." : "Sign in with Google"}
          </button>
        </div>

        <div className="mt-4 flex items-center gap-3 text-xs uppercase tracking-wide text-[var(--text-tertiary)]">
          <div className="h-px flex-1 bg-[var(--border)]" />
          <span>or</span>
          <div className="h-px flex-1 bg-[var(--border)]" />
        </div>

        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--elevated)] px-3 py-2 outline-none ring-[var(--accent)] focus:ring-1"
          />
          <input
            type="password"
            required
            minLength={6}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--elevated)] px-3 py-2 outline-none ring-[var(--accent)] focus:ring-1"
          />

          {error ? <p className="text-sm text-red-400">{error}</p> : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-[var(--accent)] px-4 py-2 font-medium text-black transition hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Working..." : mode === "login" ? "Sign in" : "Sign up"}
          </button>
        </form>

        <p className="mt-4 text-sm text-[var(--text-secondary)]">
          {mode === "login" ? (
            <>
              No account?{" "}
              <Link href="/signup" className="text-[var(--accent)] hover:underline">
                Sign up
              </Link>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <Link href="/login" className="text-[var(--accent)] hover:underline">
                Log in
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
