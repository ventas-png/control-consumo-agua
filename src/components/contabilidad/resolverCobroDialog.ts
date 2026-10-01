// Formulario para SOLICITAR la resolución manual de un cobro en línea sin
// confirmar (E8, 20261019000000): qué hizo el proveedor y por qué. No cambia
// nada: se adjunta el respaldo (captura del panel del proveedor) y otra
// persona con permiso de autorizar la aprueba.
import { openPromptDialog } from '../shared/PromptDialog'
import { solicitarResolucionCobro, type ResultadoSolicitud } from '../../domain/contabilidad/ajustes'

export async function pedirResolucionCobro(pr: { id: string; monto: number | null }): Promise<ResultadoSolicitud | null> {
  const datos = await openPromptDialog({
    title: 'Solicitar resolución de un cobro sin confirmar',
    description: `Cobro en línea${pr.monto != null ? ` de ${Number(pr.monto).toFixed(2)}` : ''}. Consulta primero el panel del proveedor: «cobrado» lo acredita como un aviso del proveedor; «no cobrado» lo cierra sin acreditar. Debes adjuntar el respaldo (captura del panel) antes de que otra persona lo apruebe.`,
    fields: [
      {
        name: 'resolucion', label: 'Qué hizo el proveedor', control: 'select', initialValue: 'cobrado',
        options: [{ value: 'cobrado', label: 'Sí cobró' }, { value: 'no_cobrado', label: 'No cobró' }],
      },
      { name: 'motivo', label: 'Motivo / evidencia consultada', control: 'textarea', rows: 3, required: true, autoFocus: true },
    ],
    submitText: 'Solicitar resolución',
    validate: (d) => ((d.motivo ?? '').trim().length < 5 ? 'Indica el motivo (al menos 5 caracteres).' : null),
  })
  if (!datos) return null
  return solicitarResolucionCobro({
    clave: crypto.randomUUID(),
    paymentRequestId: pr.id,
    resolucion: datos.resolucion === 'no_cobrado' ? 'no_cobrado' : 'cobrado',
    motivo: datos.motivo.trim(),
  })
}
