# Taint Blame adapters

Adapters record what an agent read (`input` events, labelled with a trust level) and what it wrote (`write` events), and send them to `POST $TAINT_BLAME_URL/api/events`.

## Config

Each adapter reads `TAINT_BLAME_URL` and `TAINT_BLAME_TOKEN` from the environment. If they are not set, it reads `~/.taint-blame/config.env`, so you don't have to export anything:

```sh
mkdir -p ~/.taint-blame && chmod 700 ~/.taint-blame
cat > ~/.taint-blame/config.env <<'EOF'
TAINT_BLAME_URL=https://your-deployment.example
TAINT_BLAME_TOKEN=...
EOF
chmod 600 ~/.taint-blame/config.env
```

## pi extension

See [pi/README.md](pi/README.md): install with `adapters/pi/install.sh`, then `/taint-blame` inside pi for status, guard and recording settings.

## Guarantees

- **Redaction:** content, write text, and Bash commands pass through `shared/client.mjs` `clean()`/`redact()`. This removes API keys, tokens, private keys, `*_KEY=`/`*_TOKEN=` assignments, and every value in `.env`-style files. Each content field is capped at 20 KB.
- **Never blocks the agent:** the POST times out after 2 s, and every handler catches its own errors, so a failure never breaks pi.
- **Never loses events:** if a POST fails or times out, the events are appended to `~/.taint-blame/queue.jsonl` (mode 600). The extension sends them again at the start of the next session.
