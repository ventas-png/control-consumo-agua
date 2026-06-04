import { describe, it, expect } from 'vitest'
import { validarReceptorFiscal } from '../receptorFiscal'

// Valida el GATE de los datos fiscales del receptor que aplica el formulario de
// cliente (ClientesSection). El algoritmo de NIT/RFC en sí ya está cubierto en
// src/lib/__tests__/businessFiscal.test.ts; aquí verificamos la COMPOSICIÓN que
// usa el form: gating por régimen + opcionalidad del campo.
describe('validarReceptorFiscal', () => {
  describe('régimen ninguno', () => {
    it('no valida nada (el tenant no emite comprobante fiscal)', () => {
      expect(validarReceptorFiscal('ninguno', { nit: 'basura', rfc: 'basura' })).toEqual([])
    })
  })

  describe('FEL (Guatemala)', () => {
    it('acepta un NIT válido (dígito verificador correcto)', () => {
      expect(validarReceptorFiscal('fel_gt', { nit: '12345679' })).toEqual([])
    })

    it('acepta NIT con guion', () => {
      expect(validarReceptorFiscal('fel_gt', { nit: '1234567-9' })).toEqual([])
    })

    it('acepta "CF" (Consumidor Final)', () => {
      expect(validarReceptorFiscal('fel_gt', { nit: 'CF' })).toEqual([])
      expect(validarReceptorFiscal('fel_gt', { nit: 'cf' })).toEqual([])
    })

    it('NIT vacío/ausente es válido (campo opcional)', () => {
      expect(validarReceptorFiscal('fel_gt', { nit: '' })).toEqual([])
      expect(validarReceptorFiscal('fel_gt', {})).toEqual([])
      expect(validarReceptorFiscal('fel_gt', { nit: '   ' })).toEqual([])
    })

    it('rechaza un NIT con dígito verificador inválido', () => {
      const errs = validarReceptorFiscal('fel_gt', { nit: '12345670' })
      expect(errs).toHaveLength(1)
      expect(errs[0]).toMatch(/NIT inválido/i)
    })

    it('NO valida el RFC bajo régimen FEL (campo no aplica)', () => {
      expect(validarReceptorFiscal('fel_gt', { nit: 'CF', rfc: 'no-importa' })).toEqual([])
    })
  })

  describe('CFDI (México)', () => {
    it('acepta un RFC válido (genérico nacional)', () => {
      expect(validarReceptorFiscal('cfdi_mx', { rfc: 'XAXX010101000' })).toEqual([])
    })

    it('RFC vacío/ausente es válido (campo opcional)', () => {
      expect(validarReceptorFiscal('cfdi_mx', { rfc: '' })).toEqual([])
      expect(validarReceptorFiscal('cfdi_mx', {})).toEqual([])
    })

    it('rechaza un RFC mal formado', () => {
      const errs = validarReceptorFiscal('cfdi_mx', { rfc: '123' })
      expect(errs).toHaveLength(1)
      expect(errs[0]).toMatch(/RFC inválido/i)
    })

    it('NO valida el NIT bajo régimen CFDI (campo no aplica)', () => {
      expect(validarReceptorFiscal('cfdi_mx', { rfc: 'XAXX010101000', nit: 'no-importa' })).toEqual([])
    })
  })
})
