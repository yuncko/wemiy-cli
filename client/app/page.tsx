"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Check,
  Code2,
  Copy,
  GitBranch,
  LogOut,
  MessageCircle,
  Zap,
} from "lucide-react";
import { LogoSVG } from "./svgs/logo";

export default function Home() {
  const { data, isPending } = authClient.useSession();
  const router = useRouter();
  const [hasCopied, setHasCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText("npm i orbital-cli");
    setHasCopied(true);
    setTimeout(() => setHasCopied(false), 1000);
  };

  const handleSignOut = async () => {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => router.push("/sign-in"),
      },
    });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navigation */}
      <nav className="border-b border-border/40 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center"> */}
            <LogoSVG height={56} width={56} />
            {/* </div> */}
            <span className="font-bold text-lg">Orbital CLI</span>
          </div>
          <div className="flex items-center gap-2">
            {!isPending && data?.session && data?.user ? (
              <>
                <Button
                  onClick={() => router.push("/dashboard")}
                  className="rounded-full"
                >
                  Dashboard
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleSignOut}
                  className="gap-2"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </Button>
              </>
            ) : (
              <Button
                onClick={() => router.push("/sign-in")}
                className="rounded-full"
              >
                Get Started
              </Button>
            )}
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 md:py-32">
        <div className="text-center space-y-8">
          <div className="inline-block px-4 py-2 rounded-full border border-border/40 bg-secondary/50 text-sm font-medium">
            🚀 AI-Powered CLI for Developers
          </div>

          <h1 className="text-4xl md:text-6xl font-bold text-balance leading-tight">
            Authenticate, Chat & Build with AI
          </h1>

          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto text-balance">
            Orbital CLI combines device-flow authentication, persistent AI chat,
            tool-calling capabilities, and an autonomous agent that generates
            complete applications for you.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
            <Button
              size="lg"
              onClick={() =>
                router.push(
                  !isPending && data?.session && data?.user
                    ? "/dashboard"
                    : "/sign-in",
                )
              }
              className="rounded-full px-8"
            >
              Get Started
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="rounded-full px-8 bg-transparent"
              onClick={() => {
                const npmSection = document.getElementById("install");
                npmSection?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              View Installation
            </Button>
          </div>

          <div className="pt-8 text-sm text-muted-foreground">
            Trusted by developers worldwide
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 md:py-32">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div className="space-y-8">
            <h2 className="text-3xl md:text-4xl font-bold">
              Powerful Features for Modern Development
            </h2>
            <div className="space-y-6">
              <div className="flex gap-4">
                <div className="w-12 h-12 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                  <GitBranch className="w-6 h-6 text-blue-500" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg">Device Flow Auth</h3>
                  <p className="text-muted-foreground">
                    Secure OAuth 2.0 Device Authorization Grant powered by
                    Better Auth and GitHub
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="w-12 h-12 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0">
                  <MessageCircle className="w-6 h-6 text-cyan-500" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg">
                    AI Chat with History
                  </h3>
                  <p className="text-muted-foreground">
                    Persistent conversations backed by PostgreSQL and Prisma
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="w-12 h-12 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0">
                  <Code2 className="w-6 h-6 text-green-500" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg">Tool-Calling Chat</h3>
                  <p className="text-muted-foreground">
                    Google Search, code execution, and URL context capabilities
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="w-12 h-12 rounded-lg bg-purple-500/10 flex items-center justify-center shrink-0">
                  <Zap className="w-6 h-6 text-purple-500" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg">Autonomous Agent</h3>
                  <p className="text-muted-foreground">
                    Generate complete applications with files, folders, and
                    setup commands
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="relative">
            <div className="absolute inset-0 bg-linear-to-br from-blue-500/20 to-cyan-500/20 rounded-2xl blur-3xl" />
            <div className="relative bg-card border border-border/40 rounded-2xl p-8 space-y-4 backdrop-blur-sm">
              <code className="text-sm font-mono text-cyan-400">
                $ orbital login
              </code>
              <code className="text-sm font-mono text-muted-foreground block">
                ✓ Authenticated with GitHub
              </code>
              <code className="text-sm font-mono text-green-400 block">
                $ orbital wakeup
              </code>
              <code className="text-sm font-mono text-muted-foreground block">
                ? Select mode:
              </code>
              <code className="text-sm font-mono text-muted-foreground block ml-4">
                › Chat
              </code>
              <code className="text-sm font-mono text-muted-foreground block ml-4">
                Tool Calling
              </code>
              <code className="text-sm font-mono text-muted-foreground block ml-4">
                Agentic Mode
              </code>
            </div>
          </div>
        </div>
      </section>

      {/* Installation Section */}
      <section
        id="install"
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 md:py-32 border-t border-border/40"
      >
        <div className="text-center space-y-8">
          <h2 className="text-3xl md:text-4xl font-bold">Quick Start</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Install Orbital CLI from npm and start building with AI
          </p>

          <div className="bg-card border border-border/40 rounded-xl p-6 inline-block backdrop-blur-sm">
            <div className="flex items-center gap-3 text-lg font-mono">
              <span className="text-muted-foreground">$</span>
              <span className="text-foreground">npm i orbital-cli</span>
              <button
                onClick={handleCopy}
                className="ml-4 p-2 hover:bg-secondary rounded-lg transition-colors"
                aria-label="Copy installation command"
              >
                {hasCopied ? (
                  <Check className="w-5 h-5 text-green-500" />
                ) : (
                  <Copy className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-6 pt-12">
            <div className="bg-card border border-border/40 rounded-xl p-6 backdrop-blur-sm space-y-3">
              <div className="text-3xl font-bold text-blue-500">1</div>
              <h3 className="font-semibold text-lg">Install</h3>
              <p className="text-sm text-muted-foreground">
                Install Orbital CLI globally using npm
              </p>
            </div>

            <div className="bg-card border border-border/40 rounded-xl p-6 backdrop-blur-sm space-y-3">
              <div className="text-3xl font-bold text-cyan-500">2</div>
              <h3 className="font-semibold text-lg">Authenticate</h3>
              <p className="text-sm text-muted-foreground">
                Run orbital login to authenticate with GitHub
              </p>
            </div>

            <div className="bg-card border border-border/40 rounded-xl p-6 backdrop-blur-sm space-y-3">
              <div className="text-3xl font-bold text-purple-500">3</div>
              <h3 className="font-semibold text-lg">Build</h3>
              <p className="text-sm text-muted-foreground">
                Use orbital wakeup to chat, call tools, or generate apps
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 md:py-32 border-t border-border/40">
        <div className="bg-linear-to-br from-blue-500/10 to-cyan-500/10 border border-blue-500/20 rounded-2xl p-12 md:p-16 text-center space-y-8">
          <h2 className="text-3xl md:text-4xl font-bold">
            Ready to Accelerate Your Development?
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Start building with Orbital CLI today. Authenticate securely, chat
            with AI, and generate complete applications autonomously.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button
              size="lg"
              onClick={() =>
                router.push(
                  !isPending && data?.session && data?.user
                    ? "/dashboard"
                    : "/sign-in",
                )
              }
              className="rounded-full px-8"
            >
              Get Started Now
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="rounded-full px-8 bg-transparent"
              onClick={() => {
                // Link to documentation or GitHub
                window.open(
                  "https://github.com/yuncko/Wemiy-CLI",
                  "_blank",
                );
              }}
            >
              View on GitHub
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/40 mt-20 py-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-8">
            <div className="flex items-center gap-2">
              {/* <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center"> */}
              <LogoSVG height={48} width={48} />
              {/* </div> */}
              <span className="font-bold">Wemiy CLI</span>
            </div>
            <p className="text-sm text-muted-foreground text-center md:text-right">
              © {new Date().getFullYear()} Wemiy CLI. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
