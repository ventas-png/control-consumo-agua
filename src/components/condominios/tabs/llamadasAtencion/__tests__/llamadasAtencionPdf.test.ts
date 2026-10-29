import { describe, it, expect, vi } from 'vitest'
import type { LlamadaAtencionMia } from '../../../../../types'

vi.mock('../../../../../lib/supabase', () => ({ supabase: { storage: { from: () => ({}) } }, db: {} }))

const { lineasCartaPdf } = await import('../llamadasAtencionPdf')
const { nombreAcuseValido, nombrePdfLlamada } = await import('../../../../../domain/condominios/llamadasAtencion')

const base: LlamadaAtencionMia = {
  id: 'll1', project_id: 'p1', proyecto_nombre: 'Condominio 1', personal_id: 'e1', empleado_nombre: 'Elena Empleada', empleado_cargo: 'Guardia',
  tipo: 'suspension', dias_suspension: 2, fecha_hechos: '2026-10-20', motivo: 'Abandono de puesto', descripcion: 'Dejó la garita sin relevo.',
  fundamento: 'Art. 12 del reglamento interno', estado: 'acusada', emitido_por_nombre: 'Rosa RRHH', emitido_en: '2026-10-21T14:00:00Z',
  firma_emisor_path: 'p1/ll1/emisor.png', acuse_en: '2026-10-22T09:05:00Z', acuse_nombre: 'Elena Empleada', acuse_modo: 'presencial', firma_acuse_path: 'p1/ll1/acuse.png',
}

describe('lineasCartaPdf', () => {
  it('cabecera con título por tipo, destinatario con cargo, fecha de los hechos y asunto', () => {
    const { cabecera, cuerpo } = lineasCartaPdf({ carta: base })
    expect(cabecera[0]).toBe('SUSPENSIÓN SIN GOCE DE SALARIO')
    expect(cabecera[1]).toBe('Para: Elena Empleada — Guardia')
    expect(cabecera[2]).toMatch(/^Fecha de los hechos: 20 de octubre de 2026$/)
    expect(cabecera[3]).toBe('Asunto: Abandono de puesto')
    expect(cuerpo).toEqual(['Dejó la garita sin relevo.', 'Se aplica una suspensión sin goce de salario de 2 días.', 'Fundamento: Art. 12 del reglamento interno'])
  })

  it('firmas: quién emitió y quién recibió, con hora y modo', () => {
    const { firmas } = lineasCartaPdf({ carta: base })
    expect(firmas).toHaveLength(2)
    expect(firmas[0]).toMatch(/^Emitida por: Rosa RRHH · \d{2}\/\d{2}\/2026/)
    expect(firmas[1]).toMatch(/^Recibí: Elena Empleada · \d{2}\/\d{2}\/2026.*· firmado en persona$/)
  })

  it('pendiente: el bloque de recibido dice que falta la firma; anulada: lo señala con el motivo', () => {
    expect(lineasCartaPdf({ carta: { ...base, estado: 'pendiente', acuse_en: null, acuse_nombre: null, acuse_modo: null, firma_acuse_path: null } }).firmas[1])
      .toBe('Pendiente de firma de recibido')
    const anulada = lineasCartaPdf({ carta: { ...base, estado: 'anulada', anulada_en: '2026-10-23T08:00:00Z', motivo_anulacion: 'Emitida por error' } }).firmas
    expect(anulada[2]).toMatch(/^ANULADA el .*: Emitida por error$/)
  })

  it('una llamada de atención sin fundamento ni días sólo lleva el detalle', () => {
    const { cabecera, cuerpo } = lineasCartaPdf({ carta: { ...base, tipo: 'llamada_atencion', dias_suspension: null, fundamento: null, empleado_cargo: null } })
    expect(cabecera[0]).toBe('LLAMADA DE ATENCIÓN')
    expect(cabecera[1]).toBe('Para: Elena Empleada')
    expect(cuerpo).toEqual(['Dejó la garita sin relevo.'])
  })
})

describe('helpers del dominio', () => {
  it('nombreAcuseValido exige nombre y apellido', () => {
    expect(nombreAcuseValido('Elena Empleada')).toBe(true)
    expect(nombreAcuseValido('  Elena   ')).toBe(false)
    expect(nombreAcuseValido('E E')).toBe(false)
  })
  it('nombrePdfLlamada: sin acentos ni espacios', () => {
    expect(nombrePdfLlamada(base)).toBe('Suspension-Elena_Empleada-2026-10-20.pdf')
  })
})
