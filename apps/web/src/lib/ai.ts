export type LlmMessage = { role: "system" | "user"; content: string };

export type LlmResult = {
  text: string;
  provider: "openai" | "anthropic" | "mock";
  mocked: boolean;
  /** Set when mocked is true — explains provider failure or missing API keys. */
  mockReason?: string;
};

function providerErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function completeChat(messages: LlmMessage[]): Promise<LlmResult> {
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  const failures: string[] = [];

  if (openaiKey) {
    try {
      const text = await callOpenAI(openaiKey, messages);
      return { text, provider: "openai", mocked: false };
    } catch (e) {
      console.error("OpenAI error:", e);
      failures.push(`OpenAI: ${providerErrorMessage(e)}`);
    }
  }

  if (anthropicKey) {
    try {
      const text = await callAnthropic(anthropicKey, messages);
      return { text, provider: "anthropic", mocked: false };
    } catch (e) {
      console.error("Anthropic error:", e);
      failures.push(`Anthropic: ${providerErrorMessage(e)}`);
    }
  }

  const mockReason =
    failures.length > 0
      ? failures.join("; ")
      : "No LLM API key configured (set OPENAI_API_KEY or ANTHROPIC_API_KEY)";

  return {
    text: mockFromMessages(messages),
    provider: "mock",
    mocked: true,
    mockReason,
  };
}

const DEFAULT_OPENAI_BASE_URL = "https://api.swiftrouter.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5.2";

function openAiChatCompletionsUrl(): string {
  const base = (process.env.OPENAI_BASE_URL ?? DEFAULT_OPENAI_BASE_URL).replace(/\/$/, "");
  return `${base}/chat/completions`;
}

async function callOpenAI(apiKey: string, messages: LlmMessage[]): Promise<string> {
  const res = await fetch(openAiChatCompletionsUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL,
      messages,
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

async function callAnthropic(apiKey: string, messages: LlmMessage[]): Promise<string> {
  const system = messages.find((m) => m.role === "system")?.content;
  const userMessages = messages.filter((m) => m.role === "user");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL ?? "claude-3-5-haiku-20241022",
      max_tokens: 4096,
      system,
      messages: userMessages.map((m) => ({ role: "user", content: m.content })),
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content?: { text?: string }[] };
  return data.content?.[0]?.text?.trim() ?? "";
}

function mockFromMessages(messages: LlmMessage[]): string {
  const user = messages.find((m) => m.role === "user")?.content ?? "";
  if (user.includes("classify") || user.includes("risk")) {
    return JSON.stringify({
      riskCategory: "limited",
      annexIIIArea: null,
      rationale:
        "[MOCK] Based on inventory fields, this appears to be a limited-risk AI system (transparency obligations may apply). Set OPENAI_API_KEY or ANTHROPIC_API_KEY for live classification.",
      obligations: [
        "Document intended purpose and limitations",
        "Ensure users know they interact with AI where applicable",
        "Maintain technical documentation (Annex IV if provider of high-risk)",
      ],
    });
  }
  if (user.includes("questionnaire") || user.includes("Question:")) {
    return JSON.stringify({
      answers: [
        {
          question: "Sample (mock): Do you maintain an AI systems inventory?",
          answer:
            "Yes. We maintain a centralized inventory in Registack AI, reviewed quarterly. (Enable an LLM API key for answers grounded in your org data.)",
          confidence: "medium",
          evidenceRefs: ["inventory-registry"],
        },
      ],
      note: "MOCK MODE — configure OPENAI_API_KEY or ANTHROPIC_API_KEY for RAG-backed answers.",
    });
  }
  return "Mock LLM response. Configure OPENAI_API_KEY or ANTHROPIC_API_KEY for production-quality output.";
}

export function extractJson<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced?.[1]?.trim() ?? text.trim();
  try {
    return JSON.parse(raw) as T;
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}
