import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, requireOrganization } from "@/lib/session";
import { completeChat, extractJson } from "@/lib/ai";
import { parseJsonArray } from "@/lib/utils";
import { cookies } from "next/headers";
import { ORG_COOKIE } from "@/lib/org-cookie";

type Params = { params: Promise<{ id: string }> };

type ClassificationResult = {
  riskCategory: string;
  annexIIIArea: string | null;
  rationale: string;
  obligations: string[];
};

export async function POST(_req: Request, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const cookieStore = await cookies();
  const org = await requireOrganization(session.user.id, cookieStore.get(ORG_COOKIE)?.value);

  const system = await prisma.aiSystem.findFirst({
    where: { id, organizationId: org.id },
  });
  if (!system) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const dataTypes = parseJsonArray(system.dataTypes);
  const prompt = `You are an EU AI Act compliance assistant. Classify this AI system.

Return ONLY valid JSON:
{
  "riskCategory": "minimal" | "limited" | "high" | "unacceptable",
  "annexIIIArea": string | null,
  "rationale": "2-4 sentences citing relevant factors",
  "obligations": ["bullet obligations for this tier"]
}

System:
- Name: ${system.name}
- Purpose: ${system.purpose}
- Description: ${system.description ?? "n/a"}
- Role: ${system.roleType}
- Vendor: ${system.vendor ?? "n/a"}
- Data types: ${dataTypes.join(", ") || "unknown"}
- Human oversight: ${system.humanOversight ?? "not specified"}
- Environment: ${system.deploymentEnv ?? "n/a"}`;

  const { text, provider, mocked, mockReason } = await completeChat([
    {
      role: "system",
      content:
        "Respond with JSON only. Be conservative: if uncertain about high-risk Annex III, prefer 'limited' and note uncertainty.",
    },
    { role: "user", content: prompt },
  ]);

  const parsed = extractJson<ClassificationResult>(text);
  const result: ClassificationResult = parsed ?? {
    riskCategory: "limited",
    annexIIIArea: null,
    rationale: text.slice(0, 500),
    obligations: ["Review classification with legal counsel"],
  };

  const validRisks = ["minimal", "limited", "high", "unacceptable", "unclassified"];
  const riskCategory = validRisks.includes(result.riskCategory)
    ? result.riskCategory
    : "limited";

  const updated = await prisma.aiSystem.update({
    where: { id },
    data: {
      riskCategory,
      annexIIIArea: result.annexIIIArea,
      classificationRationale: result.rationale,
      status: system.status === "draft" ? "active" : system.status,
    },
  });

  return NextResponse.json({
    system: { ...updated, dataTypes: parseJsonArray(updated.dataTypes) },
    obligations: result.obligations,
    provider,
    mocked,
    mockReason: mocked ? mockReason : undefined,
  });
}
