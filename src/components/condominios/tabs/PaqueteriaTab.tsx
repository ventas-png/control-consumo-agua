import { useState } from 'react'
import Swal from 'sweetalert2'
import { notify } from '../../shared/Dialog'
import { supabase } from '../../../lib/supabase'
import { buildUploadPath } from '../../../lib/fileValidation'
import { notifyPackage } from '../../../lib/paquetesNotify'
import { exportarExcel, exportarPDFTabla } from '../exportUtils'
import { MultiImageUploader } from '../../shared/ImageUploader'
import { SecureImage } from '../../shared/SecureImage'
import { EditModal } from '../../shared/EditModal'
import { SignaturePad } from '../../shared/SignaturePad'
import { PaqueteriaSalientesTab } from './PaqueteriaSalientesTab'
import type { PaqueteRecibido, Unidad, EstadoPaquete, TipoPaquete } from '../../../types'

interface Props {
  paquetes: PaqueteRecibido[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  userId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESTADO_CONFIG: Record<EstadoPaquete, { label: string; bg: string; color: string; icon: string }> = {
  pendiente: { label: 'Pendiente', bg: 'var(--at-primary-tint)', color: 'var(--at-primary)', icon: '📦' },
  entregado: { label: 'Entregado', bg: 'var(--at-success-tint)', color: 'var(--at-success)', icon: '✅' },
  devuelto:  { label: 'Devuelto',  bg: 'var(--at-danger-tint)', color: 'var(--at-danger)', icon: '↩️' },
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

function fechaCorta(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
}

export function PaqueteriaTab({ paquetes, unidades, proyectoId, companyId, userId, canCreate, canEdit, onRefresh }: Props) {
  const [vista, setVista] = useState<'entrante' | 'saliente_tercero'>('entrante')
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<EstadoPaquete | 'todos'>('todos')
  const [busqueda, setBusqueda] = useState('')
  const [form, setForm] = useState({
    unidad_id: '', tipo: 'paquete' as TipoPaquete, descripcion: '', remitente: '', num_guia: '', empresa_mensajeria: '', notas: '',
  })
  const [fotos, setFotos] = useState<string[]>([])

  const [firmando, setFirmando] = useState<PaqueteRecibido | null>(null)
  const [firmaNombre, setFirmaNombre] = useState('')
  const [firmaSaving, setFirmaSaving] = useState(false)

  const entrantes = paquetes.filter(p => (p.direccion ?? 'entrante') === 'entrante')
  const salientes = paquetes.filter(p => p.direccion === 'saliente_tercero')

  const filtrados = entrantes.filter(p => {
    const matchEstado = filtroEstado === 'todos' || p.estado === filtroEstado
    const matchBusqueda = !busqueda ||
      p.descripcion.toLowerCase().includes(busqueda.toLowerCase()) ||
      (p.remitente || '').toLowerCase().includes(busqueda.toLowerCase()) ||
      (p.num_guia || '').toLowerCase().includes(busqueda.toLowerCase()) ||
      (p.unidad_nombre || '').toLowerCase().includes(busqueda.toLowerCase())
    return matchEstado && matchBusqueda
  })

  const pendientes = entrantes.filter(p => p.estado === 'pendiente').length

  function resetForm() {
    setForm({ unidad_id: '', tipo: 'paquete', descripcion: '', remitente: '', num_guia: '', empresa_mensajeria: '', notas: '' })
    setFotos([])
    setShowForm(false)
  }

  async function handleRegistrar() {
    if (!form.descripcion.trim()) { notify({ variant: 'error', title: 'Error', text: 'Ingrese una descripción del paquete.' }); return }
    if (!form.unidad_id) { notify({ variant: 'error', title: 'Error', text: 'Seleccione la unidad destinataria.' }); return }
    setSaving(true)
    const { data, error } = await supabase.from('paquetes_recibidos').insert({
      company_id: companyId, project_id: proyectoId, unidad_id: form.unidad_id,
      direccion: 'entrante', tipo: form.tipo,
      descripcion: form.descripcion.trim(),
      remitente: form.remitente.trim() || null,
      num_guia: form.num_guia.trim() || null,
      empresa_mensajeria: form.empresa_mensajeria.trim() || null,
      notas: form.notas.trim() || null,
      fotos: fotos.length ? fotos : null,
      estado: 'pendiente', recibido_por: userId,
    }).select('id').single()
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    try { if (data?.id) await notifyPackage(data.id) } catch { /* best-effort */ }
    notify({ variant: 'success', title: 'Paquete registrado', text: 'Se avisó al residente.', duration: 1600 })
    resetForm(); onRefresh()
  }

  async function marcarEntregado(id: string) {
    const { error } = await supabase.from('paquetes_recibidos').update({
      estado: 'entregado', hora_entrega: new Date().toISOString(), entregado_por: userId, entregado_via: 'porteria',
    }).eq('id', id)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    onRefresh()
  }

  async function handleFirmaPorteria(file: File) {
    if (!firmando) return
    setFirmaSaving(true)
    try {
      const path = buildUploadPath('paquetes-firmas', 'firma.png', 'png')
      const { error: upErr } = await supabase.storage.from('condominios-media').upload(path, file, { contentType: 'image/png', upsert: false })
      if (upErr) { Swal.fire('Error', upErr.message, 'error'); return }
      const { error } = await supabase.from('paquetes_recibidos').update({
        estado: 'entregado', hora_entrega: new Date().toISOString(), entregado_por: userId,
        firma_path: path, entregado_a_nombre: firmaNombre.trim() || null, entregado_via: 'porteria',
      }).eq('id', firmando.id)
      if (error) { Swal.fire('Error', error.message, 'error'); return }
      setFirmando(null); setFirmaNombre(''); onRefresh()
    } finally {
      setFirmaSaving(false)
    }
  }

  async function cambiarEstado(id: string, estado: EstadoPaquete) {
    await supabase.from('paquetes_recibidos').update({ estado }).eq('id', id)
    onRefresh()
  }

  async function eliminar(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar registro?', icon: 'warning', showCancelButton: true, confirmButtonColor: 'var(--at-danger)', confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar' })
    if (!r.isConfirmed) return
    await supabase.from('paquetes_recibidos').delete().eq('id', id)
    onRefresh()
  }

  function avisarWhatsApp(p: PaqueteRecibido) {
    const tipoLabel = TIPO_CONFIG[p.tipo]?.label ?? 'Paquete'
    const msg = `📦 ${tipoLabel} recibido en portería\nUnidad: ${p.unidad_nombre ?? ''}\nDescripción: ${p.descripcion}${p.remitente ? `\nDe: ${p.remitente}` : ''}${p.empresa_mensajeria ? `\nMensajería: ${p.empresa_mensajeria}` : ''}\nPuede pasar a recogerlo cuando guste.`
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
  }

  function buildExportRows(): (string | number)[][] {
    return filtrados.map(p => [
      TIPO_CONFIG[p.tipo]?.label ?? p.tipo,
      p.descripcion,
      p.unidad_nombre ?? '',
      p.remitente ?? '',
      p.empresa_mensajeria ?? '',
      p.num_guia ?? '',
      ESTADO_CONFIG[p.estado].label,
      fechaCorta(p.hora_recepcion),
      fechaCorta(p.hora_entrega),
      p.entregado_a_nombre ?? '',
      p.entregado_via === 'portal' ? 'Portal' : p.entregado_via === 'porteria' ? 'Portería' : '',
    ])
  }
  const EXPORT_HEADERS = ['Tipo', 'Descripción', 'Unidad', 'Remitente', 'Mensajería', 'Guía', 'Estado', 'Recibido', 'Entregado', 'Entregado a', 'Vía']

  function exportarExcelLista() {
    if (filtrados.length === 0) { notify({ variant: 'info', title: 'Sin datos', text: 'No hay paquetes para exportar con el filtro actual.' }); return }
    exportarExcel('paqueteria-entrantes', [{ name: 'Paquetería', headers: EXPORT_HEADERS, rows: buildExportRows() }])
  }
  function exportarPDFLista() {
    if (filtrados.length === 0) { notify({ variant: 'info', title: 'Sin datos', text: 'No hay paquetes para exportar con el filtro actual.' }); return }
    exportarPDFTabla({
      titulo: 'Paquetería — Entrantes',
      subtitulo: `${filtrados.length} registros · ${pendientes} pendientes`,
      headers: EXPORT_HEADERS, rows: buildExportRows(),
      filename: 'paqueteria-entrantes', landscape: true,
    })
  }

  const SegBtn = ({ id, label }: { id: 'entrante' | 'saliente_tercero'; label: string }) => (
    <button onClick={() => setVista(id)}
      style={{ padding: '8px 16px', borderRadius: '9px', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
        border: '1.5px solid', borderColor: vista === id ? 'var(--at-primary)' : 'var(--at-line)',
        background: vista === id ? 'var(--at-primary-tint)' : 'var(--at-surface)', color: vista === id ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
      {label}
    </button>
  )

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--at-ink)' }}>Paquetería</h2>
          {vista === 'entrante' && (
            <p style={{ margin: '4px 0 0', color: 'var(--at-ink-3)', fontSize: '13.5px' }}>
              {entrantes.length} paquetes · <span style={{ color: 'var(--at-primary)', fontWeight: 600 }}>{pendientes} pendientes de entrega</span>
            </p>
          )}
          {vista === 'saliente_tercero' && (
            <p style={{ margin: '4px 0 0', color: 'var(--at-ink-3)', fontSize: '13.5px' }}>Paquetes dejados por residentes para retiro por un tercero</p>
          )}
        </div>
        {canCreate && vista === 'entrante' && (
          <button onClick={() => setShowForm(true)} style={{ padding: '10px 20px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
            + Registrar paquete
          </button>
        )}
      </div>

      {/* Segmento dirección */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '18px', flexWrap: 'wrap' }}>
        <SegBtn id="entrante" label="📥 Entrantes" />
        <SegBtn id="saliente_tercero" label="📤 Salidas (retiro por tercero)" />
      </div>

      {vista === 'saliente_tercero' ? (
        <PaqueteriaSalientesTab
          paquetes={salientes}
          unidades={unidades}
          proyectoId={proyectoId}
          companyId={companyId}
          userId={userId}
          canCreate={canCreate}
          canEdit={canEdit}
          onRefresh={onRefresh}
        />
      ) : (
        <>
          {/* Filtros + exportar */}
          <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
            <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar por descripción, remitente, guía, unidad..."
              style={{ flex: 1, minWidth: '200px', padding: '8px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13.5px', background: 'var(--at-surface-2)' }} />
            {(['todos', 'pendiente', 'entregado', 'devuelto'] as const).map(e => (
              <button key={e} onClick={() => setFiltroEstado(e)}
                style={{ padding: '8px 14px', borderRadius: '8px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', border: '1.5px solid', borderColor: filtroEstado === e ? 'var(--at-primary)' : 'var(--at-line)', background: filtroEstado === e ? 'var(--at-primary-tint)' : 'var(--at-surface)', color: filtroEstado === e ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
                {e === 'todos' ? 'Todos' : ESTADO_CONFIG[e].label}
              </button>
            ))}
            <button onClick={exportarExcelLista} title="Exportar a Excel" style={{ padding: '8px 12px', borderRadius: '8px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', border: '1.5px solid var(--at-line)', background: 'var(--at-surface)', color: 'var(--at-ink-2)' }}>⬇ Excel</button>
            <button onClick={exportarPDFLista} title="Exportar a PDF" style={{ padding: '8px 12px', borderRadius: '8px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', border: '1.5px solid var(--at-line)', background: 'var(--at-surface)', color: 'var(--at-ink-2)' }}>⬇ PDF</button>
          </div>

          {/* Form */}
          {showForm && (
            <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
              <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>Registrar paquete recibido</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Descripción *</label>
                  <input value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Ej. Caja Amazon, sobre TIGO..." style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Tipo</label>
                  <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value as TipoPaquete }))} style={inputStyle}>
                    {(Object.keys(TIPO_CONFIG) as TipoPaquete[]).map(t => <option key={t} value={t}>{TIPO_CONFIG[t].icon} {TIPO_CONFIG[t].label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Unidad destinataria *</label>
                  <select value={form.unidad_id} onChange={e => setForm(f => ({ ...f, unidad_id: e.target.value }))} style={inputStyle}>
                    <option value="">Seleccionar...</option>
                    {unidades.filter(u => u.activo).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Remitente</label>
                  <input value={form.remitente} onChange={e => setForm(f => ({ ...f, remitente: e.target.value }))} placeholder="Nombre o empresa" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>No. de guía</label>
                  <input value={form.num_guia} onChange={e => setForm(f => ({ ...f, num_guia: e.target.value }))} placeholder="Número de rastreo" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Empresa mensajería</label>
                  <input value={form.empresa_mensajeria} onChange={e => setForm(f => ({ ...f, empresa_mensajeria: e.target.value }))} placeholder="DHL, FedEx, Amazon..." style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Notas</label>
                  <input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} placeholder="Opcional" style={inputStyle} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <MultiImageUploader values={fotos} onChange={setFotos} folder="paquetes" label="Fotos del paquete" maxFiles={4} capture />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                <button onClick={handleRegistrar} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
                  {saving ? 'Registrando...' : '📦 Registrar recepción'}
                </button>
                <button onClick={resetForm} style={{ padding: '10px 20px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
              </div>
            </div>
          )}

          {/* Lista */}
          {filtrados.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>📦</div>
              <p style={{ fontWeight: 600, color: 'var(--at-ink-3)' }}>No hay paquetes registrados</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filtrados.map(p => {
                const cfg = ESTADO_CONFIG[p.estado]
                const tcfg = TIPO_CONFIG[p.tipo] ?? TIPO_CONFIG.paquete
                return (
                  <div key={p.id} style={{ background: 'var(--at-surface)', border: `1.5px solid ${p.estado === 'pendiente' ? 'var(--at-primary-soft-2)' : 'var(--at-line)'}`, borderRadius: '12px', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '14px' }}>
                    {p.fotos && p.fotos.length > 0 ? (
                      <SecureImage src={p.fotos[0]} alt="" style={{ width: '46px', height: '46px', objectFit: 'cover', borderRadius: '8px', flexShrink: 0, border: '1px solid var(--at-line)' }} />
                    ) : (
                      <div style={{ fontSize: '28px', flexShrink: 0 }}>{cfg.icon}</div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        {p.descripcion}
                        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', background: 'var(--at-chip)', borderRadius: '20px', padding: '2px 9px' }}>{tcfg.icon} {tcfg.label}</span>
                        {p.fotos && p.fotos.length > 1 && <span style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>📷 {p.fotos.length}</span>}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '3px' }}>
                        {p.unidad_nombre && <span>📍 {p.unidad_nombre}</span>}
                        {p.remitente && <span>· De: {p.remitente}</span>}
                        {p.empresa_mensajeria && <span>· {p.empresa_mensajeria}</span>}
                        {p.num_guia && <span>· #{p.num_guia}</span>}
                      </div>
                      <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', marginTop: '3px' }}>
                        Recibido: {fechaCorta(p.hora_recepcion)}
                        {p.hora_entrega && ` · Entregado: ${fechaCorta(p.hora_entrega)}`}
                      </div>
                      {p.estado === 'entregado' && (p.firma_path || p.entregado_a_nombre) && (
                        <div style={{ fontSize: '11.5px', color: 'var(--at-success)', fontWeight: 600, marginTop: '3px' }}>
                          {p.firma_path ? '✍ Firmado' : '✓ Entregado'}{p.entregado_a_nombre ? ` por ${p.entregado_a_nombre}` : ''}{p.entregado_via === 'portal' ? ' · desde su portal' : p.entregado_via === 'porteria' ? ' · en portería' : ''}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', flexShrink: 0 }}>
                      {p.firma_path && (
                        <SecureImage src={p.firma_path} alt="firma" style={{ width: '60px', height: '34px', objectFit: 'contain', background: '#fff', borderRadius: '6px', border: '1px solid var(--at-line)' }} />
                      )}
                      <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 700, background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                      {canEdit && p.estado === 'pendiente' && (
                        <button onClick={() => avisarWhatsApp(p)} title="Notificar residente por WhatsApp"
                          style={{ padding: '5px 10px', background: 'var(--at-success-tint)', color: 'var(--at-success)', border: '1px solid var(--at-success-border)', borderRadius: '8px', cursor: 'pointer', fontSize: '11.5px', fontWeight: 600 }}>💬 Avisar</button>
                      )}
                      {canEdit && p.estado === 'pendiente' && (
                        <button onClick={() => { setFirmando(p); setFirmaNombre('') }} style={{ padding: '6px 12px', background: 'var(--at-success-tint)', color: 'var(--at-success)', border: '1px solid var(--at-success-border)', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                          ✍ Entregar c/ firma
                        </button>
                      )}
                      {canEdit && p.estado === 'pendiente' && (
                        <button onClick={() => marcarEntregado(p.id)} style={{ padding: '5px 10px', background: 'var(--at-surface-2)', color: 'var(--at-ink-2)', border: '1px solid var(--at-line)', borderRadius: '8px', cursor: 'pointer', fontSize: '11.5px' }}>
                          ✓ Entregar sin firma
                        </button>
                      )}
                      {canEdit && p.estado === 'pendiente' && (
                        <button onClick={() => cambiarEstado(p.id, 'devuelto')} style={{ padding: '5px 10px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: '1px solid var(--at-danger-border)', borderRadius: '8px', cursor: 'pointer', fontSize: '11.5px' }}>
                          ↩ Devolver
                        </button>
                      )}
                      <button onClick={() => eliminar(p.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--at-danger)', fontSize: '15px', padding: '2px 4px' }}>🗑</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Entrega con firma (portería) */}
          {firmando && (
            <EditModal
              title={`Firmar entrega · ${firmando.unidad_nombre ?? ''}`}
              onClose={() => { if (!firmaSaving) { setFirmando(null); setFirmaNombre('') } }}
              maxWidth="460px"
            >
              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--at-ink)' }}>{firmando.descripcion}</div>
                <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>Capture la firma de quien recibe para confirmar la entrega.</div>
              </div>
              <label style={labelStyle}>Nombre de quien recibe</label>
              <input value={firmaNombre} onChange={e => setFirmaNombre(e.target.value)} placeholder="Nombre y apellido" style={{ ...inputStyle, marginBottom: '14px' }} />
              <SignaturePad onSave={handleFirmaPorteria} onCancel={() => { setFirmando(null); setFirmaNombre('') }} saving={firmaSaving} saveLabel="Confirmar entrega" />
            </EditModal>
          )}
        </>
      )}
    </div>
  )
}
