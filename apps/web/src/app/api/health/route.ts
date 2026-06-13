import { prisma } from "@/lib/prisma";

export async function GET() {
  const started = Date.now();
  let db = "ok";

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    db = "error";
  }

  const hasLlm = Boolean(
    process.env.OPENAI_API_KEY?.trim() || process.env.ANTHROPIC_API_KEY?.trim()
  );

  const status = db === "ok" ? "healthy" : "degraded";
  return Response.json(
    {
      status,
      version: process.env.npm_package_version ?? "0.1.0",
      checks: {
        database: db,
        llmConfigured: hasLlm,
      },
      latencyMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    },
    { status: db === "ok" ? 200 : 503 }
  );
}
