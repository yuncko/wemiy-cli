"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type Scan = {
  id: string;
  repoUrl: string;
  branch: string;
  status: string;
  findings: {
    findings: { pattern: string; file: string; snippet: string }[];
    filesScanned: string[];
    errors: string[];
    draftSystemIds?: string[];
  };
  createdAt: string;
};

export default function ScansPage() {
  const [scans, setScans] = useState<Scan[]>([]);
  const [repoUrl, setRepoUrl] = useState("https://github.com/vercel/ai");
  const [branch, setBranch] = useState("main");
  const [token, setToken] = useState("");
  const [running, setRunning] = useState(false);

  async function load() {
    const res = await fetch("/api/scans/github");
    if (res.ok) {
      const data = await res.json();
      setScans(data.scans);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function runScan(e: React.FormEvent) {
    e.preventDefault();
    setRunning(true);
    const res = await fetch("/api/scans/github", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repoUrl,
        branch,
        token: token || undefined,
        createDrafts: true,
      }),
    });
    setRunning(false);
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Scan failed");
      return;
    }
    toast.success(`Scan complete — ${data.scan.findings.findings?.length ?? 0} patterns found`);
    load();
  }

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold">GitHub code scan</h1>
        <p className="text-muted-foreground">
          Detect OpenAI, Anthropic, LangChain, env vars, and agent frameworks in your repository
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Run scan</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={runScan} className="space-y-4">
            <div className="space-y-2">
              <Label>Repository URL</Label>
              <Input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Branch</Label>
              <Input value={branch} onChange={(e) => setBranch(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>GitHub PAT (optional)</Label>
              <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_…" />
            </div>
            <Button type="submit" disabled={running}>
              {running ? "Scanning…" : "Scan & create draft inventory items"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Recent scans</h2>
        {scans.map((scan) => (
          <Card key={scan.id}>
            <CardHeader className="flex flex-row justify-between">
              <CardTitle className="text-base font-mono">{scan.repoUrl}</CardTitle>
              <Badge variant={scan.status === "completed" ? "default" : "secondary"}>{scan.status}</Badge>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <p>Branch: {scan.branch}</p>
              <p>Files scanned: {scan.findings?.filesScanned?.join(", ") || "—"}</p>
              <p>Findings: {scan.findings?.findings?.length ?? 0}</p>
              {scan.findings?.draftSystemIds?.length ? (
                <p className="text-primary">Created {scan.findings.draftSystemIds.length} draft inventory items</p>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
