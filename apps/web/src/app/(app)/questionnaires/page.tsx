"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

type Session = {
  id: string;
  title: string;
  responses: { question: string; answer: string; confidence: string }[];
  createdAt: string;
};

export default function QuestionnairesPage() {
  const [title, setTitle] = useState("Enterprise SIG");
  const [inputText, setInputText] = useState(
    "1. Do you maintain an inventory of AI systems?\n2. How do you classify AI risk under the EU AI Act?\n3. Describe human oversight for automated decisions."
  );
  const [sessions, setSessions] = useState<Session[]>([]);
  const [answers, setAnswers] = useState<Session["responses"]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    const res = await fetch("/api/questionnaires");
    if (res.ok) {
      const data = await res.json();
      setSessions(data.sessions);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/questionnaires", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, inputText }),
    });
    setLoading(false);
    const data = await res.json();
    if (!res.ok) {
      toast.error("Failed to generate answers");
      return;
    }
    setAnswers(data.session.responses);
    if (data.mocked) {
      toast.warning(data.mockReason ?? "Answers used mock LLM — provider unavailable");
    } else {
      toast.success("Answers generated");
    }
    load();
  }

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold">Security questionnaire helper</h1>
        <p className="text-muted-foreground">AI-suggested answers grounded in your inventory (RAG-lite)</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Paste questionnaire</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Questions</Label>
              <Textarea value={inputText} onChange={(e) => setInputText(e.target.value)} className="min-h-[160px]" />
            </div>
            <Button type="submit" disabled={loading}>
              {loading ? "Generating…" : "Generate answers"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {answers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Latest answers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {answers.map((a, i) => (
              <div key={i} className="border rounded-lg p-4 space-y-2">
                <p className="font-medium text-sm">{a.question}</p>
                <p className="text-sm text-muted-foreground">{a.answer}</p>
                <p className="text-xs text-muted-foreground">Confidence: {a.confidence}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {sessions.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">History</h2>
          {sessions.map((s) => (
            <p key={s.id} className="text-sm text-muted-foreground">
              {s.title} — {new Date(s.createdAt).toLocaleString()} ({s.responses.length} answers)
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
