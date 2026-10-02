// Carga masiva de RENGLONES de una orden de compra en borrador.
//
// El navegador SOLO convierte el archivo en filas de texto (mismo lector que la carga de
// proveedores: CSV/XLSX de verdad, sin fórmulas, tamaño acotado). Validar, resolver insumos
// y cuentas, detectar duplicados y guardar lo hace el SERVIDOR (`compras_lineas_importar_*`):
// lo que valida el navegador lo salta quien llama a la API directamente.
//
// Flujo: vista previa (no escribe renglones) → confirmación → aplicar (todo o nada).
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { comprasKeys } from './keys'
import {
  ArchivoImportacionError,
  csvPlantilla,
  leerArchivoImportacion,
  xlsxPlantilla,
  type ArchivoLeido,
  type Plantilla,
} from '../proveedores/importacion'
import type { ResultadoImportacionLineas, VistaPreviaImportacionLineas } from '../../types/compras'

export const MAX_FILAS_LINEAS = 500

export const PLANTILLA_LINEAS: Plantilla = {
  tipo: 'lineas_orden',
  titulo: 'Renglones de una orden de compra',
  descripcion: 'Agrega renglones a una orden en BORRADOR. No aprueba, no emite, no recibe ni contabiliza.',
  nombreArchivo: 'plantilla_renglones_orden',
  columnas: [
    { key: 'descripcion', ayuda: 'Qué se pide (mínimo 3 caracteres).', requerida: true, ejemplos: ['Cloro industrial', 'Mantenimiento mensual'] },
    { key: 'destino', ayuda: 'inventario, activo fijo, servicio o gasto. El inventario entra al almacén SOLO al recibir lo aceptado.', requerida: true, ejemplos: ['inventario', 'servicio'] },
    { key: 'insumo', ayuda: 'Nombre EXACTO del insumo del almacén del proyecto de la orden. Obligatorio con destino inventario; vacío en los demás. No se crea si no existe.', identificador: true, ejemplos: ['Cloro', ''] },
    { key: 'categoria', ayuda: 'mantenimiento, servicios, administrativo, seguridad, limpieza, obras u otros (por omisión: otros).', ejemplos: ['limpieza', 'mantenimiento'] },
    { key: 'cantidad', ayuda: 'Mayor que 0, con punto decimal (hasta 4 decimales).', requerida: true, ejemplos: ['10', '1'] },
    { key: 'unidad', ayuda: 'En inventario debe ser la unidad del insumo (vacío = la del insumo); en los demás, por omisión «unidad».', ejemplos: ['litro', 'servicio'] },
    { key: 'precio_unitario', ayuda: 'Sin IVA, mayor o igual a 0, con punto decimal.', requerida: true, ejemplos: ['12.50', '300'] },
    { key: 'iva', ayuda: 'MONTO de IVA del renglón (no porcentaje); por omisión 0.', ejemplos: ['15', '36'] },
    { key: 'cuenta', ayuda: 'Código de una cuenta EXISTENTE en la contabilidad de la orden; vacío = la resuelve la regla de compra o el mapeo. No se crea.', identificador: true, ejemplos: ['', ''] },
  ],
  notas: [
    'Solo se pueden importar renglones a una orden en borrador.',
    'Importar NO aprueba, emite, recibe ni contabiliza la orden; tampoco crea proveedores, cuentas ni insumos.',
    'Si UNA fila tiene error no se guarda ninguna: la carga es todo o nada.',
    'Cargar dos veces el mismo contenido en la misma orden se rechaza mientras sus renglones sigan ahí.',
    'Los códigos y nombres se leen como TEXTO. No se admiten fórmulas: pega valores.',
    `Máximo ${MAX_FILAS_LINEAS} filas por carga.`,
  ],
}

export const csvPlantillaLineas = () => csvPlantilla(PLANTILLA_LINEAS)
export const xlsxPlantillaLineas = () => xlsxPlantilla(PLANTILLA_LINEAS)

/** Lee el archivo y comprueba el límite de filas propio de esta carga. */
export async function leerArchivoLineas(nombre: string, buffer: ArrayBuffer): Promise<ArchivoLeido> {
  const leido = await leerArchivoImportacion(nombre, buffer, PLANTILLA_LINEAS)
  if (leido.filas.length > MAX_FILAS_LINEAS) {
    throw new ArchivoImportacionError(`El archivo tiene ${leido.filas.length} filas y el máximo es ${MAX_FILAS_LINEAS} por carga: divídelo.`)
  }
  return leido
}

export async function previsualizarLineas(ordenId: string, filas: Record<string, string>[], archivo: string): Promise<VistaPreviaImportacionLineas> {
  const { data, error } = await supabase.rpc('compras_lineas_importar_previsualizar', {
    p_orden_id: ordenId, p_filas: filas, p_archivo: archivo,
  })
  if (error) throw new Error(error.message)
  return data as VistaPreviaImportacionLineas
}

export async function aplicarLineas(loteId: string): Promise<ResultadoImportacionLineas> {
  const { data, error } = await supabase.rpc('compras_lineas_importar_aplicar', { p_lote_id: loteId })
  if (error) throw new Error(error.message)
  return data as ResultadoImportacionLineas
}

export async function descartarLineas(loteId: string): Promise<void> {
  const { error } = await supabase.rpc('compras_lineas_importar_descartar', { p_lote_id: loteId })
  if (error) throw new Error(error.message)
}

export function usePrevisualizarLineasMutation() {
  return useMutation({
    mutationFn: (v: { ordenId: string; filas: Record<string, string>[]; archivo: string }) =>
      previsualizarLineas(v.ordenId, v.filas, v.archivo),
  })
}

export function useAplicarLineasMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (loteId: string) => aplicarLineas(loteId),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: comprasKeys.all })
      void qc.invalidateQueries({ queryKey: comprasKeys.ordenLineas(r.orden_compra_id) })
    },
  })
}

export function useDescartarLineasMutation() {
  return useMutation({ mutationFn: (loteId: string) => descartarLineas(loteId) })
}
