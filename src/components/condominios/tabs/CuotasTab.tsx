import { useState } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../../lib/supabase'
import type { CuotaCondominio, ConceptoCuota, EstadoCuota, Unidad, Proyecto } from '../../../types'
import { exportarExcel, exportarPDFRecibo } from '../exportUtils'

interface Props {
  cuotas: CuotaCondominio[]
  unidades: Unidad[]
  proyectos: Proyecto[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const CONCEPTOS: { value: ConceptoCuota; label: string }[] = [
  { value: 'mantenimiento', label: 'Mantenimiento ordinario' },
  { value: 'extraordinaria', label: 'Cuota extraordinaria' },
  { value: 'CAM', label: 'Cargo de Área Común (CAM)' },
  { value: 'otro', label: 'Otro' },
]

const ESTADO_COLORS: Record<EstadoCuota, { bg: string; color: string }> = {
  pendiente: { bg: '#eff6ff', color: '#2563eb' },
  pagado:    { bg: '#f0fdf4', color: '#16a34a' },
  moroso:    { bg: '#fef2f2', color: '#dc2626' },
}

export function CuotasTab({ cuotas, unidades, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<EstadoCuota | 'todos'>('todos')
  const [form, setForm] = useState({
    unidad_id: '',
    concepto: 'mantenimiento' as ConceptoCuota,
    monto: '',
    periodo: new Date().toISOString().slice(0, 7),
    fecha_vencimiento: '',
    notas: '',
  })

  const cuotasFiltradas = filtroEstado === 'todos'
    ? cuotas
    : cuotas.filter(c => c.estado === filtroEstado)

  const totales = {
    pendiente: cuotas.filter(c => c.estado === 'pendiente').reduce((s, c) => s + c.monto, 0),
    moroso:    cuotas.filter(c => c.estado === 'moroso').reduce((s, c) => s + c.monto, 0),
    pagado:    cuotas.filter(c => c.estado === 'pagado').reduce((s, c) => s + c.monto, 0),
  }

  function resetForm() {
    setForm({ unidad_id: '', concepto: 'mantenimiento', monto: '', periodo: new Date().toISOString().slice(0, 7), fecha_vencimiento: '', notas: '' })
    setShowForm(false)
  }

  async function handleGuardar() {
    if (!form.monto || isNaN(Number(form.monto)) || Number(form.monto) <= 0) {
      Swal.fire('Error', 'Ingrese un monto válido.', 'error'); return
    }
    if (!form.periodo) {
      Swal.fire('Error', 'Seleccione el período.', 'error'); return
    }
    setSaving(true)
    const { error } = await supabase.from('cuotas_condominio').insert({
      company_id: companyId,
      project_id: proyectoId,
      unidad_id: form.unidad_id || null,
      concepto: form.concepto,
      monto: Number(form.monto),
      periodo: form.periodo,
      fecha_vencimiento: form.fecha_vencimiento || null,
      notas: form.notas || null,
      estado: 'pendiente',
    })
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    Swal.fire({ icon: 'success', title: 'Cuota registrada', timer: 1500, showConfirmButton: false })
    resetForm()
    onRefresh()
  }

  async function cambiarEstado(cuota: CuotaCondominio, nuevoEstado: EstadoCuota) {
    if (!canEdit) return

    if (nuevoEstado === 'pagado') {
      const hoy = new Date().toISOString().slice(0, 10)
      const { value: datos } = await Swal.fire({
        title: 'Registrar pago',
        html: `
          <div style="text-align:left;font-size:13px">
            <label style="font-weight:600;color:#374151;display:block;margin-bottom:4px">Fecha de pago</label>
            <input id="sw-fecha" type="date" class="swal2-input" value="${hoy}" style="margin:0 0 12px;width:100%;box-sizing:border-box">
            <label style="font-weight:600;color:#374151;display:block;margin-bottom:4px">Método de pago</label>
            <select id="sw-metodo" class="swal2-select" style="margin:0 0 12px;width:100%;box-sizing:border-box">
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia bancaria</option>
              <option value="cheque">Cheque</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="deposito">Depósito</option>
              <option value="otro">Otro</option>
            </select>
            <label style="font-weight:600;color:#374151;display:block;margin-bottom:4px">Referencia / No. transacción</label>
            <input id="sw-ref" type="text" class="swal2-input" placeholder="Opcional" style="margin:0;width:100%;box-sizing:border-box">
          </div>`,
        showCancelButton: true,
        confirmButtonText: 'Confirmar pago',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#16a34a',
        preConfirm: () => ({
          fecha_pago: (document.getElementById('sw-fecha') as HTMLInputElement).value,
          metodo_pago: (document.getElementById('sw-metodo') as HTMLSelectElement).value,
          referencia_pago: (document.getElementById('sw-ref') as HTMLInputElement).value || null,
        }),
      })
      if (!datos) return
      const { error } = await supabase.from('cuotas_condominio').update({
        estado: 'pagado',
        fecha_pago: datos.fecha_pago,
        metodo_pago: datos.metodo_pago,
        referencia_pago: datos.referencia_pago,
      }).eq('id', cuota.id)
      if (error) { Swal.fire('Error', error.message, 'error'); return }
      onRefresh()
      return
    }

    const { error } = await supabase.from('cuotas_condominio').update({ estado: nuevoEstado }).eq('id', cuota.id)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    onRefresh()
  }

  async function eliminar(id: string) {
    const result = await Swal.fire({ title: '¿Eliminar cuota?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar', confirmButtonColor: '#ef4444' })
    if (!result.isConfirmed) return
    await supabase.from('cuotas_condominio').delete().eq('id', id)
    onRefresh()
  }

  async function crearRecibo(cuota: CuotaCondominio) {
    const { count } = await supabase
      .from('recibos_digitales')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', proyectoId)
    const numero = `REC-${String((count ?? 0) + 1).padStart(4, '0')}`

    const { error } = await supabase.from('recibos_digitales').insert({
      company_id: companyId,
      project_id: proyectoId,
      unidad_id: cuota.unidad_id ?? null,
      cuota_id: cuota.id,
      numero_recibo: numero,
      monto: cuota.monto,
      concepto: `${cuota.concepto} — Período ${cuota.periodo}`,
      fecha_emision: cuota.fecha_pago ?? new Date().toISOString().slice(0, 10),
      estado: 'generado',
    })
    if (error) { Swal.fire('Error', error.message, 'error'); return }

    const { value: descargar } = await Swal.fire({
      icon: 'success', title: `Recibo ${numero} creado`,
      text: '¿Desea descargar el PDF ahora?',
      showCancelButton: true, confirmButtonText: 'Descargar PDF', cancelButtonText: 'Cerrar',
      timer: 8000,
    })
    if (descargar) {
      exportarPDFRecibo({
        numero_recibo: numero,
        concepto: `${cuota.concepto} — Período ${cuota.periodo}`,
        monto: cuota.monto,
        fecha_emision: cuota.fecha_pago ?? new Date().toISOString().slice(0, 10),
        unidadNombre: cuota.unidad_nombre,
        metodo_pago: cuota.metodo_pago,
        referencia_pago: cuota.referencia_pago,
      }, moneda)
    }
    onRefresh()
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>Cuotas de Mantenimiento</h2>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '13.5px' }}>{cuotas.length} cuotas registradas</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => exportarExcel(`cuotas-${new Date().toISOString().slice(0,10)}`, [{
              name: 'Cuotas',
              headers: ['Unidad', 'Concepto', 'Período', 'Monto', 'Vencimiento', 'Estado'],
              rows: cuotas.map(c => [c.unidad_nombre ?? 'General', c.concepto, c.periodo, c.monto, c.fecha_vencimiento ?? '', c.estado]),
            }])}
            style={{ padding: '10px 16px', background: '#f0fdf4', color: '#16a34a', border: '1.5px solid #86efac', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
            📊 Excel
          </button>
          {canCreate && (
            <button onClick={() => setShowForm(true)} style={{ padding: '10px 20px', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '14px' }}>
              + Nueva cuota
            </button>
          )}
        </div>
      </div>

      {/* Resumen */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
        {([['pendiente', '#2563eb', '#eff6ff'], ['moroso', '#dc2626', '#fef2f2'], ['pagado', '#16a34a', '#f0fdf4']] as const).map(([estado, color, bg]) => (
          <button key={estado} onClick={() => setFiltroEstado(filtroEstado === estado ? 'todos' : estado)}
            style={{ padding: '14px', background: filtroEstado === estado ? bg : 'white', border: `1.5px solid ${filtroEstado === estado ? color : '#e2e8f0'}`, borderRadius: '12px', cursor: 'pointer', textAlign: 'left' }}>
            <div style={{ fontSize: '18px', fontWeight: 800, color }}>{moneda} {totales[estado].toFixed(2)}</div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px', textTransform: 'capitalize' }}>{cuotas.filter(c => c.estado === estado).length} cuotas {estado}s</div>
          </button>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>Nueva cuota</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Unidad (opcional)</label>
              <select value={form.unidad_id} onChange={e => setForm(f => ({ ...f, unidad_id: e.target.value }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }}>
                <option value="">Todas las unidades</option>
                {unidades.filter(u => u.activo).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Concepto</label>
              <select value={form.concepto} onChange={e => setForm(f => ({ ...f, concepto: e.target.value as ConceptoCuota }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }}>
                {CONCEPTOS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Monto ({moneda})</label>
              <input type="number" value={form.monto} onChange={e => setForm(f => ({ ...f, monto: e.target.value }))}
                placeholder="0.00" min="0" step="0.01"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Período</label>
              <input type="month" value={form.periodo} onChange={e => setForm(f => ({ ...f, periodo: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Fecha de vencimiento</label>
              <input type="date" value={form.fecha_vencimiento} onChange={e => setForm(f => ({ ...f, fecha_vencimiento: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Notas</label>
              <input type="text" value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                placeholder="Opcional"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button onClick={handleGuardar} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
            <button onClick={resetForm} style={{ padding: '10px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Lista */}
      {cuotasFiltradas.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>💳</div>
          <p style={{ fontWeight: 600, color: '#64748b' }}>No hay cuotas {filtroEstado !== 'todos' ? `con estado "${filtroEstado}"` : 'registradas'}</p>
        </div>
      ) : (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '16px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13.5px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                {['Unidad', 'Concepto', 'Período', 'Monto', 'Vencimiento', 'Estado', ''].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11.5px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cuotasFiltradas.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '10px 14px', color: '#374151' }}>{c.unidad_nombre || <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>General</span>}</td>
                  <td style={{ padding: '10px 14px', color: '#374151' }}>{CONCEPTOS.find(x => x.value === c.concepto)?.label || c.concepto}</td>
                  <td style={{ padding: '10px 14px', color: '#374151' }}>{c.periodo}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ fontWeight: 700, color: '#0f172a' }}>{moneda} {c.monto.toFixed(2)}</div>
                    {c.estado === 'pagado' && c.metodo_pago && (
                      <div style={{ fontSize: '11px', color: '#16a34a', marginTop: '1px' }}>
                        {c.metodo_pago}{c.fecha_pago ? ` · ${c.fecha_pago}` : ''}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '10px 14px', color: c.fecha_vencimiento && c.fecha_vencimiento < new Date().toISOString().slice(0, 10) && c.estado !== 'pagado' ? '#dc2626' : '#374151' }}>
                    {c.fecha_vencimiento || '—'}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    {canEdit ? (
                      <select value={c.estado} onChange={e => cambiarEstado(c, e.target.value as EstadoCuota)}
                        style={{ padding: '4px 8px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 700, border: 'none', cursor: 'pointer', background: ESTADO_COLORS[c.estado].bg, color: ESTADO_COLORS[c.estado].color }}>
                        <option value="pendiente">Pendiente</option>
                        <option value="pagado">Pagado</option>
                        <option value="moroso">Moroso</option>
                      </select>
                    ) : (
                      <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 700, background: ESTADO_COLORS[c.estado].bg, color: ESTADO_COLORS[c.estado].color }}>
                        {c.estado}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {c.estado === 'pagado' && canCreate && (
                        <button onClick={() => crearRecibo(c)} title="Crear recibo digital"
                          style={{ background: '#eff6ff', border: 'none', cursor: 'pointer', color: '#2563eb', fontSize: '13px', padding: '3px 7px', borderRadius: '6px', fontWeight: 600 }}>
                          🧾
                        </button>
                      )}
                      <button onClick={() => eliminar(c.id)} title="Eliminar" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: '16px', padding: '2px 6px', borderRadius: '6px' }}>🗑</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
