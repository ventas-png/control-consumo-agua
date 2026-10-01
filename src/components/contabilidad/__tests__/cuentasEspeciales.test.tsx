// Las cuentas ESPECIALES del sistema ya no se buscan por código.
//
// Antes, la apertura de saldos localizaba "Resultados acumulados" con
// `codigo === '3101'` y Configuración escribía todos los mapeos sobre el ledger
// de la EMPRESA aunque se estuviera configurando un proyecto. Las dos cosas
// atan la contabilidad al catálogo sembrado: un cliente con su propio plan de
// cuentas no tiene un '3101', y un proyecto con su propia contabilidad no
// quiere que su configuración caiga en la de la empresa.
//
// Lo que se fija aquí:
//   · la apertura resuelve la cuenta por el EVENTO `resultados_acumulados`,
//     tomando el id que da el servidor y NUNCA una cuenta por su código;
//   · sin ese mapeo dice "Configuración contable incompleta" y esconde el
//     ajuste, pero deja registrar una apertura que ya cuadra (no bloquea la
//     operación);
//   · Configuración pinta la sección de cuentas especiales, marca las que
//     faltan y escribe SIEMPRE sobre el ledger activo.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import type { CuentaContable, CuentaEspecialEstado } from '../../../types/contabilidad'

const state = vi.hoisted(() => ({
  cuentas: [] as CuentaContable[],
  especiales: [] as CuentaEspecialEstado[],
  guardados: [] as Array<{ evento: string; cuentaId: string; projectId?: string | null }>,
  quitados: [] as Array<{ evento: string; projectId?: string | null }>,
  avisos: [] as Array<{ title?: string; text?: string }>,
}))

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))

vi.mock('../../shared/Dialog', () => ({
  notify: (a: { title?: string; text?: string }) => { state.avisos.push(a) },
}))

vi.mock('../../../domain/contabilidad/queries', () => ({
  useCuentasQuery: () => ({ data: state.cuentas }),
  useCuentasEspecialesQuery: () => ({ data: state.especiales }),
  useMapeoQuery: () => ({ data: [] }),
  useTiposCambioQuery: () => ({ data: [] }),
}))

vi.mock('../../../domain/contabilidad/mutations', () => ({
  useCrearAsientoBorradorMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePublicarAsientoMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useGuardarMapeoMutation: () => ({
    mutateAsync: async (v: { evento: string; cuentaId: string; projectId?: string | null }) => {
      state.guardados.push(v)
    },
    isPending: false,
  }),
  useQuitarMapeoMutation: () => ({
    mutateAsync: async (v: { evento: string; projectId?: string | null }) => {
      state.quitados.push(v)
    },
    isPending: false,
  }),
  useGuardarTipoCambioMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

// La sección de tipos de cambio mensuales tiene sus propias pruebas.
vi.mock('../TiposCambioMensualSection', () => ({ TiposCambioMensualSection: () => null }))

vi.mock('../ui', async (orig) => ({
  ...(await orig<typeof import('../ui')>()),
  usePermisosContabilidad: () => ({ puedeCrear: true, puedeEditar: true, puedeBorrar: true }),
}))

import { AperturaSaldosModal } from '../AperturaSaldosModal'
import { MapeoCuentasTab } from '../MapeoCuentasTab'

// A propósito, NINGUNA de estas cuentas usa los códigos del seed: si algo
// siguiera buscando '3101' o '3201', estas pruebas lo cazan.
function cuenta(id: string, codigo: string, nombre: string): CuentaContable {
  return {
    id, codigo, nombre,
    company_id: 'c1', project_id: null,
    tipo: 'capital', naturaleza: 'acreedora', padre_id: null, nivel: 3,
    es_detalle: true, activa: true, es_sistema: false, moneda: null,
    created_at: '', updated_at: '',
  } as CuentaContable
}

function especial(
  evento: string,
  estado: CuentaEspecialEstado['estado'],
  cuentaId: string | null,
): CuentaEspecialEstado {
  return {
    evento,
    etiqueta: evento === 'resultados_acumulados' ? 'Resultados acumulados' : evento,
    proceso: 'Proceso de prueba',
    bloqueante: evento === 'resultado_ejercicio',
    cuenta_id: cuentaId,
    codigo: null,
    nombre: null,
    estado,
  }
}

beforeEach(() => {
  state.cuentas = [
    cuenta('cta-res', 'PATRIMONIO.01', 'Utilidades de años anteriores'),
    cuenta('cta-otra', 'PATRIMONIO.02', 'Reserva legal'),
  ]
  state.especiales = [especial('resultados_acumulados', 'ok', 'cta-res')]
  state.guardados = []
  state.quitados = []
  state.avisos = []
})
afterEach(cleanup)

describe('AperturaSaldosModal · resultados acumulados sin código fijo', () => {
  it('ofrece el ajuste con la cuenta MAPEADA, aunque su código no sea 3101', () => {
    render(<AperturaSaldosModal companyId="c1" projectId={null} monedaBase="GTQ" onClose={() => {}} />)
    // Un saldo suelto descuadra la apertura y destapa el botón de ajuste.
    fireEvent.change(screen.getAllByPlaceholderText('0.00')[0]!, { target: { value: '100' } })
    expect(screen.getByText(/Ajustar contra Resultados acumulados/)).toBeTruthy()
    expect(screen.queryByText(/Configuración contable incompleta/)).toBeNull()
  })

  it('sin mapeo avisa "Configuración contable incompleta" y no ofrece el ajuste', () => {
    state.especiales = [especial('resultados_acumulados', 'sin_mapeo', null)]
    render(<AperturaSaldosModal companyId="c1" projectId={null} monedaBase="GTQ" onClose={() => {}} />)
    expect(screen.getByText(/Configuración contable incompleta/)).toBeTruthy()
    fireEvent.change(screen.getAllByPlaceholderText('0.00')[0]!, { target: { value: '100' } })
    expect(screen.queryByText(/Ajustar contra Resultados acumulados/)).toBeNull()
  })

  it('una cuenta INACTIVA o AGRUPADORA no se usa como ajuste, ni siquiera si está mapeada', () => {
    // El servidor devuelve la fila con el motivo pero SIN cuenta_id, que es lo
    // que impide caer en una cuenta contra la que no se puede asentar.
    state.especiales = [especial('resultados_acumulados', 'inactiva', null)]
    render(<AperturaSaldosModal companyId="c1" projectId={null} monedaBase="GTQ" onClose={() => {}} />)
    fireEvent.change(screen.getAllByPlaceholderText('0.00')[0]!, { target: { value: '100' } })
    expect(screen.queryByText(/Ajustar contra Resultados acumulados/)).toBeNull()
  })

  it('no bloquea la apertura: registrar sigue disponible sin el mapeo', () => {
    state.especiales = [especial('resultados_acumulados', 'sin_mapeo', null)]
    render(<AperturaSaldosModal companyId="c1" projectId={null} monedaBase="GTQ" onClose={() => {}} />)
    expect(screen.getByText('Registrar apertura').hasAttribute('disabled')).toBe(false)
  })
})

describe('MapeoCuentasTab · sección de cuentas especiales', () => {
  it('lista las cuentas especiales y marca las que faltan', () => {
    state.especiales = [
      especial('resultados_acumulados', 'ok', 'cta-res'),
      especial('resultado_ejercicio', 'sin_mapeo', null),
    ]
    render(<MapeoCuentasTab companyId="c1" projectId={null} monedaBase="GTQ" />)
    expect(screen.getByText('Cuentas especiales del sistema')).toBeTruthy()
    expect(screen.getByText(/Configuración contable incompleta/)).toBeTruthy()
    expect(screen.getByText(/falta 1 cuenta/)).toBeTruthy()
    expect(screen.getByText('Configurada')).toBeTruthy()
    expect(screen.getByText(/Sin asignar/)).toBeTruthy()
  })

  it('sólo ofrece cuentas del ledger activo, activas y de detalle', () => {
    state.cuentas = [
      cuenta('cta-res', 'PATRIMONIO.01', 'Utilidades de años anteriores'),
      { ...cuenta('cta-off', 'PATRIMONIO.09', 'Cuenta inactiva'), activa: false },
      { ...cuenta('cta-grp', 'PATRIMONIO', 'Agrupadora'), es_detalle: false },
    ]
    render(<MapeoCuentasTab companyId="c1" projectId={null} monedaBase="GTQ" />)
    const select = screen.getByLabelText('Cuenta para Resultados acumulados') as HTMLSelectElement
    const opciones = [...select.options].map((o) => o.textContent)
    expect(opciones).toContain('PATRIMONIO.01 — Utilidades de años anteriores')
    expect(opciones).not.toContain('PATRIMONIO.09 — Cuenta inactiva')
    expect(opciones).not.toContain('PATRIMONIO — Agrupadora')
  })

  it('guarda el mapeo SOBRE EL LEDGER ACTIVO, no sobre el de la empresa', async () => {
    render(<MapeoCuentasTab companyId="c1" projectId="p1" monedaBase="GTQ" />)
    fireEvent.change(screen.getByLabelText('Cuenta para Resultados acumulados'), {
      target: { value: 'cta-otra' },
    })
    await vi.waitFor(() => expect(state.guardados).toHaveLength(1))
    expect(state.guardados[0]).toEqual({
      evento: 'resultados_acumulados', cuentaId: 'cta-otra', projectId: 'p1',
    })
  })

  it('elegir «sin asignar» DESASIGNA en el ledger de la EMPRESA', async () => {
    render(<MapeoCuentasTab companyId="c1" projectId={null} monedaBase="GTQ" />)
    fireEvent.change(screen.getByLabelText('Cuenta para Resultados acumulados'), {
      target: { value: '' },
    })
    await vi.waitFor(() => expect(state.quitados).toHaveLength(1))
    expect(state.quitados[0]).toEqual({ evento: 'resultados_acumulados', projectId: null })
    // Desasignar NO es guardar: si esto se colara como upsert, el evento
    // quedaría apuntando a una cadena vacía en vez de quedarse sin cuenta.
    expect(state.guardados).toHaveLength(0)
  })

  it('y DESASIGNA en el ledger de un PROYECTO, con su project_id', async () => {
    render(<MapeoCuentasTab companyId="c1" projectId="p1" monedaBase="GTQ" />)
    fireEvent.change(screen.getByLabelText('Cuenta para Resultados acumulados'), {
      target: { value: '' },
    })
    await vi.waitFor(() => expect(state.quitados).toHaveLength(1))
    expect(state.quitados[0]).toEqual({ evento: 'resultados_acumulados', projectId: 'p1' })
    expect(state.guardados).toHaveLength(0)
  })

  it('la opción «sin asignar» existe y es la seleccionada cuando falta el mapeo', () => {
    state.especiales = [especial('resultados_acumulados', 'sin_mapeo', null)]
    render(<MapeoCuentasTab companyId="c1" projectId={null} monedaBase="GTQ" />)
    const select = screen.getByLabelText('Cuenta para Resultados acumulados') as HTMLSelectElement
    expect(select.value).toBe('')
    expect([...select.options].some((o) => o.value === '')).toBe(true)
  })

  it('elegir una cuenta sigue guardando, no borrando', async () => {
    render(<MapeoCuentasTab companyId="c1" projectId="p1" monedaBase="GTQ" />)
    fireEvent.change(screen.getByLabelText('Cuenta para Resultados acumulados'), {
      target: { value: 'cta-otra' },
    })
    await vi.waitFor(() => expect(state.guardados).toHaveLength(1))
    expect(state.quitados).toHaveLength(0)
  })

  it('no duplica un evento especial en la lista de eventos de negocio', () => {
    state.especiales = [especial('iva_por_pagar', 'ok', 'cta-res')]
    render(<MapeoCuentasTab companyId="c1" projectId={null} monedaBase="GTQ" />)
    // Un solo control para IVA por pagar: el de la sección de especiales.
    expect(screen.getAllByLabelText(/Cuenta para iva_por_pagar/)).toHaveLength(1)
    expect(screen.queryByLabelText('Cuenta para IVA por pagar')).toBeNull()
  })
})
