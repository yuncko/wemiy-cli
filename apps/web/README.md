# Registack AI (MVP)

Continuous AI compliance for B2B SaaS: EU AI Act inventory, GitHub scan stubs, risk classification, Annex IV export, and security questionnaire helper.

## Quick start

```bash
cd apps/web
cp .env.example .env
# Edit .env — set BETTER_AUTH_SECRET to a long random string

npm install
npx prisma migrate deploy
npm run db:seed
npm run dev
```

Open [http://localhost:3010](http://localhost:3010).

### Demo login (after seed)

| Field | Value |
|-------|-------|
| Email | `demo@registack.ai` |
| Password | `demo12345` |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server on port **3010** |
| `npm run build` | Production build |
| `npm run start` | Production server |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm run test` | Vitest unit tests |
| `npm run db:migrate` | Prisma migrate (dev) |
| `npm run db:seed` | Demo user + org + inventory |

## Environment variables

See [`.env.example`](.env.example).

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | SQLite path, e.g. `file:./dev.db` |
| `BETTER_AUTH_SECRET` | Yes | Session signing secret |
| `BETTER_AUTH_URL` | Yes | App URL, e.g. `http://localhost:3010` |
| `NEXT_PUBLIC_APP_URL` | Yes | Same as auth URL for client |
| `OPENAI_API_KEY` | No | Live LLM for classify / questionnaires |
| `ANTHROPIC_API_KEY` | No | Fallback LLM provider |
| `GITHUB_TOKEN` | No | Higher rate limits for repo scans |

Without LLM keys, classification and questionnaire answers use **mock mode** (clearly labeled).

## Docker

```bash
docker build -t registack-web apps/web
docker run -p 3010:3010 --env-file apps/web/.env registack-web
```

Health check: `GET /api/health`

## Features (MVP)

- Email/password auth (Better Auth) + multi-tenant organizations
- AI systems inventory (manual, JSON import, scan drafts)
- GitHub PAT/public repo scan for AI SDK patterns
- LLM risk classification with mock fallback
- Annex IV Markdown + PDF export
- Security questionnaire helper (inventory-grounded)
- Dashboard + health endpoint

## Project layout

```
apps/web/
  prisma/          Schema, migrations, seed
  src/app/         Next.js App Router pages & API
  src/components/  UI shell
  src/lib/         Auth, AI, scanner, Annex IV, PDF
```
