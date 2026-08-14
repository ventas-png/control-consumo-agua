import { describe, it, expect } from 'vitest'
import {
  describirUso,
  planificarBorradoCuentas,
  resumirBloqueadas,
  type CuentaCandidata,
} from '../borrarCuentas'
import type { CuentaEnUso } from '../mutations'

function cuenta(id: string, codigo: string, es_sistema = false): CuentaCandidata {
  return { id, codigo, nombre: `Cuenta ${codigo}`, es_sistema }
}

function uso(cuenta_id: string, referencia: string, usos = 1): CuentaEnUso {
  return { cuenta_id, referencia, usos }
}

describe('planificarBorradoCuentas', () => {
  it('deja borrar la cuenta que nadie referencia', () => {
    const plan = planificarBorradoCuentas([cuenta('a', '5201-99')], [])
    expect(plan.borrables.map((c) => c.codigo)).toEqual(['5201-99'])
    expect(plan.bloqueadas).toEqual([])
  })

  it('bloquea las cuentas del catálogo base y manda a desactivarlas', () => {
    const plan = planificarBorradoCuentas([cuenta('a', '1101', true)], [])
    expect(plan.borrables).toEqual([])
    expect(plan.bloqueadas[0].motivos[0]).toMatch(/desactívala/i)
  })

  it('bloquea por movimientos, hijas, presupuesto y mapeo, con texto legible', () => {
    const candidatas = [cuenta('a', '5201'), cuenta('b', '52'), cuenta('c', '4101'), cuenta('d', '1102-09')]
    const plan = planificarBorradoCuentas(candidatas, [
      uso('a', 'conta_asiento_lineas', 12),
      uso('b', 'conta_cuentas', 3),
      uso('c', 'presupuesto_partidas'),
      uso('d', 'conta_mapeo_cuentas'),
    ])
    expect(plan.borrables).toEqual([])
    const motivos = Object.fromEntries(plan.bloqueadas.map((b) => [b.cuenta.codigo, b.motivos.join(' | ')]))
    expect(motivos['5201']).toBe('tiene movimientos en pólizas (12)')
    expect(motivos['52']).toBe('tiene cuentas hijas (3)')
    expect(motivos['4101']).toBe('está presupuestada')
    expect(motivos['1102-09']).toBe('está asignada a un evento en Configuración')
  })

  it('acumula varios motivos en la misma cuenta', () => {
    const plan = planificarBorradoCuentas(
      [cuenta('a', '1102', true)],
      [uso('a', 'cuentas_bancarias'), uso('a', 'conta_asiento_lineas', 4)],
    )
    expect(plan.bloqueadas[0].motivos).toHaveLength(3)  // sistema + banco + movimientos
  })

  it('parte la selección: borra lo que puede y explica el resto', () => {
    const candidatas = [cuenta('a', '5201'), cuenta('b', '5202'), cuenta('c', '5203')]
    const plan = planificarBorradoCuentas(candidatas, [uso('b', 'conta_asiento_lineas', 2)])
    expect(plan.borrables.map((c) => c.codigo)).toEqual(['5201', '5203'])
    expect(plan.bloqueadas.map((b) => b.cuenta.codigo)).toEqual(['5202'])
  })

  it('no se calla ante una tabla que el mapa de motivos todavía no conoce', () => {
    // La RPC descubre las FK sola: una tabla nueva llega antes que su traducción.
    expect(describirUso(uso('a', 'tabla_nueva', 2))).toBe('la referencia tabla_nueva (2)')
    const plan = planificarBorradoCuentas([cuenta('a', '5201')], [uso('a', 'tabla_nueva')])
    expect(plan.borrables).toEqual([])
    expect(plan.bloqueadas[0].motivos[0]).toMatch(/tabla_nueva/)
  })
})

describe('resumirBloqueadas', () => {
  it('recorta la lista larga y dice cuántas faltan', () => {
    const bloqueadas = Array.from({ length: 8 }, (_, i) => ({
      cuenta: cuenta(String(i), `52${i}`),
      motivos: ['tiene movimientos en pólizas'],
    }))
    const texto = resumirBloqueadas(bloqueadas, 5)
    expect(texto.split('\n')).toHaveLength(6)
    expect(texto).toMatch(/…y 3 más/)
  })
})
