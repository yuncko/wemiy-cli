import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, requireOrganization } from "@/lib/session";
import { questionnaireSchema } from "@/lib/validations";
import { completeChat, extractJson } from "@/lib/ai";
import { buildInventoryContext, splitQuestionnaireQuestions } from "@/lib/inventory-context";
import { cookies } from "next/headers";
import { ORG_COOKIE } from "@/lib/org-cookie";
import { parseJsonSafe } from "@/lib/utils";

export async function GET() {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const cookieStore = await cookies();
  const org = await requireOrganization(session.user.id, cookieStore.get(ORG_COOKIE)?.value);

  const sessions = await prisma.questionnaireSession.findMany({
    where: { organizationId: org.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return NextResponse.json({
    sessions: sessions.map((s) => ({
      ...s,
      responses: parseJsonSafe<unknown[]>(s.responses, []),
    })),
  });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const cookieStore = await cookies();
  const org = await requireOrganization(session.user.id, cookieStore.get(ORG_COOKIE)?.value);

  const json = await req.json();
  const parsed = questionnaireSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const systems = await prisma.aiSystem.findMany({
    where: { organizationId: org.id },
    orderBy: { updatedAt: "desc" },
  });

  const inventoryContext = buildInventoryContext(org.name, systems);
  const questions = splitQuestionnaireQuestions(parsed.data.inputText);

  const prompt = `Answer security/compliance questionnaire questions using ONLY the organization inventory below.
If inventory lacks info, say what is unknown and suggest safe generic controls.

Inventory:
${inventoryContext}

Questions:
${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}

Return JSON:
{
  "answers": [
    {
      "question": "...",
      "answer": "...",
      "confidence": "high" | "medium" | "low",
      "evidenceRefs": ["system name or inventory field"]
    }
  ]
}`;

  const { text, provider, mocked, mockReason } = await completeChat([
    {
      role: "system",
      content: "You are a B2B SaaS security questionnaire assistant. Be accurate; cite inventory. JSON only.",
    },
    { role: "user", content: `questionnaire classify\n\n${prompt}` },
  ]);

  type AnswerPayload = {
    answers: {
      question: string;
      answer: string;
      confidence: string;
      evidenceRefs: string[];
    }[];
  };

  const extracted = extractJson<AnswerPayload>(text);
  const responses =
    extracted?.answers ??
    questions.map((q) => ({
      question: q,
      answer: mocked
        ? "[MOCK] Configure LLM API keys for inventory-grounded answers."
        : text.slice(0, 500),
      confidence: "low",
      evidenceRefs: [],
    }));

  const record = await prisma.questionnaireSession.create({
    data: {
      organizationId: org.id,
      title: parsed.data.title,
      inputText: parsed.data.inputText,
      responses: JSON.stringify(responses),
    },
  });

  return NextResponse.json({
    session: { ...record, responses },
    provider,
    mocked,
    mockReason: mocked ? mockReason : undefined,
  });
}
