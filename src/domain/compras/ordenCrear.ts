// Creación de órdenes de compra — piezas compartidas por Contabilidad (Compras › Nueva orden) y Operaciones
// (Órdenes compra › Nueva OC): la clave de idempotencia de un intento de captura y el texto del error.

/**
 * Una clave por intento de captura (por apertura del formulario): un doble clic, un reintento tras un corte o una
 * respuesta perdida devuelven LA MISMA orden en vez de crear otra. Si la creación falla no queda nada, así que la
 * misma clave sirve para el reintento corregido.
 */
export function nuevaClaveIdempotencia(prefijo = 'oc'): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${prefijo}-${Date.now()}-${Math.random()}`
}

/**
 * Los códigos COMPRAS_* de la base están escritos para leerse tal cual. Una excepción: la clave repetida con otro
 * contenido casi siempre significa que la captura anterior SÍ se guardó (la respuesta se perdió) y se cambió algo
 * antes de reintentar; «la clave ya se usó» no dice qué hacer.
 */
export function mensajeCrearOrden(e: unknown): string {
  const texto = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : ''
  if (texto.includes('COMPRAS_ORDEN_CLAVE_CONFLICTO')) {
    return 'Esta captura ya se guardó como una orden (puede que la respuesta se perdiera). Revisa la lista de órdenes; si necesitas otra distinta, cierra este formulario y crea una nueva.'
  }
  return texto || 'No se pudo crear la orden.'
}
