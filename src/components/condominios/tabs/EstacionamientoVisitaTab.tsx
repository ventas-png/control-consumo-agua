import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import Swal from 'sweetalert2'
import { EstacionamientoVisita, TipoVehiculoVisita, Unidad } from '../../../types'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'

interface Props {
  registros: EstacionamientoVisita[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPOS_VEHICULO: { value: TipoVehiculoVisita; label: string }[] = [
  { value: 'auto', label: '🚗 Auto' },
  { value: 'moto', label: '🏍️ Moto' },
  { value: 'camion', label: '🚛 Camión' },
  { value: 'otro', label: '🚗 Otro' },
]

function duracion(entrada: string, salida?: string | null): string {
  const ini = new Date(entrada).getTime()
  const fin = salida ? new Date(salida).getTime() : Date.now()
  const mins = Math.floor((fin - ini) / 60000)
  if (mins < 60) return `${mins} min`
  return `${Math.floor(mins / 60)}h ${mins % 60}min`
}

export default function EstacionamientoVisitaTab({
  registros, unidades, proyectoId, companyId, canCreate, canEdit, onRefresh,
}: Props) {
  const hoy = new Date().toISOString().split('T')[0]
  const [fechaFiltro, setFechaFiltro] = useState(hoy)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState({
    espacio: '',
    placa: '',
    tipo_vehiculo: 'auto' as TipoVehiculoVisita,
    unidad_visitada: '',
    visitante_nombre: '',
    autorizado_por: '',
    notas: '',
  })

  const registrosFiltrados = registros.filter(r =>
    r.hora_entrada.startsWith(fechaFiltro)
  )

  const activos = registrosFiltrados.filter(r => !r.hora_salida)
  const historial = registrosFiltrados.filter(r => r.hora_salida)

  async function guardar() {
    if (!form.espacio.trim() || !form.placa.trim()) {
      Swal.fire('Faltan datos', 'Espacio y placa son obligatorios', 'warning')
      return
    }
    setSaving(true)
    const { error } = await supabase.from('estacionamiento_visita').insert({
      company_id: companyId,
      project_id: proyectoId,
      espacio: form.espacio.trim(),
      placa: form.placa.trim().toUpperCase(),
      tipo_vehiculo: form.tipo_vehiculo,
      unidad_visitada: form.unidad_visitada || null,
      visitante_nombre: form.visitante_nombre.trim() || null,
      autorizado_por: form.autorizado_por.trim() || null,
      notas: form.notas.trim() || null,
    })
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    setForm({ espacio: '', placa: '', tipo_vehiculo: 'auto', unidad_visitada: '', visitante_nombre: '', autorizado_por: '', notas: '' })
    setMostrarForm(false)
    onRefresh()
  }

  async function registrarSalida(id: string, placa: string) {
    const res = await Swal.fire({
      title: `Registrar salida`,
      text: `¿Confirmar salida del vehículo ${placa}?`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, registrar',
    })
    if (!res.isConfirmed) return
    const { error } = await supabase
      .from('estacionamiento_visita')
      .update({ hora_salida: new Date().toISOString() })
      .eq('id', id)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 4, display: 'block' }

  const historialColumns: DataTableColumn<EstacionamientoVisita>[] = [
    { key: 'espacio', header: 'Espacio', sortable: true },
    {
      key: 'placa',
      header: 'Placa',
      sortable: true,
      render: row => <span style={{ fontWeight: 600 }}>{row.placa}</span>,
    },
    {
      key: 'tipo_vehiculo',
      header: 'Vehículo',
      sortable: true,
      render: row => <span>{TIPOS_VEHICULO.find(t => t.value === row.tipo_vehiculo)?.label || row.tipo_vehiculo}</span>,
    },
    {
      key: 'unidad',
      header: 'Unidad',
      sortable: true,
      accessor: row => unidades.find(u => u.id === row.unidad_visitada)?.nombre ?? '',
      render: row => <span>{unidades.find(u => u.id === row.unidad_visitada)?.nombre || '—'}</span>,
    },
    {
      key: 'visitante_nombre',
      header: 'Visitante',
      sortable: true,
      accessor: row => row.visitante_nombre ?? '',
      render: row => <span>{row.visitante_nombre || '—'}</span>,
    },
    {
      key: 'hora_entrada',
      header: 'Entrada',
      sortable: true,
      render: row => <span>{new Date(row.hora_entrada).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</span>,
    },
    {
      key: 'hora_salida',
      header: 'Salida',
      sortable: true,
      accessor: row => row.hora_salida ?? '',
      render: row => <span>{row.hora_salida ? new Date(row.hora_salida).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>,
    },
    {
      key: 'duracion',
      header: 'Duración',
      render: row => <span style={{ color: '#6366f1' }}>{row.hora_salida ? duracion(row.hora_entrada, row.hora_salida) : '—'}</span>,
    },
  ]

  return (
    <div style={{ padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 14, color: '#374151' }}>Fecha:</span>
          <input type="date" value={fechaFiltro} onChange={e => setFechaFiltro(e.target.value)}
            style={{ ...inp, width: 'auto', padding: '6px 10px' }} />
        </div>
        {canCreate && (
          <button onClick={() => setMostrarForm(!mostrarForm)}
            style={{ padding: '8px 16px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {mostrarForm ? '✕ Cancelar' : '+ Registrar entrada'}
          </button>
        )}
      </div>

      {/* Formulario */}
      {mostrarForm && (
        <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>Nueva entrada</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={lbl}>Espacio *</label>
              <input style={inp} placeholder="P-01" value={form.espacio} onChange={e => setForm(p => ({ ...p, espacio: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Placa *</label>
              <input style={inp} placeholder="ABC-123" value={form.placa} onChange={e => setForm(p => ({ ...p, placa: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Tipo vehículo</label>
              <select style={inp} value={form.tipo_vehiculo} onChange={e => setForm(p => ({ ...p, tipo_vehiculo: e.target.value as TipoVehiculoVisita }))}>
                {TIPOS_VEHICULO.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Unidad visitada</label>
              <select style={inp} value={form.unidad_visitada} onChange={e => setForm(p => ({ ...p, unidad_visitada: e.target.value }))}>
                <option value="">— Sin unidad —</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Nombre visitante</label>
              <input style={inp} placeholder="Juan Pérez" value={form.visitante_nombre} onChange={e => setForm(p => ({ ...p, visitante_nombre: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Autorizado por</label>
              <input style={inp} placeholder="Residente / guardia" value={form.autorizado_por} onChange={e => setForm(p => ({ ...p, autorizado_por: e.target.value }))} />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={lbl}>Notas</label>
            <input style={inp} placeholder="Observaciones opcionales" value={form.notas} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} />
          </div>
          <button onClick={guardar} disabled={saving}
            style={{ padding: '8px 20px', background: '#10b981', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {saving ? 'Guardando…' : '✅ Registrar entrada'}
          </button>
        </div>
      )}

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'Activos ahora', value: activos.length, color: '#10b981' },
          { label: 'Salidas hoy', value: historial.length, color: '#6366f1' },
          { label: 'Total del día', value: registrosFiltrados.length, color: '#f59e0b' },
        ].map(k => (
          <div key={k.label} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Activos como cards (UX intencional) */}
      {activos.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14, color: '#374151' }}>🟢 En el estacionamiento ahora</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {activos.map(r => {
              const unidad = unidades.find(u => u.id === r.unidad_visitada)
              return (
                <div key={r.id} style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, fontSize: 16 }}>{TIPOS_VEHICULO.find(t => t.value === r.tipo_vehiculo)?.label?.split(' ')[0]}</span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{r.placa} — Espacio {r.espacio}</div>
                      <div style={{ fontSize: 12, color: '#6b7280' }}>
                        {r.visitante_nombre && <span>{r.visitante_nombre} · </span>}
                        {unidad && <span>Visita a: {unidad.nombre} · </span>}
                        Entrada: {new Date(r.hora_entrada).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })} · {duracion(r.hora_entrada)}
                      </div>
                    </div>
                  </div>
                  {canEdit && (
                    <button onClick={() => registrarSalida(r.id, r.placa)}
                      style={{ padding: '6px 12px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                      Registrar salida
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Historial como DataTable */}
      <div>
        <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14, color: '#374151' }}>📋 Historial del día</div>
        <DataTable
          data={historial}
          columns={historialColumns}
          rowKey="id"
          searchableKeys={['placa', 'espacio', row => row.visitante_nombre ?? '']}
          searchPlaceholder="Buscar por placa, espacio o visitante…"
          defaultSort={{ key: 'hora_salida', direction: 'desc' }}
          emptyState={{ icon: '🅿️', title: 'Sin registros de salidas para esta fecha' }}
        />
      </div>
    </div>
  )
}
