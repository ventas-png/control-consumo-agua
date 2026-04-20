import { useState } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../../lib/supabase'
import type { AnuncioComunidad, TipoAnuncio } from '../../../types'

interface Props {
  anuncios: AnuncioComunidad[]
  proyectoId: string
  companyId: string
  userId: string
  canCreate: boolean
  onRefresh: () => void
}

const TIPO_CONFIG: Record<TipoAnuncio, { label: string; bg: string; color: string; icon: string }> = {
  aviso:         { label: 'Aviso', bg: '#eff6ff', color: '#2563eb', icon: '📢' },
  urgente:       { label: 'Urgente', bg: '#fef2f2', color: '#dc2626', icon: '🚨' },
  evento:        { label: 'Evento', bg: '#f5f3ff', color: '#7c3aed', icon: '🎉' },
  mantenimiento: { label: 'Mantenimiento', bg: '#fff7ed', color: '#ea580c', icon: '🔧' },
}

export function ComunidadTab({ anuncios, proyectoId, companyId, userId, canCreate, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroTipo, setFiltroTipo] = useState<TipoAnuncio | 'todos'>('todos')
  const [soloActivos, setSoloActivos] = useState(true)
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
    setShowForm(false)
  }

  async function handlePublicar() {
    if (!form.titulo.trim()) { Swal.fire('Error', 'Ingrese el título del anuncio.', 'error'); return }
    if (!form.contenido.trim()) { Swal.fire('Error', 'Ingrese el contenido del anuncio.', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('anuncios_comunidad').insert({
      company_id: companyId,
      project_id: proyectoId,
      titulo: form.titulo.trim(),
      contenido: form.contenido.trim(),
      tipo: form.tipo,
      publicado_por: userId,
      fecha_evento: form.fecha_evento || null,
      activo: true,
    })
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    Swal.fire({ icon: 'success', title: 'Anuncio publicado', timer: 1500, showConfirmButton: false })
    resetForm()
    onRefresh()
  }

  async function toggleActivo(anuncio: AnuncioComunidad) {
    const { error } = await supabase.from('anuncios_comunidad').update({ activo: !anuncio.activo }).eq('id', anuncio.id)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    onRefresh()
  }

  async function eliminar(id: string) {
    const result = await Swal.fire({ title: '¿Eliminar anuncio?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar', confirmButtonColor: '#ef4444' })
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
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>Tablón Comunitario</h2>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '13.5px' }}>
            {activos} anuncios activos · {eventos} eventos próximos
          </p>
        </div>
        {canCreate && (
          <button onClick={() => setShowForm(true)} style={{ padding: '10px 20px', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
            + Publicar anuncio
          </button>
        )}
      </div>

      {/* Filtros tipo */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => setFiltroTipo('todos')}
          style={{ padding: '6px 14px', borderRadius: '20px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', border: '1.5px solid', borderColor: filtroTipo === 'todos' ? '#0ea5e9' : '#e2e8f0', background: filtroTipo === 'todos' ? '#eff6ff' : 'white', color: filtroTipo === 'todos' ? '#0ea5e9' : '#64748b' }}>
          Todos
        </button>
        {(Object.entries(TIPO_CONFIG) as [TipoAnuncio, typeof TIPO_CONFIG[TipoAnuncio]][]).map(([tipo, cfg]) => (
          <button key={tipo} onClick={() => setFiltroTipo(tipo)}
            style={{ padding: '6px 14px', borderRadius: '20px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', border: '1.5px solid', borderColor: filtroTipo === tipo ? cfg.color : '#e2e8f0', background: filtroTipo === tipo ? cfg.bg : 'white', color: filtroTipo === tipo ? cfg.color : '#64748b' }}>
            {cfg.icon} {cfg.label}
          </button>
        ))}
        <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#374151', cursor: 'pointer' }}>
          <input type="checkbox" checked={soloActivos} onChange={e => setSoloActivos(e.target.checked)} />
          Solo activos
        </label>
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>Nuevo anuncio</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Título *</label>
              <input value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} placeholder="Título del anuncio"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Tipo</label>
              <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value as TipoAnuncio }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }}>
                {(Object.entries(TIPO_CONFIG) as [TipoAnuncio, typeof TIPO_CONFIG[TipoAnuncio]][]).map(([v, cfg]) => (
                  <option key={v} value={v}>{cfg.icon} {cfg.label}</option>
                ))}
              </select>
            </div>
            {form.tipo === 'evento' && (
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Fecha del evento</label>
                <input type="date" value={form.fecha_evento} onChange={e => setForm(f => ({ ...f, fecha_evento: e.target.value }))}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
              </div>
            )}
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Contenido *</label>
              <textarea value={form.contenido} onChange={e => setForm(f => ({ ...f, contenido: e.target.value }))}
                placeholder="Escribe el mensaje para los residentes..." rows={4}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc', resize: 'vertical' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button onClick={handlePublicar} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Publicando...' : '📢 Publicar'}
            </button>
            <button onClick={resetForm} style={{ padding: '10px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Lista */}
      {filtrados.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>📋</div>
          <p style={{ fontWeight: 600, color: '#64748b' }}>No hay anuncios {filtroTipo !== 'todos' ? `de tipo "${filtroTipo}"` : ''}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {filtrados.map(a => {
            const cfg = TIPO_CONFIG[a.tipo]
            return (
              <div key={a.id} style={{ background: 'white', border: `1.5px solid ${a.activo ? cfg.color + '40' : '#e2e8f0'}`, borderRadius: '14px', padding: '18px 20px', opacity: a.activo ? 1 : 0.6 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  <div style={{ width: 40, height: 40, borderRadius: '12px', background: cfg.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', flexShrink: 0 }}>
                    {cfg.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                      <span style={{ padding: '2px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                      {!a.activo && <span style={{ padding: '2px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, background: '#f1f5f9', color: '#94a3b8' }}>Inactivo</span>}
                      {a.fecha_evento && <span style={{ fontSize: '12px', color: '#7c3aed', fontWeight: 600 }}>📅 {a.fecha_evento}</span>}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: '15px', color: '#0f172a', marginBottom: '6px' }}>{a.titulo}</div>
                    <div style={{ fontSize: '13.5px', color: '#374151', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>{a.contenido}</div>
                    <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '8px' }}>
                      {a.publicado_por_nombre && `Publicado por ${a.publicado_por_nombre} · `}
                      {new Date(a.created_at).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0 }}>
                    {canCreate && (
                      <button onClick={() => toggleActivo(a)} title={a.activo ? 'Desactivar' : 'Activar'}
                        style={{ padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', border: '1px solid #e2e8f0', background: a.activo ? '#f0fdf4' : '#f8fafc', color: a.activo ? '#16a34a' : '#64748b' }}>
                        {a.activo ? '✓ Activo' : '○ Inactivo'}
                      </button>
                    )}
                    <button onClick={() => eliminar(a.id)} title="Eliminar" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: '15px', padding: '4px', textAlign: 'center' }}>🗑</button>
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
