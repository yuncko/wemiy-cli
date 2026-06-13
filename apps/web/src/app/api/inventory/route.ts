import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, requireOrganization } from "@/lib/session";
import { aiSystemSchema } from "@/lib/validations";
import { parseJsonArray, parseJsonSafe } from "@/lib/utils";
import { ORG_COOKIE } from "@/lib/org-cookie";
import { cookies } from "next/headers";

function serializeSystem(s: Awaited<ReturnType<typeof prisma.aiSystem.findFirst>>) {
  if (!s) return null;
  return {
    ...s,
    dataTypes: parseJsonArray(s.dataTypes),
    scanMetadata: parseJsonSafe<Record<string, unknown> | null>(s.scanMetadata, null),
  };
}

export async function GET() {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const cookieStore = await cookies();
  const orgId = cookieStore.get(ORG_COOKIE)?.value;
  const org = await requireOrganization(session.user.id, orgId);

  const systems = await prisma.aiSystem.findMany({
    where: { organizationId: org.id },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({
    systems: systems.map((s) => serializeSystem(s)!),
  });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const cookieStore = await cookies();
  const orgId = cookieStore.get(ORG_COOKIE)?.value;
  const org = await requireOrganization(session.user.id, orgId);

  const json = await req.json();
  const parsed = aiSystemSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const system = await prisma.aiSystem.create({
    data: {
      organizationId: org.id,
      name: data.name,
      description: data.description ?? null,
      purpose: data.purpose,
      dataTypes: JSON.stringify(data.dataTypes),
      vendor: data.vendor ?? null,
      deploymentEnv: data.deploymentEnv ?? null,
      roleType: data.roleType,
      riskCategory: data.riskCategory,
      annexIIIArea: data.annexIIIArea ?? null,
      humanOversight: data.humanOversight ?? null,
      intendedUsers: data.intendedUsers ?? null,
      status: data.status,
      source: "manual",
    },
  });

  return NextResponse.json({ system: serializeSystem(system) }, { status: 201 });
}
