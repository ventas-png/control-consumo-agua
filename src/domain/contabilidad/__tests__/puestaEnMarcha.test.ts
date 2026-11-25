import { describe, expect, it } from 'vitest'
import { EVENTOS_MAPEO } from '../../../types/contabilidad'
import { evaluarPuestaEnMarcha, resumirPuestaEnMarcha, type EntradaPuestaEnMarcha } from '../puestaEnMarcha'

const TODOS = EVENTOS_MAPEO.map((e) => e.evento)
const LISTA: EntradaPuestaEnMarcha = {
  projectId: 'p1',
  totalCuentas: 22,
  especiales: [{ etiqueta: 'Resultado del ejercicio', estado: 'ok', bloqueante: true }],
  eventosMapeados: TODOS,
  tiposCargo: [{ etiqueta: 'Mantenimiento', estado: 'ok' }],
  hayApertura: true,
  totalCuentasBancarias: 1,
}
const paso = (e: EntradaPuestaEnMarcha, id: string) => evaluarPuestaEnMarcha(e).find((p) => p.id === id)!

describe('evaluarPuestaEnMarcha', () => {
  it('una contabilidad completa no deja nada pendiente', () => {
    const pasos = evaluarPuestaEnMarcha(LISTA)
    expect(pasos.every((p) => p.listo && p.detalle === '')).toBe(true)
    expect(resumirPuestaEnMarcha(pasos)).toEqual({ listos: 6, total: 6, requeridosPendientes: 0, completa: true })
  })

  it('sin catálogo, todo lo que depende de él queda pendiente y lo dice', () => {
    const pasos = evaluarPuestaEnMarcha({ ...LISTA, totalCuentas: 0, hayApertura: false })
    expect(paso({ ...LISTA, totalCuentas: 0 }, 'catalogo').listo).toBe(false)
    for (const id of ['especiales', 'eventos', 'tiposcargo', 'apertura']) {
      const p = pasos.find((x) => x.id === id)!
      expect(p.listo).toBe(false)
      expect(p.detalle).toBe('Primero crea el catálogo de cuentas.')
    }
  })

  it('cuenta las especiales que faltan y cuántas detienen su proceso', () => {
    const p = paso({
      ...LISTA,
      especiales: [
        { etiqueta: 'Resultado del ejercicio', estado: 'sin_mapeo', bloqueante: true },
        { etiqueta: 'Activo fijo', estado: 'inactiva', bloqueante: false },
        { etiqueta: 'Diferencial cambiario', estado: 'ok', bloqueante: true },
      ],
    }, 'especiales')
    expect(p.listo).toBe(false)
    expect(p.detalle).toBe('Faltan 2 (1 detienen su proceso): Resultado del ejercicio, Activo fijo.')
    expect(p.destino).toBe('configuracion')
  })

  it('nombra los eventos sin cuenta y avisa que no se contabilizan', () => {
    const p = paso({ ...LISTA, eventosMapeados: TODOS.filter((e) => !['ingreso_agua', 'cxc_agua', 'gasto_obras'].includes(e)) }, 'eventos')
    expect(p.listo).toBe(false)
    expect(p.detalle).toBe('3 sin cuenta: Servicio de agua, CxC servicio de agua y 1 más. Lo que caiga ahí no se contabiliza.')
  })

  it('los tipos de cargo sólo aplican a la contabilidad de un proyecto', () => {
    const empresa = evaluarPuestaEnMarcha({ ...LISTA, projectId: null, tiposCargo: [{ etiqueta: 'Mantenimiento', estado: 'sin_configurar' }] })
    expect(empresa.some((p) => p.id === 'tiposcargo')).toBe(false)
    expect(resumirPuestaEnMarcha(empresa).total).toBe(5)
    const proyecto = paso({ ...LISTA, tiposCargo: [{ etiqueta: 'Mantenimiento', estado: 'sin_configurar' }, { etiqueta: 'Recargo por mora', estado: 'cuenta_invalida' }] }, 'tiposcargo')
    expect(proyecto.detalle).toBe('2 sin configurar: Mantenimiento, Recargo por mora. Sus cargos quedarán en Pendientes.')
  })

  it('apertura y bancos son recomendados: faltar no cuenta como requerido pendiente', () => {
    const pasos = evaluarPuestaEnMarcha({ ...LISTA, hayApertura: false, totalCuentasBancarias: 0 })
    expect(resumirPuestaEnMarcha(pasos)).toEqual({ listos: 4, total: 6, requeridosPendientes: 0, completa: false })
    expect(pasos.find((p) => p.id === 'apertura')!.nivel).toBe('recomendado')
  })
})
