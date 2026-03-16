"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const navItems = [
  { href: "/", label: "Playlist" },
  { href: "/topics", label: "Topics" },
  { href: "/podcasts", label: "Podcasts" },
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
    <div className="flex min-h-screen bg-[var(--background)] text-[var(--text-primary)]">
      <aside className="hidden w-64 shrink-0 border-r border-[var(--border)] bg-[var(--surface)] p-6 md:flex md:flex-col">
        <h1 className="text-2xl font-semibold tracking-tight">CastCue</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Conversations that matter.</p>

        <nav className="mt-8 space-y-2">
          {navItems.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-lg px-3 py-2 text-sm transition ${
                  active
                    ? "bg-[var(--elevated)] text-[var(--accent)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--elevated)] hover:text-[var(--text-primary)]"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <button
          onClick={handleLogout}
          className="mt-auto rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-secondary)] transition hover:bg-[var(--elevated)] hover:text-[var(--text-primary)]"
        >
          Log out
        </button>
      </aside>

      <main className="w-full p-4 md:p-8">{children}</main>
    </div>
  );
}
