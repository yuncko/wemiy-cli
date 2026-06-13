import type { AiSystem } from "@prisma/client";
import { parseJsonArray } from "./utils";

export function buildInventoryContext(orgName: string, systems: AiSystem[]): string {
  if (systems.length === 0) {
    return `Organization "${orgName}" has no AI systems registered yet.`;
  }

  return systems
    .map((s, i) => {
      const dataTypes = parseJsonArray(s.dataTypes);
      return [
        `### System ${i + 1}: ${s.name}`,
        `- ID: ${s.id}`,
        `- Purpose: ${s.purpose}`,
        `- Description: ${s.description ?? "n/a"}`,
        `- Risk: ${s.riskCategory}`,
        `- Role: ${s.roleType}`,
        `- Vendor: ${s.vendor ?? "n/a"}`,
        `- Environment: ${s.deploymentEnv ?? "n/a"}`,
        `- Data types: ${dataTypes.join(", ") || "n/a"}`,
        `- Human oversight: ${s.humanOversight ?? "n/a"}`,
        `- Annex III: ${s.annexIIIArea ?? "n/a"}`,
        `- Classification: ${s.classificationRationale ?? "not yet classified"}`,
      ].join("\n");
    })
    .join("\n\n");
}

export function splitQuestionnaireQuestions(text: string): string[] {
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const questions: string[] = [];
  let buf = "";

  for (const line of lines) {
    const isNumbered = /^\d+[\).\]]\s/.test(line) || /^[-*]\s/.test(line) || line.endsWith("?");
    if (isNumbered && buf) {
      questions.push(buf.trim());
      buf = line;
    } else {
      buf = buf ? `${buf}\n${line}` : line;
    }
  }
  if (buf.trim()) questions.push(buf.trim());

  if (questions.length === 0 && text.trim()) return [text.trim()];
  return questions.slice(0, 30);
}
