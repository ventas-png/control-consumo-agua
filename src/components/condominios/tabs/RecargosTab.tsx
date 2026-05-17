import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import Swal from 'sweetalert2'
import { RecargoMora, EstadoRecargo, TipoRecargo, Unidad, CuotaCondominio, ReglaMoraConfig } from '../../../types'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'

interface Props {
  recargos: RecargoMora[]
  cuotas: CuotaCondominio[]
  reglas: ReglaMoraConfig[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESTADO_CFG: Record<EstadoRecargo, { label: string; bg: string; color: string }> = {
  pendiente: { label: 'Pendiente', bg: '#fef3c7', color: '#92400e' },
  aplicado:  { label: 'Aplicado',  bg: '#dbeafe', color: '#1d4ed8' },
  anulado:   { label: 'Anulado',   bg: '#f3f4f6', color: '#9ca3af' },
}

export default function RecargosTab({ recargos, cuotas, reglas, unidades, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<EstadoRecargo | ''>('')
  const [filtroUnidad, setFiltroUnidad] = useState('')
  const [form, setForm] = useState({
    unidad_id: '', cuota_id: '', tipo: 'porcentaje' as TipoRecargo,
    valor: '', fecha_aplicacion: new Date().toISOString().slice(0, 10), motivo: '',
  })

  const cuotasVencidas = cuotas.filter(c => c.estado === 'moroso' || c.estado === 'pendiente')
  const cuotasUnidad = form.unidad_id ? cuotasVencidas.filter(c => c.unidad_id === form.unidad_id) : []

  const lista = recargos.filter(r =>
    (!filtroEstado || r.estado === filtroEstado) &&
    (!filtroUnidad || r.unidad_id === filtroUnidad)
  )

  const totalAplicado = recargos.filter(r => r.estado === 'aplicado').reduce((s, r) => s + r.monto_calculado, 0)
  const totalPendiente = recargos.filter(r => r.estado === 'pendiente').reduce((s, r) => s + r.monto_calculado, 0)

  function calcularMonto() {
    if (!form.valor) return null
    if (form.tipo === 'monto_fijo') return parseFloat(form.valor)
    if (form.cuota_id) {
      const cuota = cuotas.find(c => c.id === form.cuota_id)
      if (cuota) return (cuota.monto * parseFloat(form.valor)) / 100
    }
    return null
  }

  const montoPreview = calcularMonto()

  function resetForm() {
    setForm({ unidad_id: '', cuota_id: '', tipo: 'porcentaje', valor: '', fecha_aplicacion: new Date().toISOString().slice(0, 10), motivo: '' })
    setMostrarForm(false)
  }

  async function guardar() {
    if (!form.unidad_id || !form.valor) { Swal.fire('Error', 'Unidad y valor son obligatorios', 'warning'); return }
    const monto = montoPreview
    if (!monto || monto <= 0) { Swal.fire('Error', 'El monto calculado debe ser mayor a 0', 'warning'); return }
    setSaving(true)
    const { error } = await supabase.from('recargos_mora').insert({
      company_id: companyId, project_id: proyectoId,
      unidad_id: form.unidad_id,
      cuota_id: form.cuota_id || null,
      tipo: form.tipo,
      valor: parseFloat(form.valor),
      monto_calculado: monto,
      fecha_aplicacion: form.fecha_aplicacion,
      motivo: form.motivo.trim() || null,
    })
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    resetForm(); onRefresh()
  }

  async function cambiarEstado(r: RecargoMora, estado: EstadoRecargo) {
    const update: Record<string, unknown> = { estado }
    if (estado === 'anulado') update.fecha_anulacion = new Date().toISOString()
    await supabase.from('recargos_mora').update(update).eq('id', r.id)
    onRefresh()
  }

  async function aplicarMasivo() {
    const hoy = new Date().toISOString().slice(0, 10)
    const reglaActiva = reglas.find(r => r.activa)
    const cuotasVenc = cuotas.filter(c =>
      c.estado === 'moroso' ||
      (c.estado === 'pendiente' && c.fecha_vencimiento && c.fecha_vencimiento < hoy)
    )
    const unidadesMorosas = [...new Set(cuotasVenc.map(c => c.unidad_id).filter(Boolean))]
    if (unidadesMorosas.length === 0) { Swal.fire('Sin cuotas vencidas', 'No hay cuotas vencidas a las que aplicar recargo.', 'info'); return }

    let pct = 5
    let tipoRecargo: TipoRecargo = 'porcentaje'
    let motivo = `Recargo masivo mora`

    if (reglaActiva) {
      pct = reglaActiva.valor
      tipoRecargo = reglaActiva.tipo === 'porcentaje' ? 'porcentaje' : 'monto_fijo'
      motivo = `Recargo automático — ${reglaActiva.nombre}`
      const conf = await Swal.fire({
        title: 'Aplicar mora automática',
        html: `<p style="font-size:13px;color:#374151">Usando regla: <b>${reglaActiva.nombre}</b><br>
               Tipo: <b>${tipoRecargo === 'porcentaje' ? pct + '%' : moneda + ' ' + pct + ' fijo'}</b><br>
               ${unidadesMorosas.length} unidades afectadas</p>`,
        icon: 'question', showCancelButton: true,
        confirmButtonText: 'Aplicar', cancelButtonText: 'Cancelar', confirmButtonColor: '#dc2626',
      })
      if (!conf.isConfirmed) return
    } else {
      const { value } = await Swal.fire({
        title: 'Recargo masivo por mora',
        html: `<p style="font-size:13px;color:#374151;margin-bottom:8px">${unidadesMorosas.length} unidades con cuotas vencidas · Porcentaje de recargo:</p>
               <input id="pct-input" class="swal2-input" type="number" min="0.1" max="100" step="0.1" value="5" style="font-size:14px">
               <p style="font-size:11px;color:#94a3b8;margin-top:4px">Configura reglas automáticas en la pestaña "Reglas mora"</p>`,
        showCancelButton: true, confirmButtonText: 'Aplicar', cancelButtonText: 'Cancelar',
        preConfirm: () => parseFloat((document.getElementById('pct-input') as HTMLInputElement)?.value ?? '0'),
      })
      if (!value || value <= 0) return
      pct = value
    }

    setSaving(true)
    const today = new Date().toISOString().slice(0, 10)
    const rows = unidadesMorosas.map(uid => {
      const cuotasU = cuotasVenc.filter(c => c.unidad_id === uid)
      const montoBase = cuotasU.reduce((s, c) => s + c.monto, 0)
      const monto_calculado = tipoRecargo === 'porcentaje'
        ? parseFloat(((montoBase * pct) / 100).toFixed(2))
        : pct
      return {
        company_id: companyId, project_id: proyectoId,
        unidad_id: uid, tipo: tipoRecargo, valor: pct,
        monto_calculado, fecha_aplicacion: today, motivo,
      }
    })
    const { error } = await supabase.from('recargos_mora').insert(rows)
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    Swal.fire({ icon: 'success', title: `${rows.length} recargos creados`, text: `Total: ${moneda} ${rows.reduce((s, r) => s + r.monto_calculado, 0).toFixed(2)}`, timer: 2200, showConfirmButton: false })
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 3, display: 'block' }

  const columns: DataTableColumn<RecargoMora>[] = [
    {
      key: 'unidad',
      header: 'Unidad',
      sortable: true,
      accessor: row => unidades.find(u => u.id === row.unidad_id)?.nombre ?? row.unidad_nombre ?? '',
      render: row => {
        const unidad = unidades.find(u => u.id === row.unidad_id)
        return <span style={{ fontWeight: 600 }}>{unidad?.nombre ?? row.unidad_nombre ?? '—'}</span>
      },
    },
    {
      key: 'fecha_aplicacion',
      header: 'Fecha',
      sortable: true,
      render: row => <span style={{ color: '#6b7280' }}>{row.fecha_aplicacion}</span>,
    },
    {
      key: 'tipo',
      header: 'Tipo',
      sortable: true,
      render: row => <span style={{ color: '#374151' }}>{row.tipo === 'porcentaje' ? `${row.valor}%` : 'Fijo'}</span>,
    },
    {
      key: 'valor',
      header: 'Valor',
      sortable: true,
      accessor: row => row.valor,
      render: row => <span style={{ color: '#374151' }}>{row.tipo === 'porcentaje' ? `${row.valor}%` : `${moneda} ${row.valor}`}</span>,
    },
    {
      key: 'monto_calculado',
      header: 'Monto',
      sortable: true,
      align: 'right',
      accessor: row => row.monto_calculado,
      render: row => <span style={{ fontWeight: 700, color: '#dc2626' }}>{moneda} {row.monto_calculado.toFixed(2)}</span>,
    },
    {
      key: 'estado',
      header: 'Estado',
      sortable: true,
      render: row => {
        const ec = ESTADO_CFG[row.estado]
        return <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: ec.bg, color: ec.color }}>{ec.label}</span>
      },
    },
    {
      key: 'motivo',
      header: 'Motivo',
      render: row => <span style={{ color: '#9ca3af', fontSize: 12 }}>{row.motivo ?? '—'}</span>,
    },
    {
      key: 'acciones',
      header: '',
      render: row => (
        canEdit && row.estado === 'pendiente' ? (
          <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
            <button onClick={() => cambiarEstado(row, 'aplicado')}
              style={{ padding: '4px 8px', background: '#dbeafe', color: '#1d4ed8', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Aplicar</button>
            <button onClick={() => cambiarEstado(row, 'anulado')}
              style={{ padding: '4px 8px', background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>Anular</button>
          </div>
        ) : null
      ),
    },
  ]

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Recargos aplicados', val: recargos.filter(r => r.estado === 'aplicado').length, sub: `${moneda} ${totalAplicado.toLocaleString()}`, bg: '#eff6ff', color: '#2563eb' },
          { label: 'Pendientes de aplicar', val: recargos.filter(r => r.estado === 'pendiente').length, sub: `${moneda} ${totalPendiente.toLocaleString()}`, bg: '#fef3c7', color: '#d97706' },
          { label: 'Anulados', val: recargos.filter(r => r.estado === 'anulado').length, sub: '', bg: '#f3f4f6', color: '#6b7280' },
          { label: 'Unidades con mora', val: new Set(cuotas.filter(c => c.estado === 'moroso').map(c => c.unidad_id)).size, sub: '', bg: '#fef2f2', color: '#ef4444' },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: k.color }}>{k.val}</div>
            <div style={{ fontSize: 10, color: k.color }}>{k.label}</div>
            {k.sub && <div style={{ fontSize: 11, color: k.color, fontWeight: 600 }}>{k.sub}</div>}
          </div>
        ))}
      </div>

      {/* Filtros pill + botones */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(['', 'pendiente', 'aplicado', 'anulado'] as (EstadoRecargo | '')[]).map(e => (
            <button key={e} onClick={() => setFiltroEstado(e)}
              style={{ padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1.5px solid', borderColor: filtroEstado === e ? '#4f46e5' : '#e2e8f0', background: filtroEstado === e ? '#eef2ff' : 'white', color: filtroEstado === e ? '#4f46e5' : '#64748b' }}>
              {e === '' ? 'Todos' : ESTADO_CFG[e].label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {canCreate && (
            <button onClick={aplicarMasivo} disabled={saving}
              style={{ padding: '8px 14px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              ⚡ Recargo masivo
            </button>
          )}
          {canCreate && (
            <button onClick={() => setMostrarForm(!mostrarForm)}
              style={{ padding: '8px 14px', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
              {mostrarForm ? '✕ Cancelar' : '+ Recargo individual'}
            </button>
          )}
        </div>
      </div>

      {/* Formulario */}
      {mostrarForm && (
        <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>Nuevo recargo de mora</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={lbl}>Unidad *</label>
              <select style={inp} value={form.unidad_id} onChange={e => setForm(p => ({ ...p, unidad_id: e.target.value, cuota_id: '' }))}>
                <option value="">Seleccionar…</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Cuota relacionada</label>
              <select style={inp} value={form.cuota_id} onChange={e => setForm(p => ({ ...p, cuota_id: e.target.value }))} disabled={!form.unidad_id}>
                <option value="">Sin cuota específica</option>
                {cuotasUnidad.map(c => <option key={c.id} value={c.id}>{c.concepto} {c.periodo} — {moneda} {c.monto}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Tipo</label>
              <select style={inp} value={form.tipo} onChange={e => setForm(p => ({ ...p, tipo: e.target.value as TipoRecargo }))}>
                <option value="porcentaje">Porcentaje (%)</option>
                <option value="monto_fijo">Monto fijo</option>
              </select>
            </div>
            <div>
              <label style={lbl}>Valor ({form.tipo === 'porcentaje' ? '%' : moneda}) *</label>
              <input type="number" step="0.01" style={inp} value={form.valor} onChange={e => setForm(p => ({ ...p, valor: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Fecha de aplicación</label>
              <input type="date" style={inp} value={form.fecha_aplicacion} onChange={e => setForm(p => ({ ...p, fecha_aplicacion: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Motivo</label>
              <input style={inp} value={form.motivo} onChange={e => setForm(p => ({ ...p, motivo: e.target.value }))} placeholder="Opcional" />
            </div>
          </div>
          {montoPreview !== null && (
            <div style={{ background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 14px', marginBottom: 12, fontSize: 13, color: '#92400e' }}>
              Monto a cobrar: <strong>{moneda} {montoPreview.toFixed(2)}</strong>
            </div>
          )}
          <button onClick={guardar} disabled={saving}
            style={{ padding: '8px 20px', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {saving ? 'Guardando…' : '✅ Crear recargo'}
          </button>
        </div>
      )}

      <DataTable
        data={lista}
        columns={columns}
        rowKey="id"
        searchableKeys={[
          row => unidades.find(u => u.id === row.unidad_id)?.nombre ?? row.unidad_nombre ?? '',
          row => row.motivo ?? '',
        ]}
        searchPlaceholder="Buscar por unidad o motivo…"
        filters={[
          {
            key: 'unidad',
            value: filtroUnidad,
            onChange: setFiltroUnidad,
            options: [{ value: '', label: 'Todas las unidades' }, ...unidades.map(u => ({ value: u.id, label: u.nombre }))],
          },
        ]}
        pageSizeOptions={[25, 50, 100, 200]}
        defaultSort={{ key: 'fecha_aplicacion', direction: 'desc' }}
        emptyState={{ icon: '📋', title: 'Sin recargos de mora registrados' }}
      />
    </div>
  )
}
