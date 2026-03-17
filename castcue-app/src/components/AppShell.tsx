"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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
  const pathname = usePathname();
  const router = useRouter();

  const isAuthRoute = authRoutes.has(pathname);

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
            <span className="text-lg font-bold tracking-tight">CastCue</span>
          </div>
          <p className="mt-1.5 text-[11px] font-medium uppercase tracking-widest text-[var(--text-tertiary)]">
            Conversations that matter
          </p>
        </div>

        {/* Nav */}
        <nav className="mt-6 flex-1 space-y-1 px-3">
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
        </nav>

        {/* Footer */}
        <div className="border-t border-[var(--border-subtle)] p-3">
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
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-5 md:p-8">
        {children}
      </main>
    </div>
  );
}
