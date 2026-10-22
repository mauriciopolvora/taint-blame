import { useRouter } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'

export type LiveState = 'live' | 'paused' | 'offline'

// Re-runs the current route's loaders every `ms` while the tab is visible.
// router.invalidate() keeps the old data on screen until the new data lands,
// so there is no loading flash and no scroll jump.
export function useLiveRefresh(ms = 2500): { state: LiveState; updatedAt: number | null } {
  const router = useRouter()
  const [state, setState] = useState<LiveState>('live')
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let inFlight = false
    let stopped = false

    const tick = async () => {
      if (stopped) return
      if (document.visibilityState !== 'visible') {
        setState('paused')
        return
      }
      if (!inFlight) {
        inFlight = true
        try {
          await router.invalidate()
          setState('live')
          setUpdatedAt(Date.now())
        } catch {
          setState('offline')
        } finally {
          inFlight = false
        }
      }
      timer = setTimeout(tick, ms)
    }

    const onVisibility = () => {
      clearTimeout(timer)
      if (document.visibilityState === 'visible') void tick()
      else setState('paused')
    }

    setUpdatedAt(Date.now())
    timer = setTimeout(tick, ms)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [router, ms])

  return { state, updatedAt }
}

// Returns a predicate that is true for ids that appeared after the first
// render, so only rows that arrive live get an enter animation.
export function useArrivals(ids: string[]): (id: string) => boolean {
  const seen = useRef<Set<string> | null>(null)
  if (seen.current === null) seen.current = new Set(ids)
  const known = seen.current
  const fresh = new Set(ids.filter((id) => !known.has(id)))
  useEffect(() => {
    for (const id of fresh) known.add(id)
  })
  return (id) => fresh.has(id)
}
