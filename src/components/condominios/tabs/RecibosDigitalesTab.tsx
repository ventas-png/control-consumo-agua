import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import { notify, confirm } from '../../shared/Dialog'
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
  generado: { label: 'Generado', bg: 'var(--at-warning-tint)', color: 'var(--at-warning)' },
  enviado:  { label: 'Enviado',  bg: 'var(--at-primary-soft)', color: 'var(--at-primary)' },
  anulado:  { label: 'Anulado',  bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' },
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

  // When unit changes, prefill concepto from latest paid cuota
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
      notify({ variant: 'warning', title: 'Error', text: 'Unidad, monto y concepto son obligatorios' }); return
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
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setMostrarForm(false); setForm(BLANK); onRefresh()
  }

  async function marcarEnviado(id: string) {
    await supabase.from('recibos_digitales').update({ estado: 'enviado' }).eq('id', id)
    onRefresh()
  }

  async function anular(id: string) {
    const { isConfirmed } = await confirm({ title: '¿Anular recibo?', icon: 'warning', variant: 'danger', confirmText: 'Anular' })
    if (!isConfirmed) return
    await supabase.from('recibos_digitales').update({ estado: 'anulado' }).eq('id', id)
    onRefresh()
  }

  const totalEmitido = recibos.filter(r => r.estado !== 'anulado').reduce((s, r) => s + r.monto, 0)
  const inp: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Total recibos', val: recibos.length, bg: 'var(--at-surface-2)', color: 'var(--at-ink-2)' },
          { label: 'Generados', val: recibos.filter(r => r.estado === 'generado').length, bg: 'var(--at-warning-tint)', color: 'var(--at-warning)' },
          { label: 'Enviados', val: recibos.filter(r => r.estado === 'enviado').length, bg: 'var(--at-primary-tint)', color: 'var(--at-primary)' },
          { label: 'Monto emitido', val: `${moneda} ${totalEmitido.toFixed(2)}`, bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: k.color }}>{k.val}</div>
            <div style={{ fontSize: 11, color: k.color }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Filtros + botón */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value as EstadoReciboDigital | '')}
            style={{ padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 7, fontSize: 13 }}>
            <option value="">Todos los estados</option>
            {(Object.keys(ESTADO_CFG) as EstadoReciboDigital[]).map(e => <option key={e} value={e}>{ESTADO_CFG[e].label}</option>)}
          </select>
          <select value={filtroUnidad} onChange={e => setFiltroUnidad(e.target.value)}
            style={{ padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 7, fontSize: 13 }}>
            <option value="">Todas las unidades</option>
            {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
          <span style={{ fontSize: 12, color: 'var(--at-ink-3)', alignSelf: 'center' }}>{lista.length} registros</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
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
            style={{ padding: '7px 14px', background: 'var(--at-success-tint)', color: 'var(--at-success)', border: '1.5px solid var(--at-success-border)', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            📊 Excel
          </button>
          {canCreate && (
            <button onClick={() => setMostrarForm(!mostrarForm)}
              style={{ padding: '8px 16px', background: 'var(--at-primary-hover)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
              {mostrarForm ? '✕ Cancelar' : '🧾 Nuevo recibo'}
            </button>
          )}
        </div>
      </div>

      {/* Formulario */}
      {mostrarForm && (
        <div style={{ background: 'var(--at-primary-tint)', border: '1px solid var(--at-primary-soft-2)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
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
            style={{ padding: '8px 20px', background: 'var(--at-primary-hover)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {saving ? 'Guardando…' : '🧾 Generar recibo'}
          </button>
        </div>
      )}

      {/* Tabla — F3.9: migrado a <DataTable> shared */}
      <DataTable<ReciboDigital>
        data={lista}
        rowKey="id"
        pageSize={50}
        defaultSort={{ key: 'fecha_emision', direction: 'desc' }}
        emptyState={{ icon: '🧾', title: 'Sin recibos digitales', description: 'Genera el primero con el botón superior.' }}
        rowStyle={(r) => r.estado === 'anulado' ? { opacity: 0.5 } : {}}
        columns={[
          { key: 'numero_recibo', header: 'N° Recibo', sortable: true,
            render: (r) => <span style={{ fontWeight: 700, color: 'var(--at-primary-hover)', fontFamily: 'monospace' }}>{r.numero_recibo}</span> },
          { key: 'unidad_nombre', header: 'Unidad', sortable: true,
            accessor: (r) => unidades.find(u => u.id === r.unidad_id)?.nombre ?? r.unidad_nombre ?? '',
            render: (r) => <span style={{ fontWeight: 600 }}>{unidades.find(u => u.id === r.unidad_id)?.nombre ?? r.unidad_nombre ?? '—'}</span> },
          { key: 'concepto', header: 'Concepto', sortable: true, hideOnMobile: true,
            render: (r) => <span style={{ color: 'var(--at-ink-2)', display: 'inline-block', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.concepto}</span> },
          { key: 'monto', header: 'Monto', align: 'right', sortable: true,
            render: (r) => <span style={{ fontWeight: 600 }}>{moneda} {r.monto.toFixed(2)}</span> },
          { key: 'fecha_emision', header: 'Fecha', sortable: true,
            render: (r) => <span style={{ color: 'var(--at-ink-3)' }}>{r.fecha_emision}</span> },
          { key: 'destinatario_nombre', header: 'Destinatario', hideOnMobile: true, sortable: true,
            accessor: (r) => r.destinatario_nombre ?? '',
            render: (r) => <span style={{ color: 'var(--at-ink-3)' }}>{r.destinatario_nombre ?? '—'}</span> },
          { key: 'estado', header: 'Estado', sortable: true,
            render: (r) => {
              const ec = ESTADO_CFG[r.estado]
              return <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: ec.bg, color: ec.color }}>{ec.label}</span>
            } },
          { key: 'actions', header: 'Acciones', align: 'right',
            render: (r) => (
              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                <button onClick={(e) => {
                    e.stopPropagation()
                    exportarPDFRecibo({
                      numero_recibo: r.numero_recibo,
                      concepto: r.concepto,
                      monto: r.monto,
                      fecha_emision: r.fecha_emision,
                      unidadNombre: unidades.find(u => u.id === r.unidad_id)?.nombre ?? r.unidad_nombre,
                      destinatario_nombre: r.destinatario_nombre,
                      destinatario_email: r.destinatario_email,
                      notas: r.notas,
                    }, moneda, proyectoNombre)
                  }}
                  aria-label={`Exportar PDF del recibo ${r.numero_recibo}`}
                  style={{ padding: '3px 8px', background: 'var(--at-primary-tint)', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 11, color: 'var(--at-primary)' }}>
                  📄 PDF
                </button>
                {canEdit && r.estado === 'generado' && (
                  <>
                    <button onClick={(e) => { e.stopPropagation(); marcarEnviado(r.id) }}
                      style={{ padding: '3px 8px', background: 'var(--at-primary-soft)', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 11, color: 'var(--at-primary)' }}>
                      ✉️ Enviado
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); anular(r.id) }} aria-label={`Anular recibo ${r.numero_recibo}`}
                      style={{ padding: '3px 8px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 11, color: 'var(--at-danger)' }}>
                      ✕
                    </button>
                  </>
                )}
              </div>
            ) },
        ] satisfies DataTableColumn<ReciboDigital>[]}
      />
    </div>
  )
}
