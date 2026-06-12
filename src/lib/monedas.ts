// Catálogo de monedas de cobro de la EMPRESA (companies.default_currency,
// códigos ISO 4217). Subconjunto práctico del CHECK valid_currency de la BD
// (migración 20260612203000). La BD guarda el código en minúsculas.
//
// NO confundir con MONEDAS de src/types/plataforma.ts: aquellos son SÍMBOLOS
// de display por proyecto (projects.moneda: 'Q', '$', '€'…); este catálogo es
// la moneda real de cobros/contabilidad a nivel empresa.

export interface MonedaIso {
  /** Código ISO 4217 en minúsculas (como lo guarda la BD). */
  code: string
  label: string
}

export const MONEDAS_ISO: ReadonlyArray<MonedaIso> = [
  { code: 'gtq', label: 'GTQ — Quetzal (Guatemala)' },
  { code: 'usd', label: 'USD — Dólar estadounidense' },
  { code: 'mxn', label: 'MXN — Peso mexicano' },
  { code: 'hnl', label: 'HNL — Lempira (Honduras)' },
  { code: 'nio', label: 'NIO — Córdoba (Nicaragua)' },
  { code: 'crc', label: 'CRC — Colón (Costa Rica)' },
  { code: 'pab', label: 'PAB — Balboa (Panamá)' },
  { code: 'dop', label: 'DOP — Peso dominicano' },
  { code: 'cop', label: 'COP — Peso colombiano' },
  { code: 'pen', label: 'PEN — Sol peruano' },
  { code: 'clp', label: 'CLP — Peso chileno' },
  { code: 'ars', label: 'ARS — Peso argentino' },
  { code: 'brl', label: 'BRL — Real brasileño' },
  { code: 'bob', label: 'BOB — Boliviano' },
  { code: 'pyg', label: 'PYG — Guaraní (Paraguay)' },
  { code: 'uyu', label: 'UYU — Peso uruguayo' },
  { code: 'eur', label: 'EUR — Euro' },
] as const

/** Etiqueta legible de un código ISO; cae al código en mayúsculas si no está en el catálogo. */
export function monedaLabel(code: string | null | undefined): string {
  if (!code) return '—'
  const normalized = code.trim().toLowerCase()
  return MONEDAS_ISO.find(m => m.code === normalized)?.label ?? normalized.toUpperCase()
}
