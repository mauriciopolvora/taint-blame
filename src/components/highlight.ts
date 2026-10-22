import { useEffect, useState } from 'react'
import type { HighlighterCore } from 'shiki/core'

// Shiki is loaded lazily on the client only, with the JS regex engine (no WASM)
// and a fixed set of grammars, so it never lands in the Worker bundle.

export type Tok = { content: string; color?: string; fontStyle?: number }

const THEME = 'github-dark-default'

const LANGS: Record<string, () => Promise<unknown>> = {
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
}

const EXT: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  jsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  md: 'markdown',
  mdx: 'markdown',
  py: 'python',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
}

export function langFor(path: string): string | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return EXT[ext] ?? null
}

let highlighter: Promise<HighlighterCore> | null = null
const loaded = new Map<string, Promise<void>>()

async function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, theme] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
      import('shiki/themes/github-dark-default.mjs'),
    ])
    return createHighlighterCore({
      themes: [theme.default],
      langs: [],
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    })
  })()
  return highlighter
}

async function ensureLang(h: HighlighterCore, lang: string) {
  let p = loaded.get(lang)
  if (!p) {
    p = LANGS[lang]().then((m) => h.loadLanguage((m as { default: Parameters<HighlighterCore['loadLanguage']>[0] }).default))
    loaded.set(lang, p)
  }
  await p
}

const cache = new Map<string, Tok[][]>()

export async function tokenize(code: string, lang: string): Promise<Tok[][]> {
  const key = `${lang}\u0000${code}`
  const hit = cache.get(key)
  if (hit) return hit
  const h = await getHighlighter()
  await ensureLang(h, lang)
  const { tokens } = h.codeToTokens(code, { lang, theme: THEME })
  const out = tokens.map((line) => line.map((t) => ({ content: t.content, color: t.color, fontStyle: t.fontStyle })))
  cache.set(key, out)
  return out
}

// Returns per-line tokens for `code`, or null until shiki has loaded.
export function useTokens(code: string, lang: string | null): Tok[][] | null {
  const [tokens, setTokens] = useState<Tok[][] | null>(null)
  useEffect(() => {
    if (!lang || !code) {
      setTokens(null)
      return
    }
    let alive = true
    tokenize(code, lang)
      .then((t) => alive && setTokens(t))
      .catch(() => alive && setTokens(null))
    return () => {
      alive = false
    }
  }, [code, lang])
  return tokens
}
