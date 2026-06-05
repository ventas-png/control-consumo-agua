import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Guard de la POSTURA CSP (infra:I24).
//
// Decisión (tras el incidente en prod): el endurecimiento crítico es `script-src`
// —el vector real de XSS—, que se mantiene ESTRICTO (sin 'unsafe-inline' ni
// 'unsafe-eval'). `style-src` usa 'unsafe-inline' A PROPÓSITO: la app y varias
// librerías (sonner, etc.) inyectan <style> en runtime con contenido variable, y
// el enfoque por hash resultó frágil (rechazaba hojas de estilo en prod ante
// cualquier drift de versión → "Refused to apply a stylesheet…"). El riesgo de
// `style-src 'unsafe-inline'` es bajo frente al de `script-src`. Ver vercel.json.

function cspFromVercelJson(): string {
  const vercel = JSON.parse(readFileSync(resolve('vercel.json'), 'utf-8'))
  const headers = vercel.headers?.[0]?.headers ?? []
  const csp = headers.find((h: { key: string }) => h.key === 'Content-Security-Policy')?.value
  if (!csp) throw new Error('No se encontró el header Content-Security-Policy en vercel.json')
  return String(csp)
}

function directive(csp: string, name: string): string {
  const m = csp.match(new RegExp(`(?:^|;)\\s*${name} ([^;]+)`))
  return m ? m[1].trim() : ''
}

describe('CSP · postura de seguridad', () => {
  const csp = cspFromVercelJson()

  it('script-src se mantiene ESTRICTO (sin unsafe-inline ni unsafe-eval)', () => {
    const scriptSrc = directive(csp, 'script-src')
    expect(scriptSrc, 'falta script-src en la CSP').not.toBe('')
    expect(scriptSrc).not.toContain("'unsafe-inline'")
    expect(scriptSrc).not.toContain("'unsafe-eval'")
  })

  it('mantiene object-src none + base-uri self + frame-src none', () => {
    expect(directive(csp, 'object-src')).toContain("'none'")
    expect(directive(csp, 'base-uri')).toContain("'self'")
    expect(directive(csp, 'frame-src')).toContain("'none'")
  })

  it('style-src permite unsafe-inline (decisión documentada: <style> dinámicos)', () => {
    expect(directive(csp, 'style-src')).toContain("'unsafe-inline'")
  })
})
