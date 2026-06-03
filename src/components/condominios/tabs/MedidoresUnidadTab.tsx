import { useState, useMemo, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { MedidorUnidad, Unidad } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
import { useContadoresPorProyectoQuery, useConsumoPorProyectoQuery } from '../../../domain/agua/queries'

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
  const [selectedUnidad, setSelectedUnidad] = useState('')
  const [selectedContador, setSelectedContador] = useState('')
  const [notas, setNotas] = useState('')
  const [saving, setSaving] = useState(false)
  const [mesFiltro, setMesFiltro] = useState(new Date().toISOString().slice(0, 7))

  // Capa de datos (T7): lecturas con scope vía TanStack Query. Reemplaza el
  // useEffect + Promise.all + useState manual. Comparte caché entre vistas que
  // pidan el mismo (proyecto, mes) y revalida solo al cambiar proyecto o mes.
  const { data: contadores = [], isLoading: loadingContadores } = useContadoresPorProyectoQuery(companyId, proyectoId)
  const { data: consumoRows = [], isLoading: loadingConsumo } = useConsumoPorProyectoQuery(proyectoId, mesFiltro)
  const loadingCtrs = loadingContadores || loadingConsumo

  // Agrega el consumo por contador (mismo loop que antes, ahora derivado de la query).
  const consumos = useMemo<ConsumoResumen[]>(() => {
    const map: Record<string, ConsumoResumen> = {}
    for (const r of consumoRows) {
      if (!r.contador_id) continue
      if (!map[r.contador_id]) map[r.contador_id] = { contador_id: r.contador_id, consumo_total: 0, num_registros: 0, ultima_lectura: null }
      map[r.contador_id].consumo_total += r.consumo
      map[r.contador_id].num_registros += 1
      if (!map[r.contador_id].ultima_lectura || r.fecha > map[r.contador_id].ultima_lectura!) {
        map[r.contador_id].ultima_lectura = r.fecha
      }
    }
    return Object.values(map)
  }, [consumoRows])

  const vinculados = new Set(medidores.map(m => `${m.unidad_id}:${m.contador_id}`))
  const contadorMap = Object.fromEntries(contadores.map(c => [c.id, c]))
  const consumoMap  = Object.fromEntries(consumos.map(c => [c.contador_id, c]))

  const disponibles = contadores.filter(c => !medidores.some(m => m.contador_id === c.id && m.activo))

  async function handleVincular() {
    if (!selectedUnidad || !selectedContador) return notify({ variant: 'warning', title: 'Requerido', text: 'Selecciona unidad y contador.' })
    if (vinculados.has(`${selectedUnidad}:${selectedContador}`)) return notify({ variant: 'info', title: 'Ya vinculado', text: 'Esta combinación ya existe.' })
    setSaving(true)
    const { error } = await supabase.from('medidores_unidad').insert({
      company_id: companyId, project_id: proyectoId,
      unidad_id: selectedUnidad, contador_id: selectedContador,
      notas: notas || null, activo: true,
    })
    setSaving(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setSelectedUnidad(''); setSelectedContador(''); setNotas(''); onRefresh()
  }

  async function handleDesactivar(id: string) {
    const r = await confirm({ title: '¿Desvincular medidor?', icon: 'warning', variant: 'danger', confirmText: 'Desvincular' })
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

      {/* Table — F3.9: migrado a <DataTable> shared */}
      <DataTable<MedidorUnidad>
        data={medidores}
        rowKey="id"
        pageSize={50}
        isLoading={loadingCtrs}
        emptyState={{ icon: '📊', title: 'No hay medidores vinculados a unidades' }}
        rowStyle={(m) => m.activo ? {} : { opacity: 0.5 }}
        columns={[
          { key: 'unidad_nombre', header: 'Unidad', sortable: true,
            accessor: (m) => m.unidad_nombre ?? '',
            render: (m) => <span style={{ fontWeight: 600 }}>{m.unidad_nombre ?? '—'}</span> },
          { key: 'contador', header: 'Contador', sortable: true,
            accessor: (m) => contadorMap[m.contador_id]?.numero_serie ?? m.contador_id,
            render: (m) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{contadorMap[m.contador_id]?.numero_serie ?? m.contador_id.slice(0,8)}</span> },
          { key: 'tipo_agua', header: 'Tipo Agua', hideOnMobile: true, sortable: true,
            accessor: (m) => contadorMap[m.contador_id]?.tipo_agua ?? '',
            render: (m) => <span style={{ color: 'var(--at-ink-3)', textTransform: 'capitalize' }}>{contadorMap[m.contador_id]?.tipo_agua ?? '—'}</span> },
          { key: 'consumo', header: `Consumo ${mesFiltro}`, align: 'right', sortable: true,
            accessor: (m) => consumoMap[m.contador_id]?.consumo_total ?? 0,
            render: (m) => {
              const cons = consumoMap[m.contador_id]
              return <span style={{ fontWeight: cons ? 700 : 400, color: cons ? 'var(--at-accent)' : 'var(--at-ink-3)' }}>
                {cons ? `${cons.consumo_total.toFixed(2)} m³` : '—'}
              </span>
            } },
          { key: 'ultima_lectura', header: 'Última lectura', hideOnMobile: true, sortable: true,
            accessor: (m) => consumoMap[m.contador_id]?.ultima_lectura ?? '',
            render: (m) => <span style={{ color: 'var(--at-ink-3)', fontSize: 12 }}>{consumoMap[m.contador_id]?.ultima_lectura ?? '—'}</span> },
          { key: 'activo', header: 'Estado', sortable: true,
            render: (m) => (
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
                background: m.activo ? 'var(--at-success-tint)' : 'var(--at-chip)',
                color: m.activo ? 'var(--at-success)' : 'var(--at-ink-3)' }}>
                {m.activo ? 'Activo' : 'Desvinculado'}
              </span>
            ) },
          { key: 'actions', header: '', align: 'right',
            render: (m) => (canEdit && m.activo) ? (
              <button onClick={(e) => { e.stopPropagation(); handleDesactivar(m.id) }}
                style={{ padding: '3px 8px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'none', borderRadius: 5, fontSize: 11, cursor: 'pointer' }}>
                Desvincular
              </button>
            ) : null },
        ] satisfies DataTableColumn<MedidorUnidad>[]}
      />
    </div>
  )
}
