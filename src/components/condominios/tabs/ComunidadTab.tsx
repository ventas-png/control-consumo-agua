import { useState } from 'react'
import Swal from 'sweetalert2'
import { notify } from '../../shared/Dialog'
import { supabase } from '../../../lib/supabase'
import type { AnuncioComunidad, TipoAnuncio } from '../../../types'
import { ImageUploader } from '../../shared/ImageUploader'
import { SecureImage } from '../../shared/SecureImage'

interface Props {
  anuncios: AnuncioComunidad[]
  proyectoId: string
  companyId: string
  userId: string
  canCreate: boolean
  onRefresh: () => void
}

const TIPO_CONFIG: Record<TipoAnuncio, { label: string; bg: string; color: string; icon: string }> = {
  aviso:         { label: 'Aviso', bg: 'var(--at-primary-tint)', color: 'var(--at-primary)', icon: '📢' },
  urgente:       { label: 'Urgente', bg: 'var(--at-danger-tint)', color: 'var(--at-danger)', icon: '🚨' },
  evento:        { label: 'Evento', bg: 'var(--at-accent-tint-2)', color: 'var(--at-accent-hover)', icon: '🎉' },
  mantenimiento: { label: 'Mantenimiento', bg: 'var(--at-warning-tint)', color: 'var(--at-warning)', icon: '🔧' },
}

export function ComunidadTab({ anuncios, proyectoId, companyId, userId, canCreate, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroTipo, setFiltroTipo] = useState<TipoAnuncio | 'todos'>('todos')
  const [soloActivos, setSoloActivos] = useState(true)
  const [fotoUrl, setFotoUrl] = useState<string | null>(null)
  const [form, setForm] = useState({
    titulo: '',
    contenido: '',
    tipo: 'aviso' as TipoAnuncio,
    fecha_evento: '',
  })

  const filtrados = anuncios.filter(a => {
    const matchTipo = filtroTipo === 'todos' || a.tipo === filtroTipo
    const matchActivo = !soloActivos || a.activo
    return matchTipo && matchActivo
  })

  function resetForm() {
    setForm({ titulo: '', contenido: '', tipo: 'aviso', fecha_evento: '' })
    setFotoUrl(null)
    setShowForm(false)
  }

  async function handlePublicar() {
    if (!form.titulo.trim()) { notify({ variant: 'error', title: 'Error', text: 'Ingrese el título del anuncio.' }); return }
    if (!form.contenido.trim()) { notify({ variant: 'error', title: 'Error', text: 'Ingrese el contenido del anuncio.' }); return }
    setSaving(true)
    const { error } = await supabase.from('anuncios_comunidad').insert({
      company_id: companyId,
      project_id: proyectoId,
      titulo: form.titulo.trim(),
      contenido: form.contenido.trim(),
      tipo: form.tipo,
      publicado_por: userId,
      fecha_evento: form.fecha_evento || null,
      foto_url: fotoUrl,
      activo: true,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    notify({ variant: 'success', title: 'Anuncio publicado', duration: 1500 })
    resetForm()
    onRefresh()
  }

  async function toggleActivo(anuncio: AnuncioComunidad) {
    const { error } = await supabase.from('anuncios_comunidad').update({ activo: !anuncio.activo }).eq('id', anuncio.id)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
  }

  async function eliminar(id: string) {
    const result = await Swal.fire({ title: '¿Eliminar anuncio?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar', confirmButtonColor: 'var(--at-danger)' })
    if (!result.isConfirmed) return
    await supabase.from('anuncios_comunidad').delete().eq('id', id)
    onRefresh()
  }

  const activos = anuncios.filter(a => a.activo).length
  const eventos = anuncios.filter(a => a.tipo === 'evento' && a.fecha_evento && a.fecha_evento >= new Date().toISOString().slice(0, 10)).length

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--at-ink)' }}>Tablón Comunitario</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--at-ink-3)', fontSize: '13.5px' }}>
            {activos} anuncios activos · {eventos} eventos próximos
          </p>
        </div>
        {canCreate && (
          <button onClick={() => setShowForm(true)} style={{ padding: '10px 20px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
            + Publicar anuncio
          </button>
        )}
      </div>

      {/* Filtros tipo */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => setFiltroTipo('todos')}
          style={{ padding: '6px 14px', borderRadius: '20px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', border: '1.5px solid', borderColor: filtroTipo === 'todos' ? 'var(--at-primary)' : 'var(--at-line)', background: filtroTipo === 'todos' ? 'var(--at-primary-tint)' : 'var(--at-surface)', color: filtroTipo === 'todos' ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
          Todos
        </button>
        {(Object.entries(TIPO_CONFIG) as [TipoAnuncio, typeof TIPO_CONFIG[TipoAnuncio]][]).map(([tipo, cfg]) => (
          <button key={tipo} onClick={() => setFiltroTipo(tipo)}
            style={{ padding: '6px 14px', borderRadius: '20px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', border: '1.5px solid', borderColor: filtroTipo === tipo ? cfg.color : 'var(--at-line)', background: filtroTipo === tipo ? cfg.bg : 'var(--at-surface)', color: filtroTipo === tipo ? cfg.color : 'var(--at-ink-3)' }}>
            {cfg.icon} {cfg.label}
          </button>
        ))}
        <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--at-ink-2)', cursor: 'pointer' }}>
          <input type="checkbox" checked={soloActivos} onChange={e => setSoloActivos(e.target.checked)} />
          Solo activos
        </label>
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>Nuevo anuncio</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Título *</label>
              <input value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} placeholder="Título del anuncio"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Tipo</label>
              <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value as TipoAnuncio }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }}>
                {(Object.entries(TIPO_CONFIG) as [TipoAnuncio, typeof TIPO_CONFIG[TipoAnuncio]][]).map(([v, cfg]) => (
                  <option key={v} value={v}>{cfg.icon} {cfg.label}</option>
                ))}
              </select>
            </div>
            {form.tipo === 'evento' && (
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Fecha del evento</label>
                <input type="date" value={form.fecha_evento} onChange={e => setForm(f => ({ ...f, fecha_evento: e.target.value }))}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
              </div>
            )}
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Contenido *</label>
              <textarea value={form.contenido} onChange={e => setForm(f => ({ ...f, contenido: e.target.value }))}
                placeholder="Escribe el mensaje para los residentes..." rows={4}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)', resize: 'vertical' }} />
            </div>
            <div>
              <ImageUploader value={fotoUrl} onChange={setFotoUrl} folder="anuncios" label="Imagen del anuncio" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button onClick={handlePublicar} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Publicando...' : '📢 Publicar'}
            </button>
            <button onClick={resetForm} style={{ padding: '10px 20px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Lista */}
      {filtrados.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>📋</div>
          <p style={{ fontWeight: 600, color: 'var(--at-ink-3)' }}>No hay anuncios {filtroTipo !== 'todos' ? `de tipo "${filtroTipo}"` : ''}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {filtrados.map(a => {
            const cfg = TIPO_CONFIG[a.tipo]
            return (
              <div key={a.id} style={{ background: 'var(--at-surface)', border: `1.5px solid ${a.activo ? cfg.color + '40' : 'var(--at-line)'}`, borderRadius: '14px', padding: '18px 20px', opacity: a.activo ? 1 : 0.6 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  <div style={{ width: 40, height: 40, borderRadius: '12px', background: cfg.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', flexShrink: 0 }}>
                    {cfg.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                      <span style={{ padding: '2px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                      {!a.activo && <span style={{ padding: '2px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, background: 'var(--at-chip)', color: 'var(--at-ink-3)' }}>Inactivo</span>}
                      {a.fecha_evento && <span style={{ fontSize: '12px', color: 'var(--at-accent-hover)', fontWeight: 600 }}>📅 {a.fecha_evento}</span>}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--at-ink)', marginBottom: '6px' }}>{a.titulo}</div>
                    <div style={{ fontSize: '13.5px', color: 'var(--at-ink-2)', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>{a.contenido}</div>
                    {a.foto_url && (
                      <SecureImage src={a.foto_url} alt="anuncio" style={{ marginTop: 10, maxWidth: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--at-line)', cursor: 'zoom-in' }}
                        onClick={() => window.open(a.foto_url!, '_blank')} />
                    )}
                    <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '8px' }}>
                      {a.publicado_por_nombre && `Publicado por ${a.publicado_por_nombre} · `}
                      {new Date(a.created_at).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0 }}>
                    {canCreate && (
                      <button onClick={() => toggleActivo(a)} title={a.activo ? 'Desactivar' : 'Activar'}
                        style={{ padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', border: '1px solid var(--at-line)', background: a.activo ? 'var(--at-success-tint)' : 'var(--at-surface-2)', color: a.activo ? 'var(--at-success)' : 'var(--at-ink-3)' }}>
                        {a.activo ? '✓ Activo' : '○ Inactivo'}
                      </button>
                    )}
                    <button onClick={() => eliminar(a.id)} title="Eliminar" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--at-danger)', fontSize: '15px', padding: '4px', textAlign: 'center' }}>🗑</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
