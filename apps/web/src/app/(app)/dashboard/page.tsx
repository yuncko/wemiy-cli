import { prisma } from "@/lib/prisma";
import { getSession, getActiveOrganization } from "@/lib/session";
import { cookies } from "next/headers";
import { ORG_COOKIE } from "@/lib/org-cookie";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default async function DashboardPage() {
  const session = await getSession();
  const cookieStore = await cookies();
  const org = await getActiveOrganization(session!.user!.id, cookieStore.get(ORG_COOKIE)?.value);
  if (!org) return null;

  const [systems, scans, questionnaires, healthRes] = await Promise.all([
    prisma.aiSystem.findMany({ where: { organizationId: org.id } }),
    prisma.codeScan.count({ where: { organizationId: org.id } }),
    prisma.questionnaireSession.count({ where: { organizationId: org.id } }),
    fetch(`${process.env.BETTER_AUTH_URL ?? "http://localhost:3010"}/api/health`, { cache: "no-store" }).then((r) => r.json()).catch(() => null),
  ]);

  const byRisk = systems.reduce<Record<string, number>>((acc, s) => {
    acc[s.riskCategory] = (acc[s.riskCategory] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">AI compliance posture for {org.name}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>AI systems</CardDescription>
            <CardTitle className="text-3xl">{systems.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Code scans</CardDescription>
            <CardTitle className="text-3xl">{scans}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Questionnaires</CardDescription>
            <CardTitle className="text-3xl">{questionnaires}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>API health</CardDescription>
            <CardTitle className="text-lg capitalize">{healthRes?.status ?? "unknown"}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              LLM: {healthRes?.checks?.llmConfigured ? "configured" : "mock mode"}
            </p>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Risk distribution</CardTitle>
          <CardDescription>EU AI Act risk categories in your inventory</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {Object.entries(byRisk).map(([risk, count]) => (
            <Badge key={risk} variant="secondary">
              {risk}: {count}
            </Badge>
          ))}
          {systems.length === 0 && <p className="text-sm text-muted-foreground">No systems yet.</p>}
        </CardContent>
      </Card>
      <div className="flex gap-3 flex-wrap">
        <Button asChild>
          <Link href="/inventory">Manage inventory</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/scans">Run GitHub scan</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/documents">Export Annex IV</Link>
        </Button>
      </div>
    </div>
  );
}
