import { useState, useEffect, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { MedidorUnidad, Unidad, Contador } from '../../../types'
import Swal from 'sweetalert2'

interface Props {
  medidores: MedidorUnidad[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

interface ConsumoResumen {
  contador_id: string
  consumo_total: number
  num_registros: number
  ultima_lectura: string | null
}

export function MedidoresUnidadTab({ medidores, unidades, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [contadores, setContadores] = useState<Contador[]>([])
  const [consumos, setConsumos] = useState<ConsumoResumen[]>([])
  const [loadingCtrs, setLoadingCtrs] = useState(true)
  const [selectedUnidad, setSelectedUnidad] = useState('')
  const [selectedContador, setSelectedContador] = useState('')
  const [notas, setNotas] = useState('')
  const [saving, setSaving] = useState(false)
  const [mesFiltro, setMesFiltro] = useState(new Date().toISOString().slice(0, 7))

  useEffect(() => {
    if (!proyectoId || !companyId) return
    setLoadingCtrs(true)
    Promise.all([
      supabase.from('contadores').select('*').eq('project_id', proyectoId).eq('company_id', companyId).eq('activo', true).order('numero_serie'),
      supabase.from('registros').select('contador_id, consumo, fecha').eq('project_id', proyectoId).gte('fecha', `${mesFiltro}-01`).lte('fecha', `${mesFiltro}-31`),
    ]).then(([ctrsRes, regRes]) => {
      setContadores((ctrsRes.data ?? []) as Contador[])
      const map: Record<string, ConsumoResumen> = {}
      for (const r of (regRes.data ?? []) as { contador_id: string; consumo: number; fecha: string }[]) {
        if (!r.contador_id) continue
        if (!map[r.contador_id]) map[r.contador_id] = { contador_id: r.contador_id, consumo_total: 0, num_registros: 0, ultima_lectura: null }
        map[r.contador_id].consumo_total += r.consumo
        map[r.contador_id].num_registros += 1
        if (!map[r.contador_id].ultima_lectura || r.fecha > map[r.contador_id].ultima_lectura!) {
          map[r.contador_id].ultima_lectura = r.fecha
        }
      }
      setConsumos(Object.values(map))
      setLoadingCtrs(false)
    })
  }, [proyectoId, companyId, mesFiltro])

  const vinculados = new Set(medidores.map(m => `${m.unidad_id}:${m.contador_id}`))
  const contadorMap = Object.fromEntries(contadores.map(c => [c.id, c]))
  const consumoMap  = Object.fromEntries(consumos.map(c => [c.contador_id, c]))

  const disponibles = contadores.filter(c => !medidores.some(m => m.contador_id === c.id && m.activo))

  async function handleVincular() {
    if (!selectedUnidad || !selectedContador) return Swal.fire('Requerido', 'Selecciona unidad y contador.', 'warning')
    if (vinculados.has(`${selectedUnidad}:${selectedContador}`)) return Swal.fire('Ya vinculado', 'Esta combinación ya existe.', 'info')
    setSaving(true)
    const { error } = await supabase.from('medidores_unidad').insert({
      company_id: companyId, project_id: proyectoId,
      unidad_id: selectedUnidad, contador_id: selectedContador,
      notas: notas || null, activo: true,
    })
    setSaving(false)
    if (error) return Swal.fire('Error', error.message, 'error')
    setSelectedUnidad(''); setSelectedContador(''); setNotas(''); onRefresh()
  }

  async function handleDesactivar(id: string) {
    const r = await Swal.fire({ title: '¿Desvincular medidor?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Desvincular', confirmButtonColor: 'var(--at-danger)' })
    if (!r.isConfirmed) return
    await supabase.from('medidores_unidad').update({ activo: false }).eq('id', id)
    onRefresh()
  }

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }

  const activosCount  = medidores.filter(m => m.activo).length
  const totalConsumo  = consumos.reduce((s, c) => s + c.consumo_total, 0)

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Medidores por Unidad</h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', color: 'var(--at-ink-3)', fontWeight: 600 }}>Mes:</span>
          <input type="month" value={mesFiltro} onChange={e => setMesFiltro(e.target.value)}
            style={{ padding: '5px 10px', border: '1.5px solid var(--at-line)', borderRadius: '7px', fontSize: '13px', background: 'var(--at-surface)' }} />
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Vínculos activos', value: String(activosCount),        color: 'var(--at-success)' },
          { label: 'Contadores disp.', value: String(contadores.length),   color: 'var(--at-primary)' },
          { label: `Consumo ${mesFiltro}`, value: `${totalConsumo.toFixed(1)} m³`, color: 'var(--at-accent)' },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '18px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', fontWeight: 500 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Link form */}
      {canCreate && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '14px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: 700 }}>Vincular medidor a unidad</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Unidad *</label>
              <select style={inputStyle} value={selectedUnidad} onChange={e => setSelectedUnidad(e.target.value)}>
                <option value="">— Seleccionar —</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Contador *</label>
              <select style={inputStyle} value={selectedContador} onChange={e => setSelectedContador(e.target.value)}>
                <option value="">— Seleccionar —</option>
                {(disponibles.length > 0 ? disponibles : contadores).map(c => (
                  <option key={c.id} value={c.id}>{c.numero_serie} ({c.tipo_agua})</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Notas</label>
              <input style={inputStyle} value={notas} onChange={e => setNotas(e.target.value)} placeholder="Opcional" />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button onClick={handleVincular} disabled={saving}
                style={{ padding: '8px 18px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', width: '100%' }}>
                {saving ? '…' : '+ Vincular'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      {loadingCtrs ? (
        <div style={{ textAlign: 'center', padding: '32px', color: 'var(--at-ink-3)' }}>Cargando contadores…</div>
      ) : medidores.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--at-ink-3)', fontSize: '13px' }}>No hay medidores vinculados a unidades.</div>
      ) : (
        <div style={{ border: '1.5px solid var(--at-line)', borderRadius: '12px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: 'var(--at-surface-2)' }}>
                {['Unidad','Contador','Tipo Agua',`Consumo ${mesFiltro}`,'Última lectura','Estado',''].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', borderBottom: '1px solid var(--at-line)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {medidores.map((m, i) => {
                const ctr = contadorMap[m.contador_id]
                const cons = consumoMap[m.contador_id]
                return (
                  <tr key={m.id} style={{ background: i % 2 === 0 ? 'var(--at-surface)' : 'var(--at-surface-2)', borderBottom: '1px solid var(--at-chip)', opacity: m.activo ? 1 : 0.5 }}>
                    <td style={{ padding: '10px 12px', fontWeight: 600 }}>{m.unidad_nombre ?? '—'}</td>
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: '12px' }}>{ctr?.numero_serie ?? m.contador_id.slice(0,8)}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--at-ink-3)', textTransform: 'capitalize' }}>{ctr?.tipo_agua ?? '—'}</td>
                    <td style={{ padding: '10px 12px', fontWeight: cons ? 700 : 400, color: cons ? 'var(--at-accent)' : 'var(--at-ink-3)' }}>
                      {cons ? `${cons.consumo_total.toFixed(2)} m³` : '—'}
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--at-ink-3)', fontSize: '12px' }}>{cons?.ultima_lectura ?? '—'}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px',
                        background: m.activo ? 'var(--at-success-tint)' : 'var(--at-chip)',
                        color: m.activo ? 'var(--at-success)' : 'var(--at-ink-3)' }}>
                        {m.activo ? 'Activo' : 'Desvinculado'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      {canEdit && m.activo && (
                        <button onClick={() => handleDesactivar(m.id)}
                          style={{ padding: '3px 8px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>
                          Desvincular
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
