# Sessions list

The dashboard at `/` lists every recorded session. Each row shows the repository, the agent, the finding (injected, borrowed, your request, or still being checked), the edit count, the inputs read and the last activity. A row with injected code has a red edge and a red count. Choosing a row opens the blame view of that session.

## Sub-features

- `list-rows` shows one row for each seeded session, with its finding.
- `list-injected-count` shows `N with injected code` above the list. N counts every session with an injected edit, so it grows with the rows of earlier runs. No recipe checks N.
- `list-open` opens a session from its row.

## How to get to it (user POV)

- Open `/`, or choose Sessions in the sidebar from any page.

## Driving it with taint-blame-control

Preconditions:

- `node .cursor/skills/verify-taint-blame/control.mjs doctor` exits 0.
- Local D1 holds the seed. The runner runs `node .cursor/skills/verify-taint-blame/control.mjs seed` before each recipe.

- **Open the dashboard.** Run `node .cursor/skills/verify-taint-blame/control.mjs browser goto --path /` and `node .cursor/skills/verify-taint-blame/control.mjs browser wait --text "All sessions"`.
- **Read the seeded rows.** Run `node .cursor/skills/verify-taint-blame/control.mjs browser wait --role link --name-contains "1 injected in retry.ts"`, `node .cursor/skills/verify-taint-blame/control.mjs browser wait --role link --name-contains "Every edit traces to your request"`, and `node .cursor/skills/verify-taint-blame/control.mjs browser wait --role link --name-contains "Checking 1 edit"`.
- **Proof of the list.** Run `node .cursor/skills/verify-taint-blame/control.mjs browser snapshot --aria --path artifacts/verify-taint-blame/sessions-list/list.aria.txt` and `node .cursor/skills/verify-taint-blame/control.mjs browser screenshot --path artifacts/verify-taint-blame/sessions-list/list.png`. The red row reads `1 injected in retry.ts`.
- **Open the injected session.** Run `node .cursor/skills/verify-taint-blame/control.mjs browser click --role link --name-contains "1 injected in retry.ts"` and `node .cursor/skills/verify-taint-blame/control.mjs browser wait --role heading --name "acme-http"`.
- **Back through the sidebar.** Run `node .cursor/skills/verify-taint-blame/control.mjs browser click --role link --name "Sessions" --in complementary` and `node .cursor/skills/verify-taint-blame/control.mjs browser wait --text "All sessions"`.

## Gotchas

- Row names include a relative time such as `34 days ago`, so match rows with `--name-contains` on the finding text, never the full name.
- The seed has two `acme-http` rows. Match on the finding, not the repository name.
- The seeded `Checking 1 edit` row stays pending on purpose: the seed inserts an edit with no verdict, and nothing runs attribution on seeded rows.
- The header count (`N with injected code`) includes rows from earlier runs, so the recipe does not check a number. It checks the seeded rows instead.
- Rows from earlier recipes (`live-*`, `del-*`) stay in local D1. The seed restores its own three sessions and does not remove other rows.
