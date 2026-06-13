import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, requireOrganization } from "@/lib/session";
import { githubScanSchema } from "@/lib/validations";
import { scanGitHubRepository } from "@/lib/scanner";
import { cookies } from "next/headers";
import { ORG_COOKIE } from "@/lib/org-cookie";
import { parseJsonSafe } from "@/lib/utils";

type ScanFindingsPayload = {
  findings: unknown[];
  filesScanned: string[];
  errors: string[];
  draftSystemIds?: string[];
};

export async function GET() {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const cookieStore = await cookies();
  const org = await requireOrganization(session.user.id, cookieStore.get(ORG_COOKIE)?.value);

  const scans = await prisma.codeScan.findMany({
    where: { organizationId: org.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return NextResponse.json({
    scans: scans.map((s) => ({
      ...s,
      findings: parseJsonSafe<ScanFindingsPayload>(s.findings, {
        findings: [],
        filesScanned: [],
        errors: [],
      }),
    })),
  });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const cookieStore = await cookies();
  const org = await requireOrganization(session.user.id, cookieStore.get(ORG_COOKIE)?.value);

  const json = await req.json();
  const parsed = githubScanSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { repoUrl, branch, token, createDrafts } = parsed.data;

  const scan = await prisma.codeScan.create({
    data: {
      organizationId: org.id,
      repoUrl,
      branch,
      status: "running",
    },
  });

  try {
    const result = await scanGitHubRepository(repoUrl, branch, token);
    const draftIds: string[] = [];

    if (createDrafts && result.findings.length > 0) {
      const grouped = groupFindings(result.findings);
      for (const g of grouped) {
        const created = await prisma.aiSystem.create({
          data: {
            organizationId: org.id,
            name: g.name,
            purpose: g.purpose,
            description: `Auto-detected from ${repoUrl} (${g.files.join(", ")})`,
            vendor: g.vendor ?? null,
            deploymentEnv: "repository",
            roleType: "provider",
            riskCategory: "unclassified",
            status: "draft",
            source: "scan",
            scanMetadata: JSON.stringify({ patterns: g.patterns, files: g.files }),
            dataTypes: JSON.stringify([]),
          },
        });
        draftIds.push(created.id);
      }
    }

    const updated = await prisma.codeScan.update({
      where: { id: scan.id },
      data: {
        status: "completed",
        findings: JSON.stringify({
          ...result,
          draftSystemIds: draftIds,
        }),
      },
    });

    return NextResponse.json({
      scan: {
        ...updated,
        findings: parseJsonSafe<ScanFindingsPayload>(updated.findings, {
          findings: [],
          filesScanned: [],
          errors: [],
        }),
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Scan failed";
    await prisma.codeScan.update({
      where: { id: scan.id },
      data: { status: "failed", errorMessage: message },
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function groupFindings(
  findings: { pattern: string; file: string; suggestedName: string; suggestedPurpose: string; vendor?: string }[]
) {
  const map = new Map<string, { name: string; purpose: string; vendor?: string; patterns: Set<string>; files: Set<string> }>();

  for (const f of findings) {
    const key = f.pattern;
    const entry = map.get(key) ?? {
      name: f.suggestedName,
      purpose: f.suggestedPurpose,
      vendor: f.vendor,
      patterns: new Set<string>(),
      files: new Set<string>(),
    };
    entry.patterns.add(f.pattern);
    entry.files.add(f.file);
    map.set(key, entry);
  }

  return [...map.values()].map((v) => ({
    name: v.name,
    purpose: v.purpose,
    vendor: v.vendor,
    patterns: [...v.patterns],
    files: [...v.files],
  }));
}
