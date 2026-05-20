import { useState, useRef, type ChangeEvent} from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../../lib/supabase'
import type { CuotaCondominio, ConceptoCuota, EstadoCuota, Unidad, Proyecto, RubroDetalle } from '../../../types'
import { exportarExcel, exportarPDFRecibo } from '../exportUtils'

interface CSVRow {
  rawUnidad: string
  rawConcepto: string
  rawMonto: string
  rawPeriodo: string
  rawVencimiento: string
  rawNotas: string
  unidadId: string | null
  concepto: ConceptoCuota | null
  monto: number | null
  status: 'ok' | 'warn' | 'error'
  errores: string[]
}

const CONCEPTOS_VALIDOS: ConceptoCuota[] = ['mantenimiento', 'extraordinaria', 'CAM', 'otro']

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
  pendiente: { bg: 'var(--at-primary-tint)', color: 'var(--at-primary)' },
  pagado:    { bg: '#f0fdf4', color: '#16a34a' },
  moroso:    { bg: '#fef2f2', color: '#dc2626' },
}

export function CuotasTab({ cuotas, unidades, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [csvRows, setCsvRows] = useState<CSVRow[] | null>(null)
  const [importando, setImportando] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [filtroEstado, setFiltroEstado] = useState<EstadoCuota | 'todos'>('todos')
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set())
  const [expandidasRubros, setExpandidasRubros] = useState<Set<string>>(new Set())
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

  const cuotasPagables = cuotasFiltradas.filter(c => c.estado !== 'pagado')

  const totales = {
    pendiente: cuotas.filter(c => c.estado === 'pendiente').reduce((s, c) => s + c.monto, 0),
    moroso:    cuotas.filter(c => c.estado === 'moroso').reduce((s, c) => s + c.monto, 0),
    pagado:    cuotas.filter(c => c.estado === 'pagado').reduce((s, c) => s + c.monto, 0),
  }

  function parsearCSV(text: string): CSVRow[] {
    const lineas = text.trim().split('\n').filter(l => l.trim())
    if (lineas.length < 2) return []
    // skip header row
    return lineas.slice(1).map(linea => {
      const cols = linea.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
      const [rawUnidad = '', rawConcepto = '', rawMonto = '', rawPeriodo = '', rawVencimiento = '', rawNotas = ''] = cols
      const errores: string[] = []

      const unidadMatch = unidades.find(u => u.nombre.toLowerCase() === rawUnidad.toLowerCase())
      if (!rawUnidad) errores.push('Unidad vacía')
      else if (!unidadMatch) errores.push(`Unidad "${rawUnidad}" no encontrada`)

      const conceptoNorm = rawConcepto.toLowerCase()
      const concepto = CONCEPTOS_VALIDOS.includes(conceptoNorm as ConceptoCuota)
        ? (conceptoNorm as ConceptoCuota)
        : rawConcepto === '' ? null : null
      if (!concepto) errores.push(`Concepto "${rawConcepto}" inválido (usa: ${CONCEPTOS_VALIDOS.join(', ')})`)

      const monto = parseFloat(rawMonto)
      if (!rawMonto || isNaN(monto) || monto <= 0) errores.push('Monto inválido')

      if (!rawPeriodo.match(/^\d{4}-\d{2}$/)) errores.push('Período debe ser AAAA-MM')

      const status: CSVRow['status'] = errores.length === 0 ? 'ok'
        : errores.some(e => e.includes('no encontrada')) ? 'warn'
        : 'error'

      return {
        rawUnidad, rawConcepto, rawMonto, rawPeriodo, rawVencimiento, rawNotas,
        unidadId: unidadMatch?.id ?? null,
        concepto: errores.length === 0 || !errores.some(e => e.includes('Concepto')) ? concepto : null,
        monto: isNaN(monto) ? null : monto,
        status,
        errores,
      }
    })
  }

  function handleCSVFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      const filas = parsearCSV(text)
      if (filas.length === 0) {
        Swal.fire('Error', 'El archivo CSV no tiene filas válidas. Verifique el formato.', 'error')
      } else {
        setCsvRows(filas)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  async function confirmarImportCSV() {
    if (!csvRows) return
    const validas = csvRows.filter(r => r.status === 'ok' && r.unidadId && r.concepto && r.monto)
    if (validas.length === 0) {
      Swal.fire('Sin filas válidas', 'Corrija los errores antes de importar.', 'warning')
      return
    }
    const { isConfirmed } = await Swal.fire({
      title: `Importar ${validas.length} cuota${validas.length > 1 ? 's' : ''}`,
      html: `<p style="font-size:13px;color:var(--at-ink-2)">${csvRows.length - validas.length > 0 ? `<strong>${csvRows.length - validas.length} fila(s) con errores serán omitidas.</strong><br>` : ''}Se insertarán ${validas.length} cuotas con estado <strong>pendiente</strong>.</p>`,
      icon: 'question', showCancelButton: true,
      confirmButtonText: '📥 Importar', cancelButtonText: 'Cancelar',
      confirmButtonColor: 'var(--at-primary)',
    })
    if (!isConfirmed) return
    setImportando(true)
    const inserts = validas.map(r => ({
      company_id: companyId,
      project_id: proyectoId,
      unidad_id: r.unidadId,
      concepto: r.concepto!,
      monto: r.monto!,
      periodo: r.rawPeriodo,
      fecha_vencimiento: r.rawVencimiento || null,
      notas: r.rawNotas || null,
      estado: 'pendiente' as EstadoCuota,
    }))
    const { error } = await supabase.from('cuotas_condominio').insert(inserts)
    setImportando(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    Swal.fire({ icon: 'success', title: `${validas.length} cuotas importadas`, timer: 1800, showConfirmButton: false })
    setCsvRows(null)
    onRefresh()
  }

  function resetForm() {
    setForm({ unidad_id: '', concepto: 'mantenimiento', monto: '', periodo: new Date().toISOString().slice(0, 7), fecha_vencimiento: '', notas: '' })
    setShowForm(false)
  }

  function toggleSeleccion(id: string) {
    setSeleccionadas(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleTodas() {
    if (seleccionadas.size === cuotasPagables.length) {
      setSeleccionadas(new Set())
    } else {
      setSeleccionadas(new Set(cuotasPagables.map(c => c.id)))
    }
  }

  function toggleRubros(id: string) {
    setExpandidasRubros(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  function whatsappRecordatorio(cuota: CuotaCondominio) {
    const unidadNombre = cuota.unidad_nombre ?? 'su unidad'
    const venc = cuota.fecha_vencimiento ? ` con vencimiento el ${cuota.fecha_vencimiento}` : ''
    const msg = `Estimado(a) residente de ${unidadNombre},\n\nLe recordamos que tiene una cuota de *${cuota.concepto}* por *${moneda} ${cuota.monto.toFixed(2)}* correspondiente al período ${cuota.periodo}${venc}.\n\nPor favor comuníquese con la administración para regularizar su situación.\n\nGracias,\nAdministración del Condominio`
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
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
            <label style="font-weight:600;color:var(--at-ink-2);display:block;margin-bottom:4px">Fecha de pago</label>
            <input id="sw-fecha" type="date" class="swal2-input" value="${hoy}" style="margin:0 0 12px;width:100%;box-sizing:border-box">
            <label style="font-weight:600;color:var(--at-ink-2);display:block;margin-bottom:4px">Método de pago</label>
            <select id="sw-metodo" class="swal2-select" style="margin:0 0 12px;width:100%;box-sizing:border-box">
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia bancaria</option>
              <option value="cheque">Cheque</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="deposito">Depósito</option>
              <option value="otro">Otro</option>
            </select>
            <label style="font-weight:600;color:var(--at-ink-2);display:block;margin-bottom:4px">Referencia / No. transacción</label>
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

  async function pagoMasivo() {
    const ids = [...seleccionadas]
    const items = cuotas.filter(c => ids.includes(c.id))
    const totalMonto = items.reduce((s, c) => s + c.monto, 0)
    const hoy = new Date().toISOString().slice(0, 10)

    const { value: datos } = await Swal.fire({
      title: `Registrar pago para ${ids.length} cuota${ids.length > 1 ? 's' : ''}`,
      html: `
        <div style="text-align:left;font-size:13px;margin-bottom:12px">
          <span style="font-size:16px;font-weight:800;color:#16a34a">Total: ${moneda} ${totalMonto.toFixed(2)}</span>
        </div>
        <div style="text-align:left;font-size:13px">
          <label style="font-weight:600;color:var(--at-ink-2);display:block;margin-bottom:4px">Fecha de pago</label>
          <input id="sw-fecha" type="date" class="swal2-input" value="${hoy}" style="margin:0 0 12px;width:100%;box-sizing:border-box">
          <label style="font-weight:600;color:var(--at-ink-2);display:block;margin-bottom:4px">Método de pago</label>
          <select id="sw-metodo" class="swal2-select" style="margin:0 0 12px;width:100%;box-sizing:border-box">
            <option value="efectivo">Efectivo</option>
            <option value="transferencia">Transferencia bancaria</option>
            <option value="cheque">Cheque</option>
            <option value="tarjeta">Tarjeta</option>
            <option value="deposito">Depósito</option>
            <option value="otro">Otro</option>
          </select>
          <label style="font-weight:600;color:var(--at-ink-2);display:block;margin-bottom:4px">Referencia / No. transacción</label>
          <input id="sw-ref" type="text" class="swal2-input" placeholder="Opcional" style="margin:0;width:100%;box-sizing:border-box">
        </div>`,
      showCancelButton: true,
      confirmButtonText: `✅ Confirmar ${ids.length} pago${ids.length > 1 ? 's' : ''}`,
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
    }).in('id', ids)

    if (error) { Swal.fire('Error', error.message, 'error'); return }
    Swal.fire({ icon: 'success', title: `${ids.length} cuotas marcadas como pagadas`, text: `Total: ${moneda} ${totalMonto.toFixed(2)}`, timer: 2000, showConfirmButton: false })
    setSeleccionadas(new Set())
    onRefresh()
  }

  async function eliminar(id: string) {
    const result = await Swal.fire({ title: '¿Eliminar cuota?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar', confirmButtonColor: '#ef4444' })
    if (!result.isConfirmed) return
    await supabase.from('cuotas_condominio').delete().eq('id', id)
    onRefresh()
  }

  async function aplicarMoraMasiva() {
    const hoy = new Date().toISOString().slice(0, 10)
    const vencidas = cuotas.filter(c => c.estado === 'pendiente' && c.fecha_vencimiento && c.fecha_vencimiento < hoy)
    if (vencidas.length === 0) {
      Swal.fire({ icon: 'success', title: '¡Sin vencidas!', text: 'No hay cuotas pendientes con fecha de vencimiento pasada.', timer: 2000, showConfirmButton: false })
      return
    }
    const { isConfirmed } = await Swal.fire({
      title: `¿Marcar ${vencidas.length} cuota${vencidas.length > 1 ? 's' : ''} como morosas?`,
      html: `<p style="font-size:13px;color:var(--at-ink-2)">Cuotas <strong>pendientes</strong> cuya fecha de vencimiento ya pasó.<br>Esta acción se puede revertir cambiando el estado individualmente.</p>`,
      icon: 'warning', showCancelButton: true,
      confirmButtonText: '⚡ Aplicar mora', cancelButtonText: 'Cancelar', confirmButtonColor: '#dc2626',
    })
    if (!isConfirmed) return
    const { error } = await supabase.from('cuotas_condominio').update({ estado: 'moroso' }).in('id', vencidas.map(c => c.id))
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    Swal.fire({ icon: 'success', title: `${vencidas.length} cuotas marcadas como morosas`, timer: 1500, showConfirmButton: false })
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

  const montoSeleccionado = cuotas.filter(c => seleccionadas.has(c.id)).reduce((s, c) => s + c.monto, 0)

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--at-ink)' }}>Cuotas de Mantenimiento</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--at-ink-3)', fontSize: '13.5px' }}>{cuotas.length} cuotas registradas</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canEdit && seleccionadas.size > 0 && (
            <button onClick={pagoMasivo}
              style={{ padding: '10px 16px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '10px', fontWeight: 700, cursor: 'pointer', fontSize: '13px' }}>
              ✅ Pagar {seleccionadas.size} · {moneda} {montoSeleccionado.toFixed(2)}
            </button>
          )}
          <button
            onClick={() => exportarExcel(`cuotas-${new Date().toISOString().slice(0,10)}`, [{
              name: 'Cuotas',
              headers: ['Unidad', 'Concepto', 'Período', 'Monto', 'Vencimiento', 'Estado', 'Método pago', 'Fecha pago'],
              rows: cuotas.map(c => [c.unidad_nombre ?? 'General', c.concepto, c.periodo, c.monto, c.fecha_vencimiento ?? '', c.estado, c.metodo_pago ?? '', c.fecha_pago ?? '']),
            }])}
            style={{ padding: '10px 16px', background: '#f0fdf4', color: '#16a34a', border: '1.5px solid #86efac', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
            📊 Excel
          </button>
          {canEdit && (
            <button onClick={aplicarMoraMasiva}
              title="Marcar como morosas todas las cuotas pendientes con vencimiento pasado"
              style={{ padding: '10px 16px', background: '#fef2f2', color: '#dc2626', border: '1.5px solid #fca5a5', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
              ⚡ Mora
            </button>
          )}
          {canCreate && (
            <>
              <input ref={fileInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleCSVFile} />
              <button onClick={() => fileInputRef.current?.click()}
                style={{ padding: '10px 16px', background: 'var(--at-accent-tint-2)', color: 'var(--at-accent-hover)', border: '1.5px solid var(--at-accent-soft)', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
                📥 Importar CSV
              </button>
              <button onClick={() => setShowForm(true)} style={{ padding: '10px 20px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '14px' }}>
                + Nueva cuota
              </button>
            </>
          )}
        </div>
      </div>

      {/* Resumen */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
        {([['pendiente', 'var(--at-primary)', 'var(--at-primary-tint)'], ['moroso', '#dc2626', '#fef2f2'], ['pagado', '#16a34a', '#f0fdf4']] as const).map(([estado, color, bg]) => (
          <button key={estado} onClick={() => { setFiltroEstado(filtroEstado === estado ? 'todos' : estado); setSeleccionadas(new Set()) }}
            style={{ padding: '14px', background: filtroEstado === estado ? bg : 'white', border: `1.5px solid ${filtroEstado === estado ? color : 'var(--at-line)'}`, borderRadius: '12px', cursor: 'pointer', textAlign: 'left' }}>
            <div style={{ fontSize: '18px', fontWeight: 800, color }}>{moneda} {totales[estado].toFixed(2)}</div>
            <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px', textTransform: 'capitalize' }}>{cuotas.filter(c => c.estado === estado).length} cuotas {estado}s</div>
          </button>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>Nueva cuota</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Unidad (opcional)</label>
              <select value={form.unidad_id} onChange={e => setForm(f => ({ ...f, unidad_id: e.target.value }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }}>
                <option value="">Todas las unidades</option>
                {unidades.filter(u => u.activo).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Concepto</label>
              <select value={form.concepto} onChange={e => setForm(f => ({ ...f, concepto: e.target.value as ConceptoCuota }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }}>
                {CONCEPTOS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Monto ({moneda})</label>
              <input type="number" value={form.monto} onChange={e => setForm(f => ({ ...f, monto: e.target.value }))}
                placeholder="0.00" min="0" step="0.01"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Período</label>
              <input type="month" value={form.periodo} onChange={e => setForm(f => ({ ...f, periodo: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Fecha de vencimiento</label>
              <input type="date" value={form.fecha_vencimiento} onChange={e => setForm(f => ({ ...f, fecha_vencimiento: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Notas</label>
              <input type="text" value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                placeholder="Opcional"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button onClick={handleGuardar} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
            <button onClick={resetForm} style={{ padding: '10px 20px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* CSV Preview */}
      {csvRows && (
        <div style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-accent-soft)', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--at-ink)' }}>Vista previa del CSV</h3>
              <p style={{ margin: '3px 0 0', fontSize: '12.5px', color: 'var(--at-ink-3)' }}>
                {csvRows.filter(r => r.status === 'ok').length} filas válidas · {csvRows.filter(r => r.status !== 'ok').length} con errores
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={confirmarImportCSV} disabled={importando || csvRows.filter(r => r.status === 'ok').length === 0}
                style={{ padding: '9px 18px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '9px', fontWeight: 700, cursor: 'pointer', fontSize: '13px' }}>
                {importando ? 'Importando...' : `📥 Confirmar (${csvRows.filter(r => r.status === 'ok').length})`}
              </button>
              <button onClick={() => setCsvRows(null)}
                style={{ padding: '9px 14px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '9px', cursor: 'pointer', fontSize: '13px' }}>
                Cancelar
              </button>
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
              <thead>
                <tr style={{ background: 'var(--at-surface-2)', borderBottom: '1px solid var(--at-line)' }}>
                  {['', 'Unidad', 'Concepto', 'Monto', 'Período', 'Vencimiento', 'Notas'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: 'var(--at-ink-3)', fontSize: '11px', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {csvRows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--at-chip)', background: r.status === 'error' ? '#fef2f2' : r.status === 'warn' ? '#fffbeb' : undefined }}>
                    <td style={{ padding: '7px 12px', fontSize: '14px' }}>
                      {r.status === 'ok' ? '✅' : r.status === 'warn' ? '⚠️' : '❌'}
                    </td>
                    <td style={{ padding: '7px 12px', color: r.unidadId ? 'var(--at-ink-2)' : '#dc2626' }}>{r.rawUnidad || '—'}</td>
                    <td style={{ padding: '7px 12px', color: r.concepto ? 'var(--at-ink-2)' : '#dc2626' }}>{r.rawConcepto || '—'}</td>
                    <td style={{ padding: '7px 12px', color: r.monto ? 'var(--at-ink-2)' : '#dc2626' }}>{r.rawMonto || '—'}</td>
                    <td style={{ padding: '7px 12px', color: 'var(--at-ink-2)' }}>{r.rawPeriodo || '—'}</td>
                    <td style={{ padding: '7px 12px', color: 'var(--at-ink-2)' }}>{r.rawVencimiento || '—'}</td>
                    <td style={{ padding: '7px 12px', color: 'var(--at-ink-2)', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.rawNotas || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {csvRows.some(r => r.errores.length > 0) && (
            <div style={{ marginTop: '10px', padding: '10px 14px', background: '#fef2f2', borderRadius: '8px', fontSize: '12px', color: '#dc2626' }}>
              <strong>Errores detectados:</strong>
              <ul style={{ margin: '4px 0 0', paddingLeft: '18px' }}>
                {csvRows.flatMap((r, i) => r.errores.map(e => <li key={`${i}-${e}`}>Fila {i + 2}: {e}</li>))}
              </ul>
            </div>
          )}
          <div style={{ marginTop: '10px', padding: '8px 12px', background: 'var(--at-primary-tint)', borderRadius: '8px', fontSize: '11.5px', color: 'var(--at-primary-hover)' }}>
            Formato esperado: <code>unidad,concepto,monto,periodo,vencimiento,notas</code> — ejemplo: <code>Apto 101,mantenimiento,350.00,2026-04,2026-04-30,</code>
          </div>
        </div>
      )}

      {/* Lista */}
      {cuotasFiltradas.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>💳</div>
          <p style={{ fontWeight: 600, color: 'var(--at-ink-3)' }}>No hay cuotas {filtroEstado !== 'todos' ? `con estado "${filtroEstado}"` : 'registradas'}</p>
        </div>
      ) : (
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '16px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13.5px' }}>
            <thead>
              <tr style={{ background: 'var(--at-surface-2)', borderBottom: '1px solid var(--at-line)' }}>
                {canEdit && (
                  <th style={{ padding: '10px 14px', width: 36 }}>
                    <input type="checkbox"
                      checked={cuotasPagables.length > 0 && seleccionadas.size === cuotasPagables.length}
                      onChange={toggleTodas}
                      title="Seleccionar todas las pagables"
                    />
                  </th>
                )}
                {['Unidad', 'Concepto', 'Período', 'Monto', 'Vencimiento', 'Estado', 'Rubros', ''].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11.5px', fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cuotasFiltradas.flatMap(c => {
                const esPagable = c.estado !== 'pagado'
                const seleccionada = seleccionadas.has(c.id)
                const rubrosDetalle = c.rubros_detalle as RubroDetalle[] | null | undefined
                const tieneRubros = rubrosDetalle && rubrosDetalle.length > 0
                const expandido = expandidasRubros.has(c.id)
                const hoy = new Date().toISOString().slice(0, 10)
                const colCount = canEdit ? 9 : 8

                const mainRow = (
                  <tr key={c.id} style={{ borderBottom: expandido ? 'none' : '1px solid var(--at-chip)', background: seleccionada ? '#f0fdf4' : undefined }}>
                    {canEdit && (
                      <td style={{ padding: '10px 14px' }}>
                        {esPagable && (
                          <input type="checkbox" checked={seleccionada} onChange={() => toggleSeleccion(c.id)} />
                        )}
                      </td>
                    )}
                    <td style={{ padding: '10px 14px', color: 'var(--at-ink-2)' }}>{c.unidad_nombre || <span style={{ color: 'var(--at-ink-3)', fontStyle: 'italic' }}>General</span>}</td>
                    <td style={{ padding: '10px 14px', color: 'var(--at-ink-2)' }}>{CONCEPTOS.find(x => x.value === c.concepto)?.label || c.concepto}</td>
                    <td style={{ padding: '10px 14px', color: 'var(--at-ink-2)' }}>{c.periodo}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ fontWeight: 700, color: 'var(--at-ink)' }}>{moneda} {c.monto.toFixed(2)}</div>
                      {c.estado === 'pagado' && c.metodo_pago && (
                        <div style={{ fontSize: '11px', color: '#16a34a', marginTop: '1px' }}>
                          {c.metodo_pago}{c.fecha_pago ? ` · ${c.fecha_pago}` : ''}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '10px 14px', color: c.fecha_vencimiento && c.fecha_vencimiento < hoy && c.estado !== 'pagado' ? '#dc2626' : 'var(--at-ink-2)' }}>
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
                      {tieneRubros ? (
                        <button onClick={() => toggleRubros(c.id)}
                          style={{ fontSize: '11px', padding: '3px 8px', border: '1px solid var(--at-accent-soft)', borderRadius: '6px', cursor: 'pointer', background: expandido ? 'var(--at-primary-tint)' : 'var(--at-surface-2)', color: 'var(--at-accent-hover)', fontWeight: 600 }}>
                          {expandido ? '▲' : '▼'} {rubrosDetalle!.length}
                        </button>
                      ) : <span style={{ color: 'var(--at-line-strong)', fontSize: 11 }}>—</span>}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {(c.estado === 'pendiente' || c.estado === 'moroso') && (
                          <button onClick={() => whatsappRecordatorio(c)} title="Recordatorio por WhatsApp"
                            style={{ background: '#f0fdf4', border: 'none', cursor: 'pointer', color: '#16a34a', fontSize: '13px', padding: '3px 7px', borderRadius: '6px', fontWeight: 600 }}>
                            💬
                          </button>
                        )}
                        {c.estado === 'pagado' && canCreate && (
                          <button onClick={() => crearRecibo(c)} title="Crear recibo digital"
                            style={{ background: 'var(--at-primary-tint)', border: 'none', cursor: 'pointer', color: 'var(--at-primary)', fontSize: '13px', padding: '3px 7px', borderRadius: '6px', fontWeight: 600 }}>
                            🧾
                          </button>
                        )}
                        <button onClick={() => eliminar(c.id)} title="Eliminar" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: '16px', padding: '2px 6px', borderRadius: '6px' }}>🗑</button>
                      </div>
                    </td>
                  </tr>
                )

                if (!expandido || !tieneRubros) return [mainRow]

                const detalleRow = (
                  <tr key={`${c.id}-rubros`} style={{ borderBottom: '1px solid var(--at-chip)', background: '#f8faff' }}>
                    <td colSpan={colCount} style={{ padding: '0 14px 10px 48px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '8px 12px', background: 'var(--at-primary-tint)', borderRadius: 8, border: '1px solid var(--at-accent-soft-2)' }}>
                        {rubrosDetalle!.map((rd, ri) => (
                          <div key={ri} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--at-ink-2)' }}>
                            <span>
                              {rd.nombre}
                              <span style={{ marginLeft: 6, color: 'var(--at-ink-3)', fontSize: 11 }}>
                                ({rd.metodo === 'fijo' ? 'fijo' : rd.metodo === 'por_m2' ? `${moneda} ${rd.valor}/m²` : `alíc. ${rd.valor.toLocaleString('es')}`})
                              </span>
                            </span>
                            <span style={{ fontWeight: 600 }}>{moneda} {rd.monto_calculado.toLocaleString('es', { minimumFractionDigits: 2 })}</span>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )

                return [mainRow, detalleRow]
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
