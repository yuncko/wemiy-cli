import { z } from "zod";

export const aiSystemSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  purpose: z.string().min(1).max(2000),
  dataTypes: z.array(z.string()).default([]),
  vendor: z.string().max(200).optional().nullable(),
  deploymentEnv: z.string().max(200).optional().nullable(),
  roleType: z.enum(["provider", "deployer", "both"]).default("both"),
  riskCategory: z
    .enum(["unclassified", "minimal", "limited", "high", "unacceptable"])
    .default("unclassified"),
  annexIIIArea: z.string().max(500).optional().nullable(),
  humanOversight: z.string().max(2000).optional().nullable(),
  intendedUsers: z.string().max(500).optional().nullable(),
  status: z.enum(["draft", "active", "archived"]).default("draft"),
});

export const importInventorySchema = z.object({
  systems: z.array(aiSystemSchema).min(1).max(100),
});

export const githubScanSchema = z.object({
  repoUrl: z.string().url(),
  branch: z.string().min(1).max(100).default("main"),
  token: z.string().optional(),
  createDrafts: z.boolean().default(true),
});

export const questionnaireSchema = z.object({
  title: z.string().min(1).max(200),
  inputText: z.string().min(10).max(50000),
});
