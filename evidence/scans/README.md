# Security scans

Run on 2026-10-22 against the full repo (node_modules, dist and generated types excluded).

| Tool | Command | Result |
|---|---|---|
| Semgrep | `semgrep scan --config p/default --config p/javascript --config p/typescript --config p/secrets` | First run: 3 INFO `unsafe-formatstring` (template strings as console format strings in `adapters/import.mjs`, `src/server/attribution.ts`). Fixed by passing constant format strings. Rerun: **0 findings** (`semgrep.json`). |
| gitleaks (git history) | `gitleaks git . --redact` | **No leaks** in any commit (`gitleaks.json`). |
| gitleaks (working tree) | `gitleaks dir . --redact` | 1 hit: the ingest token in `.env.adapter`, a local file that is gitignored and never committed (`gitleaks-dir.json`, value redacted). Expected. |
| npm audit | `npm audit --json` | **0 vulnerabilities** (`npm-audit.json`). |

Secrets live only in Wrangler secrets (`INGEST_TOKEN`, `OPENROUTER_API_KEY`) and gitignored local files (`.dev.vars`, `.env.adapter`, `~/.taint-blame/config.env`, mode 600).
