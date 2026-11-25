# About page

The sidebar link About Taint Blame opens the public landing page at `/welcome`. It explains the product and links back to the dashboard.

## Sub-features

- `welcome-open` opens the landing page from the dashboard sidebar.
- `welcome-back` returns to the dashboard from the landing page footer.

## How to get to it (user POV)

- On any dashboard page, choose About Taint Blame in the sidebar.
- Open `/welcome` directly.

## Driving it with taint-blame-control

Preconditions:

- `node .cursor/skills/verify-taint-blame/control.mjs doctor` exits 0.
- The browser profile is fresh. The runner closes every browser before each recipe.

- **Open the dashboard.** Run `node .cursor/skills/verify-taint-blame/control.mjs browser goto --path /` and `node .cursor/skills/verify-taint-blame/control.mjs browser wait --text "All sessions"`.
- **Open the about page.** Run `node .cursor/skills/verify-taint-blame/control.mjs browser click --role link --name "About Taint Blame"` and `node .cursor/skills/verify-taint-blame/control.mjs browser wait --role heading --name "git blame for code your AI agent wrote."`.
- **Proof.** Run `node .cursor/skills/verify-taint-blame/control.mjs browser snapshot --aria --path artifacts/verify-taint-blame/welcome/landing.aria.txt` and `node .cursor/skills/verify-taint-blame/control.mjs browser screenshot --path artifacts/verify-taint-blame/welcome/landing.png`. The screenshot shows the headline and the Open dashboard link.
- **Back to the dashboard.** Run `node .cursor/skills/verify-taint-blame/control.mjs browser click --role link --name "Dashboard"` and `node .cursor/skills/verify-taint-blame/control.mjs browser wait --text "All sessions"`.

## Gotchas

- The page has three links named Open dashboard, so the recipe uses the footer link Dashboard, which is unique.
- View demo issue links to github.com. Do not click it in a recipe: it leaves the local app.
