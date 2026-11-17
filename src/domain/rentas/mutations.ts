import { useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  ArticuloInventarioRenta, ConceptoRenta, ContratoRenta, EstadoReservaRenta, GastoRenta, ImportesRenta,
  PoliticaCancelacionRenta, PropiedadRenta, ReservaUnificada,
} from '../../types'
import { supabase } from '../../lib/supabase'
import { QueryError, runQuery } from '../queryFetch'
import { MONEDA_DEFECTO } from './finanzas'
import { rentasKeys } from './keys'

type Tabla = 'rentas_propiedades' | 'rentas_contratos' | 'rentas_inventario' | 'rentas_gastos' | 'rentas_conceptos'

// Las tres tablas de catálogo comparten forma de escritura. `creado_por`,
// `created_at` y `updated_at` los sella la base: no viajan.
type Editable<T> = Omit<T, 'id' | 'created_at' | 'updated_at' | 'creado_por'>

/**
 * Un UPDATE o DELETE que la RLS no deja pasar NO da error: afecta 0 filas.
 * Se pide la fila de vuelta para distinguirlo de un guardado real.
 */
function exigirFila(filas: { id: string }[] | null, accion: string): void {
  if (!filas || filas.length === 0) {
    throw new QueryError(`No se pudo ${accion}: el registro ya no existe o no tienes permiso.`)
  }
}

function useGuardar<T extends { id: string }>(tabla: Tabla, claves: (c?: string) => readonly unknown[][], companyId?: string) {
  const qc = useQueryClient()
  const invalidar = () => { for (const k of claves(companyId)) void qc.invalidateQueries({ queryKey: k }) }
  const crear = useMutation({
    mutationFn: async (payload: Editable<T>) => {
      const fila = await runQuery<{ id: string }>((signal) =>
        supabase.from(tabla as 'rentas_propiedades').insert(payload as never).select('id').abortSignal(signal).single())
      if (!fila) throw new QueryError('No se pudo guardar')
      return fila.id
    },
    onSuccess: invalidar,
  })
  const actualizar = useMutation({
    mutationFn: async (vars: { id: string; patch: Partial<Editable<T>> }) => {
      const filas = await runQuery<{ id: string }[]>((signal) =>
        supabase.from(tabla as 'rentas_propiedades').update(vars.patch as never).eq('id', vars.id).select('id').abortSignal(signal))
      exigirFila(filas, 'guardar el cambio')
    },
    onSuccess: invalidar,
  })
  const eliminar = useMutation({
    mutationFn: async (id: string) => {
      const filas = await runQuery<{ id: string }[]>((signal) =>
        supabase.from(tabla as 'rentas_propiedades').delete().eq('id', id).select('id').abortSignal(signal))
      exigirFila(filas, 'eliminar')
    },
    onSuccess: invalidar,
  })
  return { crear, actualizar, eliminar }
}

/** Borrar una propiedad arrastra sus reservas, contratos e inventario: se refresca todo. */
export function usePropiedadesRentaMutations(companyId?: string) {
  return useGuardar<PropiedadRenta>('rentas_propiedades', () => [rentasKeys.all as unknown as unknown[]], companyId)
}
export function useContratosRentaMutations(companyId?: string) {
  return useGuardar<ContratoRenta>('rentas_contratos', c => [rentasKeys.contratos(c) as unknown as unknown[]], companyId)
}
export function useInventarioRentaMutations(companyId?: string) {
  return useGuardar<ArticuloInventarioRenta>('rentas_inventario', c => [rentasKeys.inventario(c) as unknown as unknown[]], companyId)
}

export function useGastosRentaMutations(companyId?: string) {
  return useGuardar<GastoRenta>('rentas_gastos', c => [rentasKeys.gastos(c) as unknown as unknown[]], companyId)
}
/** Conceptos del desglose: se crean y se editan; no se eliminan (se desactivan). */
export function useConceptosRentaMutations(companyId?: string) {
  const { crear, actualizar } = useGuardar<ConceptoRenta>('rentas_conceptos', c => [rentasKeys.conceptos(c) as unknown as unknown[]], companyId)
  return { crear, actualizar }
}

// ── Reservas: dos tablas detrás de una sola pantalla ─────────────────────────

/** Lo que el formulario de reserva captura, sea cual sea la tabla de destino. */
export interface DatosReserva {
  huesped_nombre: string
  huesped_email: string | null
  huesped_telefono: string | null
  fecha_entrada: string
  fecha_salida: string
  num_huespedes: number
  plataforma: ReservaUnificada['plataforma']
  codigo_confirmacion: string | null
  monto_noche: number | null
  monto_total: number | null
  estado: EstadoReservaRenta
  notas: string | null
  politica_cancelacion: PoliticaCancelacionRenta | null
  num_mascotas: number
}

/**
 * Columnas de `reservas_str` para una reserva escrita desde Rentas. La cuenta
 * de huéspedes va a `num_adultos` sólo al CREAR: al editar no se toca, porque
 * en Condominios se desglosa en adultos / niños / bebés y pisarla lo perdería.
 */
function aReservaStr(d: DatosReserva, incluirHuespedes: boolean) {
  return {
    huesped_nombre: d.huesped_nombre, huesped_email: d.huesped_email, huesped_telefono: d.huesped_telefono,
    fecha_entrada: d.fecha_entrada, fecha_salida: d.fecha_salida,
    plataforma: d.plataforma, codigo_confirmacion: d.codigo_confirmacion,
    monto_noche: d.monto_noche, monto_total: d.monto_total, estado: d.estado, notas: d.notas,
    politica_cancelacion: d.politica_cancelacion, mascotas: d.num_mascotas > 0,
    ...(incluirHuespedes ? { num_adultos: d.num_huespedes } : {}),
  }
}

/** A qué fila de qué tabla apunta una reserva de Rentas. */
export type RefReserva = Pick<ReservaUnificada, 'id' | 'origen'>

/** Propiedad enlazada → `reservas_str` (la misma que ve Condominios › STR); independiente → `rentas_reservas`. */
export async function insertarReserva(p: PropiedadRenta, datos: DatosReserva): Promise<RefReserva> {
  if (p.unidad_id && p.project_id) {
    const fila = await runQuery<{ id: string }>((signal) =>
      supabase.from('reservas_str')
        .insert({ company_id: p.company_id, project_id: p.project_id as string, unidad_id: p.unidad_id, ...aReservaStr(datos, true) })
        .select('id').abortSignal(signal).single())
    if (!fila) throw new QueryError('No se pudo guardar la reserva')
    return { id: fila.id, origen: 'condominio' }
  }
  const fila = await runQuery<{ id: string }>((signal) =>
    supabase.from('rentas_reservas')
      .insert({ company_id: p.company_id, propiedad_id: p.id, ...datos })
      .select('id').abortSignal(signal).single())
  if (!fila) throw new QueryError('No se pudo guardar la reserva')
  return { id: fila.id, origen: 'rentas' }
}

export async function actualizarReserva(reserva: RefReserva, datos: Partial<DatosReserva>): Promise<void> {
  const filas = reserva.origen === 'condominio'
    ? await runQuery<{ id: string }[]>((signal) => {
        // La cuenta de huéspedes y las mascotas se llevan en Condominios (adultos / niños / bebés).
        const { num_huespedes: _h, num_mascotas: _m, ...resto } = datos
        return supabase.from('reservas_str').update(resto).eq('id', reserva.id).select('id').abortSignal(signal)
      })
    : await runQuery<{ id: string }[]>((signal) =>
        supabase.from('rentas_reservas').update(datos).eq('id', reserva.id).select('id').abortSignal(signal))
  exigirFila(filas, 'guardar el cambio')
}

/** Guarda (crea o reemplaza) la ficha de una reserva: su moneda y su desglose de cobro. */
export async function guardarLiquidacion(
  p: Pick<PropiedadRenta, 'id' | 'company_id'>, reserva: RefReserva, importes: ImportesRenta, moneda: string = MONEDA_DEFECTO,
): Promise<void> {
  const columna = reserva.origen === 'condominio' ? 'reserva_str_id' : 'reserva_id'
  const filas = await runQuery<{ id: string }[]>((signal) =>
    supabase.from('rentas_liquidaciones')
      .upsert({ company_id: p.company_id, propiedad_id: p.id, [columna]: reserva.id, importes, moneda }, { onConflict: columna })
      .select('id').abortSignal(signal))
  exigirFila(filas, 'guardar el desglose')
}

export function useReservasRentaMutations(companyId?: string) {
  const qc = useQueryClient()
  const invalidar = () => {
    void qc.invalidateQueries({ queryKey: rentasKeys.reservas(companyId) })
    void qc.invalidateQueries({ queryKey: [...rentasKeys.all, 'reservas_str'] })
    void qc.invalidateQueries({ queryKey: rentasKeys.liquidaciones(companyId) })
  }

  /**
   * `importes` (opcional) es el desglose de cobro y `moneda` la de la reserva:
   * van a su ficha, que se guarda después de la reserva. Al crear, la ficha
   * sólo se escribe si hay desglose o la moneda no es la de por defecto; al
   * editar, `importes: undefined` no la toca.
   */
  const crear = useMutation({
    mutationFn: async (vars: { propiedad: PropiedadRenta; datos: DatosReserva; importes?: ImportesRenta; moneda?: string }) => {
      const ref = await insertarReserva(vars.propiedad, vars.datos)
      const moneda = vars.moneda ?? MONEDA_DEFECTO
      if ((vars.importes && Object.keys(vars.importes).length > 0) || moneda !== MONEDA_DEFECTO) {
        await guardarLiquidacion(vars.propiedad, ref, vars.importes ?? {}, moneda)
      }
      return ref
    },
    onSuccess: invalidar,
  })

  const actualizar = useMutation({
    mutationFn: async (vars: {
      reserva: RefReserva; datos: Partial<DatosReserva>
      propiedad?: Pick<PropiedadRenta, 'id' | 'company_id'>; importes?: ImportesRenta; moneda?: string
    }) => {
      await actualizarReserva(vars.reserva, vars.datos)
      if (vars.importes && vars.propiedad) await guardarLiquidacion(vars.propiedad, vars.reserva, vars.importes, vars.moneda)
    },
    onSuccess: invalidar,
  })

  /** Sólo las de `rentas_reservas`: una reserva de condominio se cancela, o se elimina desde su pestaña STR. */
  const eliminar = useMutation({
    mutationFn: async (id: string) => {
      const filas = await runQuery<{ id: string }[]>((signal) =>
        supabase.from('rentas_reservas').delete().eq('id', id).select('id').abortSignal(signal))
      exigirFila(filas, 'eliminar')
    },
    onSuccess: invalidar,
  })

  return { crear, actualizar, eliminar }
}
