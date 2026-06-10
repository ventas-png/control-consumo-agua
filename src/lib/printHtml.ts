// printHtml — plantilla etiquetada para construir HTML de ventanas de impresión
// (window.open('', '_blank') + document.write) de forma segura.
//
// Por qué: varias vistas de impresión interpolaban datos de BD CRUDOS en un
// document.write sobre una ventana about:blank, que hereda el origen de la app.
// Eso es XSS almacenado: un nombre/observación con `<img src=x onerror=...>`
// ejecuta JS en el origen de la app (acceso a sessionStorage / token) cuando un
// admin imprime el documento.
//
// Con esta plantilla las partes ESTÁTICAS del literal quedan crudas (es markup
// del autor) y cada ${valor} interpolado se ESCAPA por defecto. Para fragmentos
// que ya son HTML seguro (p. ej. filas construidas a su vez con printHtml) se
// usa raw() como escape-hatch explícito y auditable.
//
//   const filas = items.map(i => printHtml`<tr><td>${i.nombre}</td></tr>`).join('')
//   const doc = printHtml`<h1>${titulo}</h1><table>${raw(filas)}</table>`

/** Escapa una cadena para interpolarla como texto/atributo en HTML. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Valida un URL para usarlo en href/src dentro del HTML de impresión.
 * Solo permite http(s), mailto, tel, rutas relativas y anclas; cualquier otro
 * esquema (javascript:, data:, …) se neutraliza a '#'. El resultado va escapado.
 */
export function safeUrl(value: unknown): string {
  const t = String(value ?? '').trim()
  return escapeHtml(/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(t) ? t : '#')
}

const RAW = Symbol('printHtml.raw')
interface RawHtml { readonly [RAW]: true; readonly value: string }

/** Marca una cadena como HTML ya seguro: no se escapará al interpolarla. */
export function raw(value: string): RawHtml {
  return { [RAW]: true, value }
}

function isRaw(v: unknown): v is RawHtml {
  return typeof v === 'object' && v !== null && (v as Record<symbol, unknown>)[RAW] === true
}

/** Tagged template: escapa cada interpolación salvo las envueltas en raw(). */
export function printHtml(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = strings[0]
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    out += (isRaw(v) ? v.value : escapeHtml(v)) + strings[i + 1]
  }
  return out
}
