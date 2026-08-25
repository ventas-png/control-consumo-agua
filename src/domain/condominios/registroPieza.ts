// domain/condominios/registroPieza.ts — Guardar una pieza de recepción una sola vez.
//
// POR QUÉ EXISTE. Las dos pestañas hacían:
//
//     setSaving(true)
//     const { data, error } = await crear(...)
//     setSaving(false)                 // ← el botón vuelve a estar vivo aquí
//     if (data?.id) await avisarConReintento(data.id)   // ← y esto tarda
//     resetForm()
//
// `avisarConReintento` puede tardar segundos (tres intentos con backoff) y, si
// no salió el aviso, abre un diálogo y ESPERA a que el operador conteste. Todo
// ese rato el formulario sigue en pantalla, con sus datos, y el botón Guardar
// habilitado. Un segundo clic —o el primero repetido por impaciencia— inserta
// una segunda pieza idéntica. En correspondencia eso significa dos citaciones
// judiciales donde llegó una.
//
// Aquí el guardado queda serializado por un cerrojo en memoria (no por estado
// de React, que se aplica de forma asíncrona y llega tarde al segundo clic del
// mismo tick) y el formulario se cierra EN CUANTO el INSERT está confirmado,
// antes de empezar a avisar. Reintentar el aviso ya no puede repetir el INSERT
// porque el reintento vive dentro de `avisar`, después de que el registro está
// hecho y el cerrojo sigue echado.

/** Cómo terminó un intento de registro. */
export type ResultadoRegistro =
  /** Se insertó (y, si tocaba, se intentó el aviso). */
  | { estado: 'guardado'; id: string }
  /** El INSERT falló; ya se llamó a `onError`. */
  | { estado: 'error'; mensaje: string }
  /** Había otro guardado en vuelo: ESTE NO INSERTÓ NADA. */
  | { estado: 'ocupado' }

export interface RegistroPiezaDeps {
  /** Inserta la fila. Devuelve el id creado o el mensaje de error. */
  crear: () => Promise<{ id: string | null; error: string | null }>
  /**
   * Limpia y cierra el formulario. Se invoca en cuanto el INSERT está
   * confirmado y ANTES de avisar: lo que ya está en la base no debe seguir
   * ofreciéndose para volver a guardarse.
   */
  cerrar: () => void
  /**
   * Avisa al residente. Opcional: si la pieza no lleva aviso (una salida, o
   * correspondencia dirigida a la administración) se omite y se llama a
   * `onSinAviso`. Puede tardar y puede abrir diálogos; da igual, el formulario
   * ya no está.
   */
  avisar?: (id: string) => Promise<unknown>
  /** Mensaje de confirmación cuando no había a quién avisar. */
  onSinAviso?: (id: string) => void
  onError: (mensaje: string) => void
}

/**
 * Crea un registrador con su propio cerrojo. Uno por formulario (en React:
 * `useRef(crearRegistrador()).current`, para que sobreviva a los re-renders).
 */
export function crearRegistrador(): (deps: RegistroPiezaDeps) => Promise<ResultadoRegistro> {
  let enVuelo = false

  return async function registrar(deps: RegistroPiezaDeps): Promise<ResultadoRegistro> {
    if (enVuelo) return { estado: 'ocupado' }
    enVuelo = true
    try {
      const { id, error } = await deps.crear()
      if (error || !id) {
        const mensaje = error ?? 'No se pudo registrar la pieza.'
        deps.onError(mensaje)
        return { estado: 'error', mensaje }
      }

      // Confirmado: fuera el formulario antes de nada más.
      deps.cerrar()

      if (deps.avisar) await deps.avisar(id)
      else deps.onSinAviso?.(id)

      return { estado: 'guardado', id }
    } finally {
      enVuelo = false
    }
  }
}
