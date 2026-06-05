import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

// Guard del hash CSP de sonner (infra:I24).
//
// `<Toaster>` (sonner) inyecta su CSS como un <style> en runtime. Con la CSP
// endurecida (style-src 'self' SIN 'unsafe-inline'), ese <style> solo se permite
// vía un hash 'sha256-...' en style-src de vercel.json. Si se actualiza sonner y
// cambia su CSS, el hash queda obsoleto y los toasts saldrían sin estilo. Este
// test recomputa el hash desde node_modules y falla si vercel.json no lo tiene,
// forzando a regenerarlo en el mismo PR del upgrade.
//
// Para regenerar tras un upgrade: corré este test, copiá el hash del mensaje de
// error y pegalo en la directiva style-src de vercel.json.

/** Extrae el CSS exacto que sonner inyecta: el literal de plantilla en `wt(` ... `)`. */
function extractSonnerInjectedCss(): string {
  const src = readFileSync(resolve('node_modules/sonner/dist/index.mjs'), 'utf-8')
  const callIdx = src.indexOf('wt(`')
  if (callIdx === -1) throw new Error('No se encontró la inyección de estilos de sonner (wt(`...`))')
  let j = callIdx + 'wt(`'.length
  let out = ''
  while (j < src.length) {
    const c = src[j]
    if (c === '\\') {
      // Decodifica los escapes JS que afectan el textContent inyectado.
      const next = src[j + 1]
      out += next === '`' ? '`' : next === '\\' ? '\\' : next === '$' ? '$' : `\\${next}`
      j += 2
      continue
    }
    if (c === '`') break
    out += c
    j += 1
  }
  if (out.length === 0) throw new Error('CSS inyectado por sonner vacío')
  return out
}

function sonnerStyleHash(): string {
  const css = extractSonnerInjectedCss()
  return 'sha256-' + createHash('sha256').update(css, 'utf-8').digest('base64')
}

function styleSrcFromVercelJson(): string {
  const vercel = JSON.parse(readFileSync(resolve('vercel.json'), 'utf-8'))
  const headers = vercel.headers?.[0]?.headers ?? []
  const csp = headers.find((h: { key: string }) => h.key === 'Content-Security-Policy')?.value
  if (!csp) throw new Error('No se encontró el header Content-Security-Policy en vercel.json')
  const m = String(csp).match(/style-src ([^;]+);/)
  if (!m) throw new Error('No se encontró la directiva style-src en la CSP')
  return m[1]
}

describe('CSP · hash de estilos de sonner', () => {
  it('vercel.json incluye el hash sha256 del <style> que inyecta sonner', () => {
    const hash = sonnerStyleHash()
    const styleSrc = styleSrcFromVercelJson()
    expect(
      styleSrc.includes(`'${hash}'`),
      `style-src de vercel.json no contiene el hash actual de sonner.\n` +
        `Esperado: '${hash}'\n` +
        `Actual style-src: ${styleSrc}\n` +
        `→ Actualizá la directiva style-src en vercel.json con ese hash.`,
    ).toBe(true)
  })

  it('style-src no usa unsafe-inline (residual acotado a style-src-attr)', () => {
    expect(styleSrcFromVercelJson()).not.toContain("'unsafe-inline'")
  })
})
