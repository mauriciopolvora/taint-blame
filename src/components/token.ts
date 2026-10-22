// The ingest token lives in this browser only. Storage can throw (private
// windows, blocked site data), so every access is guarded.
const KEY = 'taint-blame.token'

export function readToken(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveToken(token: string): boolean {
  try {
    if (token) localStorage.setItem(KEY, token)
    else localStorage.removeItem(KEY)
    return true
  } catch {
    return false
  }
}

export type VerifyResult = 'connected' | 'invalid' | 'error'

export async function verifyToken(token: string): Promise<VerifyResult> {
  try {
    const res = await fetch('/api/verify', { method: 'POST', headers: { authorization: `Bearer ${token}` } })
    if (res.ok) return 'connected'
    return res.status === 401 ? 'invalid' : 'error'
  } catch {
    return 'error'
  }
}

export async function resetSessions(token: string, sessionId?: string): Promise<{ ok: true; sessions: number } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/reset', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(sessionId ? { session_id: sessionId } : {}),
    })
    if (res.ok) {
      const body = (await res.json()) as { sessions: number }
      return { ok: true, sessions: body.sessions }
    }
    if (res.status === 401) return { ok: false, error: 'The saved token was rejected. Check it in Settings.' }
    if (res.status === 404) return { ok: false, error: 'That session no longer exists.' }
    return { ok: false, error: `Request failed (${res.status}).` }
  } catch {
    return { ok: false, error: 'Could not reach the server.' }
  }
}
