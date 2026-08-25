// domain/condominios/evidencia.ts — ¿la evidencia alcanza para cerrar?
//
// QUÉ ES ESTO Y QUÉ NO ES.
// Esto NO es la garantía. La garantía es `trg_exigir_evidencia`
// (20260905000400), que rechaza en la base el paso a 'completada' sin la
// evidencia declarada. Esta función existe para que quien ejecuta sepa QUÉ le
// falta ANTES del viaje de ida y vuelta, con un mensaje escrito para una
// persona en vez de un error de Postgres.
//
// POR QUÉ IMPORTA LA DISTINCIÓN. `tareas_bloque.requiere_foto` existe desde
// 20260424000060 y estuvo hasta 20260905000400 sin exigirse en ninguna parte:
// era un badge en la tarjeta. Esa es la historia de lo que pasa cuando la
// pantalla es la única que valida. Si algún día esta función y el trigger
// discrepan, el que manda es el trigger — y el guard estático de
// `evidenciaAlCerrar` vigila que las reglas no se separen.
//
// SIRVE A LOS DOS MOTORES. Limpieza (`ejecuciones_limpieza`, que sólo exige
// foto) y Tareas de personal (`tareas_bloque`, que exige foto, comentario y
// checklist) comparten la misma idea; tener dos implementaciones sería tener
// dos maneras de estar en desacuerdo con la base.

/** Lo que la tarea/área EXIGE. Todos opcionales: lo no declarado no se exige. */
export interface RequisitosEvidencia {
  requiere_foto?: boolean | null
  requiere_comentario?: boolean | null
  requiere_checklist?: boolean | null
  /** Definición de pasos (snapshot). Su longitud define qué es «completo». */
  checklist?: string[] | null
}

/** Lo que quien ejecuta APORTÓ. */
export interface EvidenciaAportada {
  foto_urls?: string[] | null
  evidencia_texto?: string | null
  /** Posiciones (0-based) de `checklist` ya marcadas. */
  checklist_completado?: number[] | null
  /** Excepción declarada: si trae texto, se permite cerrar y queda por escrito. */
  motivo_sin_evidencia?: string | null
}

export type ResultadoEvidencia =
  | { ok: true }
  | { ok: false; motivo: string; falta: 'foto' | 'comentario' | 'checklist' }

/**
 * Espeja `exigir_evidencia_al_cerrar()` en el mismo orden y con la misma salida
 * de emergencia. Sólo aplica al cierre por 'completada': `con_observacion` y
 * `omitida` no pasan por aquí, igual que no pasan por el trigger — exigirle la
 * evidencia completa a quien está reportando un problema empuja a cerrar en
 * falso.
 */
export function evidenciaSuficiente(
  req: RequisitosEvidencia,
  aportada: EvidenciaAportada,
): ResultadoEvidencia {
  // Excepción declarada primero, como en el trigger.
  if ((aportada.motivo_sin_evidencia ?? '').trim() !== '') return { ok: true }

  if (req.requiere_foto && (aportada.foto_urls?.length ?? 0) === 0) {
    return {
      ok: false,
      falta: 'foto',
      motivo: 'Esta tarea requiere al menos una foto para cerrarse.',
    }
  }

  if (req.requiere_comentario && (aportada.evidencia_texto ?? '').trim() === '') {
    return {
      ok: false,
      falta: 'comentario',
      motivo: 'Esta tarea requiere un comentario de quien la ejecuta.',
    }
  }

  const pasos = req.checklist?.length ?? 0
  if (req.requiere_checklist && pasos > 0) {
    const hechos = new Set(aportada.checklist_completado ?? [])
    const faltan = pasos - [...Array(pasos).keys()].filter(i => hechos.has(i)).length
    if (faltan > 0) {
      return {
        ok: false,
        falta: 'checklist',
        motivo: `Falta${faltan !== 1 ? 'n' : ''} ${faltan} paso${faltan !== 1 ? 's' : ''} del checklist.`,
      }
    }
  }

  return { ok: true }
}

/**
 * ¿El error que devolvió la base viene del gate de evidencia? El trigger marca
 * sus mensajes con `EVIDENCIA:` (misma convención que `PLANTILLA_RECURSO:` de
 * 20260904000200), para poder distinguirlo de cualquier otro check_violation y
 * traducirlo en vez de mostrar el texto crudo de Postgres.
 */
export function esErrorDeEvidencia(mensaje: string | undefined): boolean {
  return (mensaje ?? '').includes('EVIDENCIA:')
}
