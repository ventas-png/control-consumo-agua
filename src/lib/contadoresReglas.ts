// Reglas puras del feature Contadores (P1 #3, refactor de ContadoresSection):
// validación del formulario, payload base de insert/update, filtros de la
// tabla y resumen por tipología. Sin dependencias de React ni Supabase.
import type { Contador, Tarifa, TipoAgua } from '../types'

export interface ContadorForm {
  numero_serie: string
  tipo_agua: TipoAgua
  descripcion: string
  marca: string
  modelo: string
  fecha_instalacion: string
  lectura_inicial: string
  activo: boolean
  tarifa_id: string
  unidad_id: string
  medida: string
  material: string
  tipo_contador: string
  valvula_cheque: string
  tipo_llave: string
  llave_antifraude: string
  valvula_aire: string
  fecha_reemplazo_sugerida: string
  numero_derecho_servicio: string
  cantidad_derecho_servicio_m3: string
  periodicidad_lectura_dias: string
  contratista_instalador: string
  garantia_instalacion_vence: string
}

/** Validación previa al guardado. Devuelve la lista de errores (vacía = ok). */
export function validarContador(numeroSerie: string, lecturaInicial: number): string[] {
  const errors: string[] = []
  if (!numeroSerie || numeroSerie.length < 2)
    errors.push('Número de serie debe tener al menos 2 caracteres')
  if (isNaN(lecturaInicial) || lecturaInicial < 0)
    errors.push('Lectura inicial debe ser un número mayor o igual a 0')
  return errors
}

/**
 * Campos comunes del payload de insert/update de un contador (vacío → null,
 * numéricos parseados). El caller añade project/company y campos de auditoría.
 */
export function construirPayloadContador(form: ContadorForm, numeroSerie: string, lecturaInicial: number) {
  return {
    numero_serie: numeroSerie,
    tipo_agua: form.tipo_agua,
    descripcion: form.descripcion || null,
    marca: form.marca || null,
    modelo: form.modelo || null,
    fecha_instalacion: form.fecha_instalacion || null,
    lectura_inicial: lecturaInicial,
    activo: form.activo,
    tarifa_id: form.tarifa_id || null,
    unidad_id: form.unidad_id || null,
    medida: form.medida || null,
    material: form.material || null,
    tipo_contador: form.tipo_contador || null,
    valvula_cheque: form.valvula_cheque || null,
    tipo_llave: form.tipo_llave || null,
    llave_antifraude: form.llave_antifraude || null,
    valvula_aire: form.valvula_aire || null,
    fecha_reemplazo_sugerida: form.fecha_reemplazo_sugerida || null,
    numero_derecho_servicio: form.numero_derecho_servicio || null,
    cantidad_derecho_servicio_m3: form.cantidad_derecho_servicio_m3 ? parseFloat(form.cantidad_derecho_servicio_m3) : null,
    periodicidad_lectura_dias: form.periodicidad_lectura_dias ? parseInt(form.periodicidad_lectura_dias) : null,
    contratista_instalador: form.contratista_instalador || null,
    garantia_instalacion_vence: form.garantia_instalacion_vence || null,
  }
}

/** Filtro de la tabla: texto libre (serie/marca/modelo/descripción) + tipo + unidad. */
export function filtrarContadores(
  contadores: Contador[],
  search: string,
  filterTipo: TipoAgua | '',
  filterUnidad: string
): Contador[] {
  return contadores.filter(c => {
    const matchSearch =
      c.numero_serie.toLowerCase().includes(search.toLowerCase()) ||
      (c.marca ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (c.modelo ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (c.descripcion ?? '').toLowerCase().includes(search.toLowerCase())
    const matchTipo = filterTipo === '' || c.tipo_agua === filterTipo
    const matchUnidad = filterUnidad === '' || c.unidad_id === filterUnidad
    return matchSearch && matchTipo && matchUnidad
  })
}

/** Resumen por tipología (solo tipos presentes): total y cuántos con tarifa. */
export function resumenPorTipo(
  contadores: Contador[],
  tipos: { value: TipoAgua; label: string }[]
): { value: TipoAgua; label: string; total: number; conTarifa: number }[] {
  return tipos
    .map(t => ({
      ...t,
      total: contadores.filter(c => c.tipo_agua === t.value).length,
      conTarifa: contadores.filter(c => c.tipo_agua === t.value && c.tarifa_id).length,
    }))
    .filter(t => t.total > 0)
}

/** Tarifas activas aplicables a un tipo de agua. */
export function tarifasParaTipo(tarifas: Tarifa[], tipo: TipoAgua): Tarifa[] {
  return tarifas.filter(t => t.tipo_agua === tipo && t.activa)
}
