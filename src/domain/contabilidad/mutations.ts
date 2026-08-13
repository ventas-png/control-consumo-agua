// Contabilidad — Hooks de ESCRITURA.
//
// Reglas del módulo:
//   - Cuentas, borradores de póliza, mapeos y tipos de cambio se escriben
//     DIRECTO vía RLS (solo company_owner/admin).
//   - PUBLICAR y ANULAR pasan SIEMPRE por RPC (conta_publicar_asiento /
//     conta_anular_asiento): el servidor valida debe=haber, cuentas de detalle
//     y periodo cerrado, y asigna el folio. Un asiento publicado es inmutable
//     (trigger de BD); la anulación genera un asiento de reverso.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { contabilidadKeys } from './keys'
import { planificarCatalogo } from './importCuentas'
import type { AsientoContable, CuentaContable, RevaluacionFxFila } from '../../types/contabilidad'
import type { AsientoFormInput, CuentaFormInput, TipoCambioFormInput } from './schemas'
import type { CuentaExistenteRef, CuentaImportFila, CuentaOmitida } from './importCuentas'

// ── Catálogo de cuentas ─────────────────────────────────────────────────────

export function useCrearCuentaMutation(companyId?: string, projectId?: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CuentaFormInput) => {
      if (!companyId) throw new Error('Falta companyId.')
      const rows = await runQuery<CuentaContable[]>((signal) =>
        supabase
          .from('conta_cuentas')
          .insert({ ...input, company_id: companyId, project_id: projectId ?? null })
          .select()
          .abortSignal(signal),
      )
      return rows?.[0] ?? null
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contabilidadKeys.cuentas(companyId, projectId) })
    },
  })
}

export function useActualizarCuentaMutation(companyId?: string, projectId?: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { id: string; patch: Partial<CuentaFormInput> & { activa?: boolean } }) => {
      const rows = await runQuery<CuentaContable[]>((signal) =>
        supabase
          .from('conta_cuentas')
          .update({ ...vars.patch, updated_at: new Date().toISOString() })
          .eq('id', vars.id)
          .select()
          .abortSignal(signal),
      )
      return rows?.[0] ?? null
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contabilidadKeys.cuentas(companyId, projectId) })
    },
  })
}

// ── Carga masiva del catálogo ───────────────────────────────────────────────

export interface ImportarCuentasVars {
  filas: CuentaImportFila[]
  /** Ledgers destino: null = contabilidad de la empresa; uuid = la del proyecto. */
  ledgers: (string | null)[]
  /** true = las cuentas cuyo código ya existe se actualizan en vez de omitirse. */
  actualizarExistentes: boolean
}

export interface ImportarCuentasResumenLedger {
  ledger: string | null
  creadas: number
  actualizadas: number
  omitidas: CuentaOmitida[]
  /** Presente si ESE ledger falló; los demás siguieron su curso. */
  error?: string
}

export interface ImportarCuentasResultado {
  porLedger: ImportarCuentasResumenLedger[]
  creadas: number
  actualizadas: number
}

/** Tamaño de lote de red (un catálogo completo son ~60 cuentas; 200 sobra). */
const LOTE_INSERT = 200

function trocear<T>(items: T[], tamano: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += tamano) out.push(items.slice(i, i + tamano))
  return out
}

/**
 * Aplica el archivo a UN ledger: lee su catálogo, arma el plan y escribe.
 * La escritura NO es transaccional (PostgREST no expone transacciones), así que
 * el resumen reporta lo que sí quedó grabado aunque después falle algo.
 */
async function cargarCatalogoEnLedger(
  companyId: string,
  ledger: string | null,
  filas: CuentaImportFila[],
  actualizarExistentes: boolean,
): Promise<ImportarCuentasResumenLedger> {
  let creadas = 0
  let actualizadas = 0
  const omitidas: CuentaOmitida[] = []

  try {
    // 1. Catálogo actual del ledger (el código es único POR LEDGER).
    let q = supabase.from('conta_cuentas').select('id,codigo,nivel,tipo,naturaleza').eq('company_id', companyId)
    q = ledger ? q.eq('project_id', ledger) : q.is('project_id', null)
    const existentes = (await runQuery<CuentaExistenteRef[]>((signal) => q.abortSignal(signal))) ?? []

    // 2. Plan (puro): padre por código → nivel, duplicados, ciclos, ya existentes.
    const plan = planificarCatalogo(filas, existentes, { actualizarExistentes })
    omitidas.push(...plan.omitidas)
    const idPorCodigo = new Map(existentes.map((c) => [c.codigo, c.id]))

    // 3. Inserción por NIVELES ascendentes: el padre existe antes que el hijo.
    const niveles = [...new Set(plan.crear.map((c) => c.nivel))].sort((a, b) => a - b)
    for (const nivel of niveles) {
      const payload: Array<Record<string, unknown>> = []
      for (const item of plan.crear.filter((c) => c.nivel === nivel)) {
        const padreId = item.padre_codigo ? idPorCodigo.get(item.padre_codigo) ?? null : null
        if (item.padre_codigo && !padreId) {
          omitidas.push({
            codigo: item.cuenta.codigo,
            motivo: `no se creó su cuenta padre "${item.padre_codigo}"`,
          })
          continue
        }
        payload.push({
          company_id: companyId,
          project_id: ledger,
          codigo: item.cuenta.codigo,
          nombre: item.cuenta.nombre,
          tipo: item.cuenta.tipo,
          naturaleza: item.cuenta.naturaleza,
          padre_id: padreId,
          nivel: item.nivel,
          es_detalle: item.cuenta.es_detalle,
          moneda: item.cuenta.moneda,
          descripcion: item.cuenta.descripcion,
        })
      }
      for (const lote of trocear(payload, LOTE_INSERT)) {
        const rows = await runQuery<Array<Pick<CuentaContable, 'id' | 'codigo'>>>((signal) =>
          supabase.from('conta_cuentas').insert(lote).select('id,codigo').abortSignal(signal),
        )
        for (const r of rows ?? []) idPorCodigo.set(r.codigo, r.id)
        creadas += rows?.length ?? 0
      }
    }

    // 4. Actualizaciones. No tocan padre_id ni nivel: mover una cuenta con
    //    movimientos de rama descuadraría los saldos históricos de su padre.
    for (const lote of trocear(plan.actualizar, 20)) {
      await Promise.all(
        lote.map((item) =>
          runQuery((signal) =>
            supabase
              .from('conta_cuentas')
              .update({
                nombre: item.cuenta.nombre,
                tipo: item.cuenta.tipo,
                naturaleza: item.cuenta.naturaleza,
                es_detalle: item.cuenta.es_detalle,
                moneda: item.cuenta.moneda,
                descripcion: item.cuenta.descripcion,
                updated_at: new Date().toISOString(),
              })
              .eq('id', item.id)
              .abortSignal(signal),
          ),
        ),
      )
      actualizadas += lote.length
    }

    return { ledger, creadas, actualizadas, omitidas }
  } catch (e) {
    return {
      ledger,
      creadas,
      actualizadas,
      omitidas,
      error: e instanceof Error ? e.message : 'No se pudo cargar el catálogo.',
    }
  }
}

/**
 * Carga masiva del catálogo en UNO O VARIOS ledgers (la empresa y/o cada
 * proyecto). Por cada ledger:
 *   1. lee su catálogo actual (el código es único POR LEDGER),
 *   2. arma el plan con `planificarCatalogo` (padre por código → uuid, nivel,
 *      duplicados, ciclos),
 *   3. inserta por NIVELES ascendentes para que el padre exista antes que el
 *      hijo, encadenando los ids recién creados.
 *
 * Cada ledger es independiente: un archivo que ya se aplicó a la empresa se
 * puede aplicar a un proyecto y allí las mismas cuentas se crean de nuevo. Si
 * uno falla (red, RLS, un CHECK), los demás se cargan igual y el fallo viaja en
 * su resumen; solo se lanza cuando fallaron TODOS.
 */
export function useImportarCuentasMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: ImportarCuentasVars): Promise<ImportarCuentasResultado> => {
      if (!companyId) throw new Error('Falta companyId.')
      if (vars.ledgers.length === 0) throw new Error('Elige al menos una contabilidad destino.')

      const porLedger: ImportarCuentasResumenLedger[] = []

      for (const ledger of vars.ledgers) {
        porLedger.push(
          await cargarCatalogoEnLedger(companyId, ledger, vars.filas, vars.actualizarExistentes),
        )
      }

      if (porLedger.every((l) => l.error)) {
        throw new Error(porLedger[0].error)
      }

      return {
        porLedger,
        creadas: porLedger.reduce((s, l) => s + l.creadas, 0),
        actualizadas: porLedger.reduce((s, l) => s + l.actualizadas, 0),
      }
    },
    onSuccess: (_data, vars) => {
      for (const ledger of vars.ledgers) {
        void qc.invalidateQueries({ queryKey: contabilidadKeys.cuentas(companyId, ledger) })
      }
    },
  })
}

// ── Pólizas ─────────────────────────────────────────────────────────────────

/** Inserta cabecera + líneas como BORRADOR (la publicación es otra acción). */
export function useCrearAsientoBorradorMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: AsientoFormInput & { moneda_base: string }) => {
      if (!companyId) throw new Error('Falta companyId.')
      const cab = await runQuery<AsientoContable[]>((signal) =>
        supabase
          .from('conta_asientos')
          .insert({
            company_id: companyId,
            project_id: input.project_id,
            fecha: input.fecha,
            tipo: input.tipo,
            concepto: input.concepto,
            estado: 'borrador',
            origen: 'manual',
            moneda_base: input.moneda_base,
          })
          .select()
          .abortSignal(signal),
      )
      const asiento = cab?.[0]
      if (!asiento) throw new Error('No se pudo crear la póliza.')
      await runQuery((signal) =>
        supabase
          .from('conta_asiento_lineas')
          .insert(
            input.lineas.map((l, i) => ({
              asiento_id: asiento.id,
              company_id: companyId,
              cuenta_id: l.cuenta_id,
              orden: i + 1,
              descripcion: l.descripcion || null,
              debe: l.debe,
              haber: l.haber,
              moneda_origen: l.moneda_origen ?? null,
              monto_origen: l.monto_origen ?? null,
              tipo_cambio: l.tipo_cambio ?? null,
            })),
          )
          .abortSignal(signal),
      )
      return asiento
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contabilidadKeys.all })
    },
  })
}

/** Publica un borrador vía RPC (valida y asigna folio en servidor). */
export function usePublicarAsientoMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (asientoId: string) =>
      await runQuery<AsientoContable>((signal) =>
        supabase.rpc('conta_publicar_asiento', { p_asiento_id: asientoId }).abortSignal(signal),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contabilidadKeys.all })
    },
  })
}

/** Anula: borrador→anulado; publicado→asiento de reverso (vía RPC). */
export function useAnularAsientoMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { asientoId: string; motivo?: string }) =>
      await runQuery<AsientoContable>((signal) =>
        supabase
          .rpc('conta_anular_asiento', {
            p_asiento_id: vars.asientoId,
            p_motivo: vars.motivo ?? null,
          })
          .abortSignal(signal),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contabilidadKeys.all })
    },
  })
}

// ── Mapeo evento → cuenta ───────────────────────────────────────────────────

export function useGuardarMapeoMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { evento: string; cuentaId: string; projectId?: string | null }) => {
      if (!companyId) throw new Error('Falta companyId.')
      // upsert manual: el UNIQUE de BD usa COALESCE(project_id, uuid-cero), que
      // PostgREST no puede inferir como conflict target.
      let q = supabase
        .from('conta_mapeo_cuentas')
        .select('id')
        .eq('company_id', companyId)
        .eq('evento', vars.evento)
        .limit(1)
      q = vars.projectId ? q.eq('project_id', vars.projectId) : q.is('project_id', null)
      const existentes = await runQuery<{ id: string }[]>((signal) => q.abortSignal(signal))
      const existente = existentes?.[0]
      if (existente) {
        await runQuery((signal) =>
          supabase
            .from('conta_mapeo_cuentas')
            .update({ cuenta_id: vars.cuentaId, updated_at: new Date().toISOString() })
            .eq('id', existente.id)
            .abortSignal(signal),
        )
      } else {
        await runQuery((signal) =>
          supabase
            .from('conta_mapeo_cuentas')
            .insert({
              company_id: companyId,
              project_id: vars.projectId ?? null,
              evento: vars.evento,
              cuenta_id: vars.cuentaId,
            })
            .abortSignal(signal),
        )
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contabilidadKeys.mapeo(companyId) })
    },
  })
}

// ── Tipos de cambio ─────────────────────────────────────────────────────────

export function useGuardarTipoCambioMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: TipoCambioFormInput) => {
      if (!companyId) throw new Error('Falta companyId.')
      await runQuery((signal) =>
        supabase
          .from('conta_tipos_cambio')
          .upsert(
            { company_id: companyId, ...input },
            { onConflict: 'company_id,moneda,fecha' },
          )
          .abortSignal(signal),
      )
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contabilidadKeys.tiposCambio(companyId) })
    },
  })
}

// ── Revaluación FX ──────────────────────────────────────────────────────────

/**
 * Revaluación de saldos en moneda extranjera contra 3301 (RPC
 * conta_revaluar_fx). Con aplicar=false solo previsualiza; con aplicar=true
 * genera los asientos de ajuste (idempotente por cuenta+fecha en servidor).
 */
export function useRevaluarFxMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { fecha: string; aplicar: boolean; projectId: string | null }) =>
      await runQuery<RevaluacionFxFila[]>((signal) =>
        supabase
          .rpc('conta_revaluar_fx', {
            p_fecha: vars.fecha,
            p_aplicar: vars.aplicar,
            p_project_id: vars.projectId,
          })
          .abortSignal(signal),
      ),
    onSuccess: (_data, vars) => {
      // Solo la aplicación toca asientos/saldos; la previsualización es lectura.
      if (vars.aplicar) void qc.invalidateQueries({ queryKey: contabilidadKeys.all })
    },
  })
}
