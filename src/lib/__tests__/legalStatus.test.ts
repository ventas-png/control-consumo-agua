import { describe, it, expect } from 'vitest'
import { resumirEstadoLegal, hayPendientesLegal } from '../legalStatus'

// plat:P33 — Resumen puro del estado de aceptación legal.

describe('resumirEstadoLegal', () => {
  it('lista vacía → total 0 y NO "todo aceptado"', () => {
    expect(resumirEstadoLegal([])).toEqual({ total: 0, aceptados: 0, pendientes: 0, todoAceptado: false })
  })

  it('todos aceptados → todoAceptado true', () => {
    const r = resumirEstadoLegal([{ accepted: true }, { accepted: true }])
    expect(r).toEqual({ total: 2, aceptados: 2, pendientes: 0, todoAceptado: true })
  })

  it('mezcla → cuenta pendientes y todoAceptado false', () => {
    const r = resumirEstadoLegal([{ accepted: true }, { accepted: false }, { accepted: false }])
    expect(r.total).toBe(3)
    expect(r.aceptados).toBe(1)
    expect(r.pendientes).toBe(2)
    expect(r.todoAceptado).toBe(false)
  })

  it('ninguno aceptado → todos pendientes', () => {
    const r = resumirEstadoLegal([{ accepted: false }])
    expect(r).toEqual({ total: 1, aceptados: 0, pendientes: 1, todoAceptado: false })
  })
})

describe('hayPendientesLegal', () => {
  it('false con lista vacía', () => {
    expect(hayPendientesLegal([])).toBe(false)
  })
  it('false si todos aceptados', () => {
    expect(hayPendientesLegal([{ accepted: true }, { accepted: true }])).toBe(false)
  })
  it('true si hay al menos uno sin aceptar', () => {
    expect(hayPendientesLegal([{ accepted: true }, { accepted: false }])).toBe(true)
  })
})
