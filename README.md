# Wemiy CLI

AI-assisted CLI for fixes, project health checks, commits, reviews, and PR prep. Published as [`@louedev/wemiy`](https://www.npmjs.com/package/@louedev/wemiy) (binary: **`wemiy`**).

![Banner](https://github.com/user-attachments/assets/b90038ef-87e4-414a-b167-a161109dcdfe)

## Features

- **Fix** — AI-assisted fixes for a file
- **Doctor** — Scan the project for bugs, performance, security, and bad practices (`--changed-only`, `--max-files`, optional cache)
- **Commit** — Conventional commit messages from your diff
- **Review** — AI code review for current changes
- **PR Ready** — Review/fix changed files, tests, commit message, PR description
- **Agent** — Agentic workflows
- **Model** — Switch provider (Gemini, OpenRouter, SwiftRouter)
- **Wake Up** — Daily assistant prompt
- **Login / Logout / Whoami** — Better Auth device flow (optional; requires the auth server)

## Repository layout

| Path | Role |
|------|------|
| [`server/`](server/) | CLI package (`wemiy`), Express API + Prisma + Better Auth |
| [`client/`](client/) | Next.js app for auth/device flow |
| `react-tailwind-todo-app/` | Sample app (not required for the CLI) |
| `ecommerce-site/` | Static demo site (optional) |

## Installation

From npm:

```bash
npm install -g @louedev/wemiy
```

From this repo:

```bash
git clone https://github.com/yuncko/wemiy-cli.git
cd wemiy-cli/server
npm install
npm link
```

## Environment variables

| Variable | Purpose |
|----------|---------|
| `OPENROUTER_API_KEY` | OpenRouter provider |
| `GEMINI_API_KEY` / Google env | Gemini (see provider docs) |
| `BACKEND_URL` | Auth server URL for `wemiy login` (default `http://localhost:3005`) |
| `FRONTEND_URL` | Web app origin for CORS/device flow |
| `ORBITAL_DEBUG` or `WEMIY_DEBUG` | Set to `true` for debug logs |

**Secrets:** Prefer environment variables for API keys. If you store keys in `~/.wemiy/config.json`, treat that file like a credential — restrict permissions and never commit it.

Create `server/.env` for local API development (see `server` README patterns).

## Commands

```bash
wemiy doctor [--path <dir>] [--fix] [--json] [--changed-only] [--max-files <n>] [--use-cache]
wemiy fix <file>
wemiy commit
wemiy review
wemiy pr-ready [--dry-run]
wemiy model
wemiy agent
wemiy wake-up
wemiy login [--server-url <url>]
wemiy logout
wemiy whoami
```

Examples:

```bash
wemiy doctor --path .
wemiy doctor --changed-only --max-files 20
wemiy pr-ready --dry-run
wemiy fix src/app.js
```

## Tech stack

- Node.js (ESM), Commander, AI SDK / providers
- Express 5 + Better Auth + Prisma (auth API in `server/`)

## Contributing

Issues and PRs are welcome. Run tests from `server/`:

```bash
cd server && npm test
```

## License

MIT
