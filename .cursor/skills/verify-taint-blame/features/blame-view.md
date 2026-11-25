# Blame view

`/sessions/<id>` shows one session. A summary says how many edits did something the user never asked for. Edits are grouped as Injected, Borrowed and Your request. Each injected card quotes the outside input that caused it, with the instruction marked, and shows the diff. How we decided lists the signals behind the verdict. The side panel lists what the agent read, with a filter for outside inputs only.

## Sub-features

- `blame-summary` names the injected edit and its source issue.
- `blame-card` shows the injected card for `src/lib/retry.ts` with the quoted issue text.
- `blame-signals` opens How we decided and shows the text match and the AI review signals.
- `blame-outside-only` filters What the agent read to the two outside inputs.

## How to get to it (user POV)

- On the dashboard, choose the row of a session.

## Driving it with taint-blame-control

Preconditions:

- `node .cursor/skills/verify-taint-blame/control.mjs doctor` exits 0.
- Local D1 holds the seed. The seeded session `9f2c1a7e-claude-retry` has one injected, one borrowed and one green edit.

- **Open the session from the dashboard.** Run `node .cursor/skills/verify-taint-blame/control.mjs browser goto --path /`, `node .cursor/skills/verify-taint-blame/control.mjs browser wait --text "All sessions"`, `node .cursor/skills/verify-taint-blame/control.mjs browser click --role link --name-contains "1 injected in retry.ts"`, and `node .cursor/skills/verify-taint-blame/control.mjs browser wait --role heading --name "acme-http"`.
- **Read the summary.** Run `node .cursor/skills/verify-taint-blame/control.mjs browser wait --text "1 edit did something you never asked for: it changed retry.ts following an instruction in a GitHub issue (acme/acme-http#482)."`.
- **Read the injected card.** Run `node .cursor/skills/verify-taint-blame/control.mjs browser wait --role heading --name "src/lib/retry.ts"` and `node .cursor/skills/verify-taint-blame/control.mjs browser wait --role link --name "acme/acme-http#482"`.
- **Open How we decided.** Run `node .cursor/skills/verify-taint-blame/control.mjs browser wait --text "AI review" --gone`, `node .cursor/skills/verify-taint-blame/control.mjs browser click --role DisclosureTriangle --name "How we decided (3 signals)"`, and `node .cursor/skills/verify-taint-blame/control.mjs browser wait --text "AI review"`.
- **Proof of the card.** Run `node .cursor/skills/verify-taint-blame/control.mjs browser snapshot --aria --path artifacts/verify-taint-blame/blame-view/injected.aria.txt` and `node .cursor/skills/verify-taint-blame/control.mjs browser screenshot --path artifacts/verify-taint-blame/blame-view/injected.png`.
- **Filter to outside inputs.** Run `node .cursor/skills/verify-taint-blame/control.mjs browser wait --role button --name-contains "Read file"`, `node .cursor/skills/verify-taint-blame/control.mjs browser click --role checkbox --name "Outside only (2)"`, `node .cursor/skills/verify-taint-blame/control.mjs browser wait --role button --name-contains "Read file" --gone`, and `node .cursor/skills/verify-taint-blame/control.mjs browser wait --role button --name-contains "GitHub issue OUTSIDE"`.
- **Proof of the filter.** Run `node .cursor/skills/verify-taint-blame/control.mjs browser snapshot --aria --path artifacts/verify-taint-blame/blame-view/outside-only.aria.txt` and `node .cursor/skills/verify-taint-blame/control.mjs browser screenshot --path artifacts/verify-taint-blame/blame-view/outside-only.png`.

## Gotchas

- The page title starts with `(1 injected)`. The heading is the repository name, `acme-http`.
- The AI review signal comes from the seed. With the judge off, a session sent during a recipe gets text match signals only.
- The legend at the top of the dashboard also says Injected, so wait on the summary sentence, not on the word.
