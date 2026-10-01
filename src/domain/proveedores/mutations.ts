// Proveedores compartidos (PR A) — Hooks de ESCRITURA.
//
// La pantalla ESCRIBE, el servidor DECIDE: cada regla (duplicados, habilitación,
// ciclo del contrato, fotografía, alcance por proyecto) la hacen cumplir
// triggers y RPC de la base, y sus mensajes (CODIGO: texto) están escritos para
// leerse tal cual. Aquí no se replica ninguna.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { uploadMedia, removeMedia } from '../shared/storage'
import { BUCKET_CONTRATOS_RESPALDO } from '../shared/buckets'
import { comprasKeys } from '../compras/keys'
import { cxpKeys } from '../cxp/keys'
import { proveedoresKeys } from './keys'
import { rpc } from './queries'
import type {
  ContactoFormInput,
  ContratoFormInput,
  HabilitacionFormInput,
  ReglaCompraFormInput,
} from './schemas'
import type {
  EstadoContratoProveedor,
  ModoAplicacion,
  OpcionesImportacion,
  ResultadoAplicacion,
  ResultadoRevertirVinculos,
  ResultadoVincularInequivocos,
  TipoImportacion,
} from '../../types/proveedores'

/**
 * Lo que escriben estas pantallas se lee en tres dominios (catálogo compartido,
 * CxP y compras): invalidar solo uno dejaría a Contabilidad mostrando un
 * proveedor y a Operaciones otro, que es justo lo que este PR viene a evitar.
 */
function useInvalidarProveedores() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: proveedoresKeys.all })
    void qc.invalidateQueries({ queryKey: cxpKeys.all })
    void qc.invalidateQueries({ queryKey: comprasKeys.all })
  }
}

// ── Contactos ───────────────────────────────────────────────────────────────

export function useGuardarContactoMutation(companyId?: string) {
  const invalidar = useInvalidarProveedores()
  return useMutation({
    mutationFn: async (vars: { id?: string; proveedorId: string; input: ContactoFormInput }) => {
      if (!companyId) throw new Error('Falta companyId.')
      if (vars.id) {
        await runQuery((signal) =>
          supabase.from('proveedor_contactos').update(vars.input).eq('id', vars.id!).abortSignal(signal),
        )
        return
      }
      await runQuery((signal) =>
        supabase
          .from('proveedor_contactos')
          .insert({ ...vars.input, company_id: companyId, proveedor_id: vars.proveedorId })
          .abortSignal(signal),
      )
    },
    onSuccess: () => invalidar(),
  })
}

export function useEliminarContactoMutation() {
  const invalidar = useInvalidarProveedores()
  return useMutation({
    mutationFn: async (id: string) => {
      await runQuery((signal) => supabase.from('proveedor_contactos').delete().eq('id', id).abortSignal(signal))
    },
    onSuccess: () => invalidar(),
  })
}

// ── Habilitación por proyecto ───────────────────────────────────────────────

/** Vincular NO habilita: la fila nace `pendiente`. */
export function useVincularProveedorProyectoMutation(companyId?: string) {
  const invalidar = useInvalidarProveedores()
  return useMutation({
    mutationFn: async (vars: { proveedorId: string; projectId: string }) => {
      if (!companyId) throw new Error('Falta companyId.')
      await runQuery((signal) =>
        supabase
          .from('proveedor_proyectos')
          .insert({ company_id: companyId, proveedor_id: vars.proveedorId, project_id: vars.projectId })
          .abortSignal(signal),
      )
    },
    onSuccess: () => invalidar(),
  })
}

/** Habilitar, suspender o retirar exige el permiso de cambio de estado (lo comprueba el trigger). */
export function useActualizarHabilitacionMutation() {
  const invalidar = useInvalidarProveedores()
  return useMutation({
    mutationFn: async (vars: { id: string; input: HabilitacionFormInput }) => {
      await runQuery((signal) =>
        supabase.from('proveedor_proyectos').update(vars.input).eq('id', vars.id).abortSignal(signal),
      )
    },
    onSuccess: () => invalidar(),
  })
}

export function useQuitarVinculoProyectoMutation() {
  const invalidar = useInvalidarProveedores()
  return useMutation({
    mutationFn: async (id: string) => {
      await runQuery((signal) => supabase.from('proveedor_proyectos').delete().eq('id', id).abortSignal(signal))
    },
    onSuccess: () => invalidar(),
  })
}

// ── Contratos ───────────────────────────────────────────────────────────────

/**
 * Los contratos nuevos nacen en BORRADOR y con proveedor del catálogo. El
 * servidor completa `proveedor_nombre` y la fotografía: lo que se mande en esos
 * campos se ignora.
 */
export function useCrearContratoMutation(companyId?: string, projectId?: string) {
  const invalidar = useInvalidarProveedores()
  return useMutation({
    mutationFn: async (input: ContratoFormInput) => {
      if (!companyId || !projectId) throw new Error('Falta empresa o proyecto.')
      const rows = await runQuery<{ id: string }[]>((signal) =>
        supabase
          .from('contratos_proveedores')
          .insert({
            ...input,
            company_id: companyId,
            project_id: projectId,
            estado: 'borrador',
            proveedor_nombre: '(se completa desde el proveedor)',
          })
          .select('id')
          .abortSignal(signal),
      )
      return rows?.[0]?.id ?? null
    },
    onSuccess: () => invalidar(),
  })
}

/** Editar: en borrador todo; activo en adelante el servidor congela las condiciones económicas. */
export function useActualizarContratoMutation() {
  const invalidar = useInvalidarProveedores()
  return useMutation({
    mutationFn: async (vars: { id: string; cambios: Record<string, unknown> }) => {
      await runQuery((signal) =>
        supabase.from('contratos_proveedores').update(vars.cambios).eq('id', vars.id).abortSignal(signal),
      )
    },
    onSuccess: () => invalidar(),
  })
}

/** Cada cambio de estado trae SU motivo (suspender, terminar y cancelar lo exigen). */
export function useCambiarEstadoContratoMutation() {
  const invalidar = useInvalidarProveedores()
  return useMutation({
    mutationFn: async (vars: { id: string; estado: EstadoContratoProveedor; motivo: string | null }) => {
      await runQuery((signal) =>
        supabase
          .from('contratos_proveedores')
          .update({ estado: vars.estado, motivo_estado: vars.motivo })
          .eq('id', vars.id)
          .abortSignal(signal),
      )
    },
    onSuccess: () => invalidar(),
  })
}

/** Solo un borrador sin nada relacionado se borra; lo demás se termina o cancela (lo exige el servidor). */
export function useEliminarContratoBorradorMutation() {
  const invalidar = useInvalidarProveedores()
  return useMutation({
    mutationFn: async (id: string) => {
      await runQuery((signal) => supabase.from('contratos_proveedores').delete().eq('id', id).abortSignal(signal))
    },
    onSuccess: () => invalidar(),
  })
}

/**
 * Sube el respaldo al bucket PRIVADO `contratos-respaldo` bajo
 * `<empresa>/<proyecto>/<contrato>/<archivo>` (la policy autoriza desde la fila
 * del contrato) y apunta `respaldo_path` a él. Se AÑADE: no se sustituye ni se
 * borra el anterior de un contrato que ya salió de borrador.
 */
export function useSubirRespaldoContratoMutation() {
  const invalidar = useInvalidarProveedores()
  return useMutation({
    mutationFn: async (vars: { companyId: string; projectId: string; contratoId: string; archivo: File; path: string }) => {
      const { error } = await uploadMedia(BUCKET_CONTRATOS_RESPALDO, vars.path, vars.archivo, {
        contentType: vars.archivo.type || undefined,
        upsert: false,
      })
      if (error) throw new Error(error)
      try {
        await runQuery((signal) =>
          supabase.from('contratos_proveedores').update({ respaldo_path: vars.path }).eq('id', vars.contratoId).abortSignal(signal),
        )
      } catch (e) {
        // Que no quede un archivo huérfano si la fila no aceptó la ruta.
        await removeMedia(BUCKET_CONTRATOS_RESPALDO, [vars.path])
        throw e
      }
    },
    onSuccess: () => invalidar(),
  })
}

// ── Históricos ──────────────────────────────────────────────────────────────

export function useVincularContratoMutation() {
  const invalidar = useInvalidarProveedores()
  return useMutation({
    mutationFn: async (vars: { contratoId: string; proveedorId: string; motivo?: string }) =>
      await rpc<string>('contrato_vincular_proveedor', {
        p_contrato_id: vars.contratoId,
        p_proveedor_id: vars.proveedorId,
        p_motivo: vars.motivo ?? null,
      }),
    onSuccess: () => invalidar(),
  })
}

/** `dryRun` por defecto: simular no cambia nada. */
export function useVincularInequivocosMutation() {
  const invalidar = useInvalidarProveedores()
  return useMutation({
    mutationFn: async (vars: { dryRun: boolean }) =>
      await rpc<ResultadoVincularInequivocos>('contratos_vincular_inequivocos', { p_dry_run: vars.dryRun }),
    onSuccess: (_d, v) => { if (!v.dryRun) invalidar() },
  })
}

export function useRevertirVinculosMutation() {
  const invalidar = useInvalidarProveedores()
  return useMutation({
    mutationFn: async (vars: { lote: string; motivo: string }) =>
      await rpc<ResultadoRevertirVinculos>('contratos_vinculos_revertir', { p_lote: vars.lote, p_motivo: vars.motivo }),
    onSuccess: () => invalidar(),
  })
}

// ── Reglas de compra ────────────────────────────────────────────────────────

export function useGuardarReglaCompraMutation(companyId?: string, projectId?: string | null) {
  const invalidar = useInvalidarProveedores()
  return useMutation({
    mutationFn: async (input: ReglaCompraFormInput) => {
      if (!companyId) throw new Error('Falta companyId.')
      await runQuery((signal) =>
        supabase
          .from('conta_reglas_compra')
          .insert({
            company_id: companyId,
            project_id: projectId ?? null,
            destino: input.destino,
            categoria: input.clasifica_por === 'categoria' ? input.categoria : null,
            suministro_id: input.clasifica_por === 'producto' ? input.suministro_id : null,
            proveedor_id: input.proveedor_id,
            cuenta_id: input.cuenta_id,
            vigente_desde: input.vigente_desde,
            notas: input.notas,
          })
          .abortSignal(signal),
      )
    },
    onSuccess: () => invalidar(),
  })
}

/** Cambiar un predeterminado = cerrar la regla vigente y abrir otra DESDE UNA FECHA FUTURA. */
export function useReemplazarReglaCompraMutation() {
  const invalidar = useInvalidarProveedores()
  return useMutation({
    mutationFn: async (vars: { reglaId: string; cuentaId: string; vigenteDesde: string }) =>
      await rpc<string>('compras_reemplazar_regla_cuenta', {
        p_regla_id: vars.reglaId,
        p_cuenta_id: vars.cuentaId,
        p_vigente_desde: vars.vigenteDesde,
      }),
    onSuccess: () => invalidar(),
  })
}

/** Cerrar (vigente_hasta) o desactivar: una regla que ya rige no se borra. */
export function useActualizarReglaCompraMutation() {
  const invalidar = useInvalidarProveedores()
  return useMutation({
    mutationFn: async (vars: { id: string; cambios: { activa?: boolean; vigente_hasta?: string | null; notas?: string | null } }) => {
      await runQuery((signal) =>
        supabase.from('conta_reglas_compra').update(vars.cambios).eq('id', vars.id).abortSignal(signal),
      )
    },
    onSuccess: () => invalidar(),
  })
}

// ── Carga masiva ────────────────────────────────────────────────────────────

export function usePrevisualizarImportacionMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: {
      tipo: TipoImportacion
      filas: Record<string, string>[]
      opciones: OpcionesImportacion
      archivoNombre?: string
      archivoSha256?: string
    }) =>
      await rpc<{ lote_id: string; resumen: Record<string, unknown> }>('proveedores_importar_previsualizar', {
        p_tipo: vars.tipo,
        p_filas: vars.filas,
        p_opciones: vars.opciones,
        p_archivo_nombre: vars.archivoNombre ?? null,
        p_archivo_sha256: vars.archivoSha256 ?? null,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: proveedoresKeys.all }),
  })
}

export function useAplicarImportacionMutation() {
  const invalidar = useInvalidarProveedores()
  return useMutation({
    mutationFn: async (vars: { loteId: string; modo: ModoAplicacion }) =>
      await rpc<ResultadoAplicacion>('proveedores_importar_aplicar', { p_lote_id: vars.loteId, p_modo: vars.modo }),
    onSuccess: () => invalidar(),
  })
}

export function useDescartarImportacionMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (loteId: string) => {
      await rpc<null>('proveedores_importar_descartar', { p_lote_id: loteId })
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: proveedoresKeys.all }),
  })
}
