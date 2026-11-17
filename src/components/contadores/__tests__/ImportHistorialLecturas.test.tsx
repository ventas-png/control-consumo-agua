// Importar historial de lecturas desde Contadores: se elige el proyecto, cada
// fila se valida contra los contadores de ESE proyecto, lo que entra no es un
// cobro, y los contadores cuya lectura inicial cambió se actualizan en pantalla.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import type { Contador, Proyecto, Tarifa, Unidad } from '../../../types'
import type { ResumenImportHistorial } from '../../../domain/agua/historialLecturas'

const h = vi.hoisted(() => ({
  importarHistorialLecturas: vi.fn(),
  notify: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../shared/SessionContext', () => ({
  useSession: () => ({ user_id: 'u1', role: 'admin', company_id: 'co1', name: 'Admin', email: 'admin@x.com' }),
}))
vi.mock('../../shared/Dialog', () => ({ notify: h.notify, confirm: vi.fn(async () => ({ isConfirmed: false })) }))
vi.mock('../../../domain/contadores/mutations', () => ({
  updateContador: vi.fn(), setContadorActivo: vi.fn(async () => ({ error: null })), deleteContador: vi.fn(),
}))
vi.mock('../../../domain/agua/historialLecturas', () => ({
  importarHistorialLecturas: h.importarHistorialLecturas,
  fetchHistorialLecturas: vi.fn(async () => []),
}))

const { ContadoresSection } = await import('../ContadoresSection')
const { validarFilaHistorial, textoResumenHistorial } = await import('../ImportHistorialLecturasModal')

const proyectos = [
  { id: 'p1', nombre: 'Viñas del Sur Fase 1', company_id: 'co1' },
  { id: 'p2', nombre: 'Edificio SQ', company_id: 'co1' },
] as unknown as Proyecto[]
const contadores = [
  { id: 'c-1', numero_serie: '21B-001', project_id: 'p1', lectura_inicial: 0, activo: true, tipo_agua: 'potable' },
  { id: 'c-2', numero_serie: 'SQ-001', project_id: 'p2', lectura_inicial: 0, activo: true, tipo_agua: 'potable' },
  { id: 'c-3', numero_serie: 'SQ-002', project_id: 'p2', lectura_inicial: 0, activo: true, tipo_agua: 'potable' },
] as unknown as Contador[]

const resumen = (extra: Partial<ResumenImportHistorial['lectura_inicial']> = {}): ResumenImportHistorial => ({
  filas: 3, insertadas: 3, actualizadas: 0, contadores: 2,
  lectura_inicial: { actualizadas: 0, sin_permiso: 0, con_lecturas: 0, anteriores_a_instalacion: 0, menores: 0, contadores: [], ...extra },
})

function subirCsv(texto: string) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File([texto], 'historial.csv', { type: 'text/csv' })] } })
}

beforeEach(() => { Object.values(h).forEach(m => m.mockReset()) })
afterEach(cleanup)

describe('validarFilaHistorial', () => {
  it('busca el contador en el proyecto elegido, sin distinguir mayúsculas', () => {
    expect(validarFilaHistorial({ contador: ' sq-001 ', fecha: '2025-11', lectura: '1 520,5' }, 2, contadores, 'p2', '2026-11-17'))
      .toEqual({ ok: true, data: { fila: 2, contador: 'sq-001', fecha: '2025-11-01', lectura: 1520.5, consumo: null, notas: null } })
    const otro = validarFilaHistorial({ contador: '21B-001', fecha: '2025-11-30', lectura: 5 }, 3, contadores, 'p2', '2026-11-17')
    expect(otro.ok).toBe(false)
    expect(!otro.ok && otro.errors).toEqual(['el contador «21B-001» no existe en el proyecto elegido'])
  })

  it('reúne todos los problemas de la fila', () => {
    const r = validarFilaHistorial({ contador: '', fecha: '2026-12-31', lectura: 'abc', consumo: -3 }, 4, contadores, 'p2', '2026-11-17')
    expect(!r.ok && r.errors).toEqual([
      'contador es obligatorio (el número como aparece en Contadores)',
      'la fecha 2026-12-31 está en el futuro',
      'lectura inválida «abc»',
      'consumo inválido «-3»',
    ])
    const sinDato = validarFilaHistorial({ contador: 'SQ-001', fecha: '31/10/2025' }, 5, contadores, 'p2', '2026-11-17')
    expect(!sinDato.ok && sinDato.errors).toEqual(['falta la lectura o el consumo'])
  })
})

it('el resumen dice qué pasó con la lectura inicial', () => {
  expect(textoResumenHistorial(resumen({ actualizadas: 1, sin_permiso: 2, anteriores_a_instalacion: 1 }))).toBe(
    '3 filas nuevas de 2 contadores. 1 contador sin lecturas toma como lectura inicial la última del historial. ' +
    '2 contadores no cambiaron su lectura inicial porque su usuario no puede editar contadores. ' +
    '1 contador conserva su lectura inicial: el historial es anterior a su fecha de instalación.')
})

describe('ContadoresSection — Importar historial', () => {
  it('pide el proyecto, manda las filas a ese proyecto y actualiza la lectura inicial en pantalla', async () => {
    h.importarHistorialLecturas.mockResolvedValue({
      data: resumen({ actualizadas: 1, contadores: [{ id: 'c-2', lectura_inicial: 1548 }] }), error: null,
    })
    const onContadorUpdated = vi.fn()
    render(
      <ContadoresSection
        contadores={contadores} tarifas={[] as Tarifa[]} unidades={[] as Unidad[]} proyectos={proyectos}
        onContadorAdded={() => {}} onContadorUpdated={onContadorUpdated} onContadorDeleted={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Importar historial' }))
    const dialog = await screen.findByRole('dialog', { name: 'Importar lecturas históricas desde Excel' })
    expect(within(dialog).getByText(/no genera cobros/)).toBeTruthy()
    const selector = within(dialog).getByLabelText('Proyecto *') as HTMLSelectElement
    expect(selector.value).toBe('')
    fireEvent.change(selector, { target: { value: 'p2' } })

    subirCsv('contador,fecha,lectura,consumo,notas\nSQ-001,2025-10-31,1520,,Cuaderno\nSQ-001,2025-11,1548,,\nSQ-002,30/11/2025,,14,\n')
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Importar 3 lecturas históricas' }))

    await waitFor(() => expect(h.importarHistorialLecturas).toHaveBeenCalledTimes(1))
    expect(h.importarHistorialLecturas).toHaveBeenCalledWith('p2', [
      { fila: 2, contador: 'SQ-001', fecha: '2025-10-31', lectura: 1520, consumo: null, notas: 'Cuaderno' },
      { fila: 3, contador: 'SQ-001', fecha: '2025-11-01', lectura: 1548, consumo: null, notas: null },
      { fila: 4, contador: 'SQ-002', fecha: '2025-11-30', lectura: null, consumo: 14, notas: null },
    ])
    await waitFor(() => expect(onContadorUpdated).toHaveBeenCalledWith('c-2', { lectura_inicial: 1548 }))
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', title: 'Historial importado' }))
  })

  it('sin proyecto elegido marca los contadores que no existen y no deja importar', async () => {
    render(
      <ContadoresSection
        contadores={contadores} tarifas={[] as Tarifa[]} unidades={[] as Unidad[]} proyectos={proyectos}
        onContadorAdded={() => {}} onContadorUpdated={() => {}} onContadorDeleted={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Importar historial' }))
    const dialog = await screen.findByRole('dialog')
    subirCsv('contador,fecha,lectura\nSQ-001,2025-10-31,1520\n')
    const importar = await within(dialog).findByRole('button', { name: 'Importar 1 lectura histórica' }) as HTMLButtonElement
    expect(importar.disabled).toBe(true)
    expect(within(dialog).getByText('Elija el proyecto.')).toBeTruthy()
    expect(h.importarHistorialLecturas).not.toHaveBeenCalled()
  })
})
