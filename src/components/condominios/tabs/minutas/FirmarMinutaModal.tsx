// Ventana de firma de un participante: quién firma, lo que acepta (los puntos
// con sus acuerdos y compromisos), la declaración que tiene que marcar y el
// recuadro de firma. La usan el paso 4 del asistente y el detalle (para quien
// firma después). Subir la firma y guardarla lo decide quien la abre.
import { useId, useState } from 'react'
import { EditModal } from '../../../shared/EditModal'
import { SignaturePad } from '../../../shared/SignaturePad'
import type { ParticipanteMinuta, PuntoMinuta } from '../../../../types'
import { ResumenAcuerdos } from './comun'

interface Props {
  participante: ParticipanteMinuta
  tituloMinuta: string
  puntos: readonly PuntoMinuta[]
  participantes: readonly ParticipanteMinuta[]
  guardando: boolean
  onFirmar: (archivo: File) => void
  onClose: () => void
}

export function FirmarMinutaModal({ participante, tituloMinuta, puntos, participantes, guardando, onFirmar, onClose }: Props) {
  const uid = useId()
  const [acepta, setAcepta] = useState(false)
  return (
    <EditModal
      title={`✍ Firma de ${participante.nombre}`}
      subtitle={tituloMinuta}
      size="md"
      fullScreenOnMobile
      onClose={() => { if (!guardando) onClose() }}
      closeOnBackdropClick={!guardando}
      closeOnEscape={!guardando}
    >
      <div className="minuta-panel" style={{ gap: 14 }}>
        <details className="minuta-firma-resumen">
          <summary>Ver los acuerdos y compromisos que se firman</summary>
          <div style={{ marginTop: 10 }}>
            <ResumenAcuerdos puntos={puntos} participantes={participantes} />
          </div>
        </details>
        <label htmlFor={`${uid}-acepta`} className="minuta-acepta">
          <input id={`${uid}-acepta`} type="checkbox" className="minuta-check" checked={acepta} disabled={guardando}
            onChange={e => setAcepta(e.target.checked)} />
          <span>Yo, <strong>{participante.nombre}</strong>, acepto los acuerdos y compromisos descritos en esta minuta.</span>
        </label>
        <div className="minuta-firma-pad">
          <SignaturePad onSave={onFirmar} onCancel={onClose} saving={guardando} saveLabel="Firmar y aceptar" bloquearGuardar={!acepta} height={180} />
          {!acepta && <p style={{ margin: '6px 2px 0', fontSize: 12, color: 'var(--at-ink-3)' }}>Marca la casilla de aceptación para poder firmar.</p>}
        </div>
      </div>
    </EditModal>
  )
}
