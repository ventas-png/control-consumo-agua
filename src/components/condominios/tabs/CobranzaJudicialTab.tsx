import React, { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import Swal from 'sweetalert2'
import { CobranzaJudicial, EtapaCobranzaJudicial, EstadoCobranzaJudicial, Unidad } from '../../../types'

interface Props {
  cobranzas: CobranzaJudicial[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ETAPAS: EtapaCobranzaJudicial[] = ['carta_notarial', 'juzgado', 'sentencia', 'ejecutado', 'archivado']
const ETAPA_CFG: Record<EtapaCobranzaJudicial, { label: string; icon: string; color: string; bg: string }> = {
  carta_notarial: { label: 'Carta notarial', icon: '📬', color: '#d97706', bg: '#fef3c7' },
  juzgado:        { label: 'En juzgado',     icon: '⚖️',  color: '#7c3aed', bg: '#f5f3ff' },
  sentencia:      { label: 'Sentencia',       icon: '📋', color: '#2563eb', bg: '#dbeafe' },
  ejecutado:      { label: 'Ejecutado',       icon: '✅', color: '#16a34a', bg: '#dcfce7' },
  archivado:      { label: 'Archivado',       icon: '📁', color: '#6b7280', bg: '#f3f4f6' },
}
const ESTADO_CFG: Record<EstadoCobranzaJudicial, { label: string; bg: string; color: string }> = {
  activo:   { label: 'Activo',   bg: '#fef2f2', color: '#ef4444' },
  resuelto: { label: 'Resuelto', bg: '#dcfce7', color: '#16a34a' },
  archivado:{ label: 'Archivado',bg: '#f3f4f6', color: '#9ca3af' },
}

const BLANK = {
  unidad_id: '', etapa: 'carta_notarial' as EtapaCobranzaJudicial,
  monto_adeudado: '', fecha_inicio: new Date().toISOString().slice(0, 10),
  abogado: '', expediente: '', notas: '',
}

export default function CobranzaJudicialTab({ cobranzas, unidades, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<CobranzaJudicial | null>(null)
  const [filtroEstado, setFiltroEstado] = useState<EstadoCobranzaJudicial | ''>('')
  const [form, setForm] = useState(BLANK)

  const lista = cobranzas.filter(c => !filtroEstado || c.estado === filtroEstado)
  const activos = cobranzas.filter(c => c.estado === 'activo').length
  const montoTotal = cobranzas.filter(c => c.estado === 'activo').reduce((s, c) => s + c.monto_adeudado, 0)

  async function guardar() {
    if (!form.unidad_id || !form.monto_adeudado) {
      Swal.fire('Error', 'Unidad y monto son obligatorios', 'warning'); return
    }
    setSaving(true)
    const { error } = await supabase.from('cobranza_judicial').insert({
      company_id: companyId, project_id: proyectoId,
      unidad_id: form.unidad_id, etapa: form.etapa,
      monto_adeudado: parseFloat(form.monto_adeudado),
      fecha_inicio: form.fecha_inicio,
      abogado: form.abogado.trim() || null,
      expediente: form.expediente.trim() || null,
      notas: form.notas.trim() || null,
    })
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    setMostrarForm(false); setForm(BLANK); onRefresh()
  }

  async function avanzarEtapa(c: CobranzaJudicial) {
    const idx = ETAPAS.indexOf(c.etapa)
    if (idx >= ETAPAS.length - 1) return
    const siguienteEtapa = ETAPAS[idx + 1]
    await supabase.from('cobranza_judicial').update({
      etapa: siguienteEtapa, fecha_actualizacion: new Date().toISOString().slice(0, 10),
    }).eq('id', c.id)
    onRefresh()
  }

  async function cambiarEstado(id: string, estado: EstadoCobranzaJudicial) {
    await supabase.from('cobranza_judicial').update({ estado }).eq('id', id)
    onRefresh()
  }

  async function editarNotas(c: CobranzaJudicial) {
    const { value } = await Swal.fire({
      title: 'Actualizar notas',
      input: 'textarea', inputValue: c.notas ?? '',
      inputAttributes: { rows: '4', style: 'font-size:13px' },
      showCancelButton: true, confirmButtonText: 'Guardar', cancelButtonText: 'Cancelar',
    })
    if (value === undefined) return
    await supabase.from('cobranza_judicial').update({ notas: value || null }).eq('id', c.id)
    onRefresh()
  }

  const inp: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }
  const lbl: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 3, display: 'block' }

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Casos activos', val: activos, bg: '#fef2f2', color: '#ef4444' },
          { label: 'Monto en litigio', val: `${moneda} ${montoTotal.toFixed(2)}`, bg: '#fff7ed', color: '#ea580c' },
          { label: 'Resueltos', val: cobranzas.filter(c => c.estado === 'resuelto').length, bg: '#dcfce7', color: '#16a34a' },
          { label: 'Total casos', val: cobranzas.length, bg: '#f9fafb', color: '#374151' },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: k.color }}>{k.val}</div>
            <div style={{ fontSize: 11, color: k.color }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['', 'activo', 'resuelto', 'archivado'] as (EstadoCobranzaJudicial | '')[]).map(e => (
            <button key={e} onClick={() => setFiltroEstado(e)}
              style={{ padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1.5px solid', borderColor: filtroEstado === e ? '#ef4444' : '#e2e8f0', background: filtroEstado === e ? '#fef2f2' : '#fff', color: filtroEstado === e ? '#ef4444' : '#64748b' }}>
              {e === '' ? 'Todos' : ESTADO_CFG[e].label}
            </button>
          ))}
        </div>
        {canCreate && (
          <button onClick={() => setMostrarForm(!mostrarForm)}
            style={{ padding: '8px 16px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {mostrarForm ? '✕ Cancelar' : '+ Nuevo caso'}
          </button>
        )}
      </div>

      {/* Formulario */}
      {mostrarForm && (
        <div style={{ background: '#fff5f5', border: '1px solid #fecaca', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>Nuevo caso de cobranza judicial</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={lbl}>Unidad *</label>
              <select style={inp} value={form.unidad_id} onChange={e => setForm(p => ({ ...p, unidad_id: e.target.value }))}>
                <option value="">Seleccionar…</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Monto adeudado ({moneda}) *</label>
              <input type="number" step="0.01" style={inp} value={form.monto_adeudado} onChange={e => setForm(p => ({ ...p, monto_adeudado: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Etapa inicial</label>
              <select style={inp} value={form.etapa} onChange={e => setForm(p => ({ ...p, etapa: e.target.value as EtapaCobranzaJudicial }))}>
                {ETAPAS.slice(0, -1).map(et => <option key={et} value={et}>{ETAPA_CFG[et].icon} {ETAPA_CFG[et].label}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Fecha de inicio</label>
              <input type="date" style={inp} value={form.fecha_inicio} onChange={e => setForm(p => ({ ...p, fecha_inicio: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Abogado / estudio</label>
              <input style={inp} value={form.abogado} onChange={e => setForm(p => ({ ...p, abogado: e.target.value }))} placeholder="Nombre del abogado" />
            </div>
            <div>
              <label style={lbl}>No. expediente</label>
              <input style={inp} value={form.expediente} onChange={e => setForm(p => ({ ...p, expediente: e.target.value }))} placeholder="Ej. 2026-0123" />
            </div>
            <div style={{ gridColumn: 'span 3' }}>
              <label style={lbl}>Notas</label>
              <input style={inp} value={form.notas} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} placeholder="Observaciones iniciales" />
            </div>
          </div>
          <button onClick={guardar} disabled={saving}
            style={{ padding: '8px 20px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {saving ? 'Guardando…' : '✅ Crear caso'}
          </button>
        </div>
      )}

      {/* Lista + Detalle */}
      {lista.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#9ca3af', padding: '40px 0', fontSize: 13 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⚖️</div>
          Sin casos de cobranza judicial registrados
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {lista.map(c => {
              const ec = ETAPA_CFG[c.etapa]
              const es = ESTADO_CFG[c.estado]
              const etapaIdx = ETAPAS.indexOf(c.etapa)
              const unidad = unidades.find(u => u.id === c.unidad_id)
              return (
                <div key={c.id} onClick={() => setSelected(c === selected ? null : c)}
                  style={{ background: selected?.id === c.id ? '#fff5f5' : '#fff', border: `1.5px solid ${selected?.id === c.id ? '#ef4444' : '#e5e7eb'}`, borderRadius: 10, padding: '12px 16px', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 2 }}>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>{unidad?.nombre ?? c.unidad_nombre ?? '—'}</span>
                        <span style={{ padding: '1px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: es.bg, color: es.color }}>{es.label}</span>
                      </div>
                      <div style={{ fontSize: 12, color: '#6b7280' }}>
                        {moneda} {c.monto_adeudado.toFixed(2)}
                        {c.abogado && ` · ${c.abogado}`}
                        {c.expediente && ` · Exp. ${c.expediente}`}
                      </div>
                    </div>
                    <span style={{ padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: ec.bg, color: ec.color }}>{ec.icon} {ec.label}</span>
                  </div>
                  {/* Timeline */}
                  <div style={{ display: 'flex', gap: 0, alignItems: 'center' }}>
                    {ETAPAS.slice(0, -1).map((et, i) => {
                      const done = i <= etapaIdx && c.etapa !== 'archivado'
                      const current = i === etapaIdx && c.etapa !== 'archivado'
                      return (
                        <React.Fragment key={et}>
                          <div style={{ width: 10, height: 10, borderRadius: '50%', background: current ? '#ef4444' : done ? '#fca5a5' : '#e5e7eb', border: current ? '2px solid #ef4444' : 'none', flexShrink: 0 }} />
                          {i < 3 && <div style={{ flex: 1, height: 2, background: i < etapaIdx && c.etapa !== 'archivado' ? '#fca5a5' : '#e5e7eb' }} />}
                        </React.Fragment>
                      )
                    })}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#9ca3af', marginTop: 2, paddingRight: 4 }}>
                    {ETAPAS.slice(0, -1).map(et => <span key={et}>{ETAPA_CFG[et].label.split(' ')[0]}</span>)}
                  </div>
                </div>
              )
            })}
          </div>
          {selected && (
            <div style={{ width: 260, flexShrink: 0, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, alignSelf: 'flex-start' }}>
              <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>Detalle del caso</div>
              {[
                ['Unidad', unidades.find(u => u.id === selected.unidad_id)?.nombre ?? selected.unidad_nombre ?? '—'],
                ['Monto', `${moneda} ${selected.monto_adeudado.toFixed(2)}`],
                ['Etapa', `${ETAPA_CFG[selected.etapa].icon} ${ETAPA_CFG[selected.etapa].label}`],
                ['Estado', ESTADO_CFG[selected.estado].label],
                ['Inicio', selected.fecha_inicio],
                ['Actualizado', selected.fecha_actualizacion ?? '—'],
                ['Abogado', selected.abogado ?? '—'],
                ['Expediente', selected.expediente ?? '—'],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '5px 0', borderBottom: '1px solid #f3f4f6' }}>
                  <span style={{ color: '#6b7280' }}>{k}</span>
                  <span style={{ fontWeight: 600, color: '#374151' }}>{v}</span>
                </div>
              ))}
              {selected.notas && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 8, lineHeight: 1.4 }}>{selected.notas}</div>}
              {canEdit && selected.estado === 'activo' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
                  {selected.etapa !== 'ejecutado' && selected.etapa !== 'archivado' && (
                    <button onClick={() => avanzarEtapa(selected)}
                      style={{ padding: '7px 0', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                      ▶ Avanzar etapa
                    </button>
                  )}
                  <button onClick={() => editarNotas(selected)}
                    style={{ padding: '7px 0', background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                    📝 Editar notas
                  </button>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => cambiarEstado(selected.id, 'resuelto')}
                      style={{ flex: 1, padding: '6px 0', background: '#dcfce7', color: '#16a34a', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                      ✅ Resuelto
                    </button>
                    <button onClick={() => cambiarEstado(selected.id, 'archivado')}
                      style={{ flex: 1, padding: '6px 0', background: '#f3f4f6', color: '#9ca3af', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 11 }}>
                      📁 Archivar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
