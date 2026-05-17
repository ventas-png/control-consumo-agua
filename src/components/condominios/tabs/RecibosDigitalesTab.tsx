import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import Swal from 'sweetalert2'
import { ReciboDigital, EstadoReciboDigital, CuotaCondominio, Unidad } from '../../../types'
import { exportarPDFRecibo, exportarExcel } from '../exportUtils'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'

interface Props {
  recibos: ReciboDigital[]
  cuotas: CuotaCondominio[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  moneda: string
  autorNombre: string
  proyectoNombre?: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESTADO_CFG: Record<EstadoReciboDigital, { label: string; bg: string; color: string }> = {
  generado: { label: 'Generado', bg: '#fef3c7', color: '#d97706' },
  enviado:  { label: 'Enviado',  bg: '#dbeafe', color: '#2563eb' },
  anulado:  { label: 'Anulado',  bg: '#fee2e2', color: '#ef4444' },
}

const BLANK = {
  unidad_id: '', cuota_id: '', monto: '', concepto: '',
  fecha_emision: new Date().toISOString().slice(0, 10),
  destinatario_nombre: '', destinatario_email: '', notas: '',
}

function nextNumero(recibos: ReciboDigital[]): string {
  if (recibos.length === 0) return 'REC-0001'
  const nums = recibos.map(r => parseInt(r.numero_recibo.replace(/\D/g, '')) || 0)
  return `REC-${String(Math.max(...nums) + 1).padStart(4, '0')}`
}

export default function RecibosDigitalesTab({ recibos, cuotas, unidades, proyectoId, companyId, moneda, autorNombre, proyectoNombre, canCreate, canEdit, onRefresh }: Props) {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<EstadoReciboDigital | ''>('')
  const [filtroUnidad, setFiltroUnidad] = useState('')
  const [form, setForm] = useState(BLANK)

  const lista = recibos.filter(r =>
    (!filtroEstado || r.estado === filtroEstado) &&
    (!filtroUnidad || r.unidad_id === filtroUnidad)
  )

  function onUnidadChange(unidad_id: string) {
    const cuotasPagadas = cuotas.filter(c => c.unidad_id === unidad_id && c.estado === 'pagado')
    const ultima = cuotasPagadas.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0]
    setForm(p => ({
      ...p, unidad_id,
      cuota_id: ultima?.id ?? '',
      monto: ultima ? String(ultima.monto) : '',
      concepto: ultima ? `${ultima.concepto ?? 'Cuota'} — ${ultima.periodo ?? ''}`.trim() : '',
    }))
  }

  async function guardar() {
    if (!form.unidad_id || !form.monto || !form.concepto.trim()) {
      Swal.fire('Error', 'Unidad, monto y concepto son obligatorios', 'warning'); return
    }
    setSaving(true)
    const { error } = await supabase.from('recibos_digitales').insert({
      company_id: companyId, project_id: proyectoId,
      unidad_id: form.unidad_id,
      cuota_id: form.cuota_id || null,
      numero_recibo: nextNumero(recibos),
      monto: parseFloat(form.monto),
      concepto: form.concepto.trim(),
      fecha_emision: form.fecha_emision,
      enviado_por: autorNombre,
      destinatario_nombre: form.destinatario_nombre.trim() || null,
      destinatario_email: form.destinatario_email.trim() || null,
      notas: form.notas.trim() || null,
    })
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    setMostrarForm(false); setForm(BLANK); onRefresh()
  }

  async function marcarEnviado(id: string) {
    await supabase.from('recibos_digitales').update({ estado: 'enviado' }).eq('id', id)
    onRefresh()
  }

  async function anular(id: string) {
    const { isConfirmed } = await Swal.fire({ title: '¿Anular recibo?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Anular', cancelButtonText: 'Cancelar' })
    if (!isConfirmed) return
    await supabase.from('recibos_digitales').update({ estado: 'anulado' }).eq('id', id)
    onRefresh()
  }

  const totalEmitido = recibos.filter(r => r.estado !== 'anulado').reduce((s, r) => s + r.monto, 0)
  const inp: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 3, display: 'block' }

  const columns: DataTableColumn<ReciboDigital>[] = [
    {
      key: 'numero_recibo',
      header: 'N° Recibo',
      sortable: true,
      render: row => <span style={{ fontWeight: 700, color: '#0369a1', fontFamily: 'monospace' }}>{row.numero_recibo}</span>,
    },
    {
      key: 'unidad',
      header: 'Unidad',
      sortable: true,
      accessor: row => unidades.find(u => u.id === row.unidad_id)?.nombre ?? row.unidad_nombre ?? '',
      render: row => <span style={{ fontWeight: 600 }}>{unidades.find(u => u.id === row.unidad_id)?.nombre ?? row.unidad_nombre ?? '—'}</span>,
    },
    {
      key: 'concepto',
      header: 'Concepto',
      sortable: true,
      render: row => (
        <span style={{ color: '#374151', display: 'inline-block', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {row.concepto}
        </span>
      ),
    },
    {
      key: 'monto',
      header: 'Monto',
      sortable: true,
      align: 'right',
      accessor: row => row.monto,
      render: row => <span style={{ fontWeight: 600 }}>{moneda} {row.monto.toFixed(2)}</span>,
    },
    {
      key: 'fecha_emision',
      header: 'Fecha',
      sortable: true,
      render: row => <span style={{ color: '#6b7280' }}>{row.fecha_emision}</span>,
    },
    {
      key: 'destinatario_nombre',
      header: 'Destinatario',
      sortable: true,
      accessor: row => row.destinatario_nombre ?? '',
      render: row => <span style={{ color: '#6b7280' }}>{row.destinatario_nombre ?? '—'}</span>,
    },
    {
      key: 'estado',
      header: 'Estado',
      sortable: true,
      render: row => {
        const ec = ESTADO_CFG[row.estado]
        return <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: ec.bg, color: ec.color }}>{ec.label}</span>
      },
    },
    {
      key: 'acciones',
      header: 'Acciones',
      render: row => (
        <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
          <button
            onClick={() => exportarPDFRecibo({
              numero_recibo: row.numero_recibo,
              concepto: row.concepto,
              monto: row.monto,
              fecha_emision: row.fecha_emision,
              unidadNombre: unidades.find(u => u.id === row.unidad_id)?.nombre ?? row.unidad_nombre,
              destinatario_nombre: row.destinatario_nombre,
              destinatario_email: row.destinatario_email,
              notas: row.notas,
            }, moneda, proyectoNombre)}
            style={{ padding: '3px 8px', background: '#eff6ff', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 11, color: '#2563eb' }}>
            📄 PDF
          </button>
          {canEdit && row.estado === 'generado' && (
            <>
              <button onClick={() => marcarEnviado(row.id)}
                style={{ padding: '3px 8px', background: '#dbeafe', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 11, color: '#2563eb' }}>
                ✉️ Enviado
              </button>
              <button onClick={() => anular(row.id)}
                style={{ padding: '3px 8px', background: '#fee2e2', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 11, color: '#ef4444' }}>
                ✕
              </button>
            </>
          )}
        </div>
      ),
    },
  ]

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Total recibos', val: recibos.length, bg: '#f9fafb', color: '#374151' },
          { label: 'Generados', val: recibos.filter(r => r.estado === 'generado').length, bg: '#fffbeb', color: '#d97706' },
          { label: 'Enviados', val: recibos.filter(r => r.estado === 'enviado').length, bg: '#eff6ff', color: '#2563eb' },
          { label: 'Monto emitido', val: `${moneda} ${totalEmitido.toFixed(2)}`, bg: '#f0fdf4', color: '#16a34a' },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: k.color }}>{k.val}</div>
            <div style={{ fontSize: 11, color: k.color }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Toolbar (export + nuevo) */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
        <button
          onClick={() => exportarExcel(`recibos-${new Date().toISOString().slice(0,10)}`, [{
            name: 'Recibos',
            headers: ['N° Recibo', 'Unidad', 'Concepto', `Monto (${moneda})`, 'Fecha emisión', 'Destinatario', 'Email', 'Estado'],
            rows: lista.map(r => [
              r.numero_recibo,
              unidades.find(u => u.id === r.unidad_id)?.nombre ?? r.unidad_nombre ?? '',
              r.concepto, r.monto, r.fecha_emision,
              r.destinatario_nombre ?? '', r.destinatario_email ?? '', r.estado,
            ]),
          }])}
          style={{ padding: '7px 14px', background: '#f0fdf4', color: '#16a34a', border: '1.5px solid #86efac', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
          📊 Excel
        </button>
        {canCreate && (
          <button onClick={() => setMostrarForm(!mostrarForm)}
            style={{ padding: '8px 16px', background: '#0369a1', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {mostrarForm ? '✕ Cancelar' : '🧾 Nuevo recibo'}
          </button>
        )}
      </div>

      {/* Formulario */}
      {mostrarForm && (
        <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>Generar recibo · {nextNumero(recibos)}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={lbl}>Unidad *</label>
              <select style={inp} value={form.unidad_id} onChange={e => onUnidadChange(e.target.value)}>
                <option value="">Seleccionar…</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={lbl}>Concepto *</label>
              <input style={inp} value={form.concepto} onChange={e => setForm(p => ({ ...p, concepto: e.target.value }))} placeholder="Ej. Cuota mantenimiento Abril 2026" />
            </div>
            <div>
              <label style={lbl}>Monto ({moneda}) *</label>
              <input type="number" step="0.01" style={inp} value={form.monto} onChange={e => setForm(p => ({ ...p, monto: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Fecha emisión</label>
              <input type="date" style={inp} value={form.fecha_emision} onChange={e => setForm(p => ({ ...p, fecha_emision: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Cuota vinculada (opcional)</label>
              <select style={inp} value={form.cuota_id} onChange={e => setForm(p => ({ ...p, cuota_id: e.target.value }))}>
                <option value="">— Ninguna —</option>
                {cuotas.filter(c => c.unidad_id === form.unidad_id && c.estado === 'pagado').map(c => (
                  <option key={c.id} value={c.id}>{c.concepto ?? 'Cuota'} {c.periodo}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={lbl}>Nombre destinatario</label>
              <input style={inp} value={form.destinatario_nombre} onChange={e => setForm(p => ({ ...p, destinatario_nombre: e.target.value }))} placeholder="Nombre del residente" />
            </div>
            <div>
              <label style={lbl}>Email destinatario</label>
              <input type="email" style={inp} value={form.destinatario_email} onChange={e => setForm(p => ({ ...p, destinatario_email: e.target.value }))} placeholder="correo@ejemplo.com" />
            </div>
            <div>
              <label style={lbl}>Notas</label>
              <input style={inp} value={form.notas} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} placeholder="Opcional" />
            </div>
          </div>
          <button onClick={guardar} disabled={saving}
            style={{ padding: '8px 20px', background: '#0369a1', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {saving ? 'Guardando…' : '🧾 Generar recibo'}
          </button>
        </div>
      )}

      <DataTable
        data={lista}
        columns={columns}
        rowKey="id"
        searchableKeys={[
          'numero_recibo',
          'concepto',
          row => unidades.find(u => u.id === row.unidad_id)?.nombre ?? row.unidad_nombre ?? '',
          row => row.destinatario_nombre ?? '',
        ]}
        searchPlaceholder="Buscar por N° recibo, unidad, concepto o destinatario…"
        filters={[
          {
            key: 'estado',
            value: filtroEstado,
            onChange: v => setFiltroEstado(v as EstadoReciboDigital | ''),
            options: [
              { value: '', label: 'Todos los estados' },
              ...(Object.keys(ESTADO_CFG) as EstadoReciboDigital[]).map(e => ({ value: e, label: ESTADO_CFG[e].label })),
            ],
          },
          {
            key: 'unidad',
            value: filtroUnidad,
            onChange: setFiltroUnidad,
            options: [
              { value: '', label: 'Todas las unidades' },
              ...unidades.map(u => ({ value: u.id, label: u.nombre })),
            ],
          },
        ]}
        pageSizeOptions={[25, 50, 100, 200]}
        defaultSort={{ key: 'fecha_emision', direction: 'desc' }}
        rowStyle={row => row.estado === 'anulado' ? { opacity: 0.5 } : {}}
        emptyState={{ icon: '🧾', title: 'Sin recibos digitales', description: 'Genera el primero con el botón superior' }}
      />
    </div>
  )
}
