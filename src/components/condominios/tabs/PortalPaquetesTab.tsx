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
import { Button } from '../../shared/Button'
import { SignaturePad } from '../../shared/SignaturePad'
import type { PaqueteRecibido, TipoPaquete } from '../../../types'

/** Las dos listas de la pestaña: lo que llega para el residente y lo que él deja para un tercero. */
export type VistaPaquetes = 'recibidos' | 'salidas'

interface Props {
  paquetes: PaqueteRecibido[]
  unidadId: string
  nombrePrefill?: string
  /** La vista la controla el portal: el aviso de entrada abre la que corresponde. */
  vista: VistaPaquetes
  onVistaChange: (vista: VistaPaquetes) => void
  onRefresh: () => void
}

// Clave `string`: la fila del motor único puede traer el vocabulario de la otra
// clase. Ver la nota en PaqueteriaTab.
const ESTADO_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  pendiente: { label: 'Pendiente de retiro', bg: 'var(--at-primary-tint)', color: 'var(--at-primary)' },
  entregado: { label: 'Recibido', bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  devuelto:  { label: 'Devuelto', bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' },
}

// Lo que el residente dejó para otra persona no está "pendiente de retiro" ni
// "recibido": está esperando a quien lo recoge, o ya se lo llevaron.
const ESTADO_SALIDA_LABEL: Record<string, string> = {
  pendiente: 'Esperando retiro',
  entregado: 'Retirado',
  devuelto:  'Devuelto',
}

const TIPO_CONFIG: Record<string, { label: string; icon: string }> = {
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

const FECHA_CORTA: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }
/** "2026-11-05T15:30:00Z" → "05 de noviembre de 2026, 15:30" (hora local), para la ficha. */
const fechaHoraLarga = (iso: string) => new Date(iso).toLocaleString('es', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function blankSalForm() {
  return { tipo: 'paquete' as TipoPaquete, descripcion: '', autorizado_nombre: '', autorizado_documento: '', autorizado_telefono: '', notas: '' }
}

export function PortalPaquetesTab({ paquetes, unidadId, nombrePrefill = '', vista, onVistaChange, onRefresh }: Props) {
  const projectId = useMediaScope()

  // Firmar recepción (entrantes)
  const [firmando, setFirmando] = useState<PaqueteRecibido | null>(null)
  const [nombre, setNombre] = useState(nombrePrefill)
  const [saving, setSaving] = useState(false)

  // Autorizar salida (retiro por tercero)
  const [showSalForm, setShowSalForm] = useState(false)
  const [salForm, setSalForm] = useState(blankSalForm())
  const [salFotos, setSalFotos] = useState<string[]>([])
  const [salSaving, setSalSaving] = useState(false)
  const [verCodigo, setVerCodigo] = useState<PaqueteRecibido | null>(null)
  // Pieza abierta en la ficha, por id: así la ficha sigue a la fila cuando el padre recarga (p. ej. tras firmar).
  const [detalleId, setDetalleId] = useState<string | null>(null)
  const detalle = detalleId ? paquetes.find(p => p.id === detalleId) ?? null : null

  const recibidos = paquetes.filter(p => (p.direccion ?? 'entrante') === 'entrante')
  const salidas   = paquetes.filter(p => p.direccion === 'saliente_tercero')

  const recibidosOrden = [...recibidos].sort((a, b) => {
    if (a.estado === 'pendiente' && b.estado !== 'pendiente') return -1
    if (b.estado === 'pendiente' && a.estado !== 'pendiente') return 1
    return new Date(b.hora_recepcion).getTime() - new Date(a.hora_recepcion).getTime()
  })
  const salidasOrden = [...salidas].sort((a, b) => new Date(b.hora_recepcion).getTime() - new Date(a.hora_recepcion).getTime())
  const pendientes = recibidos.filter(p => p.estado === 'pendiente').length
  const esperandoRetiro = salidas.filter(p => p.estado === 'pendiente').length

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

  function cerrarSalForm() {
    setSalForm(blankSalForm())
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
    cerrarSalForm()
    onVistaChange('salidas')
    onRefresh()
    setVerCodigo(data as unknown as PaqueteRecibido)
  }

  const SegBtn = ({ id, label, badge }: { id: VistaPaquetes; label: string; badge: number }) => (
    <button onClick={() => onVistaChange(id)} aria-pressed={vista === id}
      style={{ flex: '1 1 auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '7px', padding: '8px 14px', borderRadius: '9px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
        border: '1.5px solid', borderColor: vista === id ? 'var(--at-accent)' : 'var(--at-line)',
        background: vista === id ? 'var(--at-accent-tint-2)' : 'var(--at-surface)', color: vista === id ? 'var(--at-accent-hover)' : 'var(--at-ink-3)' }}>
      {label}
      {badge > 0 && (
        <span style={{ minWidth: '18px', padding: '1px 6px', borderRadius: '999px', fontSize: '11px', fontWeight: 800, textAlign: 'center', boxSizing: 'border-box', background: 'var(--at-accent)', color: 'white' }}>{badge}</span>
      )}
    </button>
  )

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--at-ink)' }}>Paquetería</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--at-ink-3)', fontSize: '13.5px' }}>
            {pendientes > 0
              ? <>Tienes <strong style={{ color: 'var(--at-primary)' }}>{pendientes}</strong> {pendientes === 1 ? 'envío pendiente de retiro' : 'envíos pendientes de retiro'}.</>
              : 'Recibe avisos de tus paquetes y autoriza retiros por terceros.'}
          </p>
        </div>
        <button onClick={() => setShowSalForm(true)} style={{ padding: '9px 16px', background: 'linear-gradient(135deg,var(--at-accent-hover),var(--at-accent))', color: 'white', border: 'none', borderRadius: '9px', fontSize: '13.5px', fontWeight: 600, cursor: 'pointer' }}>
          + Autorizar retiro
        </button>
      </div>

      {/* Si no caben en una fila, cada vista ocupa el ancho completo: así ninguna
          queda cortada en el teléfono. */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '18px', flexWrap: 'wrap' }}>
        <SegBtn id="recibidos" label="📥 Recibidos para mí" badge={pendientes} />
        <SegBtn id="salidas" label="📤 Dejados para retiro" badge={esperandoRetiro} />
      </div>

      {vista === 'recibidos' ? (
        recibidosOrden.length === 0 ? (
          <EmptyBox icon="📦" title="Sin paquetes" text="Cuando portería reciba un envío para tu unidad, aparecerá aquí." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {recibidosOrden.map(p => {
              const cfg = ESTADO_CONFIG[p.estado] ?? ESTADO_CONFIG.pendiente
              const tcfg = TIPO_CONFIG[p.tipo] ?? TIPO_CONFIG.paquete
              const pendiente = p.estado === 'pendiente'
              const fotos = p.fotos?.length ?? 0
              const abrir = () => setDetalleId(p.id)
              return (
                /* La tarjeta sólo resume; la ficha (fotos, firma, notas y Firmar recepción) abre en ventana al tocarla. */
                <div key={p.id} role="button" tabIndex={0} aria-label={p.descripcion}
                  onClick={abrir}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir() } }}
                  style={{ background: 'var(--at-surface)', border: `1.5px solid ${pendiente ? 'var(--at-primary-soft-2)' : 'var(--at-line)'}`, borderRadius: '14px', padding: '14px 16px', display: 'flex', gap: '14px', alignItems: 'flex-start', cursor: 'pointer' }}>
                  {p.fotos && p.fotos.length > 0 ? (
                    <SecureImage src={p.fotos[0]} alt="" style={{ width: '56px', height: '56px', objectFit: 'cover', borderRadius: '10px', flexShrink: 0, border: '1px solid var(--at-line)' }} />
                  ) : (
                    <div aria-hidden style={{ fontSize: '30px', flexShrink: 0, width: '56px', textAlign: 'center' }}>{tcfg.icon}</div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: '14.5px', color: 'var(--at-ink)', overflowWrap: 'anywhere' }}>{p.descripcion}</span>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', background: 'var(--at-chip)', borderRadius: '20px', padding: '2px 9px' }}>{tcfg.icon} {tcfg.label}</span>
                      <span style={{ padding: '2px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                    </div>
                    {(p.remitente || p.empresa_mensajeria || p.num_guia) && (
                      <div style={{ fontSize: '12.5px', color: 'var(--at-ink-3)', display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '5px' }}>
                        {p.remitente && <span>De: {p.remitente}</span>}
                        {p.empresa_mensajeria && <span>· {p.empresa_mensajeria}</span>}
                        {p.num_guia && <span>· #{p.num_guia}</span>}
                      </div>
                    )}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', alignItems: 'center', fontSize: '11.5px', color: 'var(--at-ink-3)', marginTop: '4px' }}>
                      <span>Recibido en portería: {new Date(p.hora_recepcion).toLocaleString('es', FECHA_CORTA)}</span>
                      {p.hora_entrega && <span style={{ color: 'var(--at-success)', fontWeight: 600 }}>✓ Retirado{p.entregado_a_nombre ? ` por ${p.entregado_a_nombre}` : ''}</span>}
                      {fotos > 0 && <span>📷 {fotos}</span>}
                      <span aria-hidden style={{ marginLeft: 'auto', fontSize: '12px', fontWeight: 700, color: 'var(--at-primary)' }}>Ver ficha ›</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )
      ) : salidasOrden.length === 0 ? (
        <EmptyBox icon="📤" title="Sin retiros autorizados" text="Autoriza a alguien para que recoja un paquete que dejes en recepción. Te avisaremos cuando lo retire." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {salidasOrden.map(p => {
            const cfg = ESTADO_CONFIG[p.estado] ?? ESTADO_CONFIG.pendiente
            const tcfg = TIPO_CONFIG[p.tipo] ?? TIPO_CONFIG.paquete
            const esperando = p.estado === 'pendiente'
            const abrir = () => setDetalleId(p.id)
            return (
              /* La tarjeta sólo resume; la ficha (datos de quien recoge, código, fotos) abre en ventana al tocarla. */
              <div key={p.id} role="button" tabIndex={0} aria-label={p.descripcion}
                onClick={abrir}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir() } }}
                style={{ background: 'var(--at-surface)', border: `1.5px solid ${esperando ? 'var(--at-accent-soft, var(--at-line))' : 'var(--at-line)'}`, borderRadius: '14px', padding: '14px 16px', display: 'flex', gap: '12px', alignItems: 'flex-start', cursor: 'pointer' }}>
                {p.fotos && p.fotos.length > 0 ? (
                  <SecureImage src={p.fotos[0]} alt="" style={{ width: '56px', height: '56px', objectFit: 'cover', borderRadius: '10px', flexShrink: 0, border: '1px solid var(--at-line)' }} />
                ) : (
                  <span aria-hidden="true" style={{ width: '48px', height: '48px', borderRadius: '12px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', background: cfg.bg }}>{tcfg.icon}</span>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
                    <span style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: '14.5px', color: 'var(--at-ink)', overflowWrap: 'anywhere' }}>{p.descripcion}</span>
                    <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', flexShrink: 0 }}>{new Date(p.hora_recepcion).toLocaleDateString('es', { day: '2-digit', month: 'short' })}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', margin: '5px 0' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '2px 9px', borderRadius: '999px', fontSize: '11.5px', fontWeight: 700, background: cfg.bg, color: cfg.color }}>
                      <span aria-hidden="true" style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor' }} />
                      {ESTADO_SALIDA_LABEL[p.estado] ?? p.estado}
                    </span>
                    <span style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--at-ink-3)', background: 'var(--at-chip)', borderRadius: '999px', padding: '2px 9px' }}>{tcfg.icon} {tcfg.label}</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', alignItems: 'center', fontSize: '12.5px', color: 'var(--at-ink-3)' }}>
                    <span>Lo recoge: <strong style={{ color: 'var(--at-ink-2)' }}>{p.autorizado_nombre}</strong></span>
                    {p.estado === 'entregado' && p.hora_entrega && (
                      <span style={{ fontSize: '12px', color: 'var(--at-success)', fontWeight: 600 }}>✓ Retirado{p.entregado_a_nombre ? ` por ${p.entregado_a_nombre}` : ''}</span>
                    )}
                    <span aria-hidden style={{ marginLeft: 'auto', fontSize: '12px', fontWeight: 700, color: 'var(--at-primary)' }}>Ver ficha ›</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Ficha de la pieza en ventana emergente (pantalla completa en el
          teléfono): datos, notas, fotos y firma, con la acción en el pie
          (Firmar recepción o Ver código de retiro). Antes cada tarjeta traía
          desplegadas las fotos, la firma y el botón. */}
      {detalle && (() => {
        const p = detalle
        const saliente = p.direccion === 'saliente_tercero'
        const cfg = ESTADO_CONFIG[p.estado] ?? ESTADO_CONFIG.pendiente
        const tcfg = TIPO_CONFIG[p.tipo] ?? TIPO_CONFIG.paquete
        const estadoLabel = saliente ? (ESTADO_SALIDA_LABEL[p.estado] ?? p.estado) : cfg.label
        const datos: { label: string; value: string; color?: string }[] = [
          { label: 'Estado', value: estadoLabel, color: cfg.color },
          { label: 'Tipo', value: `${tcfg.icon} ${tcfg.label}` },
          { label: saliente ? 'Dejado en recepción' : 'Recibido en portería', value: fechaHoraLarga(p.hora_recepcion) },
        ]
        if (p.hora_entrega) datos.push({ label: 'Retirado el', value: `${fechaHoraLarga(p.hora_entrega)}${p.entregado_a_nombre ? ` · por ${p.entregado_a_nombre}` : ''}`, color: 'var(--at-success)' })
        if (saliente) {
          datos.push({ label: 'Lo recoge', value: p.autorizado_nombre || '—' })
          if (p.autorizado_documento) datos.push({ label: 'Documento', value: p.autorizado_documento })
          if (p.autorizado_telefono) datos.push({ label: 'Teléfono', value: p.autorizado_telefono })
          if (p.estado === 'pendiente' && p.codigo_retiro) datos.push({ label: 'Código de retiro', value: p.codigo_retiro, color: 'var(--at-accent-hover)' })
        } else {
          if (p.remitente) datos.push({ label: 'De', value: p.remitente })
          if (p.empresa_mensajeria) datos.push({ label: 'Mensajería', value: p.empresa_mensajeria })
          if (p.num_guia) datos.push({ label: 'Nº de guía', value: p.num_guia })
          if (p.prioridad && p.prioridad !== 'normal') datos.push({ label: 'Prioridad', value: p.prioridad.charAt(0).toUpperCase() + p.prioridad.slice(1), color: 'var(--at-warning-strong)' })
        }
        const seccion = { background: 'var(--at-surface-2)', borderRadius: 8, padding: 10, border: '1px solid var(--at-line)', marginBottom: 12 } as const
        return (
          <EditModal
            title={p.descripcion}
            subtitle={
              <span style={{ display: 'inline-flex', gap: '4px 8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ padding: '2px 9px', borderRadius: '999px', fontSize: '10.5px', fontWeight: 800, background: cfg.bg, color: cfg.color }}>{estadoLabel}</span>
                <span style={{ padding: '2px 9px', borderRadius: '999px', fontSize: '10.5px', fontWeight: 800, background: 'var(--at-chip)', color: 'var(--at-ink-3)' }}>{tcfg.icon} {tcfg.label}</span>
                <span>📅 {new Date(p.hora_recepcion).toLocaleString('es', FECHA_CORTA)}{saliente ? ` · Lo recoge ${p.autorizado_nombre ?? ''}` : (p.remitente ? ` · De: ${p.remitente}` : '')}</span>
              </span>
            }
            size="lg"
            fullScreenOnMobile
            onClose={() => setDetalleId(null)}
            footer={
              <div className="at-ficha-acciones" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '8px', width: '100%' }}>
                <Button variant="secondary" onClick={() => setDetalleId(null)}>Cerrar</Button>
                {!saliente && p.estado === 'pendiente' && (
                  <Button variant="primary" onClick={() => abrirFirma(p)}>✍ Firmar recepción</Button>
                )}
                {saliente && p.estado === 'pendiente' && p.codigo_retiro && (
                  <Button variant="primary" onClick={() => setVerCodigo(p)}>📲 Ver código de retiro</Button>
                )}
              </div>
            }
          >
            {!saliente && p.estado === 'pendiente' && (
              <div style={{ background: 'var(--at-primary-tint)', border: '1px solid var(--at-primary-soft-2)', color: 'var(--at-primary)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12.5 }}>
                📦 Está en portería esperando que lo retires. Al recibirlo, firma la recepción desde aquí.
              </div>
            )}
            {saliente && p.estado === 'pendiente' && (
              <div style={{ background: 'var(--at-accent-tint-2)', border: '1px solid var(--at-accent-soft-2)', color: 'var(--at-accent-hover)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12.5 }}>
                📤 Sigue en recepción esperando a {p.autorizado_nombre}. Te avisaremos cuando lo retire.
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, marginBottom: 12 }}>
              {datos.map(d => (
                <div key={d.label} style={{ background: 'var(--at-surface-2)', borderRadius: 7, padding: 8, border: '1px solid var(--at-line)', minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>{d.label}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: d.color ?? 'var(--at-ink-2)', overflowWrap: 'anywhere' }}>{d.value}</div>
                </div>
              ))}
            </div>

            {p.notas && (
              <div style={seccion}>
                <div style={{ fontSize: 10, color: 'var(--at-ink-3)', marginBottom: 4 }}>Notas</div>
                <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 13, color: 'var(--at-ink-2)', lineHeight: 1.45, overflowWrap: 'anywhere' }}>{p.notas}</p>
              </div>
            )}

            {p.fotos && p.fotos.length > 0 && (
              <div style={seccion}>
                <div style={{ fontSize: 10, color: 'var(--at-ink-3)', marginBottom: 6 }}>Fotos</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {p.fotos.map((f, i) => (
                    <SecureImage key={i} src={f} alt={`Foto ${i + 1} de ${p.descripcion}`} style={{ width: 110, height: 110, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--at-line)' }} />
                  ))}
                </div>
              </div>
            )}

            {p.estado === 'entregado' && (p.firma_path || p.entregado_a_nombre) && (
              <div style={{ ...seccion, background: 'var(--at-success-tint)', borderColor: 'var(--at-success-border)', marginBottom: 0 }}>
                <div style={{ fontSize: 10, color: 'var(--at-ink-3)', marginBottom: 6 }}>Firma de recepción</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  {p.firma_path && <SecureImage src={p.firma_path} alt="Firma de recepción" style={{ width: 120, height: 60, objectFit: 'contain', background: '#fff', borderRadius: 6, border: '1px solid var(--at-line)' }} />}
                  <span style={{ fontSize: 13, color: 'var(--at-success)', fontWeight: 600 }}>Firmado{p.entregado_a_nombre ? ` por ${p.entregado_a_nombre}` : ''}{p.hora_entrega ? ` · ${new Date(p.hora_entrega).toLocaleString('es', FECHA_CORTA)}` : ''}</span>
                </div>
              </div>
            )}
          </EditModal>
        )
      })()}

      {/* Autorizar retiro — ventana emergente: el formulario no empuja la lista
          ni se queda abierto a medias al cambiar de vista. */}
      {showSalForm && (
        <EditModal
          title="Dejar un paquete en recepción"
          subtitle="Genera un código para que la persona que autorices lo recoja en portería."
          size="sm"
          onClose={() => { if (!salSaving) cerrarSalForm() }}
          footer={
            <>
              <button onClick={cerrarSalForm} disabled={salSaving} style={{ padding: '10px 16px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
              <button onClick={handleAutorizar} disabled={salSaving} style={{ padding: '10px 22px', background: 'linear-gradient(135deg,var(--at-accent-hover),var(--at-accent))', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: salSaving ? 'wait' : 'pointer' }}>
                {salSaving ? 'Generando...' : '📤 Generar código'}
              </button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label htmlFor="salida-descripcion" style={labelStyle}>¿Qué dejarás? *</label>
              <input type="text" id="salida-descripcion" autoFocus value={salForm.descripcion} onChange={e => setSalForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Ej. Sobre con llaves, bolsa de ropa..." style={inputStyle} />
            </div>
            <div>
              <span id="salida-tipo" style={{ ...labelStyle, marginBottom: '6px' }}>Tipo</span>
              <div role="group" aria-labelledby="salida-tipo" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {(Object.keys(TIPO_CONFIG) as TipoPaquete[]).map(t => {
                  const activo = salForm.tipo === t
                  return (
                    <button key={t} type="button" onClick={() => setSalForm(f => ({ ...f, tipo: t }))} aria-pressed={activo}
                      style={{ padding: '6px 13px', borderRadius: '20px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', border: '1.5px solid',
                        borderColor: activo ? 'var(--at-accent)' : 'var(--at-line)', background: activo ? 'var(--at-accent-tint-2)' : 'var(--at-surface)', color: activo ? 'var(--at-accent-hover)' : 'var(--at-ink-3)' }}>
                      {TIPO_CONFIG[t].icon} {TIPO_CONFIG[t].label}
                    </button>
                  )
                })}
              </div>
            </div>
            <div>
              <label htmlFor="salida-autorizado" style={labelStyle}>¿Quién lo recogerá? *</label>
              <input type="text" id="salida-autorizado" value={salForm.autorizado_nombre} onChange={e => setSalForm(f => ({ ...f, autorizado_nombre: e.target.value }))} placeholder="Nombre y apellido" autoComplete="off" style={inputStyle} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
              <div>
                <label htmlFor="salida-documento" style={labelStyle}>Documento (DPI/ID)</label>
                <input type="text" id="salida-documento" value={salForm.autorizado_documento} onChange={e => setSalForm(f => ({ ...f, autorizado_documento: e.target.value }))} placeholder="Opcional" autoComplete="off" style={inputStyle} />
              </div>
              <div>
                <label htmlFor="salida-telefono" style={labelStyle}>Teléfono</label>
                <input id="salida-telefono" type="tel" inputMode="tel" value={salForm.autorizado_telefono} onChange={e => setSalForm(f => ({ ...f, autorizado_telefono: e.target.value }))} placeholder="Opcional" autoComplete="off" style={inputStyle} />
              </div>
            </div>
            <MultiImageUploader values={salFotos} onChange={setSalFotos} folder="paquetes" label="Fotos (opcional)" maxFiles={4} capture />
          </div>
        </EditModal>
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
