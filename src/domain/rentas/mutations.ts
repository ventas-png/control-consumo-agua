import { useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  ArticuloInventarioRenta, ContratoRenta, EstadoReservaRenta, PropiedadRenta, ReservaUnificada,
} from '../../types'
import { supabase } from '../../lib/supabase'
import { QueryError, runQuery } from '../queryFetch'
import { rentasKeys } from './keys'

type Tabla = 'rentas_propiedades' | 'rentas_contratos' | 'rentas_inventario'

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
    ...(incluirHuespedes ? { num_adultos: d.num_huespedes } : {}),
  }
}

export function useReservasRentaMutations(companyId?: string) {
  const qc = useQueryClient()
  const invalidar = () => {
    void qc.invalidateQueries({ queryKey: rentasKeys.reservas(companyId) })
    void qc.invalidateQueries({ queryKey: [...rentasKeys.all, 'reservas_str'] })
  }

  /** Propiedad enlazada → `reservas_str` (la misma que ve Condominios › STR); independiente → `rentas_reservas`. */
  const crear = useMutation({
    mutationFn: async (vars: { propiedad: PropiedadRenta; datos: DatosReserva }) => {
      const { propiedad: p, datos } = vars
      if (p.unidad_id && p.project_id) {
        await runQuery((signal) =>
          supabase.from('reservas_str')
            .insert({ company_id: p.company_id, project_id: p.project_id as string, unidad_id: p.unidad_id, ...aReservaStr(datos, true) })
            .select('id').abortSignal(signal).single())
        return
      }
      await runQuery((signal) =>
        supabase.from('rentas_reservas')
          .insert({ company_id: p.company_id, propiedad_id: p.id, ...datos })
          .select('id').abortSignal(signal).single())
    },
    onSuccess: invalidar,
  })

  const actualizar = useMutation({
    mutationFn: async (vars: { reserva: Pick<ReservaUnificada, 'id' | 'origen'>; datos: Partial<DatosReserva> }) => {
      const { reserva, datos } = vars
      const filas = reserva.origen === 'condominio'
        ? await runQuery<{ id: string }[]>((signal) => {
            const { num_huespedes: _sinUso, ...resto } = datos
            return supabase.from('reservas_str').update(resto).eq('id', reserva.id).select('id').abortSignal(signal)
          })
        : await runQuery<{ id: string }[]>((signal) =>
            supabase.from('rentas_reservas').update(datos).eq('id', reserva.id).select('id').abortSignal(signal))
      exigirFila(filas, 'guardar el cambio')
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
