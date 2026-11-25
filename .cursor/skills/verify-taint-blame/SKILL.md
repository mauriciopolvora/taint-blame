---
name: verify-taint-blame
description: Drive the Taint Blame dashboard in a browser the way a developer does, on a local dev server with local D1, a fixture token and the judge off. Covers the sessions list, the blame view, the API token in Settings, deleting a session, live ingest from the pi extension's request, and the about page. Use when proving a Taint Blame UI or API change against the local app.
---

# Verify Taint Blame

The primary surface is the dashboard at `http://127.0.0.1:3000`. A developer opens the sessions list, opens a session to see which edits the agent made because of outside content, saves the ingest token in Settings, and deletes sessions. Sessions come from the pi extension, which posts agent events to `POST /api/events`. The dashboard has no form that creates a session, so the `ingest` helper sends the extension's request with a fixture.

Never drive a deployed worker. Never pass `--remote` to wrangler. The D1 id in `wrangler.jsonc` is the hosted database; local D1 under `.wrangler/state/v3/d1` is a different store, and it is the only one this skill touches.

The skill lives in `.cursor/skills/verify-taint-blame/`. `.claude/skills/verify-taint-blame` and `.agents/skills/verify-taint-blame` are symlinks to it. Edit the `.cursor` copy.

## Launch

From the repo root, with Node.js 22.18 or newer:

```bash
npm ci
node .cursor/skills/verify-taint-blame/control.mjs launch
node .cursor/skills/verify-taint-blame/control.mjs seed
```

Skip `npm ci` when `node_modules` is already present.

`launch` does three things:

1. It makes sure `.dev.vars` is the verify fixture: `INGEST_TOKEN=verify-local-token` and `JUDGE_ENABLED=false`. When the file is missing, launch writes it and cleanup removes it again. When the file has other content, launch stops and asks you to move it aside. It never prints, uses or changes your own `.dev.vars`.
2. It applies `migrations/` to local D1 with `wrangler d1 migrations apply taint-blame --local`.
3. It runs `npm run dev` (Vite on port 3000, workerd, local D1) in its own process group, and waits until `GET /` is HTTP 200 with the title `Taint Blame`.

The log is `node_modules/.cache/verify-taint-blame/dev.log`. If the shell `node` is older than 22.18, the helper re-execs with a newer Node from `~/.nvm` when one is installed.

`seed` runs `scripts/seed-local.sql` against local D1. The seed deletes and inserts its own three sessions, so you can run it again at any time. It does not remove other rows.

The judge stays off. `JUDGE_ENABLED=false` and no `OPENROUTER_API_KEY`, so attribution uses text overlap only and nothing leaves the machine.

## Doctor

```bash
node .cursor/skills/verify-taint-blame/control.mjs doctor
```

Run this first whenever anything looks off. It exits 0 only when all of these are true:

- `launch` recorded a process group in `node_modules/.cache/verify-taint-blame/dev.json`
- the listener on port 3000 is in that process group
- `GET /` is HTTP 200 and the HTML title is `Taint Blame`
- `POST /api/verify` is HTTP 401 without a token and HTTP 200 with the fixture token, so the server loaded the `.dev.vars` fixture

## Drive

The harness is `taint-blame-control`. Browser commands launch headless Chrome on first use, with a profile at `node_modules/.cache/verify-taint-blame/chrome-profile`, and reuse it, so the saved token in local storage survives later commands. The run state stays under `node_modules/.cache/` because Vite reloads the page when a watched file in the checkout changes. Read `features/README.md`, then follow one feature file literally.

Chrome comes from `CHROME_PATH`, else `google-chrome` or `chromium` on `PATH`. With no Chrome on `PATH`, point `CHROME_PATH` at a Playwright build, for example `export CHROME_PATH=$(ls -d ~/.cache/ms-playwright/chromium-*/chrome-linux*/chrome | head -1)`.

```bash
node .cursor/skills/verify-taint-blame/control.mjs browser goto --path /settings
node .cursor/skills/verify-taint-blame/control.mjs browser fill --role textbox --name "Ingest token" --value "verify-local-token"
node .cursor/skills/verify-taint-blame/control.mjs browser click --role button --name "Verify"
node .cursor/skills/verify-taint-blame/control.mjs browser wait --text "Connected"
node .cursor/skills/verify-taint-blame/control.mjs browser click --role link --name-contains "1 injected in retry.ts"
node .cursor/skills/verify-taint-blame/control.mjs ingest --file .cursor/skills/verify-taint-blame/features/fixtures/injected-session.json --session live-r1 --repo live-r1
```

Stable handles are accessible names, not coordinates:

- links `Sessions`, `Settings` and `About Taint Blame` in the sidebar
- a dashboard row is a link whose name holds the repository, the agent and the finding, for example `1 injected in retry.ts`. Match it with `--name-contains`, because the name also holds a relative time.
- heading with the repository name on the blame view, for example `acme-http`
- checkbox `Outside only (2)`, and the DisclosureTriangle `How we decided (3 signals)`
- textbox `Ingest token`, buttons `Show`, `Verify`, `Save` and `Remove`
- button `Delete session`, then dialog `Delete this session?` with textbox `Type delete to confirm`

## Evidence

Write proof under `artifacts/verify-taint-blame/<feature-id>/`. That directory is gitignored. Cleanup does not delete it.

A proof drives the page a developer uses. It does not insert rows with SQL, set `localStorage`, or call `/api/reset` or `/api/verify` to arrange the result. The one API a recipe calls is `POST /api/events` through `ingest`, because that is the extension's job, not the developer's. Capture the action and the resulting state: an ARIA snapshot and a PNG screenshot. After a mutation, reload and read the result again.

```bash
node .cursor/skills/verify-taint-blame/control.mjs browser snapshot --aria --path artifacts/verify-taint-blame/blame-view/injected.aria.txt
node .cursor/skills/verify-taint-blame/control.mjs browser screenshot --path artifacts/verify-taint-blame/blame-view/injected.png
```

## Cleanup

```bash
node .cursor/skills/verify-taint-blame/control.mjs cleanup
```

This sends SIGTERM, then SIGKILL, to the process groups recorded for the dev server and every Chrome profile. It deletes the Chrome profiles and the run json files, and the `.dev.vars` fixture when launch wrote it. It does not delete `artifacts/verify-taint-blame/` or `.wrangler/`. After a failed launch or a stuck browser, run cleanup before starting again. Do not kill `node` or `chrome` by name.

Sessions that recipes send (`live-*`, `del-*`) stay in local D1. They do not break later recipes, because each recipe matches its own run word.

## Run every recipe

```bash
node .cursor/skills/verify-taint-blame/run-recipes.mjs
node .cursor/skills/verify-taint-blame/run-recipes.mjs blame-view live-ingest
```

The runner launches, doctors and seeds the app, then runs each feature in `features/README.md` in index order, or only the feature ids you name. Before each feature it closes every browser and seeds again, so each recipe starts with no saved token and the three seeded sessions. It sets `TAINT_BLAME_WAIT_MS=60000`. It runs the literal `control.mjs` commands from the feature's `Driving it with taint-blame-control` bullets, in order (an indented line continues the bullet above it), with `{run}` replaced by one new word for the whole run, and stops that feature at the first command that exits 1. A `control.mjs` command outside a `- **Step.**` bullet (other than launch, doctor, seed and cleanup), a mention of `control.mjs` that is not one backtick command, and a step label with no closing `**` fail the feature. It prints one `PASS <feature>` or `FAIL <feature>: step ... got: <reason>` line per feature, runs doctor after a failure, and runs cleanup at the end. The full transcript is `artifacts/verify-taint-blame/run.log`. Exit 0 means every feature passed.

The runner proves that the commands in a recipe succeed. It does not read the screenshots. Open the PNGs under `artifacts/verify-taint-blame/<feature-id>/` before you call a visual claim proven.

## Helpers

`node .cursor/skills/verify-taint-blame/control.mjs` with no command prints usage and exits 1. The commands are `launch`, `doctor`, `seed`, `ingest`, `cleanup`, `reset-browsers`, and `browser`.

| Command | Effect |
| --- | --- |
| `seed` | Runs `scripts/seed-local.sql` against local D1. |
| `ingest --file <json> --session <id> [--repo <name>]` | Posts the events in `<json>` to `POST /api/events` with the fixture token, as session `<id>`, with times ending now. `--repo` sets the working directory to `/work/<name>`. Fails unless the server answers 200. |
| `reset-browsers` | Stops every Chrome this skill started and deletes their profiles. The dev server stays up. |
| `browser click --role <role> --name <name>` | Clicks the single accessible node with that role and name. Fails when the node is disabled. |
| `browser fill --role <role> --name <name> --value <value>` | Focuses that control and sets its value so React sees the input. |
| `browser wait --text <text>` | Waits until the visible page text contains `<text>`. Optional `--timeout` milliseconds, default `TAINT_BLAME_WAIT_MS` or 15000. |
| `browser wait --role <role> --name <name>` | Waits until one or more nodes match. |
| `browser wait ... --gone` | With `--text` or `--role` and a name, waits until the text or every matching node is gone. |
| `browser snapshot --aria --path <path>` | Writes the accessible tree and prints it. |
| `browser screenshot --path <path>` | Writes a PNG of the 1280×900 page. |
| `browser reload` | Reloads the current page and keeps the profile's local storage. |
| `browser goto --path <path>` | Opens `<path>` on the app origin. It refuses a path that leaves the origin, a `#fragment`, and an HTTP status of 400 or more. |

Every `--name` also has a `--name-contains <part>` form, which matches a part of the accessible name, and an `--in <role>` scope, which keeps only nodes inside a node with that role. A session page has two `Sessions` links (the sidebar and the breadcrumb), so the recipes use `--name "Sessions" --in complementary`. Every browser command takes `--profile <id>` (lowercase letters and digits) to drive that profile instead of the first one.

Exit 0 prints a short status line. Exit 1 prints the reason. On a miss, click, fill, and wait list other names of the same role.
