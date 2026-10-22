// Taint Blame adapter for the pi coding agent (https://pi.dev).
// Records what the agent read (prompt, files, command output, tool results) and what it wrote,
// and posts both to the Taint Blame server. Never throws, never blocks a tool call.

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type Trust = "trusted" | "semi" | "untrusted";

const AGENT = "pi";
const MAX_REF = 2000;
const MAX_PREV_BYTES = 1024 * 1024;

// The shared client reads TAINT_BLAME_URL/TOKEN from process.env at send time.
function loadConfig() {
	if (process.env.TAINT_BLAME_URL && process.env.TAINT_BLAME_TOKEN) return;
	try {
		const file = join(homedir(), ".taint-blame", "config.env");
		if (!existsSync(file)) return;
		for (const line of readFileSync(file, "utf8").split("\n")) {
			const m = line.match(/^\s*(?:export\s+)?(TAINT_BLAME_[A-Z_]+)\s*=\s*(.*?)\s*$/);
			if (!m) continue;
			const value = m[2].replace(/^(['"])(.*)\1$/, "$2");
			if (!process.env[m[1]]) process.env[m[1]] = value;
		}
	} catch {}
}

function ref(s: unknown): string | undefined {
	if (s === undefined || s === null) return undefined;
	const text = typeof s === "string" ? s : JSON.stringify(s);
	if (!text) return undefined;
	return text.length > MAX_REF ? `${text.slice(0, MAX_REF)}...` : text;
}

function textOf(content: unknown): string {
	if (!Array.isArray(content)) return typeof content === "string" ? content : "";
	return content
		.map((c: any) => (c?.type === "text" ? c.text : c?.type === "image" ? "[image]" : ""))
		.filter(Boolean)
		.join("\n");
}

function absPath(p: string, cwd: string): string {
	// pi's path tools accept "@file" and "~/" forms.
	let q = p.startsWith("@") ? p.slice(1) : p;
	if (q === "~" || q.startsWith("~/")) q = join(homedir(), q.slice(1));
	return isAbsolute(q) ? q : resolve(cwd, q);
}

function withinCwd(p: string, cwd: string): boolean {
	const rel = relative(cwd, absPath(p, cwd));
	return !rel.startsWith("..") && !isAbsolute(rel);
}

// Resolve the shared client next to the real file, so a symlink in ~/.pi/agent/extensions works
// (pi's loader resolves relative imports against the symlink's own directory).
async function loadClient(): Promise<any | undefined> {
	try {
		const here = realpathSync(fileURLToPath(import.meta.url));
		return await import(pathToFileURL(join(dirname(here), "..", "shared", "client.mjs")).href);
	} catch (err) {
		console.error(`[taint-blame] shared client not found, adapter disabled: ${(err as Error)?.message ?? err}`);
		return undefined;
	}
}

export default async function taintBlame(pi: any) {
	const client = await loadClient();
	if (!client) return;
	const { clean, fileTrust, flushQueue, send } = client;
	loadConfig();

	let sessionId: string = randomUUID();
	let cwd: string = process.cwd();
	const pending = new Set<Promise<unknown>>();
	const previousContent = new Map<string, string>();

	function emit(events: object[]) {
		try {
			if (events.length === 0) return;
			const p = send(events).catch(() => {});
			pending.add(p);
			p.finally(() => pending.delete(p));
		} catch {}
	}

	async function drain() {
		try {
			await Promise.allSettled([...pending]);
		} catch {}
	}

	function input(source: string, trust: Trust, content: string, sourceRef?: string, path?: string) {
		emit([
			{
				agent: AGENT,
				session_id: sessionId,
				ts: Date.now(),
				cwd,
				kind: "input",
				source,
				...(sourceRef ? { source_ref: sourceRef } : {}),
				trust,
				content: clean(content, path),
			},
		]);
	}

	pi.on("session_start", async (_event: any, ctx: any) => {
		try {
			cwd = ctx?.cwd || ctx?.sessionManager?.getCwd?.() || process.cwd();
			const id = ctx?.sessionManager?.getSessionId?.();
			sessionId = typeof id === "string" && id ? id : randomUUID();
			const p = flushQueue().catch(() => {});
			pending.add(p);
			p.finally(() => pending.delete(p));
		} catch {}
	});

	pi.on("input", async (event: any) => {
		try {
			if (typeof event?.text === "string" && event.text.trim()) {
				input("user_prompt", "trusted", event.text, event.source === "extension" ? "extension" : undefined);
			}
		} catch {}
		return { action: "continue" };
	});

	// Capture the file's prior content so a full-file write has a meaningful old_text.
	pi.on("tool_call", async (event: any) => {
		try {
			if (event?.toolName !== "write" || typeof event.input?.path !== "string") return;
			const file = absPath(event.input.path, cwd);
			if (existsSync(file) && statSync(file).size <= MAX_PREV_BYTES) {
				previousContent.set(event.toolCallId, readFileSync(file, "utf8"));
			}
		} catch {}
	});

	pi.on("tool_result", async (event: any) => {
		try {
			const name: string = event?.toolName ?? "unknown";
			const args = event?.input ?? {};
			const text = textOf(event?.content);

			if (name === "write" || name === "edit") {
				const prev = previousContent.get(event.toolCallId) ?? "";
				previousContent.delete(event.toolCallId);
				if (event.isError || typeof args.path !== "string") return;
				const file = absPath(args.path, cwd);
				const now = Date.now();
				const base = { agent: AGENT, session_id: sessionId, cwd, kind: "write", source: name, file_path: file };
				if (name === "write") {
					emit([{ ...base, ts: now, old_text: clean(prev, file), new_text: clean(String(args.content ?? ""), file) }]);
					return;
				}
				const edits: any[] = Array.isArray(args.edits) ? [...args.edits] : [];
				if (typeof args.oldText === "string" && typeof args.newText === "string") {
					edits.push({ oldText: args.oldText, newText: args.newText });
				}
				emit(
					edits
						.filter((e) => typeof e?.oldText === "string" && typeof e?.newText === "string")
						.map((e, i) => ({ ...base, ts: now + i, old_text: clean(e.oldText, file), new_text: clean(e.newText, file) })),
				);
				return;
			}

			if (name === "read") {
				const p = typeof args.path === "string" ? args.path : "";
				const file = p ? absPath(p, cwd) : "";
				input("read", fileTrust(file, cwd) as Trust, text, ref(file || undefined), file);
				return;
			}

			if (name === "bash" || name === "powershell") {
				input(name, "untrusted", text, ref(args.command));
				return;
			}

			if (name === "grep" || name === "find" || name === "ls") {
				const p = typeof args.path === "string" && args.path ? args.path : ".";
				const trust: Trust = withinCwd(p, cwd) ? "semi" : "untrusted";
				const r = name === "ls" ? absPath(p, cwd) : `${args.pattern ?? ""} in ${absPath(p, cwd)}`;
				input(name, trust, text, ref(r));
				return;
			}

			// Custom, extension and MCP tools: anything they return is outside our control.
			input(name, "untrusted", text, ref(args));
		} catch {}
	});

	// Print and JSON modes exit right after the run; let in-flight sends land first.
	pi.on("agent_settled", drain);
	pi.on("session_shutdown", drain);
}
