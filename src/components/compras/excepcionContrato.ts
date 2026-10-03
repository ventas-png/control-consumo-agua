// Excepción de contrato al aprobar o emitir una orden.
//
// Cuando una orden está amparada en un contrato que ya no está vigente (o que rebasaría su monto máximo), el
// servidor rechaza aprobar y emitir con COMPRAS_CONTRATO_NO_VIGENTE. Quien tiene el permiso de cambio de estado
// de Contabilidad puede AUTORIZAR una excepción: con motivo, a su nombre y en el historial de la orden (y, si la
// empresa separa solicitante y aprobador, no quien solicitó la orden). La excepción cubre UNA etapa y UNA revisión
// de la orden. Esta pantalla solo ofrece el camino; la regla la hace cumplir el servidor.
import {
  ejecutarConExcepcionContrato,
  useExcepcionContratoMutation,
} from '../../domain/proveedores/contratosCompras'
import type { EtapaExcepcionContrato } from '../../types/proveedores'
import { openPromptDialog } from '../shared/PromptDialog'

export async function pedirMotivoExcepcion(etapa: EtapaExcepcionContrato, mensajeServidor: string): Promise<string | null> {
  const r = await openPromptDialog({
    title: etapa === 'aprobar' ? 'Excepción para aprobar la orden' : 'Excepción para emitir la orden',
    description:
      `${mensajeServidor}\n\nAutorizar una excepción queda registrado a tu nombre, con el motivo, en el historial de la orden. ` +
      'No cambia el contrato ni cubre otra etapa: emitir pide su propia autorización.',
    fields: [{ name: 'motivo', label: 'Motivo de la excepción', control: 'textarea', required: true, rows: 3 }],
    submitText: 'Autorizar excepción',
    validate: (d) => ((d.motivo ?? '').trim().length >= 10 ? null : 'Escribe el motivo (al menos 10 caracteres)'),
  })
  return r ? r.motivo.trim() : null
}

/**
 * Devuelve una función que ejecuta la transición de una orden (aprobar / emitir) y, si el servidor la rechaza por
 * el contrato y la persona puede autorizar, ofrece la excepción y reintenta. Sin permiso, el rechazo se relanza
 * tal cual para mostrarlo.
 */
export function useTransicionOrdenConContrato(puedeAutorizar: boolean) {
  const excepcion = useExcepcionContratoMutation()
  return (v: { ordenId: string; etapa: EtapaExcepcionContrato; ejecutar: () => Promise<unknown> }) =>
    ejecutarConExcepcionContrato({
      ordenId: v.ordenId,
      etapa: v.etapa,
      puedeAutorizar,
      ejecutar: v.ejecutar,
      pedirMotivo: (mensaje) => pedirMotivoExcepcion(v.etapa, mensaje),
      autorizar: (a) => excepcion.mutateAsync(a),
    })
}
