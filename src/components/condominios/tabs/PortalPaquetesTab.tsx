import { useState } from 'react'
import { notify } from '../../shared/Dialog'
import { firmarRecepcionPaquete, autorizarSalidaPaquete } from '../../../domain/condominios/tabMutations'
import { uploadCondominiosMedia } from '../../../domain/shared/storage'
import { buildUploadPath } from '../../../lib/fileValidation'
import { qrPayloadRetiro } from '../../../lib/paquetes'
import { QRCodeSVG } from 'qrcode.react'
import { MultiImageUploader } from '../../shared/ImageUploader'
import { useMediaScope } from '../../shared/MediaScopeContext'
import { SecureImage } from '../../shared/SecureImage'
import { EditModal } from '../../shared/EditModal'
import { SignaturePad } from '../../shared/SignaturePad'
import type { PaqueteRecibido, EstadoPaquete, TipoPaquete } from '../../../types'

interface Props {
  paquetes: PaqueteRecibido[]
  unidadId: string
  nombrePrefill?: string
  onRefresh: () => void
}

const ESTADO_CONFIG: Record<EstadoPaquete, { label: string; bg: string; color: string }> = {
  pendiente: { label: 'Pendiente de retiro', bg: 'var(--at-primary-tint)', color: 'var(--at-primary)' },
  entregado: { label: 'Recibido', bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  devuelto:  { label: 'Devuelto', bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' },
}

const TIPO_CONFIG: Record<TipoPaquete, { label: string; icon: string }> = {
  paquete:   { label: 'Paquete',   icon: '📦' },
  documento: { label: 'Documento', icon: '📄' },
  sobre:     { label: 'Sobre',     icon: '✉️' },
  otro:      { label: 'Otro',      icon: '🎁' },
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box' as const, padding: '9px 12px',
  border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)',
}
const labelStyle = { fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' } as const

export function PortalPaquetesTab({ paquetes, unidadId, nombrePrefill = '', onRefresh }: Props) {
  const [vista, setVista] = useState<'recibidos' | 'salidas'>('recibidos')
  const projectId = useMediaScope()

  // Firmar recepción (entrantes)
  const [firmando, setFirmando] = useState<PaqueteRecibido | null>(null)
  const [nombre, setNombre] = useState(nombrePrefill)
  const [saving, setSaving] = useState(false)

  // Autorizar salida (retiro por tercero)
  const [showSalForm, setShowSalForm] = useState(false)
  const [salForm, setSalForm] = useState({ tipo: 'paquete' as TipoPaquete, descripcion: '', autorizado_nombre: '', autorizado_documento: '', autorizado_telefono: '', notas: '' })
  const [salFotos, setSalFotos] = useState<string[]>([])
  const [salSaving, setSalSaving] = useState(false)
  const [verCodigo, setVerCodigo] = useState<PaqueteRecibido | null>(null)

  const recibidos = paquetes.filter(p => (p.direccion ?? 'entrante') === 'entrante')
  const salidas   = paquetes.filter(p => p.direccion === 'saliente_tercero')

  const recibidosOrden = [...recibidos].sort((a, b) => {
    if (a.estado === 'pendiente' && b.estado !== 'pendiente') return -1
    if (b.estado === 'pendiente' && a.estado !== 'pendiente') return 1
    return new Date(b.hora_recepcion).getTime() - new Date(a.hora_recepcion).getTime()
  })
  const salidasOrden = [...salidas].sort((a, b) => new Date(b.hora_recepcion).getTime() - new Date(a.hora_recepcion).getTime())
  const pendientes = recibidos.filter(p => p.estado === 'pendiente').length

  function abrirFirma(p: PaqueteRecibido) { setFirmando(p); setNombre(nombrePrefill) }

  async function handleFirma(file: File) {
    if (!firmando) return
    // infra:I14 — scope the signature object by project_id (resident's unit project).
    if (!projectId) { notify({ variant: 'error', title: 'Error', text: 'No se pudo determinar el proyecto. Recargá la página.' }); return }
    setSaving(true)
    try {
      const path = buildUploadPath(`${projectId}/paquetes-firmas`, 'firma.png', 'png')
      const { error: upErr } = await uploadCondominiosMedia(path, file, { contentType: 'image/png', upsert: false })
      if (upErr) { notify({ variant: 'error', title: 'Error', text: upErr }); return }
      const { error } = await firmarRecepcionPaquete(firmando.id, path, nombre.trim())
      if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
      setFirmando(null)
      notify({ variant: 'success', title: 'Recepción firmada', text: 'Gracias, registramos tu firma.', duration: 1600 })
      onRefresh()
    } finally {
      setSaving(false)
    }
  }

  function resetSalForm() {
    setSalForm({ tipo: 'paquete', descripcion: '', autorizado_nombre: '', autorizado_documento: '', autorizado_telefono: '', notas: '' })
    setSalFotos([])
    setShowSalForm(false)
  }

  async function handleAutorizar() {
    if (!salForm.descripcion.trim()) { notify({ variant: 'error', title: 'Error', text: 'Describe el paquete que dejarás.' }); return }
    if (!salForm.autorizado_nombre.trim()) { notify({ variant: 'error', title: 'Error', text: 'Indica a quién autorizas a recogerlo.' }); return }
    setSalSaving(true)
    const { data, error } = await autorizarSalidaPaquete({
      unidadId,
      tipo: salForm.tipo,
      descripcion: salForm.descripcion.trim(),
      autorizadoNombre: salForm.autorizado_nombre.trim(),
      autorizadoDocumento: salForm.autorizado_documento.trim() || null,
      autorizadoTelefono: salForm.autorizado_telefono.trim() || null,
      fotos: salFotos.length ? salFotos : null,
      notas: salForm.notas.trim() || null,
    })
    setSalSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    resetSalForm()
    onRefresh()
    setVerCodigo(data as unknown as PaqueteRecibido)
  }

  const SegBtn = ({ id, label }: { id: 'recibidos' | 'salidas'; label: string }) => (
    <button onClick={() => setVista(id)}
      style={{ padding: '8px 14px', borderRadius: '9px', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
        border: '1.5px solid', borderColor: vista === id ? 'var(--at-accent)' : 'var(--at-line)',
        background: vista === id ? 'var(--at-accent-tint-2)' : 'var(--at-surface)', color: vista === id ? 'var(--at-accent-hover)' : 'var(--at-ink-3)' }}>
      {label}
    </button>
  )

  return (
    <div>
      <div style={{ marginBottom: '16px' }}>
        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--at-ink)' }}>Paquetería</h2>
        <p style={{ margin: '4px 0 0', color: 'var(--at-ink-3)', fontSize: '13.5px' }}>
          {pendientes > 0
            ? <>Tienes <strong style={{ color: 'var(--at-primary)' }}>{pendientes}</strong> {pendientes === 1 ? 'envío pendiente de retiro' : 'envíos pendientes de retiro'}.</>
            : 'Recibe avisos de tus paquetes y autoriza retiros por terceros.'}
        </p>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '18px', flexWrap: 'wrap' }}>
        <SegBtn id="recibidos" label="📥 Recibidos para mí" />
        <SegBtn id="salidas" label="📤 Dejados para retiro" />
      </div>

      {vista === 'recibidos' ? (
        recibidosOrden.length === 0 ? (
          <EmptyBox icon="📦" title="Sin paquetes" text="Cuando portería reciba un envío para tu unidad, aparecerá aquí." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {recibidosOrden.map(p => {
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
                        <span style={{ fontSize: '12px', color: 'var(--at-success)', fontWeight: 600 }}>Firmado{p.entregado_a_nombre ? ` por ${p.entregado_a_nombre}` : ''}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        )
      ) : (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '14px' }}>
            <button onClick={() => setShowSalForm(s => !s)} style={{ padding: '9px 18px', background: 'linear-gradient(135deg,var(--at-accent-hover),var(--at-accent))', color: 'white', border: 'none', borderRadius: '9px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              {showSalForm ? 'Cancelar' : '+ Autorizar retiro'}
            </button>
          </div>

          {showSalForm && (
            <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '14px', padding: '18px', marginBottom: '16px' }}>
              <h3 style={{ margin: '0 0 6px', fontSize: '15px', fontWeight: 700 }}>Dejar un paquete en recepción</h3>
              <p style={{ margin: '0 0 14px', fontSize: '12.5px', color: 'var(--at-ink-3)' }}>Genera un código para que la persona que autorices lo recoja en portería.</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>¿Qué dejarás? *</label>
                  <input value={salForm.descripcion} onChange={e => setSalForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Ej. Sobre con llaves, bolsa de ropa..." style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Tipo</label>
                  <select value={salForm.tipo} onChange={e => setSalForm(f => ({ ...f, tipo: e.target.value as TipoPaquete }))} style={inputStyle}>
                    {(Object.keys(TIPO_CONFIG) as TipoPaquete[]).map(t => <option key={t} value={t}>{TIPO_CONFIG[t].icon} {TIPO_CONFIG[t].label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Autorizado a recoger *</label>
                  <input value={salForm.autorizado_nombre} onChange={e => setSalForm(f => ({ ...f, autorizado_nombre: e.target.value }))} placeholder="Nombre y apellido" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Documento (DPI/ID)</label>
                  <input value={salForm.autorizado_documento} onChange={e => setSalForm(f => ({ ...f, autorizado_documento: e.target.value }))} placeholder="Opcional" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Teléfono</label>
                  <input value={salForm.autorizado_telefono} onChange={e => setSalForm(f => ({ ...f, autorizado_telefono: e.target.value }))} placeholder="Opcional" style={inputStyle} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <MultiImageUploader values={salFotos} onChange={setSalFotos} folder="paquetes" label="Fotos (opcional)" maxFiles={4} capture />
                </div>
              </div>
              <button onClick={handleAutorizar} disabled={salSaving} style={{ marginTop: '14px', padding: '10px 22px', background: 'linear-gradient(135deg,var(--at-accent-hover),var(--at-accent))', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
                {salSaving ? 'Generando...' : '📤 Autorizar y generar código'}
              </button>
            </div>
          )}

          {salidasOrden.length === 0 ? (
            <EmptyBox icon="📤" title="Sin retiros autorizados" text="Autoriza a alguien para que recoja un paquete que dejes en recepción." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {salidasOrden.map(p => {
                const cfg = ESTADO_CONFIG[p.estado]
                const tcfg = TIPO_CONFIG[p.tipo] ?? TIPO_CONFIG.paquete
                return (
                  <div key={p.id} style={{ background: 'var(--at-surface)', border: `1.5px solid ${p.estado === 'pendiente' ? 'var(--at-accent-soft, var(--at-line))' : 'var(--at-line)'}`, borderRadius: '14px', padding: '16px', display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
                    {p.fotos && p.fotos.length > 0 ? (
                      <SecureImage src={p.fotos[0]} alt="" style={{ width: '64px', height: '64px', objectFit: 'cover', borderRadius: '10px', flexShrink: 0, border: '1px solid var(--at-line)' }} />
                    ) : (
                      <div style={{ fontSize: '34px', flexShrink: 0, width: '64px', textAlign: 'center' }}>{tcfg.icon}</div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: '14.5px', color: 'var(--at-ink)' }}>{p.descripcion}</span>
                        <span style={{ padding: '2px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: cfg.bg, color: cfg.color }}>
                          {p.estado === 'pendiente' ? 'Esperando retiro' : p.estado === 'entregado' ? 'Retirado' : 'Devuelto'}
                        </span>
                      </div>
                      <div style={{ fontSize: '12.5px', color: 'var(--at-ink-3)', marginTop: '5px' }}>
                        Autoriza a: <strong style={{ color: 'var(--at-ink-2)' }}>{p.autorizado_nombre}</strong>{p.autorizado_documento ? ` · ${p.autorizado_documento}` : ''}
                      </div>
                      {p.estado === 'entregado' && p.hora_entrega && (
                        <div style={{ fontSize: '11.5px', color: 'var(--at-success)', fontWeight: 600, marginTop: '4px' }}>
                          ✓ Retirado{p.entregado_a_nombre ? ` por ${p.entregado_a_nombre}` : ''} · {new Date(p.hora_entrega).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      )}
                    </div>
                    {p.estado === 'pendiente' && p.codigo_retiro && (
                      <button onClick={() => setVerCodigo(p)} style={{ flexShrink: 0, padding: '7px 12px', background: 'var(--at-accent-tint-2)', color: 'var(--at-accent-hover)', border: '1px solid var(--at-line)', borderRadius: '9px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                        📲 Ver código
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Firmar recepción (entrante) */}
      {firmando && (
        <EditModal title="Firmar recepción" onClose={() => { if (!saving) setFirmando(null) }} maxWidth="460px">
          <div style={{ marginBottom: '14px' }}>
            <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--at-ink)' }}>{firmando.descripcion}</div>
            <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>Confirma que recibiste este envío firmando abajo.</div>
          </div>
          <label style={labelStyle}>Tu nombre</label>
          <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre y apellido" style={{ ...inputStyle, marginBottom: '14px' }} />
          <SignaturePad onSave={handleFirma} onCancel={() => setFirmando(null)} saving={saving} saveLabel="Confirmar recepción" />
        </EditModal>
      )}

      {/* Código de retiro generado */}
      {verCodigo && (
        <EditModal title="Código de retiro" onClose={() => setVerCodigo(null)} maxWidth="380px">
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '13px', color: 'var(--at-ink-2)', marginBottom: '12px' }}>Comparte este código con <strong>{verCodigo.autorizado_nombre}</strong>. Lo necesitará en portería para retirar el paquete.</div>
            <div style={{ fontSize: '34px', fontWeight: 800, letterSpacing: '0.18em', color: 'var(--at-accent-hover)', marginBottom: '14px' }}>{verCodigo.codigo_retiro}</div>
            {/* B5: QR local (antes api.qrserver.com — la CSP lo bloqueaba y filtraba el código a un tercero) */}
            {verCodigo.codigo_retiro && (
              <div aria-label="QR del código" style={{ display: 'inline-block', padding: '8px', background: 'white', border: '1px solid var(--at-line)', borderRadius: '10px' }}>
                <QRCodeSVG value={qrPayloadRetiro(verCodigo.codigo_retiro)} size={200} level="M" marginSize={4} />
              </div>
            )}
            <p style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '14px' }}>
              En portería pueden escanear el QR con la cámara del teléfono o teclear el código. Te avisaremos cuando sea retirado.
            </p>
          </div>
        </EditModal>
      )}
    </div>
  )
}

function EmptyBox({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--at-ink-3)' }}>
      <div style={{ fontSize: '48px', marginBottom: '14px' }}>{icon}</div>
      <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '6px' }}>{title}</div>
      <div style={{ fontSize: '13px' }}>{text}</div>
    </div>
  )
}
