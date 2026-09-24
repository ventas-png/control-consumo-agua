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
import type {
  AsientoContable,
  CuentaContable,
  RevaluacionFxFila,
  ReglaProveedor,
  DestinoImputacion,
  RespuestaReproceso,
  ConfigTipoCargoInput,
  OrigenCargo,
  RespuestaReprocesoCargo,
} from '../../types/contabilidad'
import type { AsientoFormInput, CuentaFormInput, TipoCambioFormInput } from './schemas'
import type { CuentaExistenteRef, CuentaImportFila, CuentaOmitida } from './importCuentas'

// ── Catálogo de cuentas ─────────────────────────────────────────────────────

export type PlantillaCatalogo = 'basico' | 'latam'

/**
 * Inicializa un ledger VACÍO con una plantilla elegida por el usuario.
 *
 * La RPC resuelve la empresa desde la sesión, valida que el proyecto pertenezca
 * a ella y serializa dos clics concurrentes. No recibe companyId: éste sólo se
 * usa aquí para invalidar las consultas correctas del cliente.
 */
export function useInicializarCatalogoMutation(companyId?: string, projectId?: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (plantilla: PlantillaCatalogo) => {
      if (!companyId) throw new Error('Falta companyId.')
      return await runQuery<Array<{ cuentas_creadas: number; mapeos_creados: number }>>((signal) =>
        supabase
          .rpc('conta_inicializar_catalogo', {
            p_plantilla: plantilla,
            p_project_id: projectId ?? null,
          })
          .abortSignal(signal),
      )
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contabilidadKeys.cuentas(companyId, projectId) })
      void qc.invalidateQueries({ queryKey: contabilidadKeys.mapeo(companyId, projectId) })
      void qc.invalidateQueries({ queryKey: contabilidadKeys.cuentasEspeciales(companyId, projectId) })
    },
  })
}

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

// ── Borrado de cuentas ──────────────────────────────────────────────────────

/** Fila de `conta_cuentas_en_uso`: quién referencia a la cuenta. */
export interface CuentaEnUso {
  cuenta_id: string
  /** Tabla que la referencia (nombre crudo; la UI lo traduce). */
  referencia: string
  usos: number
}

/**
 * Pregunta al servidor qué cuentas están referenciadas ANTES de borrar.
 *
 * Sin esto, el borrado de una selección es todo-o-nada: una sola cuenta con
 * movimientos aborta la transacción y no se borra ninguna, con un error de FK
 * ilegible. Con esto la UI borra las que sí puede y explica las que no.
 */
export async function fetchCuentasEnUso(ids: string[]): Promise<CuentaEnUso[]> {
  if (ids.length === 0) return []
  return (
    (await runQuery<CuentaEnUso[]>((signal) =>
      supabase.rpc('conta_cuentas_en_uso', { p_ids: ids }).abortSignal(signal),
    )) ?? []
  )
}

/**
 * Borra cuentas del catálogo del ledger. El caller ya filtró las referenciadas
 * (`fetchCuentasEnUso`); la BD sigue siendo la autoridad — FK RESTRICT para las
 * referencias y el trigger conta_cuenta_proteger_borrado para las del seed.
 */
export function useEliminarCuentasMutation(companyId?: string, projectId?: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (!companyId) throw new Error('Falta companyId.')
      if (ids.length === 0) return 0
      await runQuery((signal) =>
        supabase
          .from('conta_cuentas')
          .delete()
          .in('id', ids)
          .eq('company_id', companyId)
          .abortSignal(signal),
      )
      return ids.length
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
      // Sin prefijo de ledger: el mapeo de CUALQUIER ledger de esta empresa
      // puede haber cambiado, y la sección de cuentas especiales se pinta desde
      // una RPC distinta que también hay que refrescar.
      void qc.invalidateQueries({ queryKey: contabilidadKeys.mapeoDeEmpresa(companyId) })
      void qc.invalidateQueries({ queryKey: contabilidadKeys.cuentasEspecialesDeEmpresa(companyId) })
    },
  })
}

/**
 * Desasignar un evento: BORRA la fila de mapeo del ledger activo.
 *
 * Es una mutación aparte y no un `cuentaId: ''` en la de arriba a propósito:
 * esto DESTRUYE configuración, y un borrado disparado por una cadena vacía es
 * exactamente la clase de intención implícita que termina en un `delete()` sin
 * filtro. Aquí el borrado se pide por su nombre.
 *
 * El filtro del ledger es la parte delicada. `project_id` es NULLABLE, y en
 * PostgREST `.eq('project_id', null)` NO es `IS NULL`: hay que usar `.is()`.
 * Confundirlos haría que desasignar en la empresa borrase —o no borrase— el
 * mapeo de un proyecto. Por eso la rama se elige explícitamente y el `delete`
 * lleva SIEMPRE las tres condiciones (empresa + ledger exacto + evento).
 */
export function useQuitarMapeoMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { evento: string; projectId?: string | null }) => {
      if (!companyId) throw new Error('Falta companyId.')
      let q = supabase
        .from('conta_mapeo_cuentas')
        .delete()
        .eq('company_id', companyId)
        .eq('evento', vars.evento)
      // NULL = ledger de la EMPRESA; con valor = el de ESE proyecto. Nunca los
      // dos: un `project_id` nulo no puede alcanzar la fila de un proyecto, ni
      // el de un proyecto la de la empresa.
      q = vars.projectId ? q.eq('project_id', vars.projectId) : q.is('project_id', null)
      await runQuery((signal) => q.abortSignal(signal))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contabilidadKeys.mapeoDeEmpresa(companyId) })
      void qc.invalidateQueries({ queryKey: contabilidadKeys.cuentasEspecialesDeEmpresa(companyId) })
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

// ── Reglas de imputación ────────────────────────────────────────────────────
//
// Se escriben DIRECTO vía RLS, como cuentas y mapeos: sólo company_owner/admin
// de la empresa activa. Las validaciones duras —cuenta del mismo ledger, de
// detalle, activa, proveedor de la empresa, unidad del proyecto— viven en
// triggers de BD, no acá: el cliente no es el lugar donde se defiende la
// integridad.
//
// La invalidación usa los prefijos SIN ledger a propósito. Guardar una regla
// del ledger de un proyecto también cambia lo que la pantalla de la empresa
// debe mostrar como «configuración incompleta», y una key completa sólo
// invalidaría ese ledger.

export interface ReglaProveedorInput {
  proveedor_id: string
  destino: DestinoImputacion
  cuenta_id: string
  activa?: boolean
  notas?: string | null
}

export function useGuardarReglaProveedorMutation(companyId?: string, projectId?: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: ReglaProveedorInput & { id?: string }) => {
      if (!companyId) throw new Error('Falta companyId.')
      const { id, ...campos } = input
      const fila = { ...campos, company_id: companyId, project_id: projectId ?? null }
      const rows = id
        ? await runQuery<ReglaProveedor[]>((signal) =>
            supabase.from('conta_reglas_proveedor').update(fila).eq('id', id).select().abortSignal(signal))
        : await runQuery<ReglaProveedor[]>((signal) =>
            supabase.from('conta_reglas_proveedor').insert(fila).select().abortSignal(signal))
      return rows?.[0] ?? null
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contabilidadKeys.reglasProveedorDeEmpresa(companyId) })
      void qc.invalidateQueries({ queryKey: [...contabilidadKeys.all, 'resolucion'] })
    },
  })
}

// Sin `projectId`: el borrado va por id y la RLS ya acota a la empresa. El
// invalidado usa el prefijo de empresa, que cubre los dos ledgers.
export function useEliminarReglaProveedorMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await runQuery((signal) =>
        supabase.from('conta_reglas_proveedor').delete().eq('id', id).abortSignal(signal))
      return id
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contabilidadKeys.reglasProveedorDeEmpresa(companyId) })
      void qc.invalidateQueries({ queryKey: [...contabilidadKeys.all, 'resolucion'] })
    },
  })
}


// ── Reproceso de una factura pendiente ──────────────────────────────────────

/**
 * Reprocesa la contabilización de UNA factura.
 *
 * Sólo viaja el id: empresa, proyecto, estado y permisos los resuelve y valida
 * el servidor, que además bloquea la fila para que dos clics (o dos pestañas)
 * no generen dos asientos. Un rechazo por configuración NO es un error: vuelve
 * como `resultado: 'pendiente'` con su motivo, y la UI lo muestra como tal.
 */
export function useReprocesarFacturaMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (facturaId: string): Promise<RespuestaReproceso> => {
      const filas = await runQuery<RespuestaReproceso[]>((signal) =>
        supabase
          .rpc('conta_reprocesar_factura_proveedor', { p_factura_id: facturaId })
          .abortSignal(signal),
      )
      const fila = filas?.[0]
      if (!fila) throw new Error('El servidor no devolvió resultado del reproceso.')
      return fila
    },
    onSettled: (_data, _err, facturaId) => {
      void qc.invalidateQueries({ queryKey: contabilidadKeys.pendientesDeEmpresa(companyId) })
      void qc.invalidateQueries({ queryKey: contabilidadKeys.intentos(facturaId) })
      // Un asiento nuevo cambia pólizas y saldos de todos los reportes.
      void qc.invalidateQueries({ queryKey: [...contabilidadKeys.all, 'asientos'] })
      void qc.invalidateQueries({ queryKey: [...contabilidadKeys.all, 'balanza'] })
    },
  })
}

/**
 * Reprocesa UN cargo (cuota clasificada o cargo adicional). El servidor
 * devuelve una fila por evento del documento (emisión y, si la hubo, mora).
 */
export function useReprocesarCargoMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (doc: { origen_tabla: OrigenCargo; origen_id: string }): Promise<RespuestaReprocesoCargo[]> => {
      const filas = await runQuery<RespuestaReprocesoCargo[]>((signal) =>
        supabase
          .rpc('conta_reprocesar_cargo', { p_origen_tabla: doc.origen_tabla, p_origen_id: doc.origen_id })
          .abortSignal(signal),
      )
      if (!filas || filas.length === 0) throw new Error('El servidor no devolvió resultado del reproceso.')
      return filas
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: contabilidadKeys.cargosPendientesDeEmpresa(companyId) })
      // Un asiento nuevo cambia pólizas y saldos de todos los reportes.
      void qc.invalidateQueries({ queryKey: [...contabilidadKeys.all, 'asientos'] })
      void qc.invalidateQueries({ queryKey: [...contabilidadKeys.all, 'balanza'] })
    },
  })
}

// ── Configuración por tipo de cargo ─────────────────────────────────────────

/**
 * Error de una escritura que no afectó exactamente una fila. PostgREST no
 * devuelve error cuando la RLS filtra un UPDATE o DELETE: devuelve «éxito» con
 * cero filas. Sin esta comprobación la pantalla diría «guardado» y no habría
 * cambiado nada.
 */
export class SinFilasAfectadasError extends Error {
  constructor(message = 'No se guardó el cambio: no tienes permiso o el registro ya no existe. Recarga e inténtalo de nuevo.') {
    super(message)
    this.name = 'SinFilasAfectadasError'
  }
}

/** Exige que una escritura con `.select('id')` haya afectado exactamente una fila. */
export function exigirUnaFila(filas: { id: string }[] | null): void {
  if (!filas || filas.length !== 1) throw new SinFilasAfectadasError()
}

/**
 * Guarda la configuración de UN tipo de cargo en el ledger activo.
 *
 * Todo lo que la hace válida —cuenta activa, de detalle, del mismo ledger, del
 * tipo contable correcto, impuesto sólo donde hay tratamiento— lo decide el
 * trigger `conta_tg_config_tipo_cargo`. Si lo rechaza, el error sube tal cual
 * para que la pantalla diga qué arreglar.
 */
export function useGuardarConfigTipoCargoMutation(companyId?: string, projectId?: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: ConfigTipoCargoInput & { id?: string | null }) => {
      if (!companyId) throw new Error('Falta companyId.')
      const { id, ...campos } = input
      if (id) {
        // El tipo y el ledger no cambian en una edición (lo exige el trigger):
        // sólo viajan las cuentas y el estado.
        const { tipo_cargo: _tipo, ...editables } = campos
        exigirUnaFila(await runQuery((signal) =>
          supabase.from('conta_config_tipo_cargo').update(editables).eq('id', id).select('id').abortSignal(signal)))
      } else {
        exigirUnaFila(await runQuery((signal) =>
          supabase
            .from('conta_config_tipo_cargo')
            .insert({ ...campos, company_id: companyId, project_id: projectId ?? null })
            .select('id')
            .abortSignal(signal)))
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contabilidadKeys.configTiposCargoDeEmpresa(companyId) })
    },
  })
}

export function useEliminarConfigTipoCargoMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      exigirUnaFila(await runQuery((signal) =>
        supabase.from('conta_config_tipo_cargo').delete().eq('id', id).select('id').abortSignal(signal)))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contabilidadKeys.configTiposCargoDeEmpresa(companyId) })
    },
  })
}

// ── Nomenclatura de auxiliares ──────────────────────────────────────────────

/**
 * Asigna o cambia el código de auxiliar de un cliente en la empresa.
 *
 * Sin código, el servidor propone el siguiente `AUX-NNNNN`. El código es sólo
 * nomenclatura: los movimientos se enlazan por `cliente_id`, así que
 * renombrarlo no toca ningún asiento.
 */
export function useGuardarAuxiliarMutation(companyId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { auxiliar_id: string | null; cliente_id: string; codigo: string | null }) => {
      if (!companyId) throw new Error('Falta companyId.')
      const codigo = input.codigo?.trim() || null
      if (input.auxiliar_id) {
        if (!codigo) throw new Error('El código no puede quedar vacío.')
        exigirUnaFila(await runQuery((signal) =>
          supabase.from('conta_auxiliares').update({ codigo }).eq('id', input.auxiliar_id!).select('id').abortSignal(signal)))
      } else {
        exigirUnaFila(await runQuery((signal) =>
          supabase
            .from('conta_auxiliares')
            // `codigo` vacío → el trigger asigna el siguiente AUX-NNNNN.
            .insert({ company_id: companyId, cliente_id: input.cliente_id, codigo: codigo ?? '' })
            .select('id')
            .abortSignal(signal)))
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contabilidadKeys.auxiliaresDeEmpresa(companyId) })
    },
  })
}
