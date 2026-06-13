import { describe, expect, it } from "vitest";
import { generateAnnexIvMarkdown } from "./annex-iv";

describe("generateAnnexIvMarkdown", () => {
  it("includes organization name and system details", () => {
    const md = generateAnnexIvMarkdown("Acme Demo", [
      {
        id: "1",
        organizationId: "org",
        name: "Test Bot",
        description: null,
        purpose: "Support chat",
        dataTypes: '["email"]',
        vendor: "OpenAI",
        deploymentEnv: "prod",
        roleType: "provider",
        riskCategory: "limited",
        annexIIIArea: null,
        humanOversight: "Human review required",
        intendedUsers: "Agents",
        status: "active",
        classificationRationale: "Limited risk",
        source: "manual",
        scanMetadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    expect(md).toContain("Acme Demo");
    expect(md).toContain("Test Bot");
    expect(md).toContain("Support chat");
    expect(md).toContain("DRAFT");
  });
});
