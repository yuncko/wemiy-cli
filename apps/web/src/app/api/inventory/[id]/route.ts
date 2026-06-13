import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, requireOrganization } from "@/lib/session";
import { aiSystemSchema } from "@/lib/validations";
import { parseJsonArray } from "@/lib/utils";
import { cookies } from "next/headers";
import { ORG_COOKIE } from "@/lib/org-cookie";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const cookieStore = await cookies();
  const org = await requireOrganization(session.user.id, cookieStore.get(ORG_COOKIE)?.value);

  const existing = await prisma.aiSystem.findFirst({
    where: { id, organizationId: org.id },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const json = await req.json();
  const parsed = aiSystemSchema.partial().safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const updated = await prisma.aiSystem.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.purpose !== undefined && { purpose: data.purpose }),
      ...(data.dataTypes !== undefined && { dataTypes: JSON.stringify(data.dataTypes) }),
      ...(data.vendor !== undefined && { vendor: data.vendor }),
      ...(data.deploymentEnv !== undefined && { deploymentEnv: data.deploymentEnv }),
      ...(data.roleType !== undefined && { roleType: data.roleType }),
      ...(data.riskCategory !== undefined && { riskCategory: data.riskCategory }),
      ...(data.annexIIIArea !== undefined && { annexIIIArea: data.annexIIIArea }),
      ...(data.humanOversight !== undefined && { humanOversight: data.humanOversight }),
      ...(data.intendedUsers !== undefined && { intendedUsers: data.intendedUsers }),
      ...(data.status !== undefined && { status: data.status }),
    },
  });

  return NextResponse.json({
    system: { ...updated, dataTypes: parseJsonArray(updated.dataTypes) },
  });
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const cookieStore = await cookies();
  const org = await requireOrganization(session.user.id, cookieStore.get(ORG_COOKIE)?.value);

  const existing = await prisma.aiSystem.findFirst({
    where: { id, organizationId: org.id },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.aiSystem.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
