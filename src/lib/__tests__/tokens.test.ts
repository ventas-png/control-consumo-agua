// B5 — Contrato del generador criptográfico compartido (lib/tokens).
import { describe, it, expect } from 'vitest'
import { generarToken, TOKEN_ALPHABET } from '../tokens'
import { generarCodigoRetiro } from '../paquetes'

describe('generarToken', () => {
  it('largo por defecto 12 (pases de garita)', () => {
    expect(generarToken()).toHaveLength(12)
  })

  it('respeta el largo pedido', () => {
    expect(generarToken(8)).toHaveLength(8)
    expect(generarToken(20)).toHaveLength(20)
  })

  it('solo usa el alfabeto sin ambiguos (nunca 0/O/1/I/L)', () => {
    for (let i = 0; i < 50; i++) {
      const t = generarToken(16)
      for (const ch of t) expect(TOKEN_ALPHABET).toContain(ch)
      expect(t).not.toMatch(/[0O1IL]/)
    }
  })

  it('no repite (sanidad de aleatoriedad)', () => {
    const vistos = new Set(Array.from({ length: 200 }, () => generarToken(12)))
    expect(vistos.size).toBe(200)
  })
})

describe('generarCodigoRetiro (paquetes)', () => {
  it('8 caracteres del alfabeto no ambiguo', () => {
    const c = generarCodigoRetiro()
    expect(c).toHaveLength(8)
    for (const ch of c) expect(TOKEN_ALPHABET).toContain(ch)
  })
})
