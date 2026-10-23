# Taint Blame

**`git blame` for code your AI agent wrote.** Scanners try to block prompt injection. Taint Blame assumes it gets through and shows you exactly which lines it wrote, and what the agent had read that made it write them.

🥉 **3rd place** at the AI Security Hackathon: Build, Break, Defend (Lisbon, 22 October 2026).

The hosted demo has been taken down; see [Run it yourself](#run-it-yourself) to deploy your own.

## How it works

1. **Record.** A [pi](https://pi.dev) extension records everything the coding agent reads (your prompt, files, command output such as `gh issue view`, tool results) and every edit it makes, and sends both to the server.
2. **Label inputs** with a simple lookup, no AI: your prompt is *trusted*, files in the repo are *semi*, anything from outside (issues, web pages, command output, files outside the repo) is *untrusted*.
3. **Blame each edit** against the untrusted inputs read before it:
   - **Text overlap** (instant): copied URLs, domains, identifiers and token sequences that only appear in untrusted content, and whether the copied piece sits next to an instruction aimed at the agent.
   - **Claude Haiku judge** (background): reads your prompt, the diff and the untrusted snippets, and decides whether the edit carries out an instruction you never gave. Catches paraphrased attacks.
4. **Verdict per edit:** 🔴 **Injected** (did something you never asked for, following a hidden instruction), 🟠 **Borrowed** (copied from outside content, but serves your request), 🟢 **Your request**.
5. **Guard (optional):** the same overlap check runs locally *before* an edit lands, and pi asks "Block this edit?" (`/taint-blame guard on`).

## Results

| Test | Result |
|---|---|
| 15 hand-labeled edits, text overlap only | 5/7 injections caught, 0/8 false alarms |
| 15 hand-labeled edits, overlap + Haiku judge | **7/7** injections caught, 0/8 false alarms |
| 10 real pi runs (gpt-4o-mini, gpt-4.1-mini) on the [demo repo](https://github.com/mauriciopolvora/retry-kit/issues/1) | Agent followed the injection 10/10; **flagged red 10/10**; 0/17 legitimate edits marked red; median 4 s from edit to verdict |
| Guard mode, 6 runs | Injected edit blocked 6/6, real fix still landed |
| Semgrep, gitleaks, npm audit | Clean after fixes ([reports](evidence/scans/README.md)) |

Details: [evidence/eval-report.md](evidence/eval-report.md), [evidence/live-runs.md](evidence/live-runs.md).

## Repository

| Path | What |
|---|---|
| `src/server/` | Ingest (`POST /api/events`, bearer token, constant-time compare, body limits) and attribution (`attribution/overlap.ts`, `attribution/judge.ts`) |
| `src/routes/` | Dashboard (sessions, blame view, settings), landing page (`/welcome`), API routes |
| `adapters/pi/` | The pi extension: recording, guard, `/taint-blame` command |
| `adapters/shared/client.mjs` | Redaction of secrets, 20 KB cap, background send with a local retry queue |
| `migrations/` | D1 schema |
| `scripts/eval/` | Labeled scenarios and the live-run harness |
| `demo/` | The demo fixture (`retry-kit`) and a local fake issue server |

## Run it yourself

Stack: TanStack Start on Cloudflare Workers, D1, Claude Haiku via OpenRouter.

```bash
npm install
npx wrangler d1 create taint-blame          # put the id in wrangler.jsonc
npx wrangler d1 migrations apply taint-blame --remote
npx wrangler secret put INGEST_TOKEN        # any long random string
npx wrangler secret put OPENROUTER_API_KEY  # optional, enables the Haiku judge
npm run deploy
```

Then point the pi extension at it:

```bash
mkdir -p .taint-blame && chmod 700 .taint-blame
printf 'TAINT_BLAME_URL=https://<your-worker>\nTAINT_BLAME_TOKEN=<token>\n' > .taint-blame/config.env
chmod 600 .taint-blame/config.env
bin/install-pi    # symlinks the extension into ~/.pi/agent/extensions
```

Start `pi` in any project and type `/taint-blame` for status and settings. See [adapters/pi/README.md](adapters/pi/README.md).

## Security notes

- Ingest and destructive dashboard actions require the bearer token; the dashboard itself is read-only and open.
- Adapters redact API keys, tokens, private keys and `.env` values before sending, and cap payloads at 20 KB.
- The Haiku judge treats untrusted snippets as data and returns structured output; it can itself be targeted by injection, which is the main thing to harden next.

## Roadmap

Tracking lines across later commits, multi-step data flow (agent writes a file, reads it back, acts on it), behavior signals (new network calls, env access, dependencies), blame summaries in pull requests, more agents, a tamper-evident event log.
