import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSession, getActiveOrganization } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { ORG_COOKIE } from "@/lib/org-cookie";
import { prisma } from "@/lib/prisma";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session?.user) redirect("/sign-in");

  const cookieStore = await cookies();
  let org = await getActiveOrganization(session.user.id, cookieStore.get(ORG_COOKIE)?.value);

  if (!org) {
    const membership = await prisma.membership.findFirst({
      where: { userId: session.user.id },
      include: { organization: true },
    });
    org = membership?.organization ?? null;
  }

  if (!org) redirect("/sign-up");

  return <AppShell orgName={org.name}>{children}</AppShell>;
}
