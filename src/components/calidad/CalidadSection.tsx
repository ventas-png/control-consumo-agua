import { useState, type CSSProperties, type ChangeEvent} from 'react'
import Swal from 'sweetalert2'
import type { FuenteAgua, RegistroCalidad, TipoAgua } from '../../types'
import { supabase } from '../../lib/supabase'
import { sanitizeInput, sanitizeHTML } from '../../lib/validation'
import { generarPDFAnalisis, exportarPDFCalidad } from '../../lib/pdf'
import { TIPOLOGIAS_CALIDAD, calcularCumplimiento } from './constants'
import type { Empresa } from '../../types'

type SubTab = 'fuentes' | 'analisis' | 'historial'

interface Props {
  fuentesAgua: FuenteAgua[]
  registrosCalidad: RegistroCalidad[]
  empresa: Empresa
  userId?: string
  onFuentesUpdated: (fuentes: FuenteAgua[]) => void
  onRegistrosCalidadUpdated: (registros: RegistroCalidad[]) => void
  canCreate?: boolean
  canEdit?: boolean
}

async function recargarFuentes(): Promise<FuenteAgua[]> {
  const { data } = await supabase.from('fuentes_agua').select('*').order('created_at', { ascending: false })
  return (data ?? []) as FuenteAgua[]
}

async function recargarRegistrosCalidad(): Promise<RegistroCalidad[]> {
  const { data } = await supabase
    .from('registros_calidad')
    .select('*, fuentes_agua(identificador, nombre, tipo_agua)')
    .order('fecha', { ascending: false })
  return (data ?? []) as RegistroCalidad[]
}

export function CalidadSection({
  fuentesAgua, registrosCalidad, empresa, userId,
  onFuentesUpdated, onRegistrosCalidadUpdated,
  canCreate: _canCreate = true, canEdit: _canEdit = true,
}: Props) {
  const [subTab, setSubTab] = useState<SubTab>('fuentes')

  // Fuentes form state
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [fuenteForm, setFuenteForm] = useState({ identificador: '', nombre: '', tipo_agua: '' as TipoAgua | '', descripcion: '' })
  const [savingFuente, setSavingFuente] = useState(false)

  // Análisis form state
  const [analisisFuenteId, setAnalisisFuenteId] = useState('')
  const [analisisFecha, setAnalisisFecha] = useState(new Date().toISOString().slice(0, 16))
  const [analisisObs, setAnalisisObs] = useState('')
  const [parametroValues, setParametroValues] = useState<Record<string, string>>({})
  const [reporteBase64, setReporteBase64] = useState<string | null>(null)
  const [reporteTipo, setReporteTipo] = useState<'pdf' | 'imagen' | null>(null)
  const [reporteNombre, setReporteNombre] = useState<string | null>(null)
  const [savingAnalisis, setSavingAnalisis] = useState(false)

  // Historial filters
  const [filtroFuente, setFiltroFuente] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')
  const [filtroDesde, setFiltroDesde] = useState('')
  const [filtroHasta, setFiltroHasta] = useState('')
  const [filtroCumple, setFiltroCumple] = useState('')

  // Fuentes CRUD
  async function guardarFuente() {
    if (!fuenteForm.identificador.trim()) return Swal.fire('Atención', 'El identificador es obligatorio.', 'warning')
    if (!fuenteForm.nombre.trim() || fuenteForm.nombre.length < 2) return Swal.fire('Atención', 'El nombre es obligatorio (mín. 2 caracteres).', 'warning')
    if (!fuenteForm.tipo_agua) return Swal.fire('Atención', 'Seleccione la tipología de agua.', 'warning')

    setSavingFuente(true)
    try {
      const payload = {
        identificador: sanitizeInput(fuenteForm.identificador),
        nombre: sanitizeInput(fuenteForm.nombre),
        tipo_agua: fuenteForm.tipo_agua,
        descripcion: sanitizeInput(fuenteForm.descripcion),
      }
      if (editandoId) {
        const { error } = await supabase.from('fuentes_agua').update(payload).eq('id', editandoId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('fuentes_agua').insert([payload])
        if (error) throw error
      }
      onFuentesUpdated(await recargarFuentes())
      setFuenteForm({ identificador: '', nombre: '', tipo_agua: '', descripcion: '' })
      setEditandoId(null)
      Swal.fire({ icon: 'success', title: editandoId ? 'Fuente actualizada' : 'Fuente registrada', timer: 1500, showConfirmButton: false })
    } catch (e) {
      Swal.fire('Error', 'No se pudo guardar la fuente: ' + (e instanceof Error ? e.message : ''), 'error')
    } finally {
      setSavingFuente(false)
    }
  }

  function editarFuente(f: FuenteAgua) {
    setEditandoId(f.id)
    setFuenteForm({ identificador: f.identificador, nombre: f.nombre, tipo_agua: f.tipo_agua, descripcion: f.descripcion ?? '' })
    setSubTab('fuentes')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function toggleFuente(id: string, activo: boolean) {
    const { error } = await supabase.from('fuentes_agua').update({ activo: !activo }).eq('id', id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onFuentesUpdated(await recargarFuentes())
  }

  // Análisis
  const fuenteSeleccionada = fuentesAgua.find(f => f.id === analisisFuenteId)
  const tipologiaActual = fuenteSeleccionada ? TIPOLOGIAS_CALIDAD[fuenteSeleccionada.tipo_agua] : null

  function cumplimientoEnVivo(): { cumple: number; noCumple: number; pendiente: number; total: number } {
    if (!tipologiaActual) return { cumple: 0, noCumple: 0, pendiente: 0, total: 0 }
    let cumple = 0, noCumple = 0, pendiente = 0
    tipologiaActual.parametros.forEach(p => {
      const val = parametroValues[p.key]
      if (!val || val.trim() === '') { pendiente++; return }
      const num = parseFloat(val)
      const ok = p.min === p.max && p.min === 0 ? num === 0 : num >= p.min && num <= p.max
      if (ok) cumple++; else noCumple++
    })
    return { cumple, noCumple, pendiente, total: cumple + noCumple }
  }

  async function guardarAnalisis() {
    if (!analisisFuenteId) return Swal.fire('Atención', 'Seleccione una fuente de agua.', 'warning')
    if (!analisisFecha) return Swal.fire('Atención', 'Indique la fecha del análisis.', 'warning')
    if (!fuenteSeleccionada || !tipologiaActual) return

    const parametros: Record<string, number> = {}
    let algunoIngresado = false
    tipologiaActual.parametros.forEach(p => {
      const v = parametroValues[p.key]
      if (v && v.trim() !== '') { parametros[p.key] = parseFloat(v); algunoIngresado = true }
    })
    if (!algunoIngresado) return Swal.fire('Atención', 'Ingrese al menos un valor de parámetro.', 'warning')

    const { cumplimiento, cumple_total } = calcularCumplimiento(fuenteSeleccionada.tipo_agua, parametros)

    const registro = {
      fuente_id: analisisFuenteId,
      fecha: new Date(analisisFecha).toISOString(),
      parametros,
      cumplimiento,
      cumple_total,
      observaciones: sanitizeInput(analisisObs) || null,
      reporte_base64: reporteBase64 ?? null,
      reporte_tipo: reporteTipo ?? null,
      reporte_nombre: reporteNombre ?? null,
      created_by: userId ?? null,
    }

    setSavingAnalisis(true)
    try {
      const { error } = await supabase.from('registros_calidad').insert([registro])
      if (error) throw error
      onRegistrosCalidadUpdated(await recargarRegistrosCalidad())
      // Reset form
      setAnalisisFuenteId('')
      setAnalisisFecha(new Date().toISOString().slice(0, 16))
      setAnalisisObs('')
      setParametroValues({})
      setReporteBase64(null); setReporteTipo(null); setReporteNombre(null)
      Swal.fire({ icon: 'success', title: cumple_total ? '✅ Análisis guardado — CUMPLE' : '⚠️ Análisis guardado — NO CUMPLE', timer: 2000, showConfirmButton: false })
      setSubTab('historial')
    } catch (e) {
      Swal.fire('Error', 'No se pudo guardar: ' + (e instanceof Error ? e.message : ''), 'error')
    } finally {
      setSavingAnalisis(false)
    }
  }

  function handleReporteFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { Swal.fire('Archivo muy grande', 'El archivo no debe superar 5 MB.', 'error'); e.target.value = ''; return }
    setReporteTipo(file.type.includes('pdf') ? 'pdf' : 'imagen')
    setReporteNombre(file.name)
    const reader = new FileReader()
    reader.onload = ev => setReporteBase64((ev.target?.result as string).split(',')[1])
    reader.readAsDataURL(file)
  }

  // Historial filtered
  const historialFiltrado = registrosCalidad.filter(r => {
    if (filtroFuente && r.fuente_id !== filtroFuente) return false
    if (filtroTipo && r.fuentes_agua?.tipo_agua !== filtroTipo) return false
    if (filtroDesde && new Date(r.fecha) < new Date(filtroDesde)) return false
    if (filtroHasta && new Date(r.fecha) > new Date(filtroHasta + 'T23:59:59')) return false
    if (filtroCumple === 'cumple' && !r.cumple_total) return false
    if (filtroCumple === 'no_cumple' && r.cumple_total) return false
    return true
  })

  function verDetalle(r: RegistroCalidad) {
    const fuente = r.fuentes_agua
    const tipologia = fuente ? TIPOLOGIAS_CALIDAD[fuente.tipo_agua] : null
    let filas = ''
    if (tipologia) {
      tipologia.parametros.forEach(p => {
        const val = r.parametros[p.key]
        const cumple = r.cumplimiento[p.key]
        const rango = p.min === p.max && p.min === 0 ? '= 0' : p.min > 0 ? `${p.min} – ${p.max}` : `≤ ${p.max}`
        const badge = cumple === null || val === undefined ? '<span style="color:#94a3b8;">—</span>'
          : cumple ? '<span style="color:#166534;font-weight:600;">✅ CUMPLE</span>'
          : '<span style="color:#991b1b;font-weight:600;">❌ NO CUMPLE</span>'
        filas += `<tr style="border-bottom:1px solid #f1f5f9;${cumple === false ? 'background:#fff5f5;' : cumple === true ? 'background:#f0fdf4;' : ''}">
          <td style="padding:8px;font-size:13px;">${p.label}</td>
          <td style="padding:8px;font-size:13px;text-align:center;">${p.unidad || '—'}</td>
          <td style="padding:8px;font-size:13px;text-align:center;">${val !== undefined ? val : '—'}</td>
          <td style="padding:8px;font-size:13px;text-align:center;">${rango}</td>
          <td style="padding:8px;text-align:center;">${badge}</td>
        </tr>`
      })
    }
    Swal.fire({
      title: `Análisis — ${fuente ? sanitizeHTML(fuente.identificador) : ''}`,
      html: `<div style="text-align:left;font-size:13px;margin-bottom:12px;">
        <strong>Fecha:</strong> ${new Date(r.fecha).toLocaleString('es-GT')}<br>
        <strong>Tipología:</strong> ${tipologia ? tipologia.label : fuente?.tipo_agua ?? ''}<br>
        ${r.observaciones ? '<strong>Obs.:</strong> ' + sanitizeHTML(r.observaciones) + '<br>' : ''}
        <strong>Resultado:</strong> ${r.cumple_total ? '<span style="color:#166534;font-weight:700;">✅ CUMPLE</span>' : '<span style="color:#991b1b;font-weight:700;">❌ NO CUMPLE</span>'}
      </div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead><tr style="background:#f1f5f9;">
            <th scope="col" style="padding:8px;text-align:left;">Parámetro</th>
            <th scope="col" style="padding:8px;text-align:center;">Unidad</th>
            <th scope="col" style="padding:8px;text-align:center;">Valor</th>
            <th scope="col" style="padding:8px;text-align:center;">Rango</th>
            <th scope="col" style="padding:8px;text-align:center;">Estado</th>
          </tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>`,
      width: '700px',
      confirmButtonText: 'Cerrar',
    })
  }

  function verReporte(r: RegistroCalidad) {
    if (!r.reporte_base64) return Swal.fire('Sin reporte', 'Este análisis no tiene reporte adjunto.', 'info')
    const mime = r.reporte_tipo === 'pdf' ? 'application/pdf' : 'image/jpeg'
    const dataUrl = `data:${mime};base64,${r.reporte_base64}`
    const link = document.createElement('a')
    link.href = dataUrl
    link.download = r.reporte_nombre ?? ('reporte.' + (r.reporte_tipo === 'pdf' ? 'pdf' : 'jpg'))
    link.click()
  }

  const inputStyle: CSSProperties = { padding: '12px 16px', border: '2px solid #e2e8f0', borderRadius: '10px', fontSize: '15px', width: '100%', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '14px', fontWeight: 600, color: '#4a5568', marginBottom: '6px', display: 'block' }

  const cvl = cumplimientoEnVivo()

  const tipoOptions = [
    { value: 'potable', label: 'Agua Potable' }, { value: 'rehuso', label: 'Agua de Rehuso' },
    { value: 'piscina', label: 'Agua Piscina' }, { value: 'desalinada', label: 'Agua Desalinada' },
    { value: 'riego', label: 'Agua de Riego' }, { value: 'jacuzzi', label: 'Agua Jacuzzi' },
    { value: 'consumo_humano', label: 'Agua de Consumo Humano' },
    { value: 'desmineralizada', label: 'Agua Desmineralizada' },
    { value: 'residuales_tratadas', label: 'Aguas Residuales Tratadas' },
  ]

  return (
    <div>
      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {(['fuentes', 'analisis', 'historial'] as SubTab[]).map(t => (
          <button key={t} onClick={() => setSubTab(t)} style={{
            padding: '10px 20px', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600,
            background: subTab === t ? 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%)' : '#f1f5f9',
            color: subTab === t ? 'white' : '#475569',
          }}>
            {t === 'fuentes' ? '🗂️ Fuentes de Agua' : t === 'analisis' ? '🧪 Nuevo Análisis' : '📋 Historial Calidad'}
          </button>
        ))}
      </div>

      {/* FUENTES */}
      {subTab === 'fuentes' && (
        <div>
          <div style={{ background: 'white', borderRadius: '24px', padding: '32px', marginBottom: '20px', boxShadow: '0 10px 40px rgba(0,0,0,0.08)' }}>
            <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '16px' }}>
              {editandoId ? '✏️ Editar Fuente' : '🗂️ Fuentes de Agua'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginBottom: '20px' }}>
              <div>
                <label style={labelStyle}>Identificador *</label>
                <input type="text" value={fuenteForm.identificador} onChange={e => setFuenteForm(p => ({ ...p, identificador: e.target.value }))} placeholder="Ej: FA-001" maxLength={50} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Nombre / Descripción *</label>
                <input type="text" value={fuenteForm.nombre} onChange={e => setFuenteForm(p => ({ ...p, nombre: e.target.value }))} placeholder="Ej: Piscina principal" maxLength={100} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Tipología de Agua *</label>
                <select value={fuenteForm.tipo_agua} onChange={e => setFuenteForm(p => ({ ...p, tipo_agua: e.target.value as TipoAgua }))} style={inputStyle}>
                  <option value="">— Seleccione tipo —</option>
                  {tipoOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Descripción adicional</label>
                <input type="text" value={fuenteForm.descripcion} onChange={e => setFuenteForm(p => ({ ...p, descripcion: e.target.value }))} placeholder="Ubicación, observaciones..." maxLength={200} style={inputStyle} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={guardarFuente} disabled={savingFuente} style={{ padding: '12px 24px', background: 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
                {savingFuente ? 'Guardando...' : `💾 ${editandoId ? 'Actualizar Fuente' : 'Guardar Fuente'}`}
              </button>
              <button onClick={() => { setFuenteForm({ identificador: '', nombre: '', tipo_agua: '', descripcion: '' }); setEditandoId(null) }} style={{ padding: '12px 24px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
                ✕ Cancelar
              </button>
            </div>
          </div>

          <div style={{ background: 'white', borderRadius: '24px', padding: '32px', boxShadow: '0 10px 40px rgba(0,0,0,0.08)' }}>
            <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '16px' }}>Fuentes Registradas</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead><tr style={{ background: '#f1f5f9' }}>
                  {['ID', 'Identificador', 'Nombre', 'Tipología', 'Estado', 'Acciones'].map(h => <th scope="col" key={h} style={{ padding: '10px', textAlign: 'left', borderBottom: '2px solid #e2e8f0' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {fuentesAgua.map(f => {
                    const tipologia = TIPOLOGIAS_CALIDAD[f.tipo_agua]
                    return (
                      <tr key={f.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '10px', fontSize: '12px', color: '#94a3b8' }}>{f.id.substring(0, 8)}…</td>
                        <td style={{ padding: '10px', fontWeight: 600, color: '#0369a1' }}>{sanitizeHTML(f.identificador)}</td>
                        <td style={{ padding: '10px' }}>{sanitizeHTML(f.nombre)}</td>
                        <td style={{ padding: '10px', fontSize: '13px' }}>{tipologia?.label ?? f.tipo_agua}</td>
                        <td style={{ padding: '10px' }}>
                          <span style={{ padding: '3px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 500, background: f.activo ? '#dcfce7' : '#fee2e2', color: f.activo ? '#166534' : '#991b1b' }}>
                            {f.activo ? 'Activa' : 'Inactiva'}
                          </span>
                        </td>
                        <td style={{ padding: '10px' }}>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button onClick={() => editarFuente(f)} style={{ background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer', fontSize: '12px' }}>✏️ Editar</button>
                            <button onClick={() => toggleFuente(f.id, f.activo)} style={{ background: f.activo ? '#f59e0b' : '#10b981', color: 'white', border: 'none', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer', fontSize: '12px' }}>
                              {f.activo ? '⏸ Desactivar' : '▶ Activar'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {fuentesAgua.length === 0 && <tr><td colSpan={6} style={{ padding: '20px', textAlign: 'center', color: '#94a3b8' }}>Sin fuentes registradas</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ANÁLISIS */}
      {subTab === 'analisis' && (
        <div style={{ background: 'white', borderRadius: '24px', padding: '32px', boxShadow: '0 10px 40px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '20px' }}>🧪 Nuevo Análisis de Calidad</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginBottom: '20px' }}>
            <div>
              <label style={labelStyle}>Fuente de Agua *</label>
              <select value={analisisFuenteId} onChange={e => { setAnalisisFuenteId(e.target.value); setParametroValues({}) }} style={inputStyle}>
                <option value="">— Seleccione fuente —</option>
                {fuentesAgua.filter(f => f.activo).map(f => <option key={f.id} value={f.id}>{f.identificador} — {f.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Fecha del Análisis *</label>
              <input type="datetime-local" value={analisisFecha} onChange={e => setAnalisisFecha(e.target.value)} style={inputStyle} />
            </div>
          </div>

          {tipologiaActual && (
            <div>
              <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px' }}>
                <strong style={{ color: '#0369a1', fontSize: '14px' }}>Parámetros para: {tipologiaActual.label}</strong>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '16px', marginBottom: '16px' }}>
                {tipologiaActual.parametros.map(p => {
                  const val = parametroValues[p.key] ?? ''
                  const num = parseFloat(val)
                  const ok = val.trim() === '' ? null : (p.min === p.max && p.min === 0 ? num === 0 : num >= p.min && num <= p.max)
                  const rango = p.min === p.max && p.min === 0 ? 'Ausencia (= 0)' : p.min > 0 ? `${p.min} – ${p.max}` : `≤ ${p.max}`
                  return (
                    <div key={p.key}>
                      <label style={{ ...labelStyle, fontSize: '13px' }}>
                        {p.label}{p.unidad ? ` (${p.unidad})` : ''}
                        <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: '11px' }}> [{rango}]</span>
                      </label>
                      <input
                        type="number" step="any" value={val}
                        onChange={e => setParametroValues(prev => ({ ...prev, [p.key]: e.target.value }))}
                        placeholder="Ingrese valor"
                        style={{ ...inputStyle, borderColor: ok === null ? '#e2e8f0' : ok ? '#10b981' : '#ef4444' }}
                      />
                    </div>
                  )
                })}
              </div>

              <div style={{ marginBottom: '16px', padding: '14px', borderRadius: '10px', background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                <div style={{ fontWeight: 600, marginBottom: '8px', fontSize: '14px' }}>Resumen de Cumplimiento</div>
                {cvl.total === 0
                  ? <span style={{ color: '#94a3b8', fontSize: '13px' }}>Ingrese los valores para ver el cumplimiento.</span>
                  : <span style={{ background: cvl.noCumple === 0 ? '#dcfce7' : '#fee2e2', color: cvl.noCumple === 0 ? '#166534' : '#991b1b', padding: '4px 12px', borderRadius: '8px', fontWeight: 600 }}>
                    {cvl.noCumple === 0 ? '✅ CUMPLE' : '❌ NO CUMPLE'} — {cvl.cumple}/{cvl.total + cvl.pendiente} parámetros OK{cvl.pendiente > 0 ? `, ${cvl.pendiente} pendiente(s)` : ''}
                  </span>
                }
              </div>
            </div>
          )}

          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>Observaciones</label>
            <textarea value={analisisObs} onChange={e => setAnalisisObs(e.target.value)} rows={3} style={{ ...inputStyle, fontFamily: 'inherit' }} placeholder="Condiciones del muestreo, laboratorio, etc." />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={labelStyle}>Adjuntar Reporte (PDF o imagen, máx. 5 MB)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <label style={{ cursor: 'pointer', background: '#0ea5e9', color: 'white', padding: '8px 16px', borderRadius: '8px', fontSize: '14px' }}>
                📎 Seleccionar archivo
                <input type="file" accept=".pdf,image/*" hidden onChange={handleReporteFile} />
              </label>
              <span style={{ fontSize: '13px', color: '#64748b' }}>{reporteNombre ?? 'Ningún archivo seleccionado'}</span>
              {reporteNombre && <button onClick={() => { setReporteBase64(null); setReporteTipo(null); setReporteNombre(null) }} style={{ background: '#ef4444', color: 'white', border: 'none', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', fontSize: '13px' }}>✕ Quitar</button>}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button onClick={guardarAnalisis} disabled={savingAnalisis} style={{ padding: '12px 24px', background: 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
              {savingAnalisis ? 'Guardando...' : '💾 Guardar Análisis'}
            </button>
            <button onClick={() => { setAnalisisFuenteId(''); setParametroValues({}); setAnalisisObs('') }} style={{ padding: '12px 24px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
              ✕ Limpiar
            </button>
          </div>
        </div>
      )}

      {/* HISTORIAL */}
      {subTab === 'historial' && (
        <div style={{ background: 'white', borderRadius: '24px', padding: '32px', boxShadow: '0 10px 40px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '16px' }}>📋 Historial de Análisis de Calidad</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px', marginBottom: '16px' }}>
            <div>
              <label style={labelStyle}>Fuente</label>
              <select value={filtroFuente} onChange={e => setFiltroFuente(e.target.value)} style={inputStyle}>
                <option value="">Todas</option>
                {fuentesAgua.map(f => <option key={f.id} value={f.id}>{f.identificador}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Tipología</label>
              <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)} style={inputStyle}>
                <option value="">Todas</option>
                {tipoOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Desde</label>
              <input type="date" value={filtroDesde} onChange={e => setFiltroDesde(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Hasta</label>
              <input type="date" value={filtroHasta} onChange={e => setFiltroHasta(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Cumplimiento</label>
              <select value={filtroCumple} onChange={e => setFiltroCumple(e.target.value)} style={inputStyle}>
                <option value="">Todos</option>
                <option value="cumple">Cumple</option>
                <option value="no_cumple">No Cumple</option>
              </select>
            </div>
          </div>
          <div style={{ marginBottom: '16px' }}>
            <button onClick={() => exportarPDFCalidad(historialFiltrado, empresa)} style={{ padding: '10px 20px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
              📄 Exportar PDF
            </button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead><tr style={{ background: '#f1f5f9' }}>
                {['Fecha', 'Fuente', 'Tipología', 'Resultado', 'Observaciones', 'Acciones'].map(h => <th scope="col" key={h} style={{ padding: '10px', textAlign: h === 'Resultado' || h === 'Acciones' ? 'center' : 'left', borderBottom: '2px solid #e2e8f0' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {historialFiltrado.map(r => {
                  const fuente = r.fuentes_agua
                  const tipologia = fuente ? TIPOLOGIAS_CALIDAD[fuente.tipo_agua] : null
                  return (
                    <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px', fontSize: '13px' }}>{new Date(r.fecha).toLocaleString('es-GT')}</td>
                      <td style={{ padding: '10px', fontWeight: 600, color: '#0369a1' }}>{fuente ? sanitizeHTML(fuente.identificador) : '—'}</td>
                      <td style={{ padding: '10px', fontSize: '13px' }}>{tipologia?.label ?? fuente?.tipo_agua ?? '—'}</td>
                      <td style={{ padding: '10px', textAlign: 'center' }}>
                        <span style={{ background: r.cumple_total ? '#dcfce7' : '#fee2e2', color: r.cumple_total ? '#166534' : '#991b1b', padding: '4px 12px', borderRadius: '12px', fontSize: '12px', fontWeight: 600 }}>
                          {r.cumple_total ? '✅ CUMPLE' : '❌ NO CUMPLE'}
                        </span>
                      </td>
                      <td style={{ padding: '10px', fontSize: '13px', color: '#64748b' }}>{sanitizeHTML(r.observaciones ?? '—')}</td>
                      <td style={{ padding: '10px' }}>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center' }}>
                          <button onClick={() => verDetalle(r)} style={{ background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer', fontSize: '12px' }}>🔍 Detalle</button>
                          <button onClick={() => generarPDFAnalisis(r, empresa)} style={{ background: '#10b981', color: 'white', border: 'none', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer', fontSize: '12px' }}>📄 PDF</button>
                          {r.reporte_base64 && <button onClick={() => verReporte(r)} style={{ background: '#8b5cf6', color: 'white', border: 'none', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer', fontSize: '12px' }}>📎 Reporte</button>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {historialFiltrado.length === 0 && <tr><td colSpan={6} style={{ padding: '20px', textAlign: 'center', color: '#94a3b8' }}>Sin registros con esos filtros</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
