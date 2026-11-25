# Settings: API token

`/settings` holds the ingest token for this browser. Verify asks the server whether the token is right. Save keeps it in this browser only, and the protected actions (Delete session, Delete all sessions) send it as a bearer header. Remove forgets it.

## Sub-features

- `token-invalid` shows `Invalid token` for a wrong token.
- `token-connected` shows `Connected` for the fixture token.
- `token-save` saves the token, shows the toast, and keeps it after a reload.
- `token-remove` removes the saved token.

## How to get to it (user POV)

- Choose Settings in the sidebar from any page.

## Driving it with taint-blame-control

Preconditions:

- `node .cursor/skills/verify-taint-blame/control.mjs doctor` exits 0. It proves the dev server loaded the `.dev.vars` fixture, whose ingest token is `verify-local-token`.
- The browser profile is fresh, so no token is saved.

- **Open Settings.** Run `node .cursor/skills/verify-taint-blame/control.mjs browser goto --path /`, `node .cursor/skills/verify-taint-blame/control.mjs browser wait --text "All sessions"`, `node .cursor/skills/verify-taint-blame/control.mjs browser click --role link --name "Settings"`, and `node .cursor/skills/verify-taint-blame/control.mjs browser wait --text "No token saved yet."`.
- **Try a wrong token.** Run `node .cursor/skills/verify-taint-blame/control.mjs browser fill --role textbox --name "Ingest token" --value "wrong-{run}"`, `node .cursor/skills/verify-taint-blame/control.mjs browser click --role button --name "Verify"`, and `node .cursor/skills/verify-taint-blame/control.mjs browser wait --text "Invalid token"`.
- **Verify the fixture token.** Run `node .cursor/skills/verify-taint-blame/control.mjs browser fill --role textbox --name "Ingest token" --value "verify-local-token"`, `node .cursor/skills/verify-taint-blame/control.mjs browser click --role button --name "Verify"`, and `node .cursor/skills/verify-taint-blame/control.mjs browser wait --line "Connected"`.
- **Proof of Connected.** Run `node .cursor/skills/verify-taint-blame/control.mjs browser snapshot --aria --path artifacts/verify-taint-blame/settings-token/connected.aria.txt` and `node .cursor/skills/verify-taint-blame/control.mjs browser screenshot --path artifacts/verify-taint-blame/settings-token/connected.png`. The field shows dots, not the token.
- **Save it.** Run `node .cursor/skills/verify-taint-blame/control.mjs browser click --role button --name "Save"` and `node .cursor/skills/verify-taint-blame/control.mjs browser wait --text "Token saved in this browser"`.
- **Read it after a reload.** Run `node .cursor/skills/verify-taint-blame/control.mjs browser reload`, `node .cursor/skills/verify-taint-blame/control.mjs browser wait --text "A token is saved in this browser."`, and `node .cursor/skills/verify-taint-blame/control.mjs browser wait --role button --name "Remove"`.
- **Proof of the saved token.** Run `node .cursor/skills/verify-taint-blame/control.mjs browser screenshot --path artifacts/verify-taint-blame/settings-token/saved.png`. The danger zone no longer says `Save your API token above to enable this.`
- **Remove it.** Run `node .cursor/skills/verify-taint-blame/control.mjs browser click --role button --name "Remove"`, `node .cursor/skills/verify-taint-blame/control.mjs browser wait --text "Token removed"`, and `node .cursor/skills/verify-taint-blame/control.mjs browser wait --text "No token saved yet."`.

## Gotchas

- `verify-local-token` is the fixture from `.dev.vars` that launch writes. It is not a real token. Never type a token from `.taint-blame/config.env` or a deployed worker.
- Verify reads the field, not the saved token. Save is disabled until the field differs from the saved value.
- The token lives in this Chrome profile's local storage. The runner deletes the profile before each recipe.
