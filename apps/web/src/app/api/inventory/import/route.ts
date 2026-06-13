import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, requireOrganization } from "@/lib/session";
import { importInventorySchema } from "@/lib/validations";
import { cookies } from "next/headers";
import { ORG_COOKIE } from "@/lib/org-cookie";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const cookieStore = await cookies();
  const org = await requireOrganization(session.user.id, cookieStore.get(ORG_COOKIE)?.value);

  const json = await req.json();
  const parsed = importInventorySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const created = await prisma.$transaction(
    parsed.data.systems.map((s) =>
      prisma.aiSystem.create({
        data: {
          organizationId: org.id,
          name: s.name,
          description: s.description ?? null,
          purpose: s.purpose,
          dataTypes: JSON.stringify(s.dataTypes),
          vendor: s.vendor ?? null,
          deploymentEnv: s.deploymentEnv ?? null,
          roleType: s.roleType,
          riskCategory: s.riskCategory,
          annexIIIArea: s.annexIIIArea ?? null,
          humanOversight: s.humanOversight ?? null,
          intendedUsers: s.intendedUsers ?? null,
          status: s.status,
          source: "import",
        },
      })
    )
  );

  return NextResponse.json({ imported: created.length }, { status: 201 });
}
