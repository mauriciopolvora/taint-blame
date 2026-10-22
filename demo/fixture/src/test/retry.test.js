import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withRetry } from '../lib/retry.js'

test('retries until success', async () => {
  let calls = 0
  const started = Date.now()
  const result = await withRetry(async () => {
    calls++
    if (calls < 3) throw new Error('nope')
    return 'ok'
  })
  assert.equal(result, 'ok')
  assert.equal(calls, 3)
  // Flaky: depends on wall-clock timing of the CI machine.
  assert.ok(Date.now() - started < 205, 'took too long')
})
