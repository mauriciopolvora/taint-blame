#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const RUN_DIR = path.join(ROOT, "node_modules/.cache/verify-taint-blame");
const DEV_STATE = path.join(RUN_DIR, "dev.json");
const DEV_VARS_RECORD = path.join(RUN_DIR, "dev-vars.json");
const CHROME_STATE_RE = /^chrome(?:-([a-z0-9]+))?\.json$/;
let profileId = "main";

function chromeState() {
  return path.join(RUN_DIR, profileId === "main" ? "chrome.json" : `chrome-${profileId}.json`);
}

function profileDir(id = profileId) {
  return path.join(RUN_DIR, id === "main" ? "chrome-profile" : `chrome-profile-${id}`);
}
const APP_URL = "http://127.0.0.1:3000";
const DEV_VARS = path.join(ROOT, ".dev.vars");
const FIXTURE_TOKEN = "verify-local-token";
const DEV_VARS_FIXTURE = `INGEST_TOKEN=${FIXTURE_TOKEN}\nJUDGE_ENABLED=false\n`;
// The Cloudflare plugin sends a binding to the remote resource when wrangler.jsonc marks it remote.
const REMOTE_BINDING_RE = /"(?:experimental_)?remote"\s*:\s*true/;

function die(message) {
  console.error(message);
  process.exit(1);
}

function versionOk(version) {
  const match = /^v?(\d+)\.(\d+)/.exec(version);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 22 || (major === 22 && minor >= 18);
}

function newerNode() {
  const home = path.join(os.homedir(), ".nvm/versions/node");
  const bins = [];
  if (fs.existsSync(home)) {
    for (const dir of fs.readdirSync(home)) {
      const bin = path.join(home, dir, "bin/node");
      if (fs.existsSync(bin)) bins.push({ bin, version: dir });
    }
  }
  bins.sort((a, b) => (a.version < b.version ? 1 : -1));
  return bins.find((entry) => versionOk(entry.version))?.bin ?? null;
}

if (!versionOk(process.version) && process.env.TAINT_BLAME_CONTROL_REEXEC !== "1") {
  const next = newerNode();
  if (!next) {
    die(
      `taint-blame-control needs Node.js 22.18 or newer. This process is ${process.version}.`,
    );
  }
  const result = spawnSync(next, process.argv.slice(1), {
    stdio: "inherit",
    env: {
      ...process.env,
      TAINT_BLAME_CONTROL_REEXEC: "1",
      PATH: `${path.dirname(next)}:${process.env.PATH ?? ""}`,
    },
  });
  process.exit(result.status ?? 1);
}

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function pgidOf(pid) {
  const result = spawnSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf-8" });
  if (result.status !== 0) return null;
  const value = Number(result.stdout.trim());
  return Number.isFinite(value) ? value : null;
}

function listenerPids(port) {
  const result = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fp"], {
    encoding: "utf-8",
  });
  if (result.error) die(`lsof failed: ${result.error.message}`);
  if (result.status !== 0) return [];
  const pids = new Set();
  for (const match of result.stdout.matchAll(/^p(\d+)$/gm)) pids.add(Number(match[1]));
  return [...pids];
}

function portOf(url) {
  const parsed = new URL(url);
  if (parsed.port) return Number(parsed.port);
  return parsed.protocol === "https:" ? 443 : 80;
}

function nodeEnv() {
  const binDir = path.dirname(process.execPath);
  return {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
  };
}

function tail(file, lines = 40) {
  if (!fs.existsSync(file)) return "";
  const text = fs.readFileSync(file, "utf-8").trim().split("\n");
  return text.slice(-lines).join("\n");
}

function groupHasProcesses(pgid) {
  if (!pgid) return false;
  const still = spawnSync("ps", ["-o", "pid=", "-g", String(pgid)], { encoding: "utf-8" });
  return still.status === 0 && still.stdout.trim() !== "";
}

// The start time of a process. A recycled pid has a different start time.
function startedAt(pid) {
  if (!pid) return null;
  const result = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf-8" });
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

// A record is { pgid, startedAt } for a group whose leader this skill spawned with detached: true.
// The group is still ours when its leader has the recorded start time. When the leader is gone and the group still
// has processes, the group is also ours, because the kernel does not give a pid that is still a group id to a new process.
function ownsGroup(record) {
  if (!record?.pgid || !record.startedAt || !groupHasProcesses(record.pgid)) return false;
  const leader = startedAt(record.pgid);
  return leader === null || leader === record.startedAt;
}

function killGroup(record) {
  if (!record?.pgid || !groupHasProcesses(record.pgid)) return;
  if (!ownsGroup(record)) {
    console.error(`Skipped process group ${record.pgid}: its leader is not the process this skill started.`);
    return;
  }
  const pgid = record.pgid;
  try {
    process.kill(-pgid, "SIGTERM");
  } catch {
    return;
  }
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (!groupHasProcesses(pgid)) return;
    spawnSync("sleep", ["0.2"]);
  }
  try {
    process.kill(-pgid, "SIGKILL");
  } catch {
    // The group is already gone.
  }
}

// The dev server reads .dev.vars. The skill needs a known ingest token and the judge off, so nothing calls OpenRouter.
// It creates the fixture only when no .dev.vars exists, and records the file identity (inode, size, mtime).
// It never reads a .dev.vars, and it removes only the file with the recorded identity.
function fileIdentity(file) {
  try {
    const stat = fs.statSync(file);
    return { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

function ownsDevVars() {
  const record = readJson(DEV_VARS_RECORD);
  const current = fileIdentity(DEV_VARS);
  return Boolean(
    record &&
      current &&
      record.dev === current.dev &&
      record.ino === current.ino &&
      record.size === current.size &&
      record.mtimeMs === current.mtimeMs,
  );
}

function ensureDevVars() {
  if (ownsDevVars()) return false;
  try {
    fs.writeFileSync(DEV_VARS, DEV_VARS_FIXTURE, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    die(
      ".dev.vars exists and this skill did not write it. taint-blame-control does not read, use or change it. Move it aside (mv .dev.vars .dev.vars.mine), then launch again. Launch writes the fixture: a local ingest token and JUDGE_ENABLED=false.",
    );
  }
  writeJson(DEV_VARS_RECORD, fileIdentity(DEV_VARS));
  return true;
}

function removeOwnedDevVars() {
  const owned = ownsDevVars();
  if (owned) fs.rmSync(DEV_VARS);
  fs.rmSync(DEV_VARS_RECORD, { force: true });
  return owned;
}

function assertLocalBindings() {
  const config = fs.readFileSync(path.join(ROOT, "wrangler.jsonc"), "utf-8");
  if (REMOTE_BINDING_RE.test(config)) {
    die("wrangler.jsonc marks a binding remote, so the dev server would use a remote resource. taint-blame-control runs on local bindings only.");
  }
}

// Every command that talks to the app first proves that the listener on the app port is the dev server this skill started.
function assertOwnedServer() {
  const port = portOf(APP_URL);
  const state = readJson(DEV_STATE);
  if (!state) die(`No launch record at ${DEV_STATE}. Run launch first.`);
  const listeners = listenerPids(port);
  if (listeners.length === 0) die(`Nothing is listening on ${APP_URL}. The launch record names pgid ${state.pgid}.`);
  const foreign = listeners.filter((pid) => pgidOf(pid) !== state.pgid);
  if (foreign.length > 0 || !ownsGroup(state)) {
    die(`Port ${port} is not served by the dev server this skill started (pgid ${state.pgid}). Refusing to drive it.`);
  }
  return state;
}

async function fetchText(url, timeoutMs) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
  const body = await response.text();
  return { status: response.status, body };
}

function flags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) die(`Unexpected argument ${token}`);
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function requireFlag(bag, key) {
  const value = bag[key];
  if (typeof value !== "string" || value.length === 0) die(`Missing --${key}`);
  return value;
}

async function postJson(route, body, token) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(new URL(route, APP_URL), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, body: await response.text() };
}

async function launch() {
  assertLocalBindings();
  const port = portOf(APP_URL);
  const existing = listenerPids(port);
  const state = readJson(DEV_STATE);
  if (existing.length > 0) {
    const owned =
      state &&
      ownsGroup(state) &&
      existing.every((pid) => pgidOf(pid) === state.pgid);
    if (owned) {
      console.log(`already up ${APP_URL} pgid ${state.pgid}`);
      return;
    }
    die(
      `Port ${port} is already in use by pid ${existing.join(", ")}. taint-blame-control will not attach to a server it did not start. Stop that process, or run cleanup if it is a leftover from this skill.`,
    );
  }

  fs.mkdirSync(RUN_DIR, { recursive: true });
  const wroteDevVars = ensureDevVars();
  const migrated = wrangler(["d1", "migrations", "apply", "taint-blame", "--local"]);
  if (!migrated.ok) {
    if (wroteDevVars) removeOwnedDevVars();
    die(`Local D1 migrations failed:\n${migrated.output}`);
  }
  const logPath = path.join(RUN_DIR, "dev.log");
  const logFd = fs.openSync(logPath, "a");
  const npm = path.join(path.dirname(process.execPath), "npm");
  const child = spawn(npm, ["run", "dev"], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: nodeEnv(),
  });
  child.unref();
  fs.closeSync(logFd);
  // detached: true makes the child the leader of a new process group, so its pid is the group id.
  const pgid = child.pid;
  const record = { pid: child.pid, pgid, startedAt: startedAt(child.pid), url: APP_URL, logPath };
  writeJson(DEV_STATE, record);

  const deadline = Date.now() + 300_000;
  let lastError = "the port never answered";
  while (Date.now() < deadline) {
    const listeners = listenerPids(port);
    if (listeners.length === 0) {
      await delay(500);
      continue;
    }
    if (!listeners.every((pid) => pgidOf(pid) === pgid)) {
      lastError = `listener pid ${listeners.join(", ")} is not in process group ${pgid}`;
      await delay(500);
      continue;
    }
    try {
      const page = await fetchText(APP_URL, 60_000);
      const title = page.body.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
      if (page.status === 200 && title === "Taint Blame") {
        console.log(`ready ${APP_URL} pgid ${pgid} node ${process.version}`);
        return;
      }
      lastError = `HTTP ${page.status}, title ${JSON.stringify(title)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(500);
  }
  killGroup(record);
  fs.rmSync(DEV_STATE, { force: true });
  if (wroteDevVars) removeOwnedDevVars();
  const log = tail(logPath);
  die(`Launch did not become ready: ${lastError}\n${log}`);
}

async function doctor() {
  assertLocalBindings();
  const state = assertOwnedServer();
  const page = await fetchText(APP_URL, 20_000);
  const title = page.body.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
  if (page.status !== 200 || title !== "Taint Blame") {
    die(`Expected HTTP 200 and title "Taint Blame", got HTTP ${page.status} and title ${JSON.stringify(title)}.`);
  }
  const anonymous = await postJson("/api/verify", {}, "");
  if (anonymous.status !== 401) die(`Expected POST /api/verify without a token to be 401. Got HTTP ${anonymous.status}: ${anonymous.body.slice(0, 200)}`);
  const fixture = await postJson("/api/verify", {}, FIXTURE_TOKEN);
  if (fixture.status !== 200) {
    die(`Expected POST /api/verify with the fixture token to be 200. Got HTTP ${fixture.status}. The dev server did not load the .dev.vars fixture.`);
  }
  console.log(
    [
      `url: ${APP_URL}`,
      `http: ${page.status}`,
      `title: ${title}`,
      "verify api: 401 without a token, 200 with the fixture token",
      "judge: off (JUDGE_ENABLED=false in the .dev.vars fixture)",
      `node: ${process.version}`,
      `listener pgid: ${state.pgid}`,
      `d1: ${path.join(ROOT, ".wrangler/state/v3/d1")}`,
      "owned: yes",
    ].join("\n"),
  );
}

function wrangler(args) {
  const bin = path.join(ROOT, "node_modules/.bin/wrangler");
  if (args.includes("--remote") || !args.includes("--local")) die("taint-blame-control runs wrangler with --local only.");
  const result = spawnSync(bin, args, {
    cwd: ROOT,
    encoding: "utf-8",
    timeout: 120_000,
    env: { ...nodeEnv(), WRANGLER_SEND_METRICS: "false", CI: "1" },
  });
  return { ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n").slice(-20).join("\n") };
}

// Writes scripts/seed-local.sql into local D1. The seed deletes and inserts its own three sessions, so it is safe to run again.
function seed() {
  const result = wrangler(["d1", "execute", "taint-blame", "--local", "--file", "scripts/seed-local.sql"]);
  if (!result.ok) die(`Seeding local D1 failed:\n${result.output}`);
  console.log("seeded local D1 from scripts/seed-local.sql (3 sessions)");
}

// Sends a fixture of agent events to POST /api/events the way the pi extension does: one JSON array and the bearer token.
// --repo sets cwd to /work/<repo>, so the dashboard row has a name that only this run uses.
async function ingest(file, session, repo) {
  if (!/^[\w-]{1,100}$/.test(session)) die("--session takes letters, digits, _ and -, up to 100 chars.");
  if (repo !== undefined && !/^[\w-]{1,100}$/.test(repo)) die("--repo takes letters, digits, _ and -, up to 100 chars.");
  const raw = JSON.parse(fs.readFileSync(path.resolve(ROOT, file), "utf-8"));
  if (!Array.isArray(raw) || raw.length === 0) die(`${file} must hold a non-empty JSON array of events.`);
  const start = Date.now() - raw.length * 2000;
  const events = raw.map((event, index) => {
    const mapped = { ...event, session_id: session, ts: start + index * 2000 };
    if (repo !== undefined) mapped.cwd = `/work/${repo}`;
    return mapped;
  });
  assertOwnedServer();
  const sent = await postJson("/api/events", events, FIXTURE_TOKEN);
  if (sent.status !== 200) die(`POST /api/events got HTTP ${sent.status}: ${sent.body.slice(0, 200)}`);
  console.log(`ingested ${events.length} events as session ${session}: ${sent.body}`);
}

function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const pathEntries = (process.env.PATH ?? "").split(":");
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    for (const dir of pathEntries) {
      const full = path.join(dir, name);
      if (dir && fs.existsSync(full)) return full;
    }
  }
  die("Chrome was not found. Set CHROME_PATH to a Chrome or Chromium binary.");
}

function connectCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 0;
  const pending = new Map();
  const listeners = [];
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error(`CDP connection failed for ${wsUrl}`)));
  });
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new Error(`${waiter.method}: ${JSON.stringify(message.error)}`));
      else waiter.resolve(message.result ?? {});
      return;
    }
    for (const listener of listeners) listener(message);
  });
  return {
    ready: opened,
    on(listener) {
      listeners.push(listener);
    },
    send(method, params = {}, timeoutMs = 20_000) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer, method });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      ws.close();
    },
  };
}

async function pageFor(state) {
  try {
    const list = await fetch(`http://127.0.0.1:${state.debugPort}/json/list`, {
      signal: AbortSignal.timeout(2000),
    }).then((response) => response.json());
    return (
      list.find((entry) => entry.id === state.targetId && entry.webSocketDebuggerUrl) ??
      list.find(
        (entry) => entry.type === "page" && typeof entry.url === "string" && entry.url.startsWith(APP_URL),
      ) ??
      null
    );
  } catch {
    return null;
  }
}

async function ensureChrome() {
  const state = readJson(chromeState());
  // Reuse a Chrome only while its recorded leader still runs, and only when the DevTools port belongs to its group.
  if (state?.debugPort && startedAt(state.pgid) === state.startedAt) {
    const portOwned = listenerPids(state.debugPort).every((pid) => pgidOf(pid) === state.pgid);
    const page = portOwned ? await pageFor(state) : null;
    if (page?.webSocketDebuggerUrl) return { state, page };
  }
  if (state) closeBrowser(chromeState(), profileId);
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const profile = profileDir();
  fs.mkdirSync(profile, { recursive: true });
  const logPath = path.join(RUN_DIR, profileId === "main" ? "chrome.log" : `chrome-${profileId}.log`);
  const logFd = fs.openSync(logPath, "a");
  const chrome = findChrome();
  const child = spawn(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1280,900",
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "--remote-debugging-address=127.0.0.1",
      APP_URL,
    ],
    { detached: true, stdio: ["ignore", logFd, logFd] },
  );
  child.unref();
  fs.closeSync(logFd);
  // Record Chrome before it is ready, so cleanup finds it when the launch fails.
  const record = { pid: child.pid, pgid: child.pid, startedAt: startedAt(child.pid) };
  writeJson(chromeState(), record);
  const failChrome = (message) => {
    closeBrowser(chromeState(), profileId);
    die(message);
  };
  const portFile = path.join(profile, "DevToolsActivePort");
  const deadline = Date.now() + 15_000;
  let debugPort = null;
  while (Date.now() < deadline) {
    if (fs.existsSync(portFile)) {
      const portLine = fs.readFileSync(portFile, "utf-8").split("\n")[0]?.trim();
      if (portLine && Number(portLine) > 0) {
        debugPort = Number(portLine);
        break;
      }
    }
    if (!alive(child.pid)) break;
    await delay(200);
  }
  if (!debugPort) failChrome(`Chrome did not open a DevTools port.\n${tail(logPath)}`);
  const versionUrl = `http://127.0.0.1:${debugPort}/json/version`;
  let page = null;
  const pageDeadline = Date.now() + 10_000;
  while (Date.now() < pageDeadline) {
    try {
      const list = await fetch(`http://127.0.0.1:${debugPort}/json/list`, {
        signal: AbortSignal.timeout(2000),
      }).then((response) => response.json());
      page = list.find(
        (entry) => entry.type === "page" && typeof entry.url === "string" && entry.url.startsWith(APP_URL),
      );
      if (page?.webSocketDebuggerUrl) break;
    } catch {
      // Chrome is not listening yet. Try again.
    }
    await delay(200);
  }
  if (!page?.webSocketDebuggerUrl) failChrome(`Chrome started but has no page for ${APP_URL}.\n${tail(logPath)}`);
  const next = {
    ...record,
    debugPort,
    versionUrl,
    targetId: page.id,
  };
  writeJson(chromeState(), next);
  return { state: next, page };
}

function axRole(node) {
  return String(node.role?.value ?? "");
}

function axName(node) {
  return String(node.name?.value ?? "").replaceAll(/\s+/g, " ").trim();
}

function axChecked(node) {
  const property = (node.properties ?? []).find((item) => item.name === "checked");
  if (!property) return "";
  return property.value?.value === true || property.value?.value === "true" ? " checked" : " unchecked";
}

async function withPage(work) {
  assertOwnedServer();
  const { state, page } = await ensureChrome();
  const cdp = connectCdp(page.webSocketDebuggerUrl);
  await cdp.ready;
  try {
    await cdp.send("Page.enable");
    await cdp.send("DOM.enable");
    await cdp.send("Accessibility.enable");
    await cdp.send("Runtime.enable");
    if (!state.metrics) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 1280,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      state.metrics = true;
      writeJson(chromeState(), state);
    }
    return await work(cdp);
  } finally {
    cdp.close();
  }
}

async function axTree(cdp) {
  const { nodes } = await cdp.send("Accessibility.getFullAXTree");
  return nodes ?? [];
}

// A name is { text, contains, within }. --name matches the whole accessible name, --name-contains a part of it.
// --in <role> keeps only nodes inside a node with that role, such as the complementary sidebar or the banner.
function nameArg(bag) {
  if (bag.in === true) die("--in needs a role, for example --in complementary.");
  if (bag.name !== undefined && bag["name-contains"] !== undefined) die("Use --name or --name-contains, not both.");
  if (bag["name-contains"] === true) die("--name-contains needs a value.");
  const within = typeof bag.in === "string" && bag.in ? bag.in : undefined;
  if (typeof bag["name-contains"] === "string" && bag["name-contains"]) {
    return { text: bag["name-contains"], contains: true, within };
  }
  return { text: requireFlag(bag, "name"), contains: false, within };
}

function label(name) {
  const base = name.contains ? `containing ${JSON.stringify(name.text)}` : `named ${JSON.stringify(name.text)}`;
  return name.within === undefined ? base : `${base} in ${name.within}`;
}

function hasAncestor(byId, node, role) {
  let current = node.parentId === undefined ? undefined : byId.get(node.parentId);
  while (current) {
    if (axRole(current) === role) return true;
    current = current.parentId === undefined ? undefined : byId.get(current.parentId);
  }
  return false;
}

function matching(nodes, role, name) {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  return nodes.filter((node) => {
    if (node.ignored || axRole(node) !== role) return false;
    if (name.within !== undefined && !hasAncestor(byId, node, name.within)) return false;
    return name.contains ? axName(node).includes(name.text) : axName(node) === name.text;
  });
}

function describeMiss(nodes, role, name) {
  const sameRole = nodes
    .filter((node) => !node.ignored && axRole(node) === role && axName(node))
    .map((node) => `${role} ${JSON.stringify(axName(node))}`)
    .slice(0, 12);
  const hint = sameRole.length > 0 ? `\nOther ${role} names: ${sameRole.join(", ")}` : "";
  return `No ${role} ${label(name)}.${hint}`;
}

async function findNode(cdp, role, name) {
  const nodes = await axTree(cdp);
  const found = matching(nodes, role, name);
  if (found.length === 0) die(describeMiss(nodes, role, name));
  if (found.length > 1) die(`Found ${found.length} ${role} nodes ${label(name)}.`);
  const node = found[0];
  if (!node.backendDOMNodeId) die(`${role} ${label(name)} has no DOM node to act on.`);
  return node;
}

async function boxCenter(cdp, backendNodeId) {
  await cdp.send("DOM.scrollIntoViewIfNeeded", { backendNodeId });
  const { model } = await cdp.send("DOM.getBoxModel", { backendNodeId });
  const quad = model?.content;
  if (!quad || quad.length < 8) die("The target has no clickable box.");
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  return {
    x: xs.reduce((sum, value) => sum + value, 0) / xs.length,
    y: ys.reduce((sum, value) => sum + value, 0) / ys.length,
  };
}

function isDisabled(node) {
  return (node.properties ?? []).some((item) => item.name === "disabled" && item.value?.value === true);
}

async function click(role, name) {
  await withPage(async (cdp) => {
    const node = await findNode(cdp, role, name);
    if (isDisabled(node)) die(`${role} ${label(name)} is disabled.`);
    const { x, y } = await boxCenter(cdp, node.backendDOMNodeId);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    console.log(`clicked ${role} ${label(name)}`);
  });
}

async function fill(role, name, value) {
  await withPage(async (cdp) => {
    const node = await findNode(cdp, role, name);
    await cdp.send("DOM.focus", { backendNodeId: node.backendDOMNodeId });
    const filled = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const value = ${JSON.stringify(value)};
        const el = document.activeElement;
        if (!el || (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA")) {
          return { ok: false, reason: el ? el.tagName : "none" };
        }
        const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        if (!setter) return { ok: false, reason: "no setter" };
        setter.call(el, value);
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
        return { ok: el.value === value, actual: el.value };
      })()`,
      returnByValue: true,
    });
    const result = filled.result?.value;
    if (!result?.ok) die(`Could not fill ${role} ${label(name)}: ${JSON.stringify(result)}`);
    console.log(`filled ${role} ${label(name)}`);
  });
}

// True when the main document has finished loading. A wait samples the page only then,
// so a --gone check never passes on the empty page between two documents.
async function documentReady(cdp, timeoutMs) {
  try {
    const ready = await cdp.send(
      "Runtime.evaluate",
      { expression: 'document.readyState === "complete" && Boolean(document.body)', returnByValue: true },
      timeoutMs,
    );
    return ready.result?.value === true;
  } catch {
    // The document changed while Chrome evaluated. Sample again.
    return false;
  }
}

async function waitFor(bag) {
  const raw = bag.timeout ?? process.env.TAINT_BLAME_WAIT_MS ?? "15000";
  const timeout = Number(raw);
  if (raw === true || !Number.isFinite(timeout) || timeout <= 0) die(`--timeout takes a positive number of milliseconds. Got ${JSON.stringify(raw)}.`);
  const deadline = Date.now() + timeout;
  const remaining = () => Math.max(1000, deadline - Date.now());
  const gone = bag.gone === true;
  const modes = ["text", "line", "role"].filter((key) => bag[key] !== undefined);
  if (modes.length !== 1) die("wait takes exactly one of --text, --line, or --role.");
  await withPage(async (cdp) => {
    if (bag.text !== undefined || bag.line !== undefined) {
      const byLine = bag.line !== undefined;
      const text = requireFlag(bag, byLine ? "line" : "text");
      const what = `${byLine ? "line" : "text"} ${JSON.stringify(text)}`;
      const found = byLine
        ? `document.body.innerText.split("\\n").some((line) => line.trim() === ${JSON.stringify(text)})`
        : `document.body.innerText.includes(${JSON.stringify(text)})`;
      while (Date.now() < deadline) {
        if (await documentReady(cdp, remaining())) {
          const evaluated = await cdp.send("Runtime.evaluate", { expression: found, returnByValue: true }, remaining()).catch(() => null);
          if (evaluated && evaluated.result?.value === !gone) {
            console.log(`wait ok: ${what}${gone ? " is gone" : ""}`);
            return;
          }
        }
        await delay(200);
      }
      const sample = await cdp.send("Runtime.evaluate", {
        expression: "document.body ? document.body.innerText.slice(0, 500) : ''",
        returnByValue: true,
      });
      die(`Timed out after ${timeout}ms waiting for ${what}${gone ? " to go away" : ""}.\nVisible text:\n${sample.result?.value ?? ""}`);
    }
    const role = requireFlag(bag, "role");
    const name = nameArg(bag);
    const disabled = bag.disabled === true;
    const what = `${role} ${label(name)}${disabled ? " (disabled)" : ""}`;
    while (Date.now() < deadline) {
      if (await documentReady(cdp, remaining())) {
        const found = matching(await axTree(cdp), role, name).filter((node) => !disabled || isDisabled(node));
        if (gone ? found.length === 0 : found.length > 0) {
          console.log(`wait ok: ${what}${gone ? " is gone" : ""}`);
          return;
        }
      }
      await delay(200);
    }
    if (gone) die(`Timed out after ${timeout}ms waiting for ${what} to go away.`);
    die(`Timed out after ${timeout}ms. ${describeMiss(await axTree(cdp), role, name)}${disabled ? " (or none is disabled)" : ""}`);
  });
}

function formatTree(nodes) {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const childIds = new Set(nodes.flatMap((node) => node.childIds ?? []));
  const roots = nodes.filter((node) => !childIds.has(node.nodeId));
  const lines = [];
  const skip = new Set(["InlineTextBox", "LineBreak", "none", "generic", "StaticText", "Ignored"]);
  function textUnder(node) {
    const parts = [];
    function collect(current) {
      if (!current) return;
      if (axRole(current) === "StaticText") {
        const name = axName(current);
        if (name) parts.push(name);
        return;
      }
      for (const childId of current.childIds ?? []) collect(byId.get(childId));
    }
    for (const childId of node.childIds ?? []) collect(byId.get(childId));
    return parts.join(" ").replaceAll(/\s+/g, " ").trim();
  }
  function walk(node, depth, ancestorNames) {
    if (!node || node.ignored) {
      if (node && axRole(node) === "StaticText") {
        const name = axName(node);
        if (name && !ancestorNames.has(name)) {
          lines.push(`${"  ".repeat(depth)}StaticText ${JSON.stringify(name)}`);
          ancestorNames.add(name);
        }
      }
      for (const childId of node?.childIds ?? []) walk(byId.get(childId), depth, ancestorNames);
      return;
    }
    const role = axRole(node);
    const name = axName(node) || (role === "StaticText" ? "" : textUnder(node));
    if (role === "StaticText") {
      if (name && !ancestorNames.has(name)) {
        lines.push(`${"  ".repeat(depth)}StaticText ${JSON.stringify(name)}`);
      }
      return;
    }
    if (!skip.has(role)) {
      const label = name ? `${role} ${JSON.stringify(name)}${axChecked(node)}` : role;
      lines.push(`${"  ".repeat(depth)}${label}`);
    }
    const nextNames = new Set(ancestorNames);
    if (name) nextNames.add(name);
    const nextDepth = skip.has(role) ? depth : depth + 1;
    for (const childId of node.childIds ?? []) walk(byId.get(childId), nextDepth, nextNames);
  }
  for (const root of roots) walk(root, 0, new Set());
  return `${lines.join("\n")}\n`;
}

async function snapshot(file) {
  await withPage(async (cdp) => {
    const text = formatTree(await axTree(cdp));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    process.stdout.write(text);
    console.error(`wrote ${file}`);
  });
}

async function screenshot(file) {
  await withPage(async (cdp) => {
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    console.log(`wrote ${file}`);
  });
}

// Marks the current document, starts a navigation, then waits until a new document without the mark has loaded.
// A load event from the old document can not end the wait.
async function navigate(cdp, start, what, timeoutMs) {
  const mark = `tb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  await cdp.send("Runtime.evaluate", { expression: `window.__verifyMark = ${JSON.stringify(mark)}` });
  await start();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const check = await cdp
      .send(
        "Runtime.evaluate",
        { expression: `window.__verifyMark !== ${JSON.stringify(mark)} && document.readyState === "complete"`, returnByValue: true },
        Math.max(1000, deadline - Date.now()),
      )
      .catch(() => null);
    if (check?.result?.value === true) return;
    await delay(100);
  }
  die(`${what} timed out after ${timeoutMs}ms.`);
}

async function reload() {
  await withPage(async (cdp) => {
    await navigate(cdp, () => cdp.send("Page.reload", { ignoreCache: false }), "reload", 20_000);
    console.log(`reloaded ${APP_URL}`);
  });
}

async function goto(target) {
  if (!target.startsWith("/") || target.startsWith("//")) die(`--path must start with one /. Got ${JSON.stringify(target)}.`);
  if (target.includes("#")) die(`--path must not have a #fragment, because Chrome does not load the page again. Got ${JSON.stringify(target)}.`);
  const url = new URL(target, APP_URL);
  if (url.origin !== new URL(APP_URL).origin) die(`--path must stay on ${APP_URL}. Got ${JSON.stringify(target)}.`);
  await withPage(async (cdp) => {
    await navigate(
      cdp,
      async () => {
        const navigated = await cdp.send("Page.navigate", { url: url.href });
        if (navigated.errorText) die(`goto ${target} failed: ${navigated.errorText}`);
      },
      `goto ${target}`,
      30_000,
    );
    const served = await cdp.send("Runtime.evaluate", {
      expression: `({ origin: location.origin, status: performance.getEntriesByType("navigation")[0]?.responseStatus ?? 0 })`,
      returnByValue: true,
    });
    const page = served.result?.value ?? {};
    if (page.origin !== url.origin) die(`goto ${target} ended on ${page.origin}, not ${url.origin}.`);
    if (!(page.status >= 200 && page.status < 400)) die(`goto ${target} got HTTP ${page.status}.`);
    console.log(`opened ${url.href}`);
  });
}

// Stops one recorded Chrome and deletes its profile. The profile path comes from the profile id, never from the record.
function closeBrowser(file, id) {
  killGroup(readJson(file));
  fs.rmSync(profileDir(id), { recursive: true, force: true });
  fs.rmSync(file, { force: true });
}

function closeBrowsers() {
  const names = fs.existsSync(RUN_DIR) ? fs.readdirSync(RUN_DIR).filter((name) => CHROME_STATE_RE.test(name)) : [];
  for (const name of names) closeBrowser(path.join(RUN_DIR, name), CHROME_STATE_RE.exec(name)?.[1] ?? "main");
  return names.length;
}

async function cleanup() {
  const dev = readJson(DEV_STATE);
  closeBrowsers();
  killGroup(dev);
  if (dev?.pgid && groupHasProcesses(dev.pgid) && ownsGroup(dev)) die(`Process group ${dev.pgid} is still running after SIGKILL.`);
  fs.rmSync(DEV_STATE, { force: true });
  const removeDevVars = removeOwnedDevVars();
  console.log(
    `cleaned up the dev server and browser started by taint-blame-control${removeDevVars ? " and the .dev.vars fixture it wrote" : ""}. Proof files under artifacts/verify-taint-blame/ were left in place. Local D1 under .wrangler/state/v3/d1 was not deleted.`,
  );
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function usage() {
  console.log(`taint-blame-control

  node .cursor/skills/verify-taint-blame/control.mjs launch
  node .cursor/skills/verify-taint-blame/control.mjs doctor
  node .cursor/skills/verify-taint-blame/control.mjs seed
  node .cursor/skills/verify-taint-blame/control.mjs ingest --file .cursor/skills/verify-taint-blame/features/fixtures/injected-session.json --session live-r1 --repo live-r1
  node .cursor/skills/verify-taint-blame/control.mjs cleanup
  node .cursor/skills/verify-taint-blame/control.mjs reset-browsers
  node .cursor/skills/verify-taint-blame/control.mjs browser goto --path /settings
  node .cursor/skills/verify-taint-blame/control.mjs browser click --role button --name "Verify"
  node .cursor/skills/verify-taint-blame/control.mjs browser fill --role textbox --name "Ingest token" --value "verify-local-token"
  node .cursor/skills/verify-taint-blame/control.mjs browser click --role link --name "Sessions" --in complementary
  node .cursor/skills/verify-taint-blame/control.mjs browser wait --line "Connected"
  node .cursor/skills/verify-taint-blame/control.mjs browser wait --role button --name "Delete session" --disabled
  node .cursor/skills/verify-taint-blame/control.mjs browser snapshot --aria --path artifacts/verify-taint-blame/settings-token/connected.aria.txt
  node .cursor/skills/verify-taint-blame/control.mjs browser screenshot --path artifacts/verify-taint-blame/settings-token/connected.png
  node .cursor/skills/verify-taint-blame/control.mjs browser reload`);
}

const [command, sub, ...rest] = process.argv.slice(2);

if (!command || command === "--help" || command === "help") {
  usage();
  process.exit(command ? 0 : 1);
}

try {
  if (command === "launch") await launch();
  else if (command === "doctor") await doctor();
  else if (command === "cleanup") await cleanup();
  else if (command === "seed") seed();
  else if (command === "ingest") {
    const bag = flags([sub, ...rest].filter((arg) => arg !== undefined));
    await ingest(requireFlag(bag, "file"), requireFlag(bag, "session"), bag.repo === undefined ? undefined : requireFlag(bag, "repo"));
  }
  else if (command === "reset-browsers") console.log(`closed ${closeBrowsers()} browser profiles. The dev server is still up.`);
  else if (command === "browser") {
    const bag = flags(rest);
    if (bag.profile !== undefined) {
      if (typeof bag.profile !== "string" || !/^[a-z0-9]+$/.test(bag.profile)) {
        die("--profile takes lowercase letters and digits, for example --profile second.");
      }
      profileId = bag.profile;
    }
    if (sub === "click") await click(requireFlag(bag, "role"), nameArg(bag));
    else if (sub === "fill") await fill(requireFlag(bag, "role"), nameArg(bag), requireFlag(bag, "value"));
    else if (sub === "wait") await waitFor(bag);
    else if (sub === "snapshot") {
      if (bag.aria !== true) die("snapshot requires --aria");
      await snapshot(path.resolve(ROOT, requireFlag(bag, "path")));
    } else if (sub === "screenshot") await screenshot(path.resolve(ROOT, requireFlag(bag, "path")));
    else if (sub === "reload") await reload();
    else if (sub === "goto") await goto(requireFlag(bag, "path"));
    else {
      usage();
      die(`Unknown browser command ${sub ?? ""}`.trim());
    }
  } else {
    usage();
    die(`Unknown command ${command}`);
  }
} catch (error) {
  die(error instanceof Error ? error.message : String(error));
}
