"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Database, ScanSearch, FileText, ClipboardList, LogOut } from "lucide-react";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/inventory", label: "Inventory", icon: Database },
  { href: "/scans", label: "Scans", icon: ScanSearch },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/questionnaires", label: "Questionnaires", icon: ClipboardList },
];

export function AppShell({ children, orgName }: { children: React.ReactNode; orgName?: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await authClient.signOut();
    router.push("/sign-in");
  }

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 border-r bg-card p-4 flex flex-col gap-6">
        <div>
          <Link href="/dashboard" className="font-bold text-lg tracking-tight">
            Registack<span className="text-primary"> AI</span>
          </Link>
          {orgName && <p className="text-xs text-muted-foreground mt-1 truncate">{orgName}</p>}
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                pathname.startsWith(href) ? "bg-primary text-primary-foreground" : "hover:bg-muted"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </nav>
        <Button variant="ghost" className="mt-auto justify-start" onClick={signOut}>
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </aside>
      <main className="flex-1 p-8 overflow-auto">{children}</main>
    </div>
  );
}
