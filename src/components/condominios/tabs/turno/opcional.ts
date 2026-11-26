// La marca «Opcional» de una tarea (20261226000100): la misma en la tarjeta de
// la ejecución guiada, en la lista de la parada y en la lista del turno.
import type { CSSProperties } from 'react'

/** Lo que significa «Opcional» para quien ejecuta (title del chip). */
export const AYUDA_OPCIONAL =
  'Opcional: si no se hace, no queda pendiente ni baja el puntaje del turno; si se hace, suma.'

export const chipOpcional: CSSProperties = {
  fontSize: '11.5px', fontWeight: 700, padding: '1px 8px', borderRadius: '99px',
  background: 'var(--at-chip)', color: 'var(--at-ink-2)',
}
