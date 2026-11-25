# Taint Blame verification map

This directory is the maintained source for verifying the user-facing behavior of the Taint Blame dashboard. Read this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch with `node .cursor/skills/verify-taint-blame/control.mjs launch`, so the server on `http://127.0.0.1:3000` belongs to this run. Launch writes the `.dev.vars` fixture when the file is missing and applies the D1 migrations to local D1.
- Run `node .cursor/skills/verify-taint-blame/control.mjs doctor` and require the owned listener, the title `Taint Blame`, and the verify API at 401 without a token and 200 with the fixture token.
- Run `node .cursor/skills/verify-taint-blame/control.mjs seed`, so local D1 holds the three seeded sessions from `scripts/seed-local.sql`.
- Use a fresh Chrome profile. `reset-browsers` deletes every profile, so no token is saved.
- Never drive a deployed worker, never pass `--remote` to wrangler, and never type a real token. The judge stays off: no request leaves the machine.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise.
- Prefer ARIA roles and accessible names over CSS selectors or screen position. Use `--name-contains` where a name holds a relative time.
- Treat every command as literal. Keep quoted names and flags unchanged. `{run}` is one new word for the whole run.
- Run browser actions through `node .cursor/skills/verify-taint-blame/control.mjs browser`.
- Send agent events only with `node .cursor/skills/verify-taint-blame/control.mjs ingest`. It is the request the pi extension sends.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes an ARIA snapshot or a screenshot, with the page heading visible.
- Mutation proof includes a reload, then the same fact read again from the page.
- Record the feature id and entry point used with every artifact.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with taint-blame-control` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Sessions list](./sessions-list.md) covers the dashboard rows, the injected count, and opening a session.
- [Blame view](./blame-view.md) covers the summary, the injected card, How we decided, and the Outside only filter.
- [Settings: API token](./settings-token.md) covers a wrong token, Verify, Save, a reload, and Remove.
- [Delete a session](./delete-session.md) covers the token gate, the typed confirm, and the row gone after a reload.
- [Live ingest](./live-ingest.md) covers the extension's request, the row that arrives without a reload, and the injected verdict from text overlap.
- [About page](./welcome.md) covers the landing page from the sidebar and the way back.

## Route coverage

Each route the app serves names the recipes that drive it. Add a row with a new route under `src/routes/`.

| Route | Recipes |
| --- | --- |
| `GET /` | [Sessions list](./sessions-list.md), [Live ingest](./live-ingest.md) |
| `GET /sessions/$id` | [Blame view](./blame-view.md), [Delete a session](./delete-session.md), [Live ingest](./live-ingest.md) |
| `GET /settings` | [Settings: API token](./settings-token.md), [Delete a session](./delete-session.md) |
| `GET /welcome` | [About page](./welcome.md) |
| `POST /api/events` | [Live ingest](./live-ingest.md), [Delete a session](./delete-session.md) |
| `POST /api/verify` | [Settings: API token](./settings-token.md) |
| `POST /api/reset` | [Delete a session](./delete-session.md) (one session). No recipe drives the reset of every session. |
| `POST /api/attribute` | No recipe. The dashboard does not call it; it re-runs attribution after the judge is turned on, and the judge stays off here. |
