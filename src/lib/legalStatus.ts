// plat:P33 — Helpers PUROS para resumir el estado legal del usuario (cuánto falta
// por aceptar). Operan sobre la forma mínima `{ accepted }` para no acoplarse a la
// capa de dominio. Testeable sin red ni DOM.

export interface ResumenLegal {
  total: number
  aceptados: number
  pendientes: number
  /** true solo si HAY documentos y TODOS están aceptados. */
  todoAceptado: boolean
}

export function resumirEstadoLegal(docs: ReadonlyArray<{ accepted: boolean }>): ResumenLegal {
  const total = docs.length
  const aceptados = docs.reduce((n, d) => (d.accepted ? n + 1 : n), 0)
  const pendientes = total - aceptados
  return { total, aceptados, pendientes, todoAceptado: total > 0 && pendientes === 0 }
}

/** ¿Queda algún documento legal vigente sin aceptar? */
export function hayPendientesLegal(docs: ReadonlyArray<{ accepted: boolean }>): boolean {
  return docs.some(d => !d.accepted)
}
