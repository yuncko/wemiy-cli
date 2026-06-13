import { headers } from "next/headers";
import { auth } from "./auth";
import { prisma } from "./prisma";

export async function getSession() {
  const h = await headers();
  return auth.api.getSession({ headers: h });
}

export async function requireSession() {
  const session = await getSession();
  if (!session?.user) {
    throw new Error("Unauthorized");
  }
  return session;
}

export async function getActiveOrganization(userId: string, orgId?: string | null) {
  if (orgId) {
    const membership = await prisma.membership.findFirst({
      where: { userId, organizationId: orgId },
      include: { organization: true },
    });
    if (membership) return membership.organization;
  }

  const first = await prisma.membership.findFirst({
    where: { userId },
    include: { organization: true },
    orderBy: { createdAt: "asc" },
  });
  return first?.organization ?? null;
}

export async function requireOrganization(userId: string, orgId?: string | null) {
  const org = await getActiveOrganization(userId, orgId);
  if (!org) throw new Error("No organization");
  return org;
}
