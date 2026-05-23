import { useState } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../../lib/supabase'
import { buildUploadPath } from '../../../lib/fileValidation'
import { SecureImage } from '../../shared/SecureImage'
import { EditModal } from '../../shared/EditModal'
import { SignaturePad } from '../../shared/SignaturePad'
import type { PaqueteRecibido, EstadoPaquete, TipoPaquete } from '../../../types'

interface Props {
  paquetes: PaqueteRecibido[]
  nombrePrefill?: string
  onRefresh: () => void
}

const ESTADO_CONFIG: Record<EstadoPaquete, { label: string; bg: string; color: string; icon: string }> = {
  pendiente: { label: 'Pendiente de retiro', bg: 'var(--at-primary-tint)', color: 'var(--at-primary)', icon: '📦' },
  entregado: { label: 'Recibido', bg: 'var(--at-success-tint)', color: 'var(--at-success)', icon: '✅' },
  devuelto:  { label: 'Devuelto', bg: 'var(--at-danger-tint)', color: 'var(--at-danger)', icon: '↩️' },
}

const TIPO_CONFIG: Record<TipoPaquete, { label: string; icon: string }> = {
  paquete:   { label: 'Paquete',   icon: '📦' },
  documento: { label: 'Documento', icon: '📄' },
  sobre:     { label: 'Sobre',     icon: '✉️' },
  otro:      { label: 'Otro',      icon: '🎁' },
}

export function PortalPaquetesTab({ paquetes, nombrePrefill = '', onRefresh }: Props) {
  const [firmando, setFirmando] = useState<PaqueteRecibido | null>(null)
  const [nombre, setNombre] = useState(nombrePrefill)
  const [saving, setSaving] = useState(false)

  // Pendientes primero, luego el resto por fecha de recepción descendente.
  const ordenados = [...paquetes].sort((a, b) => {
    if (a.estado === 'pendiente' && b.estado !== 'pendiente') return -1
    if (b.estado === 'pendiente' && a.estado !== 'pendiente') return 1
    return new Date(b.hora_recepcion).getTime() - new Date(a.hora_recepcion).getTime()
  })
  const pendientes = paquetes.filter(p => p.estado === 'pendiente').length

  function abrirFirma(p: PaqueteRecibido) {
    setFirmando(p)
    setNombre(nombrePrefill)
  }

  async function handleFirma(file: File) {
    if (!firmando) return
    setSaving(true)
    try {
      const path = buildUploadPath('paquetes-firmas', 'firma.png', 'png')
      const { error: upErr } = await supabase.storage.from('condominios-media').upload(path, file, { contentType: 'image/png', upsert: false })
      if (upErr) { Swal.fire('Error', upErr.message, 'error'); return }
      const { error } = await supabase.rpc('paquete_firmar_recepcion', {
        p_paquete_id: firmando.id, p_firma_path: path, p_nombre: nombre.trim(),
      })
      if (error) { Swal.fire('Error', error.message, 'error'); return }
      setFirmando(null)
      Swal.fire({ icon: 'success', title: 'Recepción firmada', text: 'Gracias, registramos tu firma.', timer: 1600, showConfirmButton: false })
      onRefresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div style={{ marginBottom: '18px' }}>
        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--at-ink)' }}>Paquetería</h2>
        <p style={{ margin: '4px 0 0', color: 'var(--at-ink-3)', fontSize: '13.5px' }}>
          {pendientes > 0
            ? <>Tienes <strong style={{ color: 'var(--at-primary)' }}>{pendientes}</strong> {pendientes === 1 ? 'envío pendiente de retiro' : 'envíos pendientes de retiro'}.</>
            : 'No tienes envíos pendientes de retiro.'}
        </p>
      </div>

      {ordenados.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '48px', marginBottom: '14px' }}>📦</div>
          <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '6px' }}>Sin paquetes</div>
          <div style={{ fontSize: '13px' }}>Cuando portería reciba un envío para tu unidad, aparecerá aquí.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {ordenados.map(p => {
            const cfg = ESTADO_CONFIG[p.estado]
            const tcfg = TIPO_CONFIG[p.tipo] ?? TIPO_CONFIG.paquete
            const pendiente = p.estado === 'pendiente'
            return (
              <div key={p.id} style={{ background: 'var(--at-surface)', border: `1.5px solid ${pendiente ? 'var(--at-primary-soft-2)' : 'var(--at-line)'}`, borderRadius: '14px', padding: '16px', display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
                {p.fotos && p.fotos.length > 0 ? (
                  <SecureImage src={p.fotos[0]} alt="" style={{ width: '64px', height: '64px', objectFit: 'cover', borderRadius: '10px', flexShrink: 0, border: '1px solid var(--at-line)' }} />
                ) : (
                  <div style={{ fontSize: '34px', flexShrink: 0, width: '64px', textAlign: 'center' }}>{tcfg.icon}</div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: '14.5px', color: 'var(--at-ink)' }}>{p.descripcion}</span>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', background: 'var(--at-chip)', borderRadius: '20px', padding: '2px 9px' }}>{tcfg.icon} {tcfg.label}</span>
                    <span style={{ padding: '2px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                  </div>
                  <div style={{ fontSize: '12.5px', color: 'var(--at-ink-3)', display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '5px' }}>
                    {p.remitente && <span>De: {p.remitente}</span>}
                    {p.empresa_mensajeria && <span>· {p.empresa_mensajeria}</span>}
                    {p.num_guia && <span>· #{p.num_guia}</span>}
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', marginTop: '4px' }}>
                    Recibido en portería: {new Date(p.hora_recepcion).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    {p.hora_entrega && ` · Retirado: ${new Date(p.hora_entrega).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
                  </div>

                  {/* Galería de fotos adicionales */}
                  {p.fotos && p.fotos.length > 1 && (
                    <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
                      {p.fotos.slice(1).map((f, i) => (
                        <SecureImage key={i} src={f} alt="" style={{ width: '48px', height: '48px', objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--at-line)' }} />
                      ))}
                    </div>
                  )}

                  {pendiente ? (
                    <button onClick={() => abrirFirma(p)} style={{ marginTop: '12px', padding: '9px 18px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '9px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
                      ✍ Firmar recepción
                    </button>
                  ) : p.estado === 'entregado' && (p.entregado_a_nombre || p.firma_path) ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px' }}>
                      {p.firma_path && <SecureImage src={p.firma_path} alt="firma" style={{ width: '70px', height: '38px', objectFit: 'contain', background: '#fff', borderRadius: '6px', border: '1px solid var(--at-line)' }} />}
                      <span style={{ fontSize: '12px', color: 'var(--at-success)', fontWeight: 600 }}>
                        Firmado{p.entregado_a_nombre ? ` por ${p.entregado_a_nombre}` : ''}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {firmando && (
        <EditModal
          title="Firmar recepción"
          onClose={() => { if (!saving) setFirmando(null) }}
          maxWidth="460px"
        >
          <div style={{ marginBottom: '14px' }}>
            <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--at-ink)' }}>{firmando.descripcion}</div>
            <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>Confirma que recibiste este envío firmando abajo.</div>
          </div>
          <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Tu nombre</label>
          <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre y apellido"
            style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)', marginBottom: '14px' }} />
          <SignaturePad onSave={handleFirma} onCancel={() => setFirmando(null)} saving={saving} saveLabel="Confirmar recepción" />
        </EditModal>
      )}
    </div>
  )
}
