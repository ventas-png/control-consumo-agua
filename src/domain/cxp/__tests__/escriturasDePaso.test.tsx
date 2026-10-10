// ESCRITURAS DE PASO: cada UPDATE/DELETE de las acciones de compras y pagos (a) apunta SOLO a la fila indicada y (b) escribe lo que el paso dice.
//
// Los simuladores de las demás pruebas (`pasosCeroFilas`, `mutationsFilasAfectadas`) hacen `c.eq = () => c` y solo miran `estado`: quitar o
// cambiar el `.eq('id', …)` de un UPDATE de estado, o dejar de mandar el motivo / la justificación / la fecha, dejaba esas pruebas en verde.
// Un UPDATE sin filtro cambia todas las filas que la política de la empresa deja tocar (PostgREST no lo impide si no hay `pg_safeupdate`):
// aprobar «una» factura aprobaría todas las registradas. Este simulador CAPTURA `eq`, `update` y `delete` y afirma tabla, id y parche exactos.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const h = vi.hoisted(() => ({ eqs: [] as string[], parches: [] as Array<{ tabla: string; patch: Record<string, unknown> }>, borrados: [] as string[] }))

vi.mock('../../../lib/supabase', () => {
  const cadena = (tabla: string) => {
    const c: Record<string, unknown> = {}
    c.update = (patch: Record<string, unknown>) => { h.parches.push({ tabla, patch }); return c }
    c.delete = () => { h.borrados.push(tabla); return c }
    c.eq = (col: string, val: unknown) => { h.eqs.push(`${tabla}.${col}=${String(val)}`); return c }
    c.select = () => c
    c.abortSignal = () => Promise.resolve({ data: [{ id: 'x' }], error: null })
    // los ayudantes de Operaciones esperan el builder directamente (sin abortSignal)
    c.then = (a: (v: unknown) => unknown, b?: (e: unknown) => unknown) => Promise.resolve({ data: [{ id: 'x' }], error: null }).then(a, b)
    return c
  }
  return {
    supabase: { from: (t: string) => cadena(t), auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) } },
    warmUpSupabase: vi.fn(),
  }
})

import { deleteCondominioRowAfectando, updateCondominioRowAfectando } from '../../condominios/tabMutations'
import {
  useAnularFacturaMutation, useAnularOrdenMutation, useAprobarFacturaMutation, useAprobarOrdenMutation, useMarcarOrdenPagadaMutation,
} from '../mutations'
import {
  useAnularContrasenaMutation, useAprobarFacturaConCuadreMutation, useCambiarEstadoOrdenCompraMutation, useCambiarEstadoProveedorMutation,
  useCambiarEstadoRecepcionMutation, useEliminarOrdenCompraMutation, useEnlazarGastoAFacturaMutation,
} from '../../compras/mutations'

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{children}</QueryClientProvider>
)
beforeEach(() => { h.eqs = []; h.parches = []; h.borrados = [] })

type Hook = () => { mutateAsync: (v: never) => Promise<unknown> }
interface Caso { nombre: string; hook: Hook; vars: unknown; filtro: string; patch: Record<string, unknown>; sinCampos?: string[] }

const FECHA = /^\d{4}-\d{2}-\d{2}$/
const casos: Caso[] = [
  { nombre: 'aprobar factura', hook: () => useAprobarFacturaMutation('c1') as never, vars: 'f1', filtro: 'facturas_proveedor.id=f1', patch: { estado: 'aprobada' } },
  { nombre: 'anular factura', hook: () => useAnularFacturaMutation('c1') as never, vars: 'f1', filtro: 'facturas_proveedor.id=f1', patch: { estado: 'anulada' } },
  { nombre: 'aprobar orden de pago (la aprueba quien está en sesión)', hook: () => useAprobarOrdenMutation('c1') as never, vars: 'op1', filtro: 'ordenes_pago.id=op1', patch: { estado: 'aprobada', aprobada_por: 'u1' } },
  { nombre: 'marcar pagada con la fecha elegida', hook: () => useMarcarOrdenPagadaMutation('c1') as never, vars: { ordenId: 'op1', fechaPago: '2026-10-05' }, filtro: 'ordenes_pago.id=op1', patch: { estado: 'pagada', fecha_pago: '2026-10-05' } },
  { nombre: 'marcar pagada sin fecha: hoy', hook: () => useMarcarOrdenPagadaMutation('c1') as never, vars: { ordenId: 'op1' }, filtro: 'ordenes_pago.id=op1', patch: { estado: 'pagada', fecha_pago: expect.stringMatching(FECHA) } },
  { nombre: 'anular orden de pago', hook: () => useAnularOrdenMutation('c1') as never, vars: 'op1', filtro: 'ordenes_pago.id=op1', patch: { estado: 'anulada' } },
  { nombre: 'aprobar una orden de compra', hook: () => useCambiarEstadoOrdenCompraMutation() as never, vars: { id: 'o1', estado: 'aprobada' }, filtro: 'ordenes_compra.id=o1', patch: { estado: 'aprobada' }, sinCampos: ['motivo_devolucion', 'motivo_anulacion'] },
  { nombre: 'devolver una orden a borrador: el motivo va a motivo_devolucion', hook: () => useCambiarEstadoOrdenCompraMutation() as never, vars: { id: 'o1', estado: 'borrador', motivo: 'corregir el precio' }, filtro: 'ordenes_compra.id=o1', patch: { estado: 'borrador', motivo_devolucion: 'corregir el precio' }, sinCampos: ['motivo_anulacion'] },
  { nombre: 'cancelar una orden: el motivo va a motivo_anulacion', hook: () => useCambiarEstadoOrdenCompraMutation() as never, vars: { id: 'o1', estado: 'cancelada', motivo: 'ya no se necesita' }, filtro: 'ordenes_compra.id=o1', patch: { estado: 'cancelada', motivo_anulacion: 'ya no se necesita' }, sinCampos: ['motivo_devolucion'] },
  { nombre: 'registrar una recepción', hook: () => useCambiarEstadoRecepcionMutation() as never, vars: { id: 'r1', estado: 'registrada' }, filtro: 'recepciones.id=r1', patch: { estado: 'registrada' }, sinCampos: ['motivo_anulacion'] },
  { nombre: 'anular una recepción con su motivo', hook: () => useCambiarEstadoRecepcionMutation() as never, vars: { id: 'r1', estado: 'anulada', motivo: 'remisión equivocada' }, filtro: 'recepciones.id=r1', patch: { estado: 'anulada', motivo_anulacion: 'remisión equivocada' } },
  { nombre: 'anular una contraseña de pago con su motivo', hook: () => useAnularContrasenaMutation() as never, vars: { id: 'k1', motivo: 'error de captura' }, filtro: 'contrasenas_pago.id=k1', patch: { estado: 'anulada', motivo_anulacion: 'error de captura' } },
  { nombre: 'aprobar factura con cuadre', hook: () => useAprobarFacturaConCuadreMutation() as never, vars: { facturaId: 'f1' }, filtro: 'facturas_proveedor.id=f1', patch: { estado: 'aprobada' }, sinCampos: ['match_justificacion'] },
  { nombre: 'aprobar factura FORZANDO el cuadre: la justificación viaja', hook: () => useAprobarFacturaConCuadreMutation() as never, vars: { facturaId: 'f1', justificacion: 'diferencia de flete autorizada' }, filtro: 'facturas_proveedor.id=f1', patch: { estado: 'aprobada', match_justificacion: 'diferencia de flete autorizada' } },
  { nombre: 'autorizar un proveedor', hook: () => useCambiarEstadoProveedorMutation() as never, vars: { id: 'p1', input: { estado: 'autorizado' } }, filtro: 'proveedores.id=p1', patch: { estado: 'autorizado' } },
  { nombre: 'enlazar un gasto CONTABILIZADO: se anula', hook: () => useEnlazarGastoAFacturaMutation() as never, vars: { gastoId: 'g1', facturaId: 'f1', yaContabilizado: true }, filtro: 'gastos_condominio.id=g1', patch: { factura_id: 'f1', estado: 'anulado' } },
  { nombre: 'enlazar un gasto NO contabilizado: solo se enlaza, NO se anula', hook: () => useEnlazarGastoAFacturaMutation() as never, vars: { gastoId: 'g1', facturaId: 'f1', yaContabilizado: false }, filtro: 'gastos_condominio.id=g1', patch: { factura_id: 'f1' }, sinCampos: ['estado'] },
]

describe('cada UPDATE de paso filtra por la fila indicada (y solo por ella) y escribe lo que el paso dice', () => {
  it.each(casos)('$nombre', async ({ hook, vars, filtro, patch, sinCampos }) => {
    const { result } = renderHook(hook, { wrapper })
    await result.current.mutateAsync(vars as never)
    expect(h.parches).toHaveLength(1)
    expect(h.eqs).toEqual([filtro])
    expect(h.parches[0].patch).toMatchObject(patch)
    for (const campo of sinCampos ?? []) expect(h.parches[0].patch, campo).not.toHaveProperty(campo)
  })

  it('eliminar una orden de compra: solo esa fila', async () => {
    const { result } = renderHook(() => useEliminarOrdenCompraMutation(), { wrapper })
    await result.current.mutateAsync('o1')
    expect(h.borrados).toEqual(['ordenes_compra'])
    expect(h.eqs).toEqual(['ordenes_compra.id=o1'])
  })
})

describe('los ayudantes de Operaciones (aprobar, devolver, cancelar, editar y eliminar desde la pestaña) filtran por la fila indicada', () => {
  it('updateCondominioRowAfectando', async () => {
    await updateCondominioRowAfectando('ordenes_compra', 'o1', { estado: 'aprobada' })
    expect(h.parches).toEqual([{ tabla: 'ordenes_compra', patch: { estado: 'aprobada' } }])
    expect(h.eqs).toEqual(['ordenes_compra.id=o1'])
  })
  it('deleteCondominioRowAfectando', async () => {
    await deleteCondominioRowAfectando('ordenes_compra', 'o1')
    expect(h.borrados).toEqual(['ordenes_compra'])
    expect(h.eqs).toEqual(['ordenes_compra.id=o1'])
  })
})
