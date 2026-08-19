// Aviso al residente tras registrar una pieza en recepción, contando la verdad.
//
// POR QUÉ EXISTE: las dos pestañas hacían
//   try { await notificarPieza(id) } catch { /* best-effort */ }
//   notify({ variant: 'success', text: 'Se avisó al residente.' })
// y esa combinación miente dos veces. Si la edge function respondía 500 tras
// los reintentos, el catch se tragaba el error; si respondía 200 pero el
// residente no tenía correo, ni teléfono, ni usuario de app, la respuesta traía
// notified=0/emailed=0 y aun así la pantalla decía que se le había avisado.
// Quien registra el paquete se va convencido de que el vecino ya sabe.
//
// Aquí el resultado real decide el mensaje, y cuando no salió nada se ofrece
// reintentar — el registro ya está guardado, así que reintentar es solo el aviso.
import { confirm, notify } from '../shared/Dialog'
import { intentarAvisar, type ResultadoAviso } from '../../lib/paquetesNotify'

/** Resumen legible de por dónde salió el aviso ("app, correo"). */
function canales(r: ResultadoAviso): string {
  if (r.estado === 'fallo') return ''
  const partes: string[] = []
  if ((r.detalle.notified ?? 0) > 0) partes.push('app')
  if ((r.detalle.emailed ?? 0) > 0) partes.push('correo')
  if (r.detalle.whatsapp === 'sent') partes.push('WhatsApp')
  return partes.join(', ')
}

/** Por qué no salió nada, en términos que el operador pueda accionar. */
function motivo(r: ResultadoAviso): string {
  if (r.estado === 'fallo') return r.error.message
  if (r.detalle.skipped === 'no_cliente') return 'la unidad no tiene un residente registrado'
  // El servidor rechaza avisar de una salida aunque se le pida (notify-package);
  // la pestaña ya no lo intenta, pero si algo lo intentara, esto lo explica.
  if (r.detalle.skipped === 'pieza_saliente') return 'la pieza es una salida y no se avisa al residente'
  if (r.detalle.whatsapp === 'error') return 'los canales configurados fallaron'
  return 'el residente no tiene correo, teléfono ni usuario del portal'
}

/**
 * Avisa al residente y refleja el resultado. Si no se entregó nada, ofrece
 * reintentar tantas veces como el operador quiera; al desistir, deja constancia
 * con una advertencia (no un éxito).
 *
 * Devuelve el último resultado por si el llamador quiere hacer algo más con él.
 */
export async function avisarConReintento(paqueteId: string): Promise<ResultadoAviso> {
  for (;;) {
    const r = await intentarAvisar(paqueteId)

    if (r.estado === 'entregado') {
      const vias = canales(r)
      notify({
        variant: 'success', title: 'Registrado', duration: 2200,
        text: vias ? `Se avisó al residente por ${vias}.` : 'Se avisó al residente.',
      })
      return r
    }

    const { isConfirmed } = await confirm({
      title: 'El registro se guardó, pero el aviso no salió',
      text: `No se pudo avisar al residente: ${motivo(r)}. Puedes reintentar el aviso; la pieza ya quedó registrada.`,
      confirmText: 'Reintentar aviso',
      cancelText: 'Continuar sin avisar',
      icon: 'warning',
    })
    if (!isConfirmed) {
      notify({
        variant: 'warning', title: 'Registrado sin aviso', duration: 3200,
        text: 'La pieza quedó registrada, pero el residente NO fue notificado.',
      })
      return r
    }
  }
}
