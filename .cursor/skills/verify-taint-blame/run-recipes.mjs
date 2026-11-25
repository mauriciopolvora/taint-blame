#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SKILL_DIR, "../../..");
const FEATURES = path.join(SKILL_DIR, "features");
const CONTROL = "node .cursor/skills/verify-taint-blame/control.mjs";
const LOG = path.join(ROOT, "artifacts/verify-taint-blame/run.log");

fs.mkdirSync(path.dirname(LOG), { recursive: true });
fs.writeFileSync(LOG, "");

function log(line) {
  fs.appendFileSync(LOG, `${line}\n`);
}

process.env.TAINT_BLAME_WAIT_MS ??= "60000";
const RUN_WORD = `r${Date.now().toString(36)}`;

function run(command, timeoutMs = 150_000) {
  const result = spawnSync("bash", ["-c", command], { cwd: ROOT, encoding: "utf-8", timeout: timeoutMs });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  log(`$ ${command}\n${output}\nexit ${result.status ?? result.signal}`);
  return { ok: result.status === 0, output };
}

function control(args, timeoutMs) {
  return run(`${CONTROL} ${args}`, timeoutMs);
}

function recipeSteps(file) {
  const text = fs.readFileSync(path.join(FEATURES, file), "utf-8");
  const drive = text.split(/^## Driving it with taint-blame-control$/m)[1]?.split(/^## /m)[0] ?? "";
  const bullets = [];
  for (const line of drive.split("\n")) {
    if (line.startsWith("- ")) bullets.push(line);
    else if (/^\s+\S/.test(line) && bullets.length > 0) bullets[bullets.length - 1] += ` ${line.trim()}`;
    else if (line.includes("control.mjs")) throw new Error(`a control.mjs command is outside a bullet: ${line.trim()}`);
  }
  const steps = [];
  for (const bullet of bullets) {
    const quoted = [...bullet.matchAll(/`(node \.cursor\/skills\/verify-taint-blame\/control\.mjs [^`]+)`/g)].map((match) => match[1]);
    if (quoted.length !== bullet.split("control.mjs").length - 1) {
      throw new Error(`a control.mjs command is not one backtick span: ${bullet.slice(0, 80)}`);
    }
    const commands = quoted.filter((command) => !/ (launch|doctor|cleanup|seed)$/.test(command));
    if (!bullet.startsWith("- **")) {
      if (commands.length > 0) throw new Error(`a bullet without a **step** label has commands: ${bullet.slice(0, 80)}`);
      continue;
    }
    const label = /^- \*\*([^*]+)\*\*/.exec(bullet)?.[1];
    if (label === undefined) throw new Error(`a step bullet has no closing **: ${bullet.slice(0, 80)}`);
    for (const command of commands) steps.push({ label, command: command.replaceAll("{run}", RUN_WORD) });
  }
  return steps;
}

const index = fs.readFileSync(path.join(FEATURES, "README.md"), "utf-8").split(/^## Route coverage$/m)[0] ?? "";
const indexed = [...index.matchAll(/\]\(\.\/([\w-]+\.md)\)/g)].map((match) => match[1]);
const wanted = process.argv.slice(2);
const ids = indexed.map((file) => file.replace(/\.md$/, ""));
const unknown = wanted.filter((id) => !ids.includes(id));
const features = wanted.length > 0 ? indexed.filter((file) => wanted.includes(file.replace(/\.md$/, ""))) : indexed;
if (unknown.length > 0 || features.length === 0) {
  console.error(`No feature matches ${unknown.join(", ") || wanted.join(", ")}. Feature ids: ${ids.join(", ")}`);
  process.exit(1);
}

const launched = control("launch", 330_000);
if (!launched.ok || !control("doctor").ok || !control("seed").ok) {
  console.error(`FAIL launch: ${launched.output.split("\n").slice(-3).join(" | ")}`);
  control("cleanup");
  process.exit(1);
}

let failures = 0;
for (const file of features) {
  const id = file.replace(/\.md$/, "");
  log(`\n## ${id}`);
  if (!control("reset-browsers").ok || !control("seed").ok) {
    failures += 1;
    console.log(`FAIL ${id}: could not close the browsers and seed local D1 before the recipe`);
    continue;
  }
  let steps;
  try {
    steps = recipeSteps(file);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${id}: ${error.message}`);
    continue;
  }
  if (steps.length === 0) {
    failures += 1;
    console.log(`FAIL ${id}: no control.mjs commands found in the bullets under "## Driving it with taint-blame-control"`);
    continue;
  }
  let failed = null;
  for (const step of steps) {
    const result = run(step.command);
    if (!result.ok) {
      failed = { step, reason: result.output.split("\n")[0] };
      break;
    }
  }
  if (failed) {
    failures += 1;
    console.log(`FAIL ${id}: step "${failed.step.label}" ran ${failed.step.command.replace(CONTROL, "control.mjs")} and got: ${failed.reason}`);
    if (!control("doctor").ok) {
      console.log("FAIL doctor after the failed step. Stopping.");
      break;
    }
  } else {
    console.log(`PASS ${id} (${steps.length} steps)`);
  }
}

control("cleanup");
console.log(`log: ${path.relative(ROOT, LOG)}`);
process.exit(failures === 0 ? 0 : 1);
