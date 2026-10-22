# Taint Blame adapters

Adapters record what an agent read (`input` events, labelled with a trust level) and what it wrote (`write` events), and send them to `POST $TAINT_BLAME_URL/api/events`.

## Config

The extension reads `TAINT_BLAME_URL` and `TAINT_BLAME_TOKEN` from the environment, or from `.taint-blame/config.env` in this repo (gitignored, mode 600). Nothing is written outside the repo:

```sh
mkdir -p .taint-blame && chmod 700 .taint-blame
grep -E '^TAINT_BLAME_(URL|TOKEN)=' .env.adapter > .taint-blame/config.env
chmod 600 .taint-blame/config.env
```

## pi extension

See [pi/README.md](pi/README.md): install with `bin/install-pi` (a single symlink into pi; settings stay in the repo), then `/taint-blame` inside pi for status, guard and recording settings.

## Guarantees

- **Redaction:** content, write text, and Bash commands pass through `shared/client.mjs` `clean()`/`redact()`. This removes API keys, tokens, private keys, `*_KEY=`/`*_TOKEN=` assignments, and every value in `.env`-style files. Each content field is capped at 20 KB.
- **Never blocks the agent:** sends run in the background with an 8 s timeout, and every handler catches its own errors, so a failure never breaks pi.
- **Never loses events:** if a POST fails or times out, the events are appended to `.taint-blame/queue.jsonl` in this repo (mode 600). The extension sends them again at the start of the next session.
