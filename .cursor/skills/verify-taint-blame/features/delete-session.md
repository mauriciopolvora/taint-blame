# Delete a session

The blame view has Delete session. It needs a saved token. A dialog asks the user to type `delete`, then the session, its inputs, edits and verdicts go away, the page returns to the dashboard and shows `Session deleted`.

## Sub-features

- `delete-needs-token` keeps Delete session disabled until a token is saved.
- `delete-confirm` deletes after the user types `delete` in the dialog.
- `delete-gone` removes the row from the dashboard, also after a reload.

## How to get to it (user POV)

- Save the token in Settings, open a session from the dashboard, then choose Delete session in its header.

## Driving it with taint-blame-control

Preconditions:

- `node .cursor/skills/verify-taint-blame/control.mjs doctor` exits 0.
- The browser profile is fresh, so no token is saved.

- **Send a session to delete.** Run `node .cursor/skills/verify-taint-blame/control.mjs ingest --file .cursor/skills/verify-taint-blame/features/fixtures/injected-session.json --session del-{run} --repo del-{run}`. It prints `"writes":1`.
- **See Delete session disabled.** Run `node .cursor/skills/verify-taint-blame/control.mjs browser goto --path /`, `node .cursor/skills/verify-taint-blame/control.mjs browser wait --text "All sessions"`, `node .cursor/skills/verify-taint-blame/control.mjs browser click --role link --name-contains "del-{run}"`, `node .cursor/skills/verify-taint-blame/control.mjs browser wait --role heading --name "del-{run}"`, and `node .cursor/skills/verify-taint-blame/control.mjs browser wait --text "1 edit did something you never asked for"`. Clicking Delete session now fails with `is disabled`; the recipe does not run that click.
- **Save the token.** Run `node .cursor/skills/verify-taint-blame/control.mjs browser click --role link --name "Settings"`, `node .cursor/skills/verify-taint-blame/control.mjs browser fill --role textbox --name "Ingest token" --value "verify-local-token"`, `node .cursor/skills/verify-taint-blame/control.mjs browser click --role button --name "Save"`, and `node .cursor/skills/verify-taint-blame/control.mjs browser wait --text "Token saved in this browser"`.
- **Open the session again.** Run `node .cursor/skills/verify-taint-blame/control.mjs browser click --role link --name "Sessions" --in complementary`, `node .cursor/skills/verify-taint-blame/control.mjs browser wait --text "All sessions"`, `node .cursor/skills/verify-taint-blame/control.mjs browser click --role link --name-contains "del-{run}"`, and `node .cursor/skills/verify-taint-blame/control.mjs browser wait --role heading --name "del-{run}"`.
- **Open the dialog.** Run `node .cursor/skills/verify-taint-blame/control.mjs browser click --role button --name "Delete session"` and `node .cursor/skills/verify-taint-blame/control.mjs browser wait --text "Delete this session?"`.
- **Confirm.** Run `node .cursor/skills/verify-taint-blame/control.mjs browser fill --role textbox --name "Type delete to confirm" --value "delete"`, `node .cursor/skills/verify-taint-blame/control.mjs browser screenshot --path artifacts/verify-taint-blame/delete-session/dialog.png`, `node .cursor/skills/verify-taint-blame/control.mjs browser click --role button --name "Delete session"`, and `node .cursor/skills/verify-taint-blame/control.mjs browser wait --text "Session deleted"`.
- **See the row gone.** Run `node .cursor/skills/verify-taint-blame/control.mjs browser wait --text "All sessions"`, `node .cursor/skills/verify-taint-blame/control.mjs browser reload`, `node .cursor/skills/verify-taint-blame/control.mjs browser wait --text "All sessions"`, and `node .cursor/skills/verify-taint-blame/control.mjs browser wait --role link --name-contains "del-{run}" --gone`.
- **Proof.** Run `node .cursor/skills/verify-taint-blame/control.mjs browser snapshot --aria --path artifacts/verify-taint-blame/delete-session/after.aria.txt` and `node .cursor/skills/verify-taint-blame/control.mjs browser screenshot --path artifacts/verify-taint-blame/delete-session/after.png`.

## Gotchas

- The dialog has no accessible name (the `<dialog>` has no `aria-labelledby`), so `wait --role dialog --name ...` never matches. The recipe waits for its title text.
- While the dialog is open the page behind it is inert, so the dialog's Delete session button is the only one with that name.
- Opening `/sessions/del-{run}` after the delete is HTTP 404 (`Not found.`). `browser goto` fails on a 404, so the recipe proves the delete on the dashboard instead.
- Delete all sessions in Settings removes every local session, the seed too. No recipe drives it. The runner seeds again before each recipe if you drive it by hand.
