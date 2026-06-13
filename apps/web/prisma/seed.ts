import { PrismaClient } from "@prisma/client";
import { auth } from "../src/lib/auth";

const prisma = new PrismaClient();

const DEMO_EMAIL = "demo@registack.ai";
const DEMO_PASSWORD = "demo12345";

async function main() {
  const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  let userId = existing?.id;

  if (!userId) {
    const signUp = await auth.api.signUpEmail({
      body: {
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
        name: "Demo User",
      },
    });
    if (!signUp?.user?.id) {
      throw new Error("Failed to create demo user");
    }
    userId = signUp.user.id;
    console.log("Created demo user:", DEMO_EMAIL);
  } else {
    console.log("Demo user exists:", DEMO_EMAIL);
  }

  let org = await prisma.organization.findUnique({ where: { slug: "acme-saas-demo" } });
  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: "Acme SaaS Demo",
        slug: "acme-saas-demo",
        memberships: { create: { userId: userId!, role: "owner" } },
      },
    });
    console.log("Created demo organization:", org.name);
  }

  const count = await prisma.aiSystem.count({ where: { organizationId: org.id } });
  if (count === 0) {
    await prisma.aiSystem.createMany({
      data: [
        {
          organizationId: org.id,
          name: "Customer Support Copilot",
          purpose: "Answer support tickets using retrieval-augmented generation",
          description: "Embedded in helpdesk UI for tier-1 support agents",
          dataTypes: JSON.stringify(["ticket_content", "customer_email"]),
          vendor: "OpenAI",
          deploymentEnv: "production",
          roleType: "provider",
          riskCategory: "limited",
          humanOversight: "Agents review AI drafts before sending to customers",
          intendedUsers: "Internal support staff",
          status: "active",
          source: "manual",
          classificationRationale:
            "Limited-risk: transparency to agents; no automated legal decisions without review.",
        },
        {
          organizationId: org.id,
          name: "Resume Screening Assistant",
          purpose: "Rank job applicants based on job description fit",
          description: "Used by HR for initial shortlisting",
          dataTypes: JSON.stringify(["employment_data", "personal_identifiers"]),
          vendor: "Anthropic",
          deploymentEnv: "production",
          roleType: "both",
          riskCategory: "high",
          annexIIIArea: "Employment, workers management and access to self-employment",
          humanOversight: "Recruiter must approve final shortlist; candidates may request human review",
          intendedUsers: "HR recruiters",
          status: "draft",
          source: "manual",
        },
        {
          organizationId: org.id,
          name: "OpenAI SDK (detected)",
          purpose: "OpenAI API integration",
          description: "Auto-detected pattern placeholder from scan workflow",
          dataTypes: JSON.stringify([]),
          vendor: "OpenAI",
          deploymentEnv: "repository",
          roleType: "provider",
          riskCategory: "unclassified",
          status: "draft",
          source: "scan",
        },
      ],
    });
    console.log("Seeded sample AI systems");
  }

  console.log("\n--- Demo credentials ---");
  console.log("Email:", DEMO_EMAIL);
  console.log("Password:", DEMO_PASSWORD);
  console.log("Org slug:", org.slug);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
