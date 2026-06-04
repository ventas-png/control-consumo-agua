// serv:S11 · Núcleo fiscal FEL/CFDI — Hooks de LECTURA de documentos_fiscales.
//
// Foundation: SOLO lado lectura. Siguiendo el orden de adopción de
// src/domain/README.md, estos hooks AÚN NO se cablean a componentes en este PR
// (zero blast radius). La UI que los consuma (badge de estatus de timbrado,
// historial de comprobantes) es follow-up.
//
// RLS scopea por tenant (company_id directo en documentos_fiscales); replicamos
// el filtro .eq('company_id', …) como defense-in-depth donde aplica.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { fiscalKeys } from './keys'
import type { DocumentoFiscal } from '../../types/fiscal'

// Columnas a proyectar. Debe ser UN string literal (no concatenación) para que
// supabase-js infiera el select sin caer al fallback GenericStringError (igual
// que REGISTROS_LIST_COLS / FACTURA_COLS). Traemos los payloads jsonb porque la
// UI de detalle los necesita; si pesaran, separar en una query de detalle.
const DOC_COLS =
  'id,company_id,registro_id,regimen,tipo,estado,proveedor,request_payload,response_payload,uuid_fiscal,serie,numero,numero_autorizacion,fecha_certificacion,error,created_at,updated_at'

/**
 * Documentos fiscales del tenant (scope company). RLS + filtro defensivo por
 * company_id. Orden por created_at desc. Limit 5000 para no exceder el
 * statement_timeout en históricos grandes.
 */
export function useDocumentosFiscalesQuery(companyId?: string) {
  return useQuery({
    queryKey: fiscalKeys.documentos(companyId),
    queryFn: async () =>
      (await runQuery<DocumentoFiscal[]>((signal) => {
        let q = supabase
          .from('documentos_fiscales')
          .select(DOC_COLS)
          .order('created_at', { ascending: false })
          .limit(5000)
        if (companyId) q = q.eq('company_id', companyId)
        return q.abortSignal(signal)
      })) ?? [],
    enabled: !!companyId,
  })
}

/**
 * Documentos fiscales de una Factura concreta (scope registro). Útil para el
 * badge/historial de timbrado de un recibo. Orden por created_at desc.
 */
export function useDocumentosFiscalesPorRegistroQuery(registroId?: string) {
  return useQuery({
    queryKey: fiscalKeys.documentosPorRegistro(registroId),
    queryFn: async () =>
      (await runQuery<DocumentoFiscal[]>((signal) =>
        supabase
          .from('documentos_fiscales')
          .select(DOC_COLS)
          .eq('registro_id', registroId!)
          .order('created_at', { ascending: false })
          .abortSignal(signal),
      )) ?? [],
    enabled: !!registroId,
  })
}

/** Un documento fiscal por id (detalle). */
export function useDocumentoFiscalQuery(id?: string) {
  return useQuery({
    queryKey: fiscalKeys.documento(id),
    queryFn: async () =>
      (await runQuery<DocumentoFiscal[]>((signal) =>
        supabase
          .from('documentos_fiscales')
          .select(DOC_COLS)
          .eq('id', id!)
          .limit(1)
          .abortSignal(signal),
      ))?.[0] ?? null,
    enabled: !!id,
  })
}
