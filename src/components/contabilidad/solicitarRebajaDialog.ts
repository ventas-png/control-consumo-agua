// Formulario para SOLICITAR una rebaja de importe (E6, 20261017000000): qué
// componente, cuánto y por qué. No cambia nada: la aprobación de otra persona
// registra la nota de crédito. El tope (saldo pendiente) lo aplica el servidor.
import { openPromptDialog } from '../shared/PromptDialog'
import {
  leerImporteRebaja,
  solicitarRebaja,
  type ComponenteRebaja,
  type ResultadoSolicitud,
} from '../../domain/contabilidad/ajustes'

export interface DocumentoRebaja {
  tabla: 'cuotas_condominio' | 'cargos_adicionales_unidad'
  id: string
  concepto: string
  /** Cuota con mora devengada: se puede rebajar el principal o la mora. */
  tieneMora?: boolean
}

export async function pedirRebaja(doc: DocumentoRebaja): Promise<ResultadoSolicitud | null> {
  const opcionesComponente: Array<{ value: ComponenteRebaja; label: string }> = doc.tabla === 'cargos_adicionales_unidad'
    ? [{ value: 'cargo', label: 'Cargo adicional' }]
    : doc.tieneMora
      ? [{ value: 'principal', label: 'Principal de la cuota' }, { value: 'mora', label: 'Mora' }]
      : [{ value: 'principal', label: 'Principal de la cuota' }]
  const datos = await openPromptDialog({
    title: 'Solicitar rebaja de importe',
    description: `${doc.concepto}. Sólo rebajas, hasta el saldo pendiente; no genera saldo a favor. Nada cambia hasta que otra persona con permiso de autorizar la apruebe: entonces se registra una nota de crédito.`,
    fields: [
      { name: 'componente', label: 'Qué se rebaja', control: 'select', initialValue: opcionesComponente[0].value, options: opcionesComponente },
      { name: 'importe', label: 'Importe a rebajar', required: true, autoFocus: true, inputMode: 'decimal' },
      { name: 'motivo', label: 'Motivo', control: 'textarea', rows: 3, required: true },
    ],
    submitText: 'Solicitar rebaja',
    validate: (d) => {
      const imp = leerImporteRebaja(d.importe ?? '')
      if ('error' in imp) return imp.error
      if ((d.motivo ?? '').trim().length < 5) return 'Indica el motivo (al menos 5 caracteres).'
      return null
    },
  })
  if (!datos) return null
  const imp = leerImporteRebaja(datos.importe)
  if ('error' in imp) return null
  return solicitarRebaja({
    clave: crypto.randomUUID(),
    documentoTabla: doc.tabla,
    documentoId: doc.id,
    componente: datos.componente as ComponenteRebaja,
    importe: imp.importe,
    motivo: datos.motivo.trim(),
  })
}
