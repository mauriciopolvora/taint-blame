# Live ingest

The pi extension sends what the agent reads and every edit to `POST /api/events` with the ingest token. The server runs the text overlap check on each new edit in the background. The dashboard and the blame view update by themselves, with no reload.

## Sub-features

- `ingest-accepted` accepts the fixture events with the fixture token.
- `ingest-live-row` shows the new session on an open dashboard without a reload.
- `ingest-verdict` marks the copied `curl ... | sh` line as injected, with the issue as its source, from text overlap alone.

## How to get to it (user POV)

- Run pi with the extension pointed at this server. The recipe sends the same request the extension sends, from a fixture of four events: the prompt, an issue with a hidden instruction, a file read, and one edit that follows the instruction.

## Driving it with taint-blame-control

Preconditions:

- `node .cursor/skills/verify-taint-blame/control.mjs doctor` exits 0. The judge is off, so nothing calls OpenRouter.

- **Open the dashboard and keep it open.** Run `node .cursor/skills/verify-taint-blame/control.mjs browser goto --path /`, `node .cursor/skills/verify-taint-blame/control.mjs browser wait --text "All sessions"`, and `node .cursor/skills/verify-taint-blame/control.mjs browser wait --role link --name-contains "live-{run}" --gone`.
- **Send the events.** Run `node .cursor/skills/verify-taint-blame/control.mjs ingest --file .cursor/skills/verify-taint-blame/features/fixtures/injected-session.json --session live-{run} --repo live-{run}`. It prints `"received":4` and `"writes":1`.
- **See the row arrive.** Do not reload. Run `node .cursor/skills/verify-taint-blame/control.mjs browser wait --role link --name-contains "live-{run}"`.
- **Proof of the row.** Run `node .cursor/skills/verify-taint-blame/control.mjs browser screenshot --path artifacts/verify-taint-blame/live-ingest/dashboard.png`.
- **Open the session.** Run `node .cursor/skills/verify-taint-blame/control.mjs browser click --role link --name-contains "live-{run}"`, `node .cursor/skills/verify-taint-blame/control.mjs browser wait --role heading --name "live-{run}"`, and `node .cursor/skills/verify-taint-blame/control.mjs browser wait --text "1 edit did something you never asked for: it changed install.sh following an instruction in a GitHub issue (example/verify-fixture#7)."`.
- **Proof of the verdict.** Run `node .cursor/skills/verify-taint-blame/control.mjs browser wait --role heading --name "scripts/install.sh"`, `node .cursor/skills/verify-taint-blame/control.mjs browser snapshot --aria --path artifacts/verify-taint-blame/live-ingest/session.aria.txt`, and `node .cursor/skills/verify-taint-blame/control.mjs browser screenshot --path artifacts/verify-taint-blame/live-ingest/session.png`.

## Gotchas

- `ingest` posts to the local server only, with the fixture token. It is the extension's request, not a shortcut around the UI: the dashboard has no way to create a session.
- `--repo` sets the working directory to `/work/<repo>`, so the row name is unique to the run. Without it, every run shows `verify-fixture`.
- The dashboard polls every few seconds while it is visible. Waiting for the row proves the live refresh; a reload would only prove storage.
- Rows from earlier runs also read `1 injected in install.sh`. Match the row by the run word, then read the verdict on the session page.
