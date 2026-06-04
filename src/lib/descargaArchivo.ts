// plat:P35 — Utilidades para descargar el export de datos del titular.
// `nombreArchivoExport` es PURO (testeable); `descargarJson` toca el DOM.

/** Nombre del archivo de export: mis-datos-administratodo-YYYY-MM-DD.json (UTC). */
export function nombreArchivoExport(fecha: Date = new Date()): string {
  const d = Number.isNaN(fecha.getTime()) ? new Date() : fecha
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `mis-datos-administratodo-${yyyy}-${mm}-${dd}.json`
}

/** Dispara la descarga de `data` como JSON con el nombre dado. Requiere DOM. */
export function descargarJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
