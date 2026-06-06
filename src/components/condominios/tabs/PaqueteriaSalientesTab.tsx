import { useState } from 'react'
import { notify, confirm } from '../../shared/Dialog'
import {
  createCondominioRowReturning,
  updateCondominioRow,
  deleteCondominioRow,
} from '../../../domain/condominios/tabMutations'
import { uploadCondominiosMedia } from '../../../domain/shared/storage'
import { buildUploadPath } from '../../../lib/fileValidation'
import { generarCodigoRetiro, codigoRetiroQrUrl } from '../../../lib/paquetes'
import { MultiImageUploader } from '../../shared/ImageUploader'
import { SecureImage } from '../../shared/SecureImage'
import { EditModal } from '../../shared/EditModal'
import { SignaturePad } from '../../shared/SignaturePad'
import type { PaqueteRecibido, Unidad, EstadoPaquete, TipoPaquete } from '../../../types'

interface Props {
  paquetes: PaqueteRecibido[]   // solo salientes (direccion = 'saliente_tercero')
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  userId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
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

export function PaqueteriaSalientesTab({ paquetes, unidades, proyectoId, companyId, userId, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<EstadoPaquete | 'todos'>('todos')
  const [form, setForm] = useState({
    unidad_id: '', tipo: 'paquete' as TipoPaquete, descripcion: '',
    autorizado_nombre: '', autorizado_documento: '', autorizado_telefono: '', notas: '',
  })
  const [fotos, setFotos] = useState<string[]>([])

  const [verCodigo, setVerCodigo] = useState<PaqueteRecibido | null>(null)
  const [entregando, setEntregando] = useState<PaqueteRecibido | null>(null)
  const [entregaCodigo, setEntregaCodigo] = useState('')
  const [entregaNombre, setEntregaNombre] = useState('')
  const [entregaSaving, setEntregaSaving] = useState(false)

  const filtrados = paquetes.filter(p => {
    const matchEstado = filtroEstado === 'todos' || p.estado === filtroEstado
    const matchBusqueda = !busqueda ||
      p.descripcion.toLowerCase().includes(busqueda.toLowerCase()) ||
      (p.autorizado_nombre || '').toLowerCase().includes(busqueda.toLowerCase()) ||
      (p.codigo_retiro || '').toLowerCase().includes(busqueda.toLowerCase()) ||
      (p.unidad_nombre || '').toLowerCase().includes(busqueda.toLowerCase())
    return matchEstado && matchBusqueda
  })

  const porRetirar = paquetes.filter(p => p.estado === 'pendiente' && p.recibido_por).length
  const sinDepositar = paquetes.filter(p => p.estado === 'pendiente' && !p.recibido_por).length

  function resetForm() {
    setForm({ unidad_id: '', tipo: 'paquete', descripcion: '', autorizado_nombre: '', autorizado_documento: '', autorizado_telefono: '', notas: '' })
    setFotos([])
    setShowForm(false)
  }

  async function handleRegistrar() {
    if (!form.descripcion.trim()) { notify({ variant: 'error', title: 'Error', text: 'Ingrese una descripción.' }); return }
    if (!form.unidad_id) { notify({ variant: 'error', title: 'Error', text: 'Seleccione la unidad del residente.' }); return }
    if (!form.autorizado_nombre.trim()) { notify({ variant: 'error', title: 'Error', text: 'Indique a quién se autoriza el retiro.' }); return }
    setSaving(true)
    const codigo = generarCodigoRetiro()
    const { data, error } = await createCondominioRowReturning('paquetes_recibidos', {
      company_id: companyId, project_id: proyectoId, unidad_id: form.unidad_id,
      direccion: 'saliente_tercero', tipo: form.tipo, descripcion: form.descripcion.trim(),
      autorizado_nombre: form.autorizado_nombre.trim(),
      autorizado_documento: form.autorizado_documento.trim() || null,
      autorizado_telefono: form.autorizado_telefono.trim() || null,
      fotos: fotos.length ? fotos : null,
      notas: form.notas.trim() || null,
      estado: 'pendiente', recibido_por: userId, codigo_retiro: codigo,
    }, '*, unidades(nombre)')
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    const row = { ...(data as unknown as PaqueteRecibido & { unidades?: { nombre: string } | null }), unidad_nombre: (data as { unidades?: { nombre: string } | null }).unidades?.nombre }
    resetForm()
    onRefresh()
    setVerCodigo(row)
  }

  async function confirmarCustodia(id: string) {
    const { error } = await updateCondominioRow('paquetes_recibidos', id, { recibido_por: userId, hora_recepcion: new Date().toISOString() })
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
  }

  async function handleEntregar(file: File) {
    if (!entregando) return
    if (entregaCodigo.trim().toUpperCase() !== (entregando.codigo_retiro || '').toUpperCase()) {
      notify({ variant: 'error', title: 'Código incorrecto', text: 'El código de retiro no coincide. Verifique con quien recoge.' })
      return
    }
    setEntregaSaving(true)
    try {
      const path = buildUploadPath(`${proyectoId}/paquetes-firmas`, 'firma.png', 'png')
      const { error: upErr } = await uploadCondominiosMedia(path, file, { contentType: 'image/png', upsert: false })
      if (upErr) { notify({ variant: 'error', title: 'Error', text: upErr }); return }
      const { error } = await updateCondominioRow('paquetes_recibidos', entregando.id, {
        estado: 'entregado', hora_entrega: new Date().toISOString(), entregado_por: userId,
        firma_path: path, entregado_a_nombre: entregaNombre.trim() || entregando.autorizado_nombre || null,
        entregado_via: 'porteria',
      })
      if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
      setEntregando(null); setEntregaCodigo(''); setEntregaNombre('')
      onRefresh()
    } finally {
      setEntregaSaving(false)
    }
  }

  async function devolver(id: string) {
    const r = await confirm({ title: '¿Devolver al residente?', text: 'El paquete sale de custodia sin entregarse al tercero.', icon: 'warning', confirmText: 'Devolver' })
    if (!r.isConfirmed) return
    await updateCondominioRow('paquetes_recibidos', id, { estado: 'devuelto' })
    onRefresh()
  }

  async function eliminar(id: string) {
    const r = await confirm({ title: '¿Eliminar registro?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    await deleteCondominioRow('paquetes_recibidos', id)
    onRefresh()
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <p style={{ margin: 0, color: 'var(--at-ink-3)', fontSize: '13.5px' }}>
          <span style={{ color: 'var(--at-primary)', fontWeight: 600 }}>{porRetirar}</span> por retirar
          {sinDepositar > 0 && <> · <span style={{ color: 'var(--at-warning-strong)', fontWeight: 600 }}>{sinDepositar}</span> autorizados sin depositar</>}
        </p>
        {canCreate && (
          <button onClick={() => setShowForm(true)} style={{ padding: '10px 20px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
            + Registrar salida
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar por descripción, autorizado, código, unidad..."
          style={{ flex: 1, minWidth: '200px', padding: '8px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13.5px', background: 'var(--at-surface-2)' }} />
        {(['todos', 'pendiente', 'entregado', 'devuelto'] as const).map(e => (
          <button key={e} onClick={() => setFiltroEstado(e)}
            style={{ padding: '8px 14px', borderRadius: '8px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', border: '1.5px solid', borderColor: filtroEstado === e ? 'var(--at-primary)' : 'var(--at-line)', background: filtroEstado === e ? 'var(--at-primary-tint)' : 'var(--at-surface)', color: filtroEstado === e ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
            {e === 'todos' ? 'Todos' : e === 'pendiente' ? 'Por retirar' : e === 'entregado' ? 'Retirados' : 'Devueltos'}
          </button>
        ))}
      </div>

      {showForm && (
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>Registrar paquete para retiro por tercero</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Descripción *</label>
              <input value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Ej. Sobre con documentos, bolsa..." style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Tipo</label>
              <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value as TipoPaquete }))} style={inputStyle}>
                {(Object.keys(TIPO_CONFIG) as TipoPaquete[]).map(t => <option key={t} value={t}>{TIPO_CONFIG[t].icon} {TIPO_CONFIG[t].label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Unidad del residente *</label>
              <select value={form.unidad_id} onChange={e => setForm(f => ({ ...f, unidad_id: e.target.value }))} style={inputStyle}>
                <option value="">Seleccionar...</option>
                {unidades.filter(u => u.activo).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Autorizado a retirar *</label>
              <input value={form.autorizado_nombre} onChange={e => setForm(f => ({ ...f, autorizado_nombre: e.target.value }))} placeholder="Nombre y apellido" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Documento (DPI/ID)</label>
              <input value={form.autorizado_documento} onChange={e => setForm(f => ({ ...f, autorizado_documento: e.target.value }))} placeholder="Opcional" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Teléfono</label>
              <input value={form.autorizado_telefono} onChange={e => setForm(f => ({ ...f, autorizado_telefono: e.target.value }))} placeholder="Opcional" style={inputStyle} />
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
              {saving ? 'Registrando...' : '📤 Registrar y generar código'}
            </button>
            <button onClick={resetForm} style={{ padding: '10px 20px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}

      {filtrados.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>📤</div>
          <p style={{ fontWeight: 600, color: 'var(--at-ink-3)' }}>No hay paquetes para retiro por tercero</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtrados.map(p => {
            const tcfg = TIPO_CONFIG[p.tipo] ?? TIPO_CONFIG.paquete
            const enCustodia = !!p.recibido_por
            return (
              <div key={p.id} style={{ background: 'var(--at-surface)', border: `1.5px solid ${p.estado === 'pendiente' ? 'var(--at-primary-soft-2)' : 'var(--at-line)'}`, borderRadius: '12px', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '14px' }}>
                {p.fotos && p.fotos.length > 0 ? (
                  <SecureImage src={p.fotos[0]} alt="" style={{ width: '46px', height: '46px', objectFit: 'cover', borderRadius: '8px', flexShrink: 0, border: '1px solid var(--at-line)' }} />
                ) : (
                  <div style={{ fontSize: '28px', flexShrink: 0 }}>{tcfg.icon}</div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    {p.descripcion}
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', background: 'var(--at-chip)', borderRadius: '20px', padding: '2px 9px' }}>{tcfg.icon} {tcfg.label}</span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '3px' }}>
                    {p.unidad_nombre && <span>📍 {p.unidad_nombre}</span>}
                    <span>· Retira: <strong style={{ color: 'var(--at-ink-2)' }}>{p.autorizado_nombre}</strong></span>
                    {p.autorizado_documento && <span>· {p.autorizado_documento}</span>}
                    {p.autorizado_telefono && <span>· 📞 {p.autorizado_telefono}</span>}
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', marginTop: '3px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                    {p.codigo_retiro && p.estado === 'pendiente' && (
                      <span>Código: <strong style={{ color: 'var(--at-ink)', letterSpacing: '0.06em' }}>{p.codigo_retiro}</strong></span>
                    )}
                    {p.estado === 'pendiente' && (
                      <span style={{ color: enCustodia ? 'var(--at-success)' : 'var(--at-warning-strong)', fontWeight: 600 }}>
                        {enCustodia ? '● En custodia' : '○ Sin depositar'}
                      </span>
                    )}
                    {p.estado === 'entregado' && p.hora_entrega && <span>Retirado: {new Date(p.hora_entrega).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
                  </div>
                  {p.estado === 'entregado' && (p.entregado_a_nombre || p.firma_path) && (
                    <div style={{ fontSize: '11.5px', color: 'var(--at-success)', fontWeight: 600, marginTop: '3px' }}>
                      ✍ Retirado{p.entregado_a_nombre ? ` por ${p.entregado_a_nombre}` : ''}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', flexShrink: 0 }}>
                  {p.firma_path && (
                    <SecureImage src={p.firma_path} alt="firma" style={{ width: '60px', height: '34px', objectFit: 'contain', background: '#fff', borderRadius: '6px', border: '1px solid var(--at-line)' }} />
                  )}
                  {p.estado === 'pendiente' && p.codigo_retiro && (
                    <button onClick={() => setVerCodigo(p)} style={{ padding: '5px 10px', background: 'var(--at-surface-2)', color: 'var(--at-ink-2)', border: '1px solid var(--at-line)', borderRadius: '8px', cursor: 'pointer', fontSize: '11.5px', fontWeight: 600 }}>
                      📲 Ver código/QR
                    </button>
                  )}
                  {canEdit && p.estado === 'pendiente' && !enCustodia && (
                    <button onClick={() => confirmarCustodia(p.id)} style={{ padding: '5px 10px', background: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', border: '1px solid var(--at-warning-border)', borderRadius: '8px', cursor: 'pointer', fontSize: '11.5px', fontWeight: 600 }}>
                      📥 Confirmar custodia
                    </button>
                  )}
                  {canEdit && p.estado === 'pendiente' && enCustodia && (
                    <button onClick={() => { setEntregando(p); setEntregaCodigo(''); setEntregaNombre(p.autorizado_nombre || '') }} style={{ padding: '6px 12px', background: 'var(--at-success-tint)', color: 'var(--at-success)', border: '1px solid var(--at-success-border)', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                      ✍ Entregar a tercero
                    </button>
                  )}
                  {canEdit && p.estado === 'pendiente' && (
                    <button onClick={() => devolver(p.id)} style={{ padding: '5px 10px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: '1px solid var(--at-danger-border)', borderRadius: '8px', cursor: 'pointer', fontSize: '11.5px' }}>
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

      {/* Modal: ver código + QR */}
      {verCodigo && (
        <EditModal title="Código de retiro" onClose={() => setVerCodigo(null)} maxWidth="380px">
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '13px', color: 'var(--at-ink-3)', marginBottom: '4px' }}>{verCodigo.descripcion} · {verCodigo.unidad_nombre ?? ''}</div>
            <div style={{ fontSize: '13px', color: 'var(--at-ink-2)', marginBottom: '14px' }}>Para: <strong>{verCodigo.autorizado_nombre}</strong></div>
            <div style={{ fontSize: '34px', fontWeight: 800, letterSpacing: '0.18em', color: 'var(--at-primary)', marginBottom: '14px' }}>{verCodigo.codigo_retiro}</div>
            {verCodigo.codigo_retiro && (
              <img src={codigoRetiroQrUrl(verCodigo.codigo_retiro)} alt="QR del código" style={{ width: '180px', height: '180px', border: '1px solid var(--at-line)', borderRadius: '10px' }} />
            )}
            <p style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '14px' }}>
              Comparta este código con quien recogerá el paquete. Lo necesitará en portería.
            </p>
          </div>
        </EditModal>
      )}

      {/* Modal: entregar a tercero */}
      {entregando && (
        <EditModal title={`Entregar a tercero · ${entregando.unidad_nombre ?? ''}`} onClose={() => { if (!entregaSaving) { setEntregando(null); setEntregaCodigo(''); setEntregaNombre('') } }} maxWidth="460px">
          <div style={{ marginBottom: '14px' }}>
            <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--at-ink)' }}>{entregando.descripcion}</div>
            <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>Autorizado: {entregando.autorizado_nombre}{entregando.autorizado_documento ? ` · ${entregando.autorizado_documento}` : ''}</div>
          </div>
          <label style={labelStyle}>Código de retiro *</label>
          <input value={entregaCodigo} onChange={e => setEntregaCodigo(e.target.value)} placeholder="Código que muestra quien recoge"
            style={{ ...inputStyle, marginBottom: '12px', letterSpacing: '0.1em', textTransform: 'uppercase' }} />
          <label style={labelStyle}>Nombre de quien retira</label>
          <input value={entregaNombre} onChange={e => setEntregaNombre(e.target.value)} placeholder="Nombre y apellido"
            style={{ ...inputStyle, marginBottom: '14px' }} />
          <SignaturePad onSave={handleEntregar} onCancel={() => { setEntregando(null); setEntregaCodigo(''); setEntregaNombre('') }} saving={entregaSaving} saveLabel="Validar y entregar" />
        </EditModal>
      )}
    </div>
  )
}
