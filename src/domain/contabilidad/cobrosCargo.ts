// ════════════════════════════════════════════════════════════════════════════
// Cobros de cargos adicionales (20261004000000)
//
// El cobro de un cargo adicional por tipo se registra en back-office con
// `conta_registrar_cobro_cargo` (ya verificado) y se contabiliza contra la CxC
// de su devengo. El estado «pagado» del cargo lo deriva el servidor de sus
// cobros; la pantalla no lo marca a mano. Anular un cobro lo rechaza con
// motivo y reversa su asiento; nada se borra.
//
// Idempotencia: la clave del cobro (`p_pago_id`) la genera la pantalla al
// abrir el formulario. Un doble clic o un reintento tras un corte de red
// devuelve el MISMO cobro, no uno nuevo.
// ════════════════════════════════════════════════════════════════════════════
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { contabilidadKeys } from './keys'

/** Resumen de cobro de UN cargo, como lo devuelve `conta_cargos_cobro_resumen`. */
export interface CobroCargoResumen {
  cargo_id: string
  /** Entró a la contabilización por tipo (tiene devengo o intento). */
  por_tipo: boolean
  devengo_estado: string | null
  devengado: number
  /** Lo aplicado por cobros con asiento vivo. */
  aplicado: number
  /** Cobros vivos todavía sin asiento (pendientes). */
  en_proceso: number
  saldo: number
  cobros: number
  /** Figura «pagado» sin ningún cobro vinculado (dato anterior a los cobros por cargo). */
  pagado_sin_cobro: boolean
}

/** Un cobro de un cargo, con su aplicación, asiento, reverso y motivo si está pendiente. */
export interface CobroDeCargo {
  pago_id: string
  fecha: string
  monto: number
  metodo: string
  referencia: string | null
  estado: string
  anulacion_motivo: string | null
  aplicado: number
  asiento_id: string | null
  asiento_numero: number | null
  asiento_estado: string | null
  reverso_id: string | null
  reverso_numero: number | null
  reverso_fecha: string | null
  codigo: string | null
  motivo: string | null
}

export interface ResultadoRegistroCobro {
  pago_id: string
  repetido: boolean
  /** contabilizada | pendiente | bloqueada */
  resultado: string
  codigo: string | null
  motivo: string | null
  asiento_id: string | null
  asiento_numero: number | null
  estado_cargo: string
}

export interface ResultadoAnulacionCobro {
  pago_id: string
  /** anulado | ya_anulado */
  resultado: string
  asiento_id: string | null
  reverso_id: string | null
  reverso_numero: number | null
  estado_cargo: string
  cobros_pendientes: number
}

/** Métodos de un cobro de back-office (los de pasarela entran por su propio flujo). */
export const METODOS_COBRO_CARGO = [
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'deposito', label: 'Depósito' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'tarjeta_credito', label: 'Tarjeta de crédito' },
  { value: 'tarjeta_debito', label: 'Tarjeta de débito' },
  { value: 'otro', label: 'Otro' },
] as const

export type MetodoCobroCargo = (typeof METODOS_COBRO_CARGO)[number]['value']

/** Texto para el usuario de un código de pendiente del servidor. */
export function etiquetaPendienteCobro(codigo: string | null): string {
  switch (codigo) {
    case 'excede_saldo': return 'Excede el saldo'
    case 'cobro_anterior_pendiente': return 'Espera un cobro anterior'
    case 'devengo_pendiente': return 'Cargo sin contabilizar'
    case 'sin_cuenta': return 'Falta la cuenta del método'
    case 'periodo_cerrado': return 'Período cerrado'
    case null: return 'Pendiente'
    default: return 'Pendiente'
  }
}

/** Cobro de cada cargo del proyecto (un mapa por id de cargo). */
export function useCargosCobroResumenQuery(companyId?: string, projectId?: string | null) {
  return useQuery({
    queryKey: contabilidadKeys.cobrosCargoResumen(companyId, projectId),
    enabled: !!companyId && !!projectId,
    queryFn: async (): Promise<Map<string, CobroCargoResumen>> => {
      const filas = await runQuery<CobroCargoResumen[]>((signal) =>
        supabase.rpc('conta_cargos_cobro_resumen', { p_project_id: projectId! }).abortSignal(signal),
      )
      return new Map((filas ?? []).map((f) => [f.cargo_id, f]))
    },
  })
}

/** Los cobros de UN cargo. */
export function useCobrosDeCargoQuery(companyId?: string, cargoId?: string | null) {
  return useQuery({
    queryKey: contabilidadKeys.cobrosDeCargo(companyId, cargoId),
    enabled: !!companyId && !!cargoId,
    queryFn: async (): Promise<CobroDeCargo[]> =>
      (await runQuery<CobroDeCargo[]>((signal) =>
        supabase.rpc('conta_cargo_cobros', { p_cargo_id: cargoId! }).abortSignal(signal),
      )) ?? [],
  })
}

function useInvalidarCobros(companyId?: string) {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: contabilidadKeys.cobrosCargoDeEmpresa(companyId) })
    void qc.invalidateQueries({ queryKey: contabilidadKeys.cargosPendientesDeEmpresa(companyId) })
    void qc.invalidateQueries({ queryKey: contabilidadKeys.estadoCuentaDeEmpresa(companyId) })
    void qc.invalidateQueries({ queryKey: [...contabilidadKeys.all, 'asientos'] })
    void qc.invalidateQueries({ queryKey: [...contabilidadKeys.all, 'balanza'] })
  }
}

export interface RegistrarCobroCargoInput {
  cargoId: string
  monto: number
  metodo: MetodoCobroCargo
  fecha: string
  referencia?: string | null
  notas?: string | null
  /** Clave de idempotencia: la misma en cada reintento del mismo formulario. */
  clave: string
}

/** Registra un cobro de cargo ya verificado. El servidor valida y contabiliza. */
export function useRegistrarCobroCargoMutation(companyId?: string) {
  const invalidar = useInvalidarCobros(companyId)
  return useMutation({
    mutationFn: async (input: RegistrarCobroCargoInput): Promise<ResultadoRegistroCobro> => {
      const filas = await runQuery<ResultadoRegistroCobro[]>((signal) =>
        supabase
          .rpc('conta_registrar_cobro_cargo', {
            p_cargo_id: input.cargoId,
            p_monto: input.monto,
            p_metodo: input.metodo,
            p_fecha: input.fecha,
            p_referencia: input.referencia ?? null,
            p_notas: input.notas ?? null,
            p_pago_id: input.clave,
          })
          .abortSignal(signal),
      )
      if (!filas || filas.length !== 1) throw new Error('El servidor no devolvió el resultado del cobro.')
      return filas[0]
    },
    onSettled: invalidar,
  })
}

/** Anula (rechaza con motivo) un cobro de cargo; su asiento se reversa. */
export function useAnularCobroCargoMutation(companyId?: string) {
  const invalidar = useInvalidarCobros(companyId)
  return useMutation({
    mutationFn: async (input: { pagoId: string; motivo: string }): Promise<ResultadoAnulacionCobro> => {
      const filas = await runQuery<ResultadoAnulacionCobro[]>((signal) =>
        supabase
          .rpc('conta_anular_cobro_cargo', { p_pago_id: input.pagoId, p_motivo: input.motivo })
          .abortSignal(signal),
      )
      if (!filas || filas.length !== 1) throw new Error('El servidor no devolvió el resultado de la anulación.')
      return filas[0]
    },
    onSettled: invalidar,
  })
}
