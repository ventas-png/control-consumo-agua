import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Guard de la POSTURA CSP (infra:I24 + Fase de solidez 2026-06-10).
//
// Decisión (tras el incidente en prod): el endurecimiento crítico es `script-src`
// —el vector real de XSS—, que se mantiene ESTRICTO (sin 'unsafe-inline' ni
// 'unsafe-eval'). `style-src` usa 'unsafe-inline' A PROPÓSITO: la app y varias
// librerías (sonner, etc.) inyectan <style> en runtime con contenido variable, y
// el enfoque por hash resultó frágil (rechazaba hojas de estilo en prod ante
// cualquier drift de versión → "Refused to apply a stylesheet…"). Ver vercel.json.
//
// Desde 2026-06-10 la CSP está CONDICIONADA POR HOST en vercel.json:
//   - entrada con `has`     → dominios de PRODUCCIÓN: Supabase PINEADO al ref del
//     proyecto (nada de https://*.supabase.co, que permitiría exfiltrar a un
//     proyecto Supabase de un atacante si hubiera XSS).
//   - entrada con `missing` → previews de Vercel: wildcard *.supabase.co porque
//     cada preview branch de Supabase usa un ref efímero distinto.

type HeaderEntry = { key: string; value: string }
type HeaderRoute = {
  source: string
  has?: Array<{ type: string; value: string }>
  missing?: Array<{ type: string; value: string }>
  headers: HeaderEntry[]
}

function cspsFromVercelJson(): { prod: string; preview: string } {
  const vercel = JSON.parse(readFileSync(resolve('vercel.json'), 'utf-8'))
  const routes: HeaderRoute[] = vercel.headers ?? []
  const withCsp = routes
    .map((r) => ({
      route: r,
      csp: r.headers.find((h) => h.key === 'Content-Security-Policy')?.value,
    }))
    .filter((x): x is { route: HeaderRoute; csp: string } => Boolean(x.csp))

  const prod = withCsp.find((x) => x.route.has?.some((c) => c.type === 'host'))?.csp
  const preview = withCsp.find((x) => x.route.missing?.some((c) => c.type === 'host'))?.csp
  if (!prod || !preview) {
    throw new Error(
      'vercel.json debe tener DOS CSP: una con `has` host (prod, pineada) y una con `missing` host (previews, wildcard)',
    )
  }
  // Las condiciones de host de ambas entradas deben ser IDÉNTICAS: si divergen,
  // algún host quedaría con dos CSP (o ninguna) según el orden de merge de Vercel.
  const hasHost = JSON.stringify(withCsp.find((x) => x.route.has)?.route.has)
  const missingHost = JSON.stringify(withCsp.find((x) => x.route.missing)?.route.missing)
  if (hasHost !== missingHost) {
    throw new Error('Las condiciones host de `has` y `missing` divergen en vercel.json')
  }
  return { prod, preview }
}

function directive(csp: string, name: string): string {
  const m = csp.match(new RegExp(`(?:^|;)\\s*${name} ([^;]+)`))
  return m ? m[1].trim() : ''
}

describe('CSP · postura de seguridad (prod y previews)', () => {
  const { prod, preview } = cspsFromVercelJson()
  const variants: Array<[string, string]> = [
    ['prod', prod],
    ['preview', preview],
  ]

  it.each(variants)('[%s] script-src ESTRICTO (sin unsafe-inline ni unsafe-eval)', (_n, csp) => {
    const scriptSrc = directive(csp, 'script-src')
    expect(scriptSrc, 'falta script-src en la CSP').not.toBe('')
    expect(scriptSrc).not.toContain("'unsafe-inline'")
    expect(scriptSrc).not.toContain("'unsafe-eval'")
  })

  it.each(variants)('[%s] object-src none + base-uri self + frame-src none', (_n, csp) => {
    expect(directive(csp, 'object-src')).toContain("'none'")
    expect(directive(csp, 'base-uri')).toContain("'self'")
    expect(directive(csp, 'frame-src')).toContain("'none'")
  })

  it.each(variants)('[%s] form-action self + frame-ancestors none', (_n, csp) => {
    expect(directive(csp, 'form-action')).toContain("'self'")
    expect(directive(csp, 'frame-ancestors')).toContain("'none'")
  })

  it.each(variants)('[%s] style-src permite unsafe-inline (decisión documentada)', (_n, csp) => {
    expect(directive(csp, 'style-src')).toContain("'unsafe-inline'")
  })

  it.each(variants)('[%s] sin endpoints retirados (api.emailjs.com — Fase 4 #21)', (_n, csp) => {
    expect(csp).not.toContain('emailjs.com')
  })

  it('prod NO usa wildcard *.supabase.co: Supabase pineado al ref del proyecto', () => {
    expect(prod).not.toContain('*.supabase.co')
    const connect = directive(prod, 'connect-src')
    expect(connect).toContain('https://nnsqmeigtgewatameexo.supabase.co')
    expect(connect).toContain('wss://nnsqmeigtgewatameexo.supabase.co')
    expect(directive(prod, 'img-src')).toContain('https://nnsqmeigtgewatameexo.supabase.co')
  })

  it('preview SÍ permite *.supabase.co (refs efímeros de los preview branches)', () => {
    const connect = directive(preview, 'connect-src')
    expect(connect).toContain('https://*.supabase.co')
    expect(connect).toContain('wss://*.supabase.co')
  })
})
