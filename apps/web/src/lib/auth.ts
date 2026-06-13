import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "sqlite" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  trustedOrigins: [process.env.BETTER_AUTH_URL ?? "http://localhost:3010"],
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3010",
  secret: process.env.BETTER_AUTH_SECRET ?? "dev-secret-change-in-production",
});

export type Session = typeof auth.$Infer.Session;
