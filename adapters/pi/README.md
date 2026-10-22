# Taint Blame adapter for pi

A pi extension (`taint-blame.ts`) that sends what the agent read and wrote to Taint Blame.

| pi event | Event sent |
|---|---|
| `input` | `input`, source `user_prompt`, trusted |
| `tool_result` read | `input`, source `read`, trust from `fileTrust()` (`.pi/` and paths outside cwd are untrusted) |
| `tool_result` bash | `input`, source `bash`, untrusted, `source_ref` = command |
| `tool_result` grep/find/ls | `input`, semi when the searched path is inside cwd, otherwise untrusted |
| `tool_result` any other tool (custom, MCP) | `input`, source = tool name, untrusted, `source_ref` = JSON args |
| `tool_result` edit | one `write` per `edits[]` entry (ts +1 ms each) |
| `tool_result` write | `write`, `old_text` = file content captured in `tool_call` before the write, or `""` for a new file |

The session id is pi's own session id (`ctx.sessionManager.getSessionId()`, a UUIDv7). It also works with `--no-session`. Sends are fire-and-forget. `agent_settled` and `session_shutdown` wait for in-flight sends, so `pi -p` does not exit before they finish. Failed sends go to `~/.taint-blame/queue.jsonl` and are retried at the next `session_start`.

## Install

```sh
adapters/pi/install.sh
```

This symlinks `~/.pi/agent/extensions/taint-blame.ts` to this file. If `~/.taint-blame/config.env` does not exist, it also writes it from the repo's `.env.adapter` (mode 600). The extension finds `../shared/client.mjs` through the symlink's real path, so it must stay a symlink, not a copy.

To load it for one run instead: `pi -e /path/to/taint-blame/adapters/pi/taint-blame.ts ...`

## Config

`TAINT_BLAME_URL` and `TAINT_BLAME_TOKEN` come from the environment. If they are not set, the extension reads `~/.taint-blame/config.env` (`KEY=value` lines).

## Tested with

```sh
cd /private/tmp/claude-501/tb-pi-test
pi -p -e ~/Developer/taint-blame/adapters/pi/taint-blame.ts "read notes.md and append a line saying hello" < /dev/null
```

The model was pi's configured default, `openai/gpt-6.1-sol` (ChatGPT/Codex OAuth). No OpenRouter key was configured. With a ChatGPT account, the Codex backend rejects `gpt-4o-mini` and `gpt-5.4-mini`. To use OpenRouter, set `OPENROUTER_API_KEY` (or run `/login openrouter`) and pass `--model openrouter/<id>`.

Add `--tools read,bash,edit,write,grep,find,ls` to enable grep/find/ls. The default tool set is read, bash, edit, write.

Redirect stdin (`< /dev/null`) when you run it from a script. In print mode pi reads piped stdin as extra prompt text, and an open stdin that never closes can hang it.
