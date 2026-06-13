import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, requireOrganization } from "@/lib/session";
import { generateAnnexIvMarkdown } from "@/lib/annex-iv";
import { markdownToPdf } from "@/lib/pdf";
import { cookies } from "next/headers";
import { ORG_COOKIE } from "@/lib/org-cookie";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const cookieStore = await cookies();
  const org = await requireOrganization(session.user.id, cookieStore.get(ORG_COOKIE)?.value);

  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "markdown";
  const systemIds = url.searchParams.get("ids")?.split(",").filter(Boolean);

  const systems = await prisma.aiSystem.findMany({
    where: {
      organizationId: org.id,
      ...(systemIds?.length ? { id: { in: systemIds } } : {}),
    },
    orderBy: { name: "asc" },
  });

  const markdown = generateAnnexIvMarkdown(org.name, systems);
  const date = new Date().toISOString().slice(0, 10);

  if (format === "json") {
    return NextResponse.json({ markdown, systemCount: systems.length });
  }

  if (format === "pdf") {
    const pdfBytes = await markdownToPdf(markdown);
    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="annex-iv-${org.slug}-${date}.pdf"`,
      },
    });
  }

  const filename = `annex-iv-${org.slug}-${date}.md`;
  return new NextResponse(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
