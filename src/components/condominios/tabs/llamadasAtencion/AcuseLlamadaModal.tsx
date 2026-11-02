import { useState, type CSSProperties } from 'react'
import { EditModal } from '../../../shared/EditModal'
import { Button } from '../../../shared/Button'
import { SignaturePad } from '../../../shared/SignaturePad'
import { notify } from '../../../shared/Dialog'
import { acusarLlamadaAtencion, nombreAcuseValido, subirFirmaLlamada } from '../../../../domain/condominios/llamadasAtencion'
import { CartaLlamada } from './CartaLlamada'
import type { CartaParaPdf } from './llamadasAtencionPdf'

interface Props {
  carta: CartaParaPdf & { id: string; project_id: string }
  proyectoNombre?: string | null
  /** usuario = el empleado firma desde su cuenta; presencial = firma en el dispositivo de RRHH. */
  modo: 'usuario' | 'presencial'
  onClose: () => void
  onAcusado: () => void
}

const inp: CSSProperties = { width: '100%', padding: '9px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', fontFamily: 'inherit', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }

/**
 * Leer la carta y firmar de recibido. La firma se sube ANTES de llamar a la RPC
 * (que comprueba que exista bajo <project>/<carta>/); si la RPC la rechaza, el
 * objeto queda huérfano y no prueba nada. La hora la pone el servidor.
 */
export function AcuseLlamadaModal({ carta, proyectoNombre, modo, onClose, onAcusado }: Props) {
  const [nombre, setNombre] = useState(carta.empleado_nombre)
  const [saving, setSaving] = useState(false)

  async function firmar(firma: File) {
    if (!nombreAcuseValido(nombre)) {
      notify({ variant: 'warning', title: 'Falta el nombre', text: 'Escribí el nombre completo de quien recibe la carta.' }); return
    }
    setSaving(true)
    try {
      const { path, error: upErr } = await subirFirmaLlamada(carta.project_id, carta.id, firma, 'acuse')
      if (!path) { notify({ variant: 'error', title: 'No se subió la firma', text: upErr ?? 'Intentá de nuevo.' }); return }
      const { error } = await acusarLlamadaAtencion(carta.id, nombre, path)
      if (error) { notify({ variant: 'error', title: 'No se registró el acuse', text: error.message }); return }
      notify({ variant: 'success', title: 'Acuse registrado', text: `${nombre.trim()} firmó de recibido.`, duration: 2500 })
      onAcusado()
    } finally { setSaving(false) }
  }

  return (
    <EditModal
      title={modo === 'usuario' ? 'Leer y firmar de recibido' : 'Registrar acuse en persona'}
      subtitle={modo === 'usuario'
        ? 'Firmar de recibido deja constancia de que leíste la carta; no significa que estés de acuerdo con su contenido.'
        : 'El empleado lee la carta en este dispositivo, escribe su nombre y firma. Queda registrado con tu usuario, la fecha y la hora.'}
      maxWidth="720px"
      fullScreenOnMobile
      closeOnBackdropClick={!saving}
      closeOnEscape={!saving}
      onClose={() => { if (!saving) onClose() }}
      footer={<Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>}
    >
      <CartaLlamada carta={carta} proyectoNombre={proyectoNombre} sinFirmas />
      <div style={{ marginTop: '16px' }}>
        <label htmlFor="acuse-nombre" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '4px' }}>Recibí: nombre completo *</label>
        <input id="acuse-nombre" style={inp} value={nombre} onChange={e => setNombre(e.target.value)} disabled={saving} />
      </div>
      <div style={{ marginTop: '12px', fontSize: '12px', color: 'var(--at-ink-3)', marginBottom: '6px' }}>Firma de recibido *</div>
      <SignaturePad onSave={firmar} saving={saving} saveLabel={saving ? 'Registrando…' : 'Firmar de recibido'} />
    </EditModal>
  )
}
