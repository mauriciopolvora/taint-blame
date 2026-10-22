// Fixture tests for the Claude Code adapter. Run: node adapters/claude-code/test.mjs
// No network: the hook process tests point at an unreachable URL and a temp HOME,
// so events must land in that HOME's queue.jsonl.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promptEvent, toolEvents, batches } from './map.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const fx = (name) => JSON.parse(readFileSync(join(here, 'fixtures', `${name}.json`), 'utf8'))
const map = (h) => {
  const ctx = { session_id: h.session_id, cwd: h.cwd, ts: 1000 }
  return h.hook_event_name === 'UserPromptSubmit' ? promptEvent(ctx, h.prompt) : toolEvents(ctx, h.tool_name, h.tool_input, h.tool_response)
}
let passed = 0
const t = (name, fn) => { fn(); passed++; console.log(`ok  ${name}`) }

// The fixture repo root must exist with a .git dir for repo-root detection.
mkdirSync('/tmp/tb-fixture-repo/.git', { recursive: true })

t('user prompt is trusted', () => {
  const [e] = map(fx('user-prompt'))
  assert.equal(e.source, 'user_prompt'); assert.equal(e.trust, 'trusted'); assert.equal(e.kind, 'input')
})
t('read in repo is semi with file_path ref', () => {
  const [e] = map(fx('read'))
  assert.deepEqual([e.source, e.trust, e.source_ref, e.content], ['read', 'semi', '/tmp/tb-fixture-repo/README.md', '# Demo\n\nSome text.\n'])
})
t('read outside repo is untrusted', () => assert.equal(map(fx('read-outside'))[0].trust, 'untrusted'))
t('read of .claude/skills is untrusted', () => assert.equal(map(fx('read-skill'))[0].trust, 'untrusted'))
t('bash is untrusted, redacted, command ref', () => {
  const [e] = map(fx('bash'))
  assert.equal(e.trust, 'untrusted'); assert.equal(e.source_ref, 'cat .env')
  assert.ok(!e.content.includes('supersecretvalue123') && !e.content.includes('ghp_'), e.content)
})
t('web_fetch untrusted with url ref', () => {
  const [e] = map(fx('web-fetch'))
  assert.deepEqual([e.source, e.trust, e.source_ref], ['web_fetch', 'untrusted', 'https://example.com'])
  assert.match(e.content, /backdoor/)
})
t('web_search flattens results', () => {
  const [e] = map(fx('web-search'))
  assert.equal(e.source, 'web_search'); assert.match(e.content, /iana\.org/); assert.match(e.content, /documentation/)
})
t('agent result is task/untrusted', () => {
  const [e] = map(fx('agent'))
  assert.deepEqual([e.source, e.trust, e.content], ['task', 'untrusted', 'The first line is # Demo'])
})
t('mcp source name', () => {
  const [e] = map(fx('mcp'))
  assert.deepEqual([e.source, e.trust], ['mcp:github__get_issue', 'untrusted']); assert.match(e.content, /evil\.sh/)
})
t('grep in repo is semi', () => assert.deepEqual([map(fx('grep'))[0].source, map(fx('grep'))[0].trust], ['grep', 'semi']))
t('glob outside repo is untrusted', () => assert.equal(map(fx('glob-outside'))[0].trust, 'untrusted'))
t('edit -> write event', () => {
  const [e] = map(fx('edit'))
  assert.deepEqual([e.kind, e.source, e.old_text, e.new_text], ['write', 'edit', 'Some text.', 'Some text.\nhello'])
})
t('write create has empty old_text', () => assert.equal(map(fx('write-create'))[0].old_text, ''))
t('write update uses originalFile', () => assert.equal(map(fx('write-update'))[0].old_text, 'hello'))
t('multiedit -> one event per edit, ts +1ms', () => {
  const es = map(fx('multiedit'))
  assert.equal(es.length, 2); assert.deepEqual(es.map((e) => e.ts), [1000, 1001]); assert.equal(es[1].new_text, 'd')
})
t('todowrite ignored', () => assert.equal(map(fx('todowrite')).length, 0))
t('batches respect size', () => {
  const big = Array.from({ length: 250 }, () => ({ content: 'x'.repeat(20000) }))
  const bs = batches(big)
  assert.ok(bs.every((b) => b.length <= 100 && JSON.stringify(b).length < 1024 * 1024)); assert.equal(bs.flat().length, 250)
})

// Process-level: unreachable URL -> queue, exit 0, nothing on stdout, fast.
t('hook process: failure path queues, exits 0, silent, < 2.6 s', () => {
  const home = mkdtempSync(join(tmpdir(), 'tb-home-'))
  for (const name of readdirSync(join(here, 'fixtures')).map((f) => f.replace(/\.json$/, ''))) {
    const start = Date.now()
    const r = spawnSync(process.execPath, [join(here, 'hook.mjs')], {
      input: readFileSync(join(here, 'fixtures', `${name}.json`)),
      env: { PATH: process.env.PATH, HOME: home, TAINT_BLAME_URL: 'http://127.0.0.1:9', TAINT_BLAME_TOKEN: 'test-token' },
    })
    const ms = Date.now() - start
    assert.equal(r.status, 0, `${name} exit`); assert.equal(r.stdout.length, 0, `${name} stdout`); assert.ok(ms < 2600, `${name} took ${ms}ms`)
  }
  const q = readFileSync(join(home, '.taint-blame', 'queue.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.equal(q.length, 16) // 14 one-event fixtures + multiedit (2) + todowrite (0)
})
t('hook process: garbage stdin and no config still exit 0 silently', () => {
  const home = mkdtempSync(join(tmpdir(), 'tb-home-'))
  const r = spawnSync(process.execPath, [join(here, 'hook.mjs')], { input: 'not json', env: { PATH: process.env.PATH, HOME: home } })
  assert.equal(r.status, 0); assert.equal(r.stdout.length, 0)
})
t('hook process: blackholed URL hits the 2 s fetch timeout, still < 2.6 s', () => {
  const home = mkdtempSync(join(tmpdir(), 'tb-home-'))
  const start = Date.now()
  const r = spawnSync(process.execPath, [join(here, 'hook.mjs')], {
    input: readFileSync(join(here, 'fixtures', 'read.json')),
    env: { PATH: process.env.PATH, HOME: home, TAINT_BLAME_URL: 'http://10.255.255.1', TAINT_BLAME_TOKEN: 'x' },
  })
  const ms = Date.now() - start
  assert.equal(r.status, 0); assert.ok(ms < 2600, `took ${ms}ms`)
  assert.ok(existsSync(join(home, '.taint-blame', 'queue.jsonl')), 'queued after timeout')
})
// config.env fallback: a local server must receive the token from the file.
{
  const { createServer } = await import('node:http')
  const { spawn } = await import('node:child_process')
  const home = mkdtempSync(join(tmpdir(), 'tb-home-'))
  let got
  const srv = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => { got = { auth: req.headers.authorization, url: req.url, body: JSON.parse(body) }; res.end('{"ok":true}') })
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  mkdirSync(join(home, '.taint-blame'))
  writeFileSync(join(home, '.taint-blame', 'config.env'), `TAINT_BLAME_URL=http://127.0.0.1:${srv.address().port}/\nTAINT_BLAME_TOKEN="abc"\n`)
  const child = spawn(process.execPath, [join(here, 'hook.mjs')], { env: { PATH: process.env.PATH, HOME: home } })
  child.stdin.end(readFileSync(join(here, 'fixtures', 'read.json')))
  const code = await new Promise((r) => child.on('exit', r))
  srv.close()
  t('hook process: config.env fallback is used and POST succeeds (no queue)', () => {
    assert.equal(code, 0)
    assert.equal(got?.auth, 'Bearer abc'); assert.equal(got.url, '/api/events'); assert.equal(got.body[0].source, 'read')
    assert.ok(!existsSync(join(home, '.taint-blame', 'queue.jsonl')))
  })
}

console.log(`\n${passed} passed`)
