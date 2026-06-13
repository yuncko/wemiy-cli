export type ScanFinding = {
  pattern: string;
  file: string;
  line?: number;
  snippet: string;
  suggestedName: string;
  suggestedPurpose: string;
  vendor?: string;
};

export type TreeEntry = { path: string; type: string; size?: number };

const AI_PATTERNS: { regex: RegExp; pattern: string; vendor?: string; purpose: string }[] = [
  { regex: /from\s+['"]openai['"]|require\(['"]openai['"]\)/, pattern: "openai-sdk", vendor: "OpenAI", purpose: "OpenAI API integration" },
  { regex: /@anthropic-ai\/sdk|from\s+['"]@anthropic-ai\/sdk['"]/, pattern: "anthropic-sdk", vendor: "Anthropic", purpose: "Anthropic API integration" },
  { regex: /from\s+['"]langchain|@langchain\//, pattern: "langchain", vendor: "LangChain", purpose: "LangChain orchestration" },
  { regex: /from\s+['"]@ai-sdk\//, pattern: "vercel-ai-sdk", vendor: "Vercel AI SDK", purpose: "AI SDK integration" },
  { regex: /OPENAI_API_KEY|ANTHROPIC_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY/, pattern: "ai-env-var", purpose: "AI provider API key reference" },
  { regex: /ChatOpenAI|Anthropic|GoogleGenerativeAI/, pattern: "llm-class", purpose: "LLM client instantiation" },
  { regex: /embeddings?\.create|text-embedding/, pattern: "embeddings", purpose: "Embedding generation" },
  { regex: /mcp.*server|@modelcontextprotocol/, pattern: "mcp", purpose: "Model Context Protocol usage" },
  { regex: /crewai|autogen|pydantic_ai/, pattern: "agent-framework", purpose: "Agent framework" },
];

/** Limits to keep scans bounded on large monorepos. */
export const SCAN_LIMITS = {
  maxFiles: 200,
  maxFileSizeBytes: 100_000,
  maxDepth: 12,
} as const;

const SKIP_DIR_SEGMENTS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  "vendor",
  "__pycache__",
  ".turbo",
  "out",
]);

const SCANNABLE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".rb",
  ".php",
  ".json",
  ".toml",
  ".yaml",
  ".yml",
  ".txt",
  ".md",
  ".env",
  ".example",
]);

const MANIFEST_FILENAMES = new Set([
  "package.json",
  "requirements.txt",
  "pyproject.toml",
  "go.mod",
  "Cargo.toml",
  "composer.json",
  "Gemfile",
  "Pipfile",
]);

const PRIORITY_PREFIXES = [
  "src/",
  "app/",
  "lib/",
  "packages/",
  "apps/",
  "api/",
  "pages/",
  "server/",
  "functions/",
];

export function detectAiPatterns(content: string, file: string): ScanFinding[] {
  const findings: ScanFinding[] = [];
  const lines = content.split("\n");

  for (const { regex, pattern, vendor, purpose } of AI_PATTERNS) {
    lines.forEach((line, idx) => {
      if (regex.test(line)) {
        findings.push({
          pattern,
          file,
          line: idx + 1,
          snippet: line.trim().slice(0, 200),
          suggestedName: `${pattern} in ${file.split("/").pop()}`,
          suggestedPurpose: purpose,
          vendor,
        });
      }
    });
  }
  return findings;
}

export function parseGitHubRepoUrl(repoUrl: string): { owner: string; repo: string } | null {
  try {
    const url = new URL(repoUrl.replace(/\.git$/, ""));
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1] };
  } catch {
    return null;
  }
}

function pathDepth(filePath: string): number {
  return filePath.split("/").length;
}

function isSkippedPath(filePath: string): boolean {
  return filePath.split("/").some((seg) => SKIP_DIR_SEGMENTS.has(seg));
}

function isScannableFile(filePath: string, size?: number): boolean {
  if (isSkippedPath(filePath)) return false;
  if (pathDepth(filePath) > SCAN_LIMITS.maxDepth) return false;
  if (size !== undefined && size > SCAN_LIMITS.maxFileSizeBytes) return false;

  const base = filePath.split("/").pop() ?? filePath;
  if (MANIFEST_FILENAMES.has(base)) return true;

  const dot = base.lastIndexOf(".");
  if (dot < 0) return false;
  return SCANNABLE_EXTENSIONS.has(base.slice(dot).toLowerCase());
}

function pathPriority(filePath: string): number {
  const lower = filePath.toLowerCase();
  for (let i = 0; i < PRIORITY_PREFIXES.length; i++) {
    if (lower.startsWith(PRIORITY_PREFIXES[i])) return i;
  }
  return PRIORITY_PREFIXES.length;
}

/** Filter and sort tree blobs for scanning (exported for tests). */
export function filterScannableFiles(
  entries: TreeEntry[],
  opts: { maxFiles?: number; maxFileSize?: number } = {}
): string[] {
  const maxFiles = opts.maxFiles ?? SCAN_LIMITS.maxFiles;
  const maxFileSize = opts.maxFileSize ?? SCAN_LIMITS.maxFileSizeBytes;

  return entries
    .filter((e) => e.type === "blob" && isScannableFile(e.path, e.size ?? 0))
    .filter((e) => (e.size ?? 0) <= maxFileSize)
    .sort((a, b) => {
      const pa = pathPriority(a.path);
      const pb = pathPriority(b.path);
      if (pa !== pb) return pa - pb;
      return a.path.localeCompare(b.path);
    })
    .slice(0, maxFiles)
    .map((e) => e.path);
}

function githubHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Registack-AI-Scanner",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function fetchGitHubFile(
  owner: string,
  repo: string,
  path: string,
  branch: string,
  token?: string
): Promise<string | null> {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(apiUrl, { headers: githubHeaders(token) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${path}`);

  const data = (await res.json()) as { content?: string; encoding?: string };
  if (!data.content) return null;
  return Buffer.from(data.content, "base64").toString("utf-8");
}

async function getBranchTreeSha(
  owner: string,
  repo: string,
  branch: string,
  token?: string
): Promise<string> {
  const refUrl = `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`;
  const refRes = await fetch(refUrl, { headers: githubHeaders(token) });
  if (!refRes.ok) {
    throw new Error(`GitHub ref ${refRes.status} for branch ${branch}`);
  }
  const refData = (await refRes.json()) as { object?: { sha?: string } };
  const sha = refData.object?.sha;
  if (!sha) throw new Error(`Could not resolve branch ${branch}`);
  return sha;
}

async function listRepoFiles(
  owner: string,
  repo: string,
  branch: string,
  token?: string
): Promise<string[]> {
  const treeSha = await getBranchTreeSha(owner, repo, branch, token);
  const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`;
  const treeRes = await fetch(treeUrl, { headers: githubHeaders(token) });
  if (!treeRes.ok) {
    throw new Error(`GitHub tree ${treeRes.status}`);
  }

  const treeData = (await treeRes.json()) as { tree?: TreeEntry[] };
  return filterScannableFiles(treeData.tree ?? []);
}

async function searchGitHubCode(
  owner: string,
  repo: string,
  branch: string,
  token: string | undefined,
  filesScanned: Set<string>,
  findings: ScanFinding[],
  errors: string[]
): Promise<void> {
  try {
    const q = encodeURIComponent(`repo:${owner}/${repo} openai OR langchain OR anthropic`);
    const res = await fetch(`https://api.github.com/search/code?q=${q}&per_page=30`, {
      headers: githubHeaders(token),
    });

    if (res.status === 403 && !token) {
      errors.push("Code search skipped: authentication required for this repository");
      return;
    }
    if (res.status === 429) {
      errors.push("Code search skipped: GitHub rate limit exceeded");
      return;
    }
    if (!res.ok) {
      errors.push(`Code search skipped: GitHub API ${res.status}`);
      return;
    }

    const data = (await res.json()) as { items?: { path: string }[] };
    for (const item of data.items ?? []) {
      if (filesScanned.has(item.path)) continue;
      try {
        const content = await fetchGitHubFile(owner, repo, item.path, branch, token);
        if (content) {
          filesScanned.add(item.path);
          findings.push(...detectAiPatterns(content, item.path));
        }
      } catch (e) {
        errors.push(`${item.path}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } catch (e) {
    errors.push(`Code search: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function scanGitHubRepository(
  repoUrl: string,
  branch: string,
  token?: string
): Promise<{ findings: ScanFinding[]; filesScanned: string[]; errors: string[] }> {
  const parsed = parseGitHubRepoUrl(repoUrl);
  if (!parsed) throw new Error("Invalid GitHub repository URL");

  const { owner, repo } = parsed;
  const findings: ScanFinding[] = [];
  const filesScanned = new Set<string>();
  const errors: string[] = [];
  const ghToken = token ?? process.env.GITHUB_TOKEN;

  let paths: string[] = [];
  try {
    paths = await listRepoFiles(owner, repo, branch, ghToken);
  } catch (e) {
    errors.push(`Tree walk: ${e instanceof Error ? e.message : String(e)}`);
  }

  for (const path of paths) {
    try {
      const content = await fetchGitHubFile(owner, repo, path, branch, ghToken);
      if (!content) continue;
      filesScanned.add(path);
      findings.push(...detectAiPatterns(content, path));
    } catch (e) {
      errors.push(`${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  await searchGitHubCode(owner, repo, branch, ghToken, filesScanned, findings, errors);

  const deduped = dedupeFindings(findings);
  return { findings: deduped, filesScanned: [...filesScanned], errors };
}

function dedupeFindings(findings: ScanFinding[]): ScanFinding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.pattern}:${f.file}:${f.line ?? 0}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
