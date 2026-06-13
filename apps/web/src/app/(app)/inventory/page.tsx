"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type AiSystem = {
  id: string;
  name: string;
  purpose: string;
  description?: string | null;
  dataTypes: string[];
  vendor?: string | null;
  deploymentEnv?: string | null;
  roleType: string;
  riskCategory: string;
  annexIIIArea?: string | null;
  humanOversight?: string | null;
  status: string;
  classificationRationale?: string | null;
  source: string;
};

const emptyForm = {
  name: "",
  purpose: "",
  description: "",
  vendor: "",
  deploymentEnv: "production",
  roleType: "both",
  humanOversight: "",
  dataTypes: "personal_data, usage_logs",
};

export default function InventoryPage() {
  const [systems, setSystems] = useState<AiSystem[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [importJson, setImportJson] = useState("");

  async function load() {
    const res = await fetch("/api/inventory");
    if (!res.ok) {
      toast.error("Failed to load inventory");
      return;
    }
    const data = await res.json();
    setSystems(data.systems);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function createSystem(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        dataTypes: form.dataTypes.split(",").map((s) => s.trim()).filter(Boolean),
        status: "draft",
        riskCategory: "unclassified",
      }),
    });
    if (!res.ok) {
      toast.error("Failed to create system");
      return;
    }
    toast.success("AI system added");
    setForm(emptyForm);
    load();
  }

  async function classify(id: string) {
    const res = await fetch(`/api/inventory/${id}/classify`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Classification failed");
      return;
    }
    if (data.mocked) {
      toast.warning(data.mockReason ?? "Classification used mock LLM — provider unavailable");
    } else {
      toast.success("Classified");
    }
    load();
  }

  async function doImport() {
    try {
      const parsed = JSON.parse(importJson);
      const systemsPayload = Array.isArray(parsed) ? parsed : parsed.systems;
      const res = await fetch("/api/inventory/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systems: systemsPayload }),
      });
      if (!res.ok) throw new Error("Import failed");
      toast.success("Imported");
      setImportJson("");
      load();
    } catch {
      toast.error("Invalid JSON");
    }
  }

  if (loading) return <p className="text-muted-foreground">Loading inventory…</p>;

  return (
    <div className="space-y-8 max-w-5xl">
      <div>
        <h1 className="text-3xl font-bold">AI Systems Inventory</h1>
        <p className="text-muted-foreground">EU AI Act–aligned registry for your organization</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add system manually</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={createSystem} className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label>Vendor</Label>
              <Input value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="OpenAI" />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Purpose</Label>
              <Textarea value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} required />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Human oversight</Label>
              <Textarea value={form.humanOversight} onChange={(e) => setForm({ ...form, humanOversight: e.target.value })} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Data types (comma-separated)</Label>
              <Input value={form.dataTypes} onChange={(e) => setForm({ ...form, dataTypes: e.target.value })} />
            </div>
            <Button type="submit">Add to inventory</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Import JSON</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={importJson}
            onChange={(e) => setImportJson(e.target.value)}
            placeholder='{"systems":[{"name":"...","purpose":"..."}]}'
            className="min-h-[120px] font-mono text-xs"
          />
          <Button variant="outline" onClick={doImport}>
            Import
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Registered systems ({systems.length})</h2>
        {systems.map((s) => (
          <Card key={s.id}>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle className="text-lg">{s.name}</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">{s.purpose}</p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Badge>{s.riskCategory}</Badge>
                <Badge variant="secondary">{s.source}</Badge>
                <Badge variant="outline">{s.status}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {s.classificationRationale && (
                <p className="text-sm bg-muted p-3 rounded-md">{s.classificationRationale}</p>
              )}
              <Button size="sm" variant="outline" onClick={() => classify(s.id)}>
                Run risk classification
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
