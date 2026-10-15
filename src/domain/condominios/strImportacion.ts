// domain/condominios/strImportacion.ts — carga masiva de RESERVAS STR de un proyecto.
//
// El navegador SOLO convierte el archivo en filas de texto (mismo lector que la carga de
// proveedores y de renglones: CSV/XLSX de verdad, sin fórmulas, tamaño acotado). Validar,
// resolver la unidad por nombre, detectar códigos repetidos y solapes, y guardar lo hace el
// SERVIDOR (`str_reservas_importar_*`, 20261031000100): lo que valida el navegador lo salta
// quien llama a la API directamente.
//
// Flujo: vista previa (no escribe reservas) → confirmación → aplicar (todo o nada).
import { supabase } from '../../lib/supabase'
import {
  ArchivoImportacionError,
  csvPlantilla,
  leerArchivoImportacion,
  xlsxPlantilla,
  type ArchivoLeido,
  type Plantilla,
} from '../proveedores/importacion'
import type { ResultadoImportacionSTR, VistaPreviaImportacionSTR } from '../../types'

export const MAX_FILAS_STR = 500

export const PLANTILLA_RESERVAS_STR: Plantilla = {
  tipo: 'reservas_str',
  titulo: 'Reservas de corto plazo (STR)',
  descripcion: 'Carga reservas CONFIRMADAS de un proyecto (en curso, cargadas o futuras). No cancela, no modifica ni elimina reservas existentes.',
  nombreArchivo: 'plantilla_reservas_str',
  columnas: [
    { key: 'unidad', requerida: true, identificador: true, ayuda: 'Nombre EXACTO de la unidad del proyecto, como aparece en Unidades (sin distinguir mayúsculas). No se crea si no existe.', ejemplos: ['Apto 1A', 'Apto 2B'] },
    { key: 'huesped_nombre', requerida: true, ayuda: 'Nombre del huésped principal (2–150 caracteres).', ejemplos: ['Ana López', 'Luis Gómez'] },
    { key: 'huesped_email', ayuda: 'Correo del huésped (opcional).', ejemplos: ['ana@correo.example', ''] },
    { key: 'huesped_telefono', identificador: true, ayuda: 'Teléfono (texto, puede llevar +).', ejemplos: ['+502 5555 0001', ''] },
    { key: 'fecha_entrada', requerida: true, ayuda: 'AAAA-MM-DD.', ejemplos: ['2026-12-10', '2026-12-20'] },
    { key: 'fecha_salida', requerida: true, ayuda: 'AAAA-MM-DD, posterior a la entrada (al menos una noche).', ejemplos: ['2026-12-12', '2026-12-25'] },
    { key: 'hora_llegada_estimada', ayuda: 'HH:MM (opcional).', ejemplos: ['15:00', ''] },
    { key: 'hora_salida_estimada', ayuda: 'HH:MM (opcional).', ejemplos: ['11:00', ''] },
    { key: 'num_adultos', ayuda: 'Entero ≥ 1 (vacío = 1).', ejemplos: ['2', '1'] },
    { key: 'num_ninos', ayuda: 'Entero ≥ 0 (vacío = 0).', ejemplos: ['1', ''] },
    { key: 'num_bebes', ayuda: 'Entero ≥ 0 (vacío = 0).', ejemplos: ['', ''] },
    { key: 'plataforma', ayuda: 'airbnb, booking, vrbo, directo u otro (vacío = directo).', ejemplos: ['airbnb', 'booking'] },
    { key: 'codigo_confirmacion', identificador: true, ayuda: 'Código de la plataforma. Si ya existe en una reserva NO cancelada del proyecto, o se repite en el archivo, la fila se rechaza.', ejemplos: ['HM-100', 'BK-200'] },
    { key: 'fecha_reservacion', ayuda: 'AAAA-MM-DD en que se hizo la reserva (opcional).', ejemplos: ['2026-11-01', ''] },
    { key: 'monto_noche', ayuda: 'Con punto decimal, sin separador de miles (opcional).', ejemplos: ['100', '85.50'] },
    { key: 'monto_total', ayuda: 'Vacío = noches × monto_noche.', ejemplos: ['', '427.50'] },
    { key: 'politica_cancelacion', ayuda: 'flexible, moderada, estricta, no_reembolsable, na u otra (vacío = na).', ejemplos: ['flexible', ''] },
    { key: 'mascotas', ayuda: 'si o no (vacío = no).', ejemplos: ['si', 'no'] },
    { key: 'notas', ayuda: 'Observaciones (hasta 1000 caracteres).', ejemplos: ['Cuna para bebé', ''] },
  ],
  notas: [
    'Toda reserva importada nace CONFIRMADA en el proyecto elegido. Importar no cancela, modifica ni elimina reservas.',
    'La unidad se busca por su nombre exacto entre las unidades activas del proyecto; si no existe o hay dos con el mismo nombre, la fila falla. No se crean unidades.',
    'Un código de confirmación ya usado por una reserva no cancelada del proyecto (o repetido en el archivo) rechaza la fila; un solape de fechas con otra reserva de la misma unidad solo avisa.',
    'Si UNA fila tiene error no se guarda ninguna: la carga es todo o nada.',
    'Cargar dos veces el mismo contenido en el mismo proyecto se rechaza mientras sus reservas sigan ahí.',
    'Los códigos y teléfonos se leen como TEXTO. No se admiten fórmulas: pega valores. No incluyas columnas de estado ni identificadores: se rechazan.',
    `Máximo ${MAX_FILAS_STR} filas por carga.`,
  ],
}

export const csvPlantillaSTR = () => csvPlantilla(PLANTILLA_RESERVAS_STR)
export const xlsxPlantillaSTR = () => xlsxPlantilla(PLANTILLA_RESERVAS_STR)

/** Lee el archivo y comprueba el límite de filas propio de esta carga. */
export async function leerArchivoReservasSTR(nombre: string, buffer: ArrayBuffer): Promise<ArchivoLeido> {
  const leido = await leerArchivoImportacion(nombre, buffer, PLANTILLA_RESERVAS_STR)
  if (leido.filas.length > MAX_FILAS_STR) {
    throw new ArchivoImportacionError(`El archivo tiene ${leido.filas.length} filas y el máximo es ${MAX_FILAS_STR} por carga: divídelo.`)
  }
  return leido
}

export async function previsualizarReservasSTR(projectId: string, filas: Record<string, string>[], archivo: string): Promise<VistaPreviaImportacionSTR> {
  const { data, error } = await supabase.rpc('str_reservas_importar_previsualizar', {
    p_project_id: projectId, p_filas: filas, p_archivo: archivo,
  })
  if (error) throw new Error(mensajeErrorImportacionSTR(error.message))
  return data as VistaPreviaImportacionSTR
}

export async function aplicarReservasSTR(loteId: string): Promise<ResultadoImportacionSTR> {
  const { data, error } = await supabase.rpc('str_reservas_importar_aplicar', { p_lote_id: loteId })
  if (error) throw new Error(mensajeErrorImportacionSTR(error.message))
  return data as ResultadoImportacionSTR
}

export async function descartarReservasSTR(loteId: string): Promise<void> {
  const { error } = await supabase.rpc('str_reservas_importar_descartar', { p_lote_id: loteId })
  if (error) throw new Error(error.message)
}

/** Los mensajes del servidor llevan un prefijo técnico (STR_IMPORT_…): se quita para la pantalla. */
export function mensajeErrorImportacionSTR(mensaje: string): string {
  return mensaje.replace(/^STR_IMPORT_[A-Z_]+:\s*/, '')
}

/** Monto total de la vista previa (solo filas válidas con monto). */
export function totalVistaPrevia(vista: Pick<VistaPreviaImportacionSTR, 'filas'> | null): number {
  return (vista?.filas ?? []).reduce((s, f) => s + (f.datos?.monto_total ?? 0), 0)
}
