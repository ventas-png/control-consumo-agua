// lib/padronMascotas.ts — Reglas puras del registro de mascotas desde el portal
// (20261101000000). Módulo sin React ni Supabase para poder probarlo aislado.
//
// La validación espeja la de portal_enviar_mascota: el servidor es quien manda,
// esto solo le muestra al residente el problema antes de enviar.
import type { EspecieMascota, VacunaMascota } from '../types'

/**
 * Vacunas habituales por especie: el portal las ofrece como lista para marcar
 * (además de "otra"), de modo que la administración reciba el esquema completo
 * y no solo "la última vacuna".
 */
export const VACUNAS_POR_ESPECIE: Record<EspecieMascota, string[]> = {
  perro: [
    'Rabia (antirrábica)',
    'Polivalente / Múltiple (DHPP)',
    'Parvovirus',
    'Moquillo (Distemper)',
    'Hepatitis infecciosa canina',
    'Leptospirosis',
    'Bordetella (tos de las perreras)',
    'Coronavirus canino',
    'Influenza canina',
  ],
  gato: [
    'Rabia (antirrábica)',
    'Triple felina (FVRCP)',
    'Leucemia felina (FeLV)',
    'Panleucopenia felina',
    'Clamidiosis felina',
  ],
  ave: ['Newcastle', 'Viruela aviar'],
  otro: [],
}

/** Perros y gatos deben declarar al menos una vacuna (lo exige el servidor). */
export function exigeVacunas(especie: EspecieMascota): boolean {
  return especie === 'perro' || especie === 'gato'
}

/** Vacuna del catálogo marcada en el formulario. */
export interface VacunaMarcada { fecha: string; proxima: string }
/** Vacuna fuera del catálogo, escrita a mano. */
export interface VacunaOtra { tipo: string; fecha: string; proxima: string }

/**
 * Arma el arreglo de vacunas a enviar y valida lo mismo que el servidor.
 * Las filas "otra" completamente vacías se ignoran.
 */
export function armarVacunas(
  especie: EspecieMascota,
  marcadas: Record<string, VacunaMarcada>,
  otras: VacunaOtra[],
  hoy: string,
): { vacunas: VacunaMascota[]; error: string | null } {
  const vacunas: VacunaMascota[] = []
  for (const tipo of VACUNAS_POR_ESPECIE[especie]) {
    const m = marcadas[tipo]
    if (!m) continue
    if (!m.fecha) return { vacunas, error: `Indica la fecha en que se aplicó "${tipo}".` }
    vacunas.push({ tipo, fecha: m.fecha, proxima: m.proxima || null })
  }
  for (const o of otras) {
    if (!o.tipo.trim() && !o.fecha) continue
    if (!o.tipo.trim()) return { vacunas, error: 'Cada vacuna adicional debe indicar su nombre.' }
    if (!o.fecha) return { vacunas, error: `Indica la fecha en que se aplicó "${o.tipo.trim()}".` }
    vacunas.push({ tipo: o.tipo.trim(), fecha: o.fecha, proxima: o.proxima || null })
  }
  const futura = vacunas.find(v => v.fecha > hoy)
  if (futura) return { vacunas, error: `La vacuna "${futura.tipo}" tiene fecha futura.` }
  if (exigeVacunas(especie) && vacunas.length === 0) {
    return { vacunas, error: 'Registra al menos una vacuna de tu mascota.' }
  }
  return { vacunas, error: null }
}

/** Placa como la normaliza el servidor: mayúsculas y sin espacios repetidos. */
export function normalizarPlaca(placa: string): string {
  return placa.trim().replace(/\s+/g, ' ').toUpperCase()
}

/** Misma forma que acepta portal_enviar_vehiculo. */
export function placaValida(placa: string): boolean {
  return /^[A-Z0-9][A-Z0-9 -]{1,14}$/.test(normalizarPlaca(placa))
}
