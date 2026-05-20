import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { AlertaCondominio, TipoAlerta, PolizaSeguro, ContratoProveedor, InspeccionNormativa, LlaveCondominio } from '../../../types'
import Swal from 'sweetalert2'

interface Props {
  alertas: AlertaCondominio[]
  polizas: PolizaSeguro[]
  contratos: ContratoProveedor[]
  inspecciones: InspeccionNormativa[]
  llaves: LlaveCondominio[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPO_LABELS: Record<TipoAlerta, { label: string; color: string; bg: string }> = {
  urgente:       { label: 'Urgente',       color: '#ef4444', bg: '#fee2e2' },
  vencimiento:   { label: 'Vencimiento',   color: '#f59e0b', bg: '#fef3c7' },
  recordatorio:  { label: 'Recordatorio',  color: '#1B3B36', bg: '#D9E2DC' },
  aviso:         { label: 'Aviso',         color: '#B96A3F', bg: '#F4EBE3' },
}

const DAYS_WARNING = 30

function daysUntil(dateStr: string) {
  const diff = new Date(dateStr).getTime() - Date.now()
  return Math.ceil(diff / 86400000)
}

interface AutoAlert {
  key: string
  tipo: TipoAlerta
  titulo: string
  descripcion: string
  fecha_alerta: string
  referencia_tabla: string
  referencia_id: string
}

function buildAutoAlerts(
  polizas: PolizaSeguro[],
  contratos: ContratoProveedor[],
  inspecciones: InspeccionNormativa[],
  llaves: LlaveCondominio[],
): AutoAlert[] {
  const alerts: AutoAlert[] = []

  for (const p of polizas) {
    if (!p.fecha_vencimiento) continue
    const d = daysUntil(p.fecha_vencimiento)
    if (d <= DAYS_WARNING) {
      alerts.push({
        key: `poliza-${p.id}`,
        tipo: d <= 7 ? 'urgente' : 'vencimiento',
        titulo: `Póliza por vencer: ${p.aseguradora}`,
        descripcion: `Vence en ${d <= 0 ? 'fecha pasada' : `${d} día(s)`}`,
        fecha_alerta: p.fecha_vencimiento,
        referencia_tabla: 'polizas_seguro',
        referencia_id: p.id,
      })
    }
  }

  for (const c of contratos) {
    if (!c.fecha_fin) continue
    const d = daysUntil(c.fecha_fin)
    if (d <= DAYS_WARNING) {
      alerts.push({
        key: `contrato-${c.id}`,
        tipo: d <= 7 ? 'urgente' : 'vencimiento',
        titulo: `Contrato por vencer: ${c.proveedor_nombre}`,
        descripcion: `Vence en ${d <= 0 ? 'fecha pasada' : `${d} día(s)`}`,
        fecha_alerta: c.fecha_fin,
        referencia_tabla: 'contratos_proveedores',
        referencia_id: c.id,
      })
    }
  }

  for (const i of inspecciones) {
    if (!i.fecha_proxima) continue
    const d = daysUntil(i.fecha_proxima)
    if (d <= DAYS_WARNING) {
      alerts.push({
        key: `inspeccion-${i.id}`,
        tipo: d <= 7 ? 'urgente' : 'recordatorio',
        titulo: `Inspección próxima: ${i.tipo}`,
        descripcion: `Programada en ${d <= 0 ? 'fecha pasada' : `${d} día(s)`}`,
        fecha_alerta: i.fecha_proxima,
        referencia_tabla: 'inspecciones_normativas',
        referencia_id: i.id,
      })
    }
  }

  for (const l of llaves) {
    if (l.estado === 'perdida') {
      alerts.push({
        key: `llave-${l.id}`,
        tipo: 'urgente',
        titulo: `Llave/acceso reportado perdido`,
        descripcion: `${l.tipo.toUpperCase()} — ${l.codigo ?? 'sin código'} → ${l.unidad_nombre ?? 'unidad desconocida'}`,
        fecha_alerta: l.created_at.slice(0, 10),
        referencia_tabla: 'llaves_condominio',
        referencia_id: l.id,
      })
    }
  }

  return alerts.sort((a, b) => new Date(a.fecha_alerta).getTime() - new Date(b.fecha_alerta).getTime())
}

const BLANK: Omit<AlertaCondominio, 'id' | 'company_id' | 'project_id' | 'created_at'> = {
  tipo: 'aviso',
  titulo: '',
  descripcion: '',
  fecha_alerta: new Date().toISOString().slice(0, 10),
  estado: 'activa',
  referencia_tabla: undefined,
  referencia_id: undefined,
}

export function AlertasTab({ alertas, polizas, contratos, inspecciones, llaves, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<'activa' | 'resuelta' | 'ignorada' | 'all'>('activa')

  const autoAlerts = buildAutoAlerts(polizas, contratos, inspecciones, llaves)
  const storedActivas = alertas.filter(a => filtroEstado === 'all' ? true : a.estado === filtroEstado)

  const totalUrgentes = alertas.filter(a => a.estado === 'activa' && a.tipo === 'urgente').length
    + autoAlerts.filter(a => a.tipo === 'urgente').length
  const totalVencimientos = alertas.filter(a => a.estado === 'activa' && a.tipo === 'vencimiento').length
    + autoAlerts.filter(a => a.tipo === 'vencimiento').length
  const totalAuto = autoAlerts.length

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  async function handleSave() {
    if (!form.titulo.trim() || !form.fecha_alerta) return Swal.fire('Campos requeridos', 'Título y fecha son obligatorios.', 'warning')
    setSaving(true)
    const { error } = await supabase.from('alertas_condominio').insert({
      company_id: companyId,
      project_id: proyectoId,
      tipo: form.tipo,
      titulo: form.titulo.trim(),
      descripcion: form.descripcion || null,
      fecha_alerta: form.fecha_alerta,
      estado: 'activa',
    })
    setSaving(false)
    if (error) return Swal.fire('Error', error.message, 'error')
    setShowForm(false)
    setForm({ ...BLANK })
    onRefresh()
  }

  async function handleEstado(id: string, estado: 'resuelta' | 'ignorada') {
    await supabase.from('alertas_condominio').update({ estado }).eq('id', id)
    onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar alerta?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: '#ef4444' })
    if (!r.isConfirmed) return
    await supabase.from('alertas_condominio').delete().eq('id', id)
    onRefresh()
  }

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid #E1DDD0', borderRadius: '8px', fontSize: '13px', color: '#15291F', background: '#FAF7EF', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '20px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#15291F' }}>Alertas y Notificaciones</h2>
        {canCreate && (
          <button onClick={() => setShowForm(v => !v)}
            style={{ padding: '8px 16px', background: '#1B3B36', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Nueva Alerta
          </button>
        )}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Urgentes activas',   value: totalUrgentes,    icon: '🚨', color: '#ef4444' },
          { label: 'Vencimientos próximos', value: totalVencimientos, icon: '⏰', color: '#f59e0b' },
          { label: 'Auto-detectadas',    value: totalAuto,        icon: '🤖', color: '#1B3B36' },
          { label: 'Manuales activas',   value: alertas.filter(a => a.estado === 'activa').length, icon: '📌', color: '#B96A3F' },
        ].map(k => (
          <div key={k.label} style={{ background: 'white', border: '1.5px solid #E1DDD0', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '22px', marginBottom: '4px' }}>{k.icon}</div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '11px', color: '#7E9389', fontWeight: 500 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: '#FAF7EF', border: '1.5px solid #E1DDD0', borderRadius: '12px', padding: '16px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: '14px', fontWeight: 700, color: '#15291F' }}>Nueva alerta manual</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '4px' }}>Tipo *</label>
              <select value={form.tipo} onChange={e => setF('tipo', e.target.value as TipoAlerta)} style={inputStyle}>
                {(Object.keys(TIPO_LABELS) as TipoAlerta[]).map(t => (
                  <option key={t} value={t}>{TIPO_LABELS[t].label}</option>
                ))}
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '4px' }}>Título *</label>
              <input style={inputStyle} value={form.titulo} onChange={e => setF('titulo', e.target.value)} placeholder="Descripción breve de la alerta" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '4px' }}>Fecha alerta *</label>
              <input style={inputStyle} type="date" value={form.fecha_alerta} onChange={e => setF('fecha_alerta', e.target.value)} />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '4px' }}>Descripción</label>
              <input style={inputStyle} value={form.descripcion ?? ''} onChange={e => setF('descripcion', e.target.value)} placeholder="Detalles adicionales (opcional)" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '14px' }}>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '8px 20px', background: '#1B3B36', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={() => setShowForm(false)}
              style={{ padding: '8px 14px', background: 'white', border: '1.5px solid #E1DDD0', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: '#7E9389' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Auto-detected alerts */}
      {autoAlerts.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '13px', fontWeight: 700, color: '#7E9389', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            🤖 Auto-detectadas ({autoAlerts.length})
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {autoAlerts.map(a => {
              const t = TIPO_LABELS[a.tipo]
              return (
                <div key={a.key} style={{ background: t.bg, border: `1.5px solid ${t.color}30`, borderRadius: '10px', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: t.color, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: '13px', color: '#15291F' }}>{a.titulo}</div>
                    <div style={{ fontSize: '12px', color: '#7E9389', marginTop: '2px' }}>{a.descripcion}</div>
                  </div>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: t.color, background: 'white', padding: '3px 8px', borderRadius: '20px', flexShrink: 0 }}>
                    {t.label}
                  </span>
                  <span style={{ fontSize: '11px', color: '#7E9389', flexShrink: 0 }}>{a.fecha_alerta}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Manual stored alerts */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
          <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: '#7E9389', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            📌 Alertas manuales ({alertas.length})
          </h3>
          <div style={{ display: 'flex', gap: '6px' }}>
            {(['activa', 'resuelta', 'ignorada', 'all'] as const).map(e => (
              <button key={e} onClick={() => setFiltroEstado(e)}
                style={{ padding: '4px 10px', fontSize: '11px', fontWeight: 600, borderRadius: '20px', border: '1.5px solid', cursor: 'pointer',
                  background: filtroEstado === e ? '#15291F' : 'white',
                  color: filtroEstado === e ? 'white' : '#7E9389',
                  borderColor: filtroEstado === e ? '#15291F' : '#E1DDD0' }}>
                {e === 'all' ? 'Todas' : e.charAt(0).toUpperCase() + e.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {storedActivas.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px', color: '#7E9389', fontSize: '13px' }}>
            No hay alertas manuales {filtroEstado !== 'all' ? `con estado "${filtroEstado}"` : ''}.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {storedActivas.map(a => {
              const t = TIPO_LABELS[a.tipo]
              const d = daysUntil(a.fecha_alerta)
              return (
                <div key={a.id} style={{ background: a.estado !== 'activa' ? '#FAF7EF' : t.bg, border: `1.5px solid ${a.estado !== 'activa' ? '#E1DDD0' : t.color + '40'}`, borderRadius: '10px', padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: a.estado !== 'activa' ? '#C7C2B0' : t.color, flexShrink: 0, marginTop: '5px' }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: '13px', color: a.estado !== 'activa' ? '#7E9389' : '#15291F', textDecoration: a.estado === 'ignorada' ? 'line-through' : 'none' }}>
                        {a.titulo}
                      </div>
                      {a.descripcion && <div style={{ fontSize: '12px', color: '#7E9389', marginTop: '2px' }}>{a.descripcion}</div>}
                      <div style={{ fontSize: '11px', color: '#7E9389', marginTop: '4px' }}>
                        {a.fecha_alerta} {a.estado === 'activa' && d <= 7 && d > 0 ? `— ⚠️ ${d} día(s)` : a.estado === 'activa' && d <= 0 ? '— ⛔ Vencida' : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexShrink: 0, alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: a.estado !== 'activa' ? '#7E9389' : t.color, background: 'white', padding: '3px 8px', borderRadius: '20px', border: '1px solid #E1DDD0' }}>
                        {t.label}
                      </span>
                      {canEdit && a.estado === 'activa' && (
                        <>
                          <button onClick={() => handleEstado(a.id, 'resuelta')}
                            style={{ padding: '4px 10px', background: '#dcfce7', color: '#16a34a', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>
                            ✓ Resolver
                          </button>
                          <button onClick={() => handleEstado(a.id, 'ignorada')}
                            style={{ padding: '4px 8px', background: '#EAE6D8', color: '#7E9389', border: 'none', borderRadius: '6px', fontSize: '11px', cursor: 'pointer' }}>
                            Ignorar
                          </button>
                        </>
                      )}
                      {canEdit && (
                        <button onClick={() => handleDelete(a.id)}
                          style={{ padding: '4px 7px', background: '#fee2e2', border: 'none', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', color: '#ef4444' }}>
                          🗑️
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
