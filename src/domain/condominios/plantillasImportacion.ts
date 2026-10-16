// domain/condominios/plantillasImportacion.ts — carga masiva de ACTIVIDADES del catálogo
// (plantillas_tarea_cargo) de un proyecto, con sus insumos, herramientas y equipo por nombre.
//
// El navegador SOLO convierte el archivo en filas de texto (mismo lector que la carga de
// proveedores, renglones y reservas STR: CSV/XLSX de verdad, sin fórmulas, tamaño acotado).
// Validar, resolver área y recursos por nombre, detectar actividades repetidas y guardar lo
// hace el SERVIDOR (`plantillas_importar_*`, 20261031000200): lo que valida el navegador lo
// salta quien llama a la API directamente.
//
// Flujo: vista previa (no escribe actividades) → confirmación → aplicar (todo o nada).
import { supabase } from '../../lib/supabase'
import {
  ArchivoImportacionError,
  csvPlantilla,
  leerArchivoImportacion,
  xlsxPlantilla,
  type ArchivoLeido,
  type Plantilla,
} from '../proveedores/importacion'
import type { ResultadoImportacionActividades, VistaPreviaImportacionActividades } from '../../types'

export const MAX_FILAS_ACTIVIDADES = 500

export const PLANTILLA_ACTIVIDADES: Plantilla = {
  tipo: 'actividades_catalogo',
  titulo: 'Catálogo de actividades',
  descripcion: 'Crea actividades del catálogo de un proyecto (con su cargo, servicio, duración, checklist e insumos, herramientas y equipo por nombre). No modifica ni elimina actividades existentes.',
  nombreArchivo: 'plantilla_actividades',
  columnas: [
    { key: 'titulo', requerida: true, ayuda: 'Título de la actividad (2–150 caracteres). Si ya existe una con el mismo título y cargo en el proyecto, la fila se rechaza.', ejemplos: ['Barrido de pasillos', 'Ronda nocturna'] },
    { key: 'cargo', requerida: true, ayuda: 'Cargo que la desempeña: el código o el nombre de un cargo ACTIVO del condominio (Recursos Humanos → Configuración). Por defecto: conserje, guardia, jardinero, mantenimiento, administrador u otro.', ejemplos: ['conserje', 'guardia'] },
    { key: 'servicio', requerida: true, ayuda: 'Familia: limpieza, mantenimiento, seguridad, jardineria, administracion u otro.', ejemplos: ['limpieza', 'seguridad'] },
    { key: 'descripcion', ayuda: 'Detalle de cómo realizar la actividad (hasta 2000 caracteres).', ejemplos: ['Barrer y trapear de arriba abajo', ''] },
    { key: 'instrucciones_seguridad', ayuda: 'EPP requerido, bloqueo de área, manejo de químicos… (hasta 2000 caracteres).', ejemplos: ['Guantes y señalización de piso mojado', ''] },
    { key: 'duracion_min', ayuda: 'Minutos estimados (entero > 0). Obligatoria si el servicio es limpieza.', ejemplos: ['30', ''] },
    { key: 'icono', ayuda: 'Uno de los íconos de la pantalla (vacío = el del servicio).', ejemplos: ['🧹', ''] },
    { key: 'area', ayuda: 'Nombre EXACTO de un área activa del proyecto (sin distinguir mayúsculas). No se crea si no existe.', ejemplos: ['Pasillos', ''] },
    { key: 'orden', ayuda: 'Entero ≥ 0 (vacío = 0).', ejemplos: ['1', ''] },
    { key: 'requiere_foto', ayuda: 'si o no (vacío = no).', ejemplos: ['si', 'no'] },
    { key: 'requiere_comentario', ayuda: 'si o no (vacío = no).', ejemplos: ['no', ''] },
    { key: 'requiere_checklist', ayuda: 'si o no (vacío = no). Con «si», la columna checklist debe traer al menos un paso.', ejemplos: ['si', ''] },
    { key: 'checklist', ayuda: 'Pasos separados por «|», en orden (hasta 50).', ejemplos: ['Barrer|Trapear|Vaciar basureros', ''] },
    { key: 'insumos', ayuda: 'Insumos de Suministros por nombre, separados por «;», con cantidad opcional «Nombre x 3» (decimales con punto). Deben existir y estar activos.', ejemplos: ['Escoba; Bolsa de basura x 3', ''] },
    { key: 'herramientas', ayuda: 'Artículos de Inventario con categoría HERRAMIENTA, por nombre, separados por «;»; cantidad entera opcional «x 2»; «!» al final = obligatoria.', ejemplos: ['Trapeador x 2!', ''] },
    { key: 'equipo', ayuda: 'Artículos de Inventario con categoría EQUIPO, por nombre, separados por «;»; cantidad entera opcional «x 2»; «!» al final = obligatorio.', ejemplos: ['Hidrolavadora!', 'Radio x 2'] },
  ],
  notas: [
    'Toda actividad importada nace ACTIVA en el proyecto elegido. Importar no modifica ni elimina actividades existentes.',
    'Si ya existe una actividad con el mismo título y cargo en el proyecto (activa o inactiva), o el archivo la repite, la fila se rechaza: la carga no sobrescribe.',
    'El área, los insumos, las herramientas y el equipo se buscan por su nombre exacto en los catálogos del proyecto; si no existen, están inactivos o dados de baja, o hay dos con el mismo nombre, la fila falla. No se crean recursos.',
    'Herramientas y equipo viven en Inventario: la columna decide la categoría («herramientas» → herramienta, «equipo» → equipo). Para vincular insumos necesitas permiso para ver Suministros; para herramientas y equipo, permiso para ver Inventario.',
    'Si UNA fila tiene error no se guarda ninguna: la carga es todo o nada.',
    'Cargar dos veces el mismo contenido en el mismo proyecto se rechaza mientras sus actividades sigan ahí.',
    'No se admiten fórmulas: pega valores. No incluyas columnas de estado ni identificadores: se rechazan.',
    `Máximo ${MAX_FILAS_ACTIVIDADES} filas por carga.`,
  ],
}

export const csvPlantillaActividades = () => csvPlantilla(PLANTILLA_ACTIVIDADES)
export const xlsxPlantillaActividades = () => xlsxPlantilla(PLANTILLA_ACTIVIDADES)

/** Lee el archivo y comprueba el límite de filas propio de esta carga. */
export async function leerArchivoActividades(nombre: string, buffer: ArrayBuffer): Promise<ArchivoLeido> {
  const leido = await leerArchivoImportacion(nombre, buffer, PLANTILLA_ACTIVIDADES)
  if (leido.filas.length > MAX_FILAS_ACTIVIDADES) {
    throw new ArchivoImportacionError(`El archivo tiene ${leido.filas.length} filas y el máximo es ${MAX_FILAS_ACTIVIDADES} por carga: divídelo.`)
  }
  return leido
}

export async function previsualizarActividades(projectId: string, filas: Record<string, string>[], archivo: string): Promise<VistaPreviaImportacionActividades> {
  const { data, error } = await supabase.rpc('plantillas_importar_previsualizar', {
    p_project_id: projectId, p_filas: filas, p_archivo: archivo,
  })
  if (error) throw new Error(mensajeErrorImportacionActividades(error.message))
  return data as VistaPreviaImportacionActividades
}

export async function aplicarActividades(loteId: string): Promise<ResultadoImportacionActividades> {
  const { data, error } = await supabase.rpc('plantillas_importar_aplicar', { p_lote_id: loteId })
  if (error) throw new Error(mensajeErrorImportacionActividades(error.message))
  return data as ResultadoImportacionActividades
}

export async function descartarActividades(loteId: string): Promise<void> {
  const { error } = await supabase.rpc('plantillas_importar_descartar', { p_lote_id: loteId })
  if (error) throw new Error(error.message)
}

/** Los mensajes del servidor llevan un prefijo técnico (PLANTILLAS_IMPORT_…): se quita para la pantalla. */
export function mensajeErrorImportacionActividades(mensaje: string): string {
  return mensaje.replace(/^PLANTILLAS_IMPORT_[A-Z_]+:\s*/, '')
}

/** Recursos (insumos + herramientas + equipo) que vincularía la vista previa (solo filas válidas). */
export function totalRecursosVistaPrevia(vista: Pick<VistaPreviaImportacionActividades, 'filas'> | null): number {
  return (vista?.filas ?? []).reduce((s, f) => s + (f.datos?.n_recursos ?? 0), 0)
}
