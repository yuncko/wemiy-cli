"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export default function DocumentsPage() {
  async function downloadMarkdown() {
    const res = await fetch("/api/documents/annex-iv");
    if (!res.ok) {
      toast.error("Export failed");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "annex-iv-draft.md";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Annex IV Markdown downloaded");
  }

  async function downloadPdf() {
    const res = await fetch("/api/documents/annex-iv?format=pdf");
    if (!res.ok) {
      toast.error("PDF export failed");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "annex-iv-draft.pdf";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Annex IV PDF downloaded");
  }

  async function previewJson() {
    const res = await fetch("/api/documents/annex-iv?format=json");
    const data = await res.json();
    if (!res.ok) {
      toast.error("Preview failed");
      return;
    }
    console.log(data);
    toast.success(`Preview ready (${data.systemCount} systems) — see console`);
  }

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold">Documents</h1>
        <p className="text-muted-foreground">Generate EU AI Act Annex IV technical documentation from your inventory</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Annex IV technical documentation</CardTitle>
          <CardDescription>
            Draft export from your AI systems registry. Requires legal review before submission.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3 flex-wrap">
          <Button onClick={downloadMarkdown}>Download Markdown</Button>
          <Button variant="outline" onClick={downloadPdf}>
            Download PDF
          </Button>
          <Button variant="outline" onClick={previewJson}>
            Preview metadata (JSON)
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
