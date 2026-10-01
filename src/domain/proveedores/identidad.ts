// Proveedores — identidad, habilitación y búsqueda (lógica PURA, testeable).
//
// IMPORTANTE: esto ESPEJA al servidor, no lo reemplaza. La autoridad es la BD
// (`proveedor_normalizar_identificacion`, `proveedor_habilitado_en`, el trigger
// `proveedores_tg_identidad`…). Aquí vive solo lo que la pantalla necesita para
// avisar ANTES de enviar y para decidir qué ofrecer: si estas funciones se
// equivocan, el servidor igual rechaza; si el servidor cambia y esto no, lo
// atrapa `identidad.test.ts`, que usa los mismos vectores del arnés SQL.
import { proveedorHabilitado } from '../../types/compras'
import type {
  EstadoHabilitacionProyecto,
  ProveedorCatalogo,
  ProveedorProyecto,
} from '../../types/proveedores'

/** Marcadores de «no tiene identificación»: no identifican a nadie. */
const SIN_IDENTIFICACION = new Set([
  'CF', 'CONSUMIDORFINAL', 'NA', 'SN', 'SINNIT', 'NOAPLICA', 'NINGUNO', 'NINGUNA', 'PENDIENTE',
])

/**
 * Identificación fiscal normalizada: mayúsculas y solo A-Z/0-9, SIN quitar ceros
 * a la izquierda («0123» y «123» pueden ser identificaciones distintas). Igual
 * que `proveedor_normalizar_identificacion`. NULL para vacío y marcadores.
 */
export function normalizarIdentificacion(texto: string | null | undefined): string | null {
  const n = (texto ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (n === '' || SIN_IDENTIFICACION.has(n)) return null
  return n
}

/** Nombre sin acentos ni puntuación: SOLO para proponer coincidencias, nunca para unir. */
export function normalizarNombre(nombre: string | null | undefined): string {
  return (nombre ?? '')
    .toLowerCase()
    .replace(/[áàäâã]/g, 'a')
    .replace(/[éèëê]/g, 'e')
    .replace(/[íìïî]/g, 'i')
    .replace(/[óòöôõ]/g, 'o')
    .replace(/[úùüû]/g, 'u')
    .replace(/ñ/g, 'n')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Como `normalizarNombre`, sin la forma societaria final (S.A., Ltda., …). */
export function nombreBase(nombre: string | null | undefined): string {
  return normalizarNombre(nombre)
    .replace(/( (sa|s a|sas|srl|s r l|s de rl|ltda|limitada|cia|compania|cv|c v|sociedad anonima|inc|llc|corp))+$/g, '')
    .trim()
}

/** La identificación efectiva de un proveedor: NIT, o RFC si no hay NIT. */
export function identificacionDe(p: Pick<ProveedorCatalogo, 'nit' | 'rfc'>): string | null {
  const nit = (p.nit ?? '').trim()
  const rfc = (p.rfc ?? '').trim()
  return normalizarIdentificacion(nit !== '' ? nit : rfc)
}

/**
 * ¿Chocaría con otro proveedor ya registrado? Misma regla de la guarda del
 * servidor: igual identificación normalizada y país igual **o desconocido**.
 * Devuelve el proveedor con el que choca, o null.
 */
export function buscarDuplicadoFiscal(
  candidato: { nit?: string | null; rfc?: string | null; pais?: string | null },
  existentes: readonly ProveedorCatalogo[],
  ignorarId?: string | null,
): ProveedorCatalogo | null {
  const norm = identificacionDe({ nit: candidato.nit ?? null, rfc: candidato.rfc ?? null })
  if (!norm) return null
  const pais = (candidato.pais ?? '').trim().toUpperCase() || null
  return (
    existentes.find(
      (p) =>
        p.id !== ignorarId &&
        identificacionDe(p) === norm &&
        (p.pais == null || pais == null || p.pais === pais),
    ) ?? null
  )
}

// ── Habilitación por proyecto ───────────────────────────────────────────────

/**
 * ¿Se le puede comprar a este proveedor EN este proyecto, hoy? Espejo de
 * `proveedor_habilitado_en`:
 *   1. autorización general vigente (la misma de la Fase 6);
 *   2. un veto del proyecto (suspendido/retirado) gana aunque el alcance sea de empresa;
 *   3. alcance `empresa` → sí (y sirve a la contabilidad de la empresa);
 *   4. alcance `proyectos` → exige un vínculo HABILITADO y vigente en ese
 *      proyecto; sin proyecto (contabilidad de empresa) no aplica.
 */
export function proveedorHabilitadoEn(
  proveedor: ProveedorCatalogo,
  asignaciones: readonly ProveedorProyecto[],
  projectId: string | null,
  hoy: string,
): boolean {
  if (!proveedorHabilitado(proveedor, hoy)) return false

  const vinculo = projectId
    ? asignaciones.find((a) => a.proveedor_id === proveedor.id && a.project_id === projectId)
    : undefined

  if (vinculo && (vinculo.estado === 'suspendido' || vinculo.estado === 'retirado')) return false
  if ((proveedor.alcance ?? 'empresa') === 'empresa') return true
  if (!vinculo) return false
  return vinculo.estado === 'habilitado' && (vinculo.vigente_hasta == null || vinculo.vigente_hasta >= hoy)
}

/** Por qué NO se le puede comprar (para mostrarlo al lado del proveedor). */
export function motivoNoHabilitado(
  proveedor: ProveedorCatalogo,
  asignaciones: readonly ProveedorProyecto[],
  projectId: string | null,
  hoy: string,
): string | null {
  if (proveedorHabilitadoEn(proveedor, asignaciones, projectId, hoy)) return null
  if (!proveedorHabilitado(proveedor, hoy)) {
    const estado = proveedor.estado ?? 'borrador'
    if (estado === 'autorizado') return 'Su autorización venció'
    return `No autorizado (${estado})`
  }
  const vinculo = projectId
    ? asignaciones.find((a) => a.proveedor_id === proveedor.id && a.project_id === projectId)
    : undefined
  if (vinculo && (vinculo.estado === 'suspendido' || vinculo.estado === 'retirado')) {
    return `${vinculo.estado === 'suspendido' ? 'Suspendido' : 'Retirado'} en este proyecto`
  }
  if (projectId == null) return 'Solo opera en proyectos habilitados, no en la contabilidad de la empresa'
  if (!vinculo) return 'No está vinculado a este proyecto'
  const estado: EstadoHabilitacionProyecto = vinculo.estado
  if (estado === 'pendiente') return 'Habilitación pendiente en este proyecto'
  return 'Su habilitación en este proyecto venció'
}

// ── Búsqueda ────────────────────────────────────────────────────────────────

/**
 * Busca por nombre, código o identificación fiscal. Las identificaciones se
 * comparan normalizadas («1234567-8» encuentra «12345678»), y el nombre sin
 * acentos ni mayúsculas. NO es una unión por parecido: solo filtra una lista.
 */
export function buscarProveedores<T extends ProveedorCatalogo>(lista: readonly T[], texto: string): T[] {
  const t = texto.trim()
  if (t === '') return [...lista]
  const nombre = normalizarNombre(t)
  const ident = normalizarIdentificacion(t)
  const codigo = t.toLowerCase()
  return lista.filter((p) => {
    if (nombre !== '' && normalizarNombre(p.nombre).includes(nombre)) return true
    if (p.codigo && p.codigo.toLowerCase().includes(codigo)) return true
    if (ident && (identificacionDe(p) ?? '').includes(ident)) return true
    return false
  })
}

/** «PRV-00012 · Ferretería La Unión» — la misma etiqueta en toda la aplicación. */
export function etiquetaProveedor(p: Pick<ProveedorCatalogo, 'nombre' | 'codigo'>): string {
  return p.codigo ? `${p.codigo} · ${p.nombre}` : p.nombre
}
