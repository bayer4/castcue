"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { GenerationProvider, useGeneration } from "@/components/GenerationContext";

const navItems = [
  {
    href: "/",
    label: "Playlist",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18V5l12-3v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="15" r="3" />
      </svg>
    ),
  },
  {
    href: "/topics",
    label: "Topics",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 9h16" />
        <path d="M4 15h16" />
        <path d="M10 3 8 21" />
        <path d="M16 3 14 21" />
      </svg>
    ),
  },
  {
    href: "/podcasts",
    label: "Podcasts",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
    ),
  },
];

const authRoutes = new Set(["/login", "/signup"]);

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <GenerationProvider>
      <AppShellContent>{children}</AppShellContent>
    </GenerationProvider>
  );
}

function AppShellContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isGenerating, progress, queuedEpisodeCount, completedEpisodes, startGeneration } = useGeneration();

  const isAuthRoute = authRoutes.has(pathname);
  const showGlobalGenerateButton = pathname !== "/" && pathname !== "/podcasts";

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  if (isAuthRoute) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="hidden w-[240px] shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--surface)] md:flex">
        {/* Logo */}
        <div className="px-5 pt-6 pb-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18V5l12-3v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="15" r="3" />
              </svg>
            </div>
            <span className="text-lg font-bold tracking-tight">Freq</span>
          </div>
          <p className="mt-1.5 text-[11px] font-medium uppercase tracking-widest text-[var(--text-tertiary)]">
            Conversations that matter
          </p>
          {isGenerating ? (
            <div className="mt-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--elevated)] px-2 py-1.5">
              <div className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" />
                <span>Scanning podcasts...</span>
              </div>
              {progress && progress.total > 0 ? (() => {
                const combinedTotal = completedEpisodes + progress.total + queuedEpisodeCount;
                const combinedCurrent = completedEpisodes + progress.current;
                const pct = Math.round((combinedCurrent / combinedTotal) * 100);
                return (
                  <>
                    <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-[var(--border)]">
                      <div
                        className="h-full rounded-full bg-[var(--accent)] transition-all duration-500 ease-out"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="mt-1 text-right text-[10px] text-[var(--text-tertiary)]">
                      {combinedCurrent} of {combinedTotal} episodes
                    </p>
                  </>
                );
              })() : null}
            </div>
          ) : null}
        </div>

        {/* Nav */}
        <nav className="mt-6 space-y-1 px-3">
          {navItems.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-item ${active ? "nav-item--active" : ""}`}
              >
                {item.icon}
                {item.label}
              </Link>
            );
          })}

          <div className="mt-4 border-t border-[var(--border-subtle)] pt-4">
            <button
              onClick={handleLogout}
              className="nav-item w-full text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16,17 21,12 16,7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Log out
            </button>
          </div>
        </nav>

        <div className="flex-1" />
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-5 md:p-8">
        {showGlobalGenerateButton ? (
          <div className="mb-4 flex justify-end">
            <button
              onClick={() => startGeneration()}
              disabled={isGenerating}
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-70"
            >
              {isGenerating ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
              ) : (
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)]" />
              )}
              {isGenerating ? "Scanning..." : "Generate Clips"}
            </button>
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}
