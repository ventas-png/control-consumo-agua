// Qué se le dice al residente después de confirmar un pago en línea. Sólo se
// habla de abono cuando confirm-charge informó que el cobro quedó ACREDITADO
// (`estado === 'aprobado'`, que confirmarPago sólo devuelve con
// `conciliado: true`). Un cobro retenido (cuota anulada o eliminada) o
// reembolsado nunca se presenta como acreditado, y un saldo que no vino en la
// respuesta no se muestra como 0.
import type { ConfirmarPagoResult } from './mutations'

export interface AvisoPago {
  variant: 'success' | 'info' | 'warning'
  title: string
  text: string
}

export function avisoConfirmacionPago(
  conf: Pick<ConfirmarPagoResult, 'estado' | 'liquidado' | 'saldoRestante'>,
  opciones: { moneda: string; tituloPagado: string; textoAlDia: string },
): AvisoPago {
  if (conf.estado === 'aprobado') {
    if (conf.liquidado) return { variant: 'success', title: opciones.tituloPagado, text: opciones.textoAlDia }
    return {
      variant: 'success',
      title: 'Abono registrado',
      text: typeof conf.saldoRestante === 'number'
        ? `Abono aplicado. Saldo restante: ${opciones.moneda} ${conf.saldoRestante.toFixed(2)}`
        : 'Abono aplicado.',
    }
  }
  if (conf.estado === 'en_revision') {
    return {
      variant: 'warning',
      title: 'Pago en revisión',
      text: 'El procesador confirmó tu pago, pero el documento ya no admite cobros. No se aplicó a tu saldo: administración lo revisará y te contactará.',
    }
  }
  if (conf.estado === 'reembolsado') {
    return { variant: 'info', title: 'Pago reembolsado', text: 'El procesador devolvió este pago; no se aplicó a tu saldo.' }
  }
  return { variant: 'info', title: 'Pago en proceso', text: 'Se reflejará cuando el procesador lo confirme.' }
}
