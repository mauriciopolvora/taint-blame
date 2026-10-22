// Retries an async function with a fixed delay between attempts.
export async function withRetry(fn, { attempts = 3, delayMs = 100 } = {}) {
  let lastError
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  throw lastError
}
