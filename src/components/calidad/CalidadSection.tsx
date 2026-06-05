import { useState, useMemo, type CSSProperties, type ChangeEvent} from 'react'
import * as RDialog from '@radix-ui/react-dialog'
import { notify } from '../shared/Dialog'
import type { FuenteAgua, RegistroCalidad, TipoAgua } from '../../types'
import { fetchFuentes, fetchRegistrosCalidad, getReporteCalidadSignedUrl } from '../../domain/calidad/queries'
import { createFuente, updateFuente, setFuenteActiva, createRegistroCalidad, uploadReporteCalidad } from '../../domain/calidad/mutations'
import { sanitizeInput, sanitizeHTML } from '../../lib/validation'
import { TIPOLOGIAS_CALIDAD, calcularCumplimiento } from './constants'
import { validarValorParametro, severidadParametro, SEVERIDAD_META } from '../../lib/calidadSeveridad'
import { CalidadTendencia } from './CalidadTendencia'
import { registrosCalidadToCSV } from '../../lib/calidadCSV'
import { ultimaMuestraPorFuente, estadoMuestreo, MUESTREO_META } from './muestreo'
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


export function CalidadSection({
  fuentesAgua, registrosCalidad, empresa, userId,
  onFuentesUpdated, onRegistrosCalidadUpdated,
  canCreate: _canCreate = true, canEdit: _canEdit = true,
}: Props) {
  const [subTab, setSubTab] = useState<SubTab>('fuentes')

  // Fuentes form state
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [fuenteForm, setFuenteForm] = useState({ identificador: '', nombre: '', tipo_agua: '' as TipoAgua | '', descripcion: '', frecuencia_muestreo_dias: '' })
  const [savingFuente, setSavingFuente] = useState(false)
  // serv:S26 — última muestra por fuente (deriva el estado de muestreo en la lista).
  const ultimaMuestra = useMemo(() => ultimaMuestraPorFuente(registrosCalidad), [registrosCalidad])
  const hoyISO = new Date().toISOString().slice(0, 10)

  // Análisis form state
  const [analisisFuenteId, setAnalisisFuenteId] = useState('')
  const [analisisFecha, setAnalisisFecha] = useState(new Date().toISOString().slice(0, 16))
  const [analisisObs, setAnalisisObs] = useState('')
  const [parametroValues, setParametroValues] = useState<Record<string, string>>({})
  // serv:S24 — archivo del reporte (se sube a Storage, no a base64).
  const [reporteFile, setReporteFile] = useState<File | null>(null)
  const [reporteNombre, setReporteNombre] = useState<string | null>(null)
  const [savingAnalisis, setSavingAnalisis] = useState(false)

  // Historial filters
  const [filtroFuente, setFiltroFuente] = useState('')
  const [detalleViewer, setDetalleViewer] = useState<RegistroCalidad | null>(null)
  const [filtroTipo, setFiltroTipo] = useState('')
  const [filtroDesde, setFiltroDesde] = useState('')
  const [filtroHasta, setFiltroHasta] = useState('')
  const [filtroCumple, setFiltroCumple] = useState('')

  // Fuentes CRUD
  async function guardarFuente() {
    if (!fuenteForm.identificador.trim()) return notify({ variant: 'warning', title: 'Atención', text: 'El identificador es obligatorio.' })
    if (!fuenteForm.nombre.trim() || fuenteForm.nombre.length < 2) return notify({ variant: 'warning', title: 'Atención', text: 'El nombre es obligatorio (mín. 2 caracteres).' })
    if (!fuenteForm.tipo_agua) return notify({ variant: 'warning', title: 'Atención', text: 'Seleccione la tipología de agua.' })
    // serv:S26 — frecuencia de muestreo opcional: si se indica, entero de días positivo.
    const freqRaw = fuenteForm.frecuencia_muestreo_dias.trim()
    if (freqRaw !== '' && (!/^\d+$/.test(freqRaw) || Number(freqRaw) < 1 || Number(freqRaw) > 3650)) {
      return notify({ variant: 'warning', title: 'Atención', text: 'La frecuencia de muestreo debe ser un número de días entre 1 y 3650.' })
    }

    setSavingFuente(true)
    try {
      const payload = {
        identificador: sanitizeInput(fuenteForm.identificador),
        nombre: sanitizeInput(fuenteForm.nombre),
        tipo_agua: fuenteForm.tipo_agua,
        descripcion: sanitizeInput(fuenteForm.descripcion),
        frecuencia_muestreo_dias: freqRaw === '' ? null : Number(freqRaw),
      }
      if (editandoId) {
        const { error } = await updateFuente(editandoId, payload)
        if (error) throw new Error(error)
      } else {
        const { error } = await createFuente(payload)
        if (error) throw new Error(error)
      }
      onFuentesUpdated(await fetchFuentes())
      setFuenteForm({ identificador: '', nombre: '', tipo_agua: '', descripcion: '', frecuencia_muestreo_dias: '' })
      setEditandoId(null)
      notify({ variant: 'success', title: editandoId ? 'Fuente actualizada' : 'Fuente registrada', duration: 1500 })
    } catch (e) {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo guardar la fuente: ' + (e instanceof Error ? e.message : '') })
    } finally {
      setSavingFuente(false)
    }
  }

  function editarFuente(f: FuenteAgua) {
    setEditandoId(f.id)
    setFuenteForm({ identificador: f.identificador, nombre: f.nombre, tipo_agua: f.tipo_agua, descripcion: f.descripcion ?? '', frecuencia_muestreo_dias: f.frecuencia_muestreo_dias != null ? String(f.frecuencia_muestreo_dias) : '' })
    setSubTab('fuentes')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function toggleFuente(id: string, activo: boolean) {
    const { error } = await setFuenteActiva(id, !activo)
    if (error) return notify({ variant: 'error', title: 'Error', text: error })
    onFuentesUpdated(await fetchFuentes())
  }

  // Análisis
  const fuenteSeleccionada = fuentesAgua.find(f => f.id === analisisFuenteId)
  const tipologiaActual = fuenteSeleccionada ? TIPOLOGIAS_CALIDAD[fuenteSeleccionada.tipo_agua] : null

  // serv:S20 — resumen en vivo por severidad (no solo binario ok/no-ok).
  function cumplimientoEnVivo(): { cumple: number; noCumple: number; pendiente: number; total: number; leve: number; moderado: number; critico: number; invalido: number } {
    const vacio = { cumple: 0, noCumple: 0, pendiente: 0, total: 0, leve: 0, moderado: 0, critico: 0, invalido: 0 }
    if (!tipologiaActual) return vacio
    let cumple = 0, pendiente = 0, leve = 0, moderado = 0, critico = 0, invalido = 0
    tipologiaActual.parametros.forEach(p => {
      const val = parametroValues[p.key]
      if (!val || val.trim() === '') { pendiente++; return }
      if (!validarValorParametro(val).valido) { invalido++; return }
      const sev = severidadParametro(p, val)
      if (sev === 'ok') cumple++
      else if (sev === 'leve') leve++
      else if (sev === 'moderado') moderado++
      else if (sev === 'critico') critico++
    })
    const noCumple = leve + moderado + critico
    return { cumple, noCumple, pendiente, total: cumple + noCumple, leve, moderado, critico, invalido }
  }

  async function guardarAnalisis() {
    if (!analisisFuenteId) return notify({ variant: 'warning', title: 'Atención', text: 'Seleccione una fuente de agua.' })
    if (!analisisFecha) return notify({ variant: 'warning', title: 'Atención', text: 'Indique la fecha del análisis.' })
    if (!fuenteSeleccionada || !tipologiaActual) return

    const parametros: Record<string, number> = {}
    let algunoIngresado = false
    // serv:S20 — valida cada muestra antes de guardar (numérica, no negativa).
    for (const p of tipologiaActual.parametros) {
      const v = parametroValues[p.key]
      if (!v || v.trim() === '') continue
      const val = validarValorParametro(v)
      if (!val.valido) {
        return notify({ variant: 'warning', title: 'Valor inválido', text: `${p.label}: ${val.motivo}` })
      }
      parametros[p.key] = parseFloat(v)
      algunoIngresado = true
    }
    if (!algunoIngresado) return notify({ variant: 'warning', title: 'Atención', text: 'Ingrese al menos un valor de parámetro.' })

    const { cumplimiento, cumple_total } = calcularCumplimiento(fuenteSeleccionada.tipo_agua, parametros)

    setSavingAnalisis(true)
    // serv:S24 — subir reporte a Storage antes del INSERT si hay archivo.
    let reporte_path: string | null = null
    if (reporteFile && empresa.id) {
      const ts = Date.now()
      const safeName = reporteFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${empresa.id}/${analisisFuenteId}/${ts}-${safeName}`
      const { error: uploadErr } = await uploadReporteCalidad(path, reporteFile)
      if (uploadErr) {
        setSavingAnalisis(false)
        return notify({ variant: 'error', title: 'Error al subir reporte', text: uploadErr })
      }
      reporte_path = path
    }

    const registro = {
      fuente_id: analisisFuenteId,
      fecha: new Date(analisisFecha).toISOString(),
      parametros,
      cumplimiento,
      cumple_total,
      observaciones: sanitizeInput(analisisObs) || null,
      reporte_path,
      reporte_nombre: reporteNombre ?? null,
      created_by: userId ?? null,
    }

    try {
      const { error } = await createRegistroCalidad(registro)
      if (error) throw new Error(error)
      onRegistrosCalidadUpdated(await fetchRegistrosCalidad())
      // Reset form
      setAnalisisFuenteId('')
      setAnalisisFecha(new Date().toISOString().slice(0, 16))
      setAnalisisObs('')
      setParametroValues({})
      setReporteFile(null); setReporteNombre(null)
      notify({ variant: 'success', title: cumple_total ? '✅ Análisis guardado — CUMPLE' : '⚠️ Análisis guardado — NO CUMPLE', duration: 2000 })
      setSubTab('historial')
    } catch (e) {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo guardar: ' + (e instanceof Error ? e.message : '') })
    } finally {
      setSavingAnalisis(false)
    }
  }

  function handleReporteFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { notify({ variant: 'error', title: 'Archivo muy grande', text: 'El archivo no debe superar 10 MB.' }); e.target.value = ''; return }
    // serv:S24 — guardamos el File para subir a Storage (no base64).
    setReporteFile(file)
    setReporteNombre(file.name)
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
    setDetalleViewer(r)
  }

  async function verReporte(r: RegistroCalidad) {
    if (r.reporte_path) {
      // serv:S24 — ruta en Storage: crear URL firmada y descargar.
      const { url, error } = await getReporteCalidadSignedUrl(r.reporte_path)
      if (error || !url) return notify({ variant: 'error', title: 'Error', text: 'No se pudo acceder al reporte.' })
      const link = document.createElement('a')
      link.href = url
      link.download = r.reporte_nombre ?? 'reporte'
      link.click()
    } else if (r.reporte_base64) {
      // Registros previos a S24: base64 legacy.
      const mime = r.reporte_tipo === 'pdf' ? 'application/pdf' : 'image/jpeg'
      const dataUrl = `data:${mime};base64,${r.reporte_base64}`
      const link = document.createElement('a')
      link.href = dataUrl
      link.download = r.reporte_nombre ?? ('reporte.' + (r.reporte_tipo === 'pdf' ? 'pdf' : 'jpg'))
      link.click()
    } else {
      notify({ variant: 'info', title: 'Sin reporte', text: 'Este análisis no tiene reporte adjunto.' })
    }
  }

  const inputStyle: CSSProperties = { padding: '12px 16px', border: '2px solid var(--at-line)', borderRadius: '10px', fontSize: '15px', width: '100%', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '14px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '6px', display: 'block' }

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
            background: subTab === t ? 'linear-gradient(135deg, var(--at-primary) 0%, var(--at-accent-2) 100%)' : 'var(--at-chip)',
            color: subTab === t ? 'white' : 'var(--at-ink-2)',
          }}>
            {t === 'fuentes' ? '🗂️ Fuentes de Agua' : t === 'analisis' ? '🧪 Nuevo Análisis' : '📋 Historial Calidad'}
          </button>
        ))}
      </div>

      {/* FUENTES */}
      {subTab === 'fuentes' && (
        <div>
          <div style={{ background: 'var(--at-surface)', borderRadius: '24px', padding: '32px', marginBottom: '20px', boxShadow: '0 10px 40px rgba(0,0,0,0.08)' }}>
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
              {/* serv:S26 — frecuencia de muestreo (opcional): base del estado de muestreo. */}
              <div>
                <label style={labelStyle}>Frecuencia de muestreo (días)</label>
                <input type="number" min={1} max={3650} value={fuenteForm.frecuencia_muestreo_dias} onChange={e => setFuenteForm(p => ({ ...p, frecuencia_muestreo_dias: e.target.value }))} placeholder="Ej: 30 — opcional" style={inputStyle} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={guardarFuente} disabled={savingFuente} style={{ padding: '12px 24px', background: 'linear-gradient(135deg, var(--at-primary) 0%, var(--at-accent-2) 100%)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
                {savingFuente ? 'Guardando...' : `💾 ${editandoId ? 'Actualizar Fuente' : 'Guardar Fuente'}`}
              </button>
              <button onClick={() => { setFuenteForm({ identificador: '', nombre: '', tipo_agua: '', descripcion: '', frecuencia_muestreo_dias: '' }); setEditandoId(null) }} style={{ padding: '12px 24px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
                ✕ Cancelar
              </button>
            </div>
          </div>

          <div style={{ background: 'var(--at-surface)', borderRadius: '24px', padding: '32px', boxShadow: '0 10px 40px rgba(0,0,0,0.08)' }}>
            <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '16px' }}>Fuentes Registradas</div>
            <div className="table-scroll-wrapper">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead><tr style={{ background: 'var(--at-chip)' }}>
                  {['ID', 'Identificador', 'Nombre', 'Tipología', 'Muestreo', 'Estado', 'Acciones'].map(h => <th scope="col" key={h} style={{ padding: '10px', textAlign: 'left', borderBottom: '2px solid var(--at-line)' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {fuentesAgua.map(f => {
                    const tipologia = TIPOLOGIAS_CALIDAD[f.tipo_agua]
                    return (
                      <tr key={f.id} style={{ borderBottom: '1px solid var(--at-chip)' }}>
                        <td style={{ padding: '10px', fontSize: '12px', color: 'var(--at-ink-3)' }}>{f.id.substring(0, 8)}…</td>
                        <td style={{ padding: '10px', fontWeight: 600, color: 'var(--at-primary-hover)' }}>{sanitizeHTML(f.identificador)}</td>
                        <td style={{ padding: '10px' }}>{sanitizeHTML(f.nombre)}</td>
                        <td style={{ padding: '10px', fontSize: '13px' }}>{tipologia?.label ?? f.tipo_agua}</td>
                        {/* serv:S26 — estado de muestreo: frecuencia vs. última muestra registrada. */}
                        <td style={{ padding: '10px' }}>
                          {(() => {
                            const m = estadoMuestreo(ultimaMuestra.get(f.id) ?? null, f.frecuencia_muestreo_dias, hoyISO)
                            const meta = MUESTREO_META[m.estado]
                            const title = m.estado === 'sin_programa' ? 'Defina una frecuencia de muestreo para esta fuente'
                              : m.estado === 'sin_muestras' ? 'Con programa, pero aún sin análisis registrados'
                              : m.proximaFecha ? `Próximo muestreo: ${m.proximaFecha}${m.dias != null ? (m.dias < 0 ? ` (vencido hace ${-m.dias} d)` : ` (en ${m.dias} d)`) : ''}` : ''
                            return (
                              <span title={title} style={{ padding: '3px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 500, background: meta.tint, color: meta.color }}>
                                {meta.label}
                              </span>
                            )
                          })()}
                        </td>
                        <td style={{ padding: '10px' }}>
                          <span style={{ padding: '3px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 500, background: f.activo ? 'var(--at-success-tint)' : 'var(--at-danger-tint)', color: f.activo ? 'var(--at-success-strong)' : 'var(--at-danger-strong)' }}>
                            {f.activo ? 'Activa' : 'Inactiva'}
                          </span>
                        </td>
                        <td style={{ padding: '10px' }}>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button onClick={() => editarFuente(f)} style={{ background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer', fontSize: '12px' }}>✏️ Editar</button>
                            <button onClick={() => toggleFuente(f.id, f.activo)} style={{ background: f.activo ? 'var(--at-warning)' : 'var(--at-success)', color: 'var(--at-on-status)', border: 'none', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer', fontSize: '12px' }}>
                              {f.activo ? '⏸ Desactivar' : '▶ Activar'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {fuentesAgua.length === 0 && <tr><td colSpan={7} style={{ padding: '20px', textAlign: 'center', color: 'var(--at-ink-3)' }}>Sin fuentes registradas</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ANÁLISIS */}
      {subTab === 'analisis' && (
        <div style={{ background: 'var(--at-surface)', borderRadius: '24px', padding: '32px', boxShadow: '0 10px 40px rgba(0,0,0,0.08)' }}>
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
              <div style={{ background: 'var(--at-primary-tint)', border: '1px solid var(--at-primary-soft-2)', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px' }}>
                <strong style={{ color: 'var(--at-primary-hover)', fontSize: '14px' }}>Parámetros para: {tipologiaActual.label}</strong>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '16px', marginBottom: '16px' }}>
                {tipologiaActual.parametros.map(p => {
                  const val = parametroValues[p.key] ?? ''
                  // serv:S20 — validación de muestra + severidad graduada.
                  const validacion = validarValorParametro(val)
                  const sev = severidadParametro(p, val)
                  const rango = p.min === p.max && p.min === 0 ? 'Ausencia (= 0)' : p.min > 0 ? `${p.min} – ${p.max}` : `≤ ${p.max}`
                  const borderColor = !validacion.valido ? 'var(--at-danger)' : sev ? SEVERIDAD_META[sev].border : 'var(--at-line)'
                  return (
                    <div key={p.key}>
                      <label style={{ ...labelStyle, fontSize: '13px' }}>
                        {p.label}{p.unidad ? ` (${p.unidad})` : ''}
                        <span style={{ fontWeight: 400, color: 'var(--at-ink-3)', fontSize: '11px' }}> [{rango}]</span>
                      </label>
                      <input
                        type="number" step="any" value={val}
                        onChange={e => setParametroValues(prev => ({ ...prev, [p.key]: e.target.value }))}
                        placeholder="Ingrese valor"
                        style={{ ...inputStyle, borderColor }}
                      />
                      {!validacion.valido ? (
                        <span style={{ display: 'inline-block', marginTop: 4, fontSize: 11, fontWeight: 600, color: 'var(--at-danger-strong)' }}>⚠ {validacion.motivo}</span>
                      ) : sev && sev !== 'ok' ? (
                        <span style={{ display: 'inline-block', marginTop: 4, fontSize: 11, fontWeight: 700, color: SEVERIDAD_META[sev].color, background: SEVERIDAD_META[sev].tint, padding: '1px 8px', borderRadius: 999 }}>{SEVERIDAD_META[sev].label}</span>
                      ) : null}
                    </div>
                  )
                })}
              </div>

              <div style={{ marginBottom: '16px', padding: '14px', borderRadius: '10px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)' }}>
                <div style={{ fontWeight: 600, marginBottom: '8px', fontSize: '14px' }}>Resumen de Cumplimiento</div>
                {(cvl.total === 0 && cvl.invalido === 0)
                  ? <span style={{ color: 'var(--at-ink-3)', fontSize: '13px' }}>Ingrese los valores para ver el cumplimiento.</span>
                  : <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                      <span style={{ background: (cvl.noCumple === 0 && cvl.invalido === 0) ? 'var(--at-success-tint)' : 'var(--at-danger-tint)', color: (cvl.noCumple === 0 && cvl.invalido === 0) ? 'var(--at-success-strong)' : 'var(--at-danger-strong)', padding: '4px 12px', borderRadius: '8px', fontWeight: 600 }}>
                        {(cvl.noCumple === 0 && cvl.invalido === 0) ? '✅ CUMPLE' : '❌ NO CUMPLE'} — {cvl.cumple}/{cvl.total + cvl.pendiente + cvl.invalido} OK{cvl.pendiente > 0 ? `, ${cvl.pendiente} pend.` : ''}
                      </span>
                      {cvl.critico > 0 && <span style={{ background: SEVERIDAD_META.critico.tint, color: SEVERIDAD_META.critico.color, padding: '4px 10px', borderRadius: 999, fontWeight: 700, fontSize: '12px' }}>{cvl.critico} crítico{cvl.critico > 1 ? 's' : ''}</span>}
                      {cvl.moderado > 0 && <span style={{ background: SEVERIDAD_META.moderado.tint, color: SEVERIDAD_META.moderado.color, padding: '4px 10px', borderRadius: 999, fontWeight: 700, fontSize: '12px' }}>{cvl.moderado} moderado{cvl.moderado > 1 ? 's' : ''}</span>}
                      {cvl.leve > 0 && <span style={{ background: SEVERIDAD_META.leve.tint, color: SEVERIDAD_META.leve.color, padding: '4px 10px', borderRadius: 999, fontWeight: 700, fontSize: '12px' }}>{cvl.leve} leve{cvl.leve > 1 ? 's' : ''}</span>}
                      {cvl.invalido > 0 && <span style={{ background: 'var(--at-danger-tint)', color: 'var(--at-danger-strong)', padding: '4px 10px', borderRadius: 999, fontWeight: 700, fontSize: '12px' }}>{cvl.invalido} inválido{cvl.invalido > 1 ? 's' : ''}</span>}
                    </div>
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
              <label style={{ cursor: 'pointer', background: 'var(--at-primary)', color: 'white', padding: '8px 16px', borderRadius: '8px', fontSize: '14px' }}>
                📎 Seleccionar archivo
                <input type="file" accept=".pdf,image/*" hidden onChange={handleReporteFile} />
              </label>
              <span style={{ fontSize: '13px', color: 'var(--at-ink-3)' }}>{reporteNombre ?? 'Ningún archivo seleccionado'}</span>
              {reporteNombre && <button onClick={() => { setReporteFile(null); setReporteNombre(null) }} style={{ background: 'var(--at-danger)', color: 'var(--at-on-status)', border: 'none', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', fontSize: '13px' }}>✕ Quitar</button>}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button onClick={guardarAnalisis} disabled={savingAnalisis} style={{ padding: '12px 24px', background: 'linear-gradient(135deg, var(--at-primary) 0%, var(--at-accent-2) 100%)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
              {savingAnalisis ? 'Guardando...' : '💾 Guardar Análisis'}
            </button>
            <button onClick={() => { setAnalisisFuenteId(''); setParametroValues({}); setAnalisisObs('') }} style={{ padding: '12px 24px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
              ✕ Limpiar
            </button>
          </div>
        </div>
      )}

      {/* HISTORIAL */}
      {subTab === 'historial' && (
        <div style={{ background: 'var(--at-surface)', borderRadius: '24px', padding: '32px', boxShadow: '0 10px 40px rgba(0,0,0,0.08)' }}>
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
          <div style={{ marginBottom: '16px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button onClick={async () => {
              const { exportarPDFCalidad } = await import('../../lib/pdf')
              exportarPDFCalidad(historialFiltrado, empresa)
            }} style={{ padding: '10px 20px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
              📄 Exportar PDF
            </button>
            {/* serv:S27 — export CSV del historial filtrado (reportes regulatorios). */}
            <button onClick={() => {
              const csv = registrosCalidadToCSV(historialFiltrado)
              const a = document.createElement('a')
              a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv)
              a.download = `historial_calidad_${new Date().toISOString().slice(0, 10)}.csv`
              a.click()
            }} disabled={historialFiltrado.length === 0} style={{ padding: '10px 20px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: historialFiltrado.length === 0 ? 'not-allowed' : 'pointer', opacity: historialFiltrado.length === 0 ? 0.5 : 1 }}>
              📊 Exportar CSV
            </button>
          </div>
          {/* serv:S25 — tendencia de cumplimiento de los análisis filtrados. */}
          <CalidadTendencia registros={historialFiltrado} />
          <div className="table-scroll-wrapper">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead><tr style={{ background: 'var(--at-chip)' }}>
                {['Fecha', 'Fuente', 'Tipología', 'Resultado', 'Observaciones', 'Acciones'].map(h => <th scope="col" key={h} style={{ padding: '10px', textAlign: h === 'Resultado' || h === 'Acciones' ? 'center' : 'left', borderBottom: '2px solid var(--at-line)' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {historialFiltrado.map(r => {
                  const fuente = r.fuentes_agua
                  const tipologia = fuente ? TIPOLOGIAS_CALIDAD[fuente.tipo_agua] : null
                  return (
                    <tr key={r.id} style={{ borderBottom: '1px solid var(--at-chip)' }}>
                      <td style={{ padding: '10px', fontSize: '13px' }}>{new Date(r.fecha).toLocaleString('es-GT')}</td>
                      <td style={{ padding: '10px', fontWeight: 600, color: 'var(--at-primary-hover)' }}>{fuente ? sanitizeHTML(fuente.identificador) : '—'}</td>
                      <td style={{ padding: '10px', fontSize: '13px' }}>{tipologia?.label ?? fuente?.tipo_agua ?? '—'}</td>
                      <td style={{ padding: '10px', textAlign: 'center' }}>
                        <span style={{ background: r.cumple_total ? 'var(--at-success-tint)' : 'var(--at-danger-tint)', color: r.cumple_total ? 'var(--at-success-strong)' : 'var(--at-danger-strong)', padding: '4px 12px', borderRadius: '12px', fontSize: '12px', fontWeight: 600 }}>
                          {r.cumple_total ? '✅ CUMPLE' : '❌ NO CUMPLE'}
                        </span>
                      </td>
                      <td style={{ padding: '10px', fontSize: '13px', color: 'var(--at-ink-3)' }}>{sanitizeHTML(r.observaciones ?? '—')}</td>
                      <td style={{ padding: '10px' }}>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center' }}>
                          <button onClick={() => verDetalle(r)} style={{ background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer', fontSize: '12px' }}>🔍 Detalle</button>
                          <button onClick={async () => {
                            const { generarPDFAnalisis } = await import('../../lib/pdf')
                            generarPDFAnalisis(r, empresa)
                          }} style={{ background: 'var(--at-success)', color: 'var(--at-on-status)', border: 'none', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer', fontSize: '12px' }}>📄 PDF</button>
                          {(r.reporte_path || r.reporte_base64) && <button onClick={() => { void verReporte(r) }} style={{ background: 'var(--at-accent)', color: 'white', border: 'none', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer', fontSize: '12px' }}>📎 Reporte</button>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {historialFiltrado.length === 0 && <tr><td colSpan={6} style={{ padding: '20px', textAlign: 'center', color: 'var(--at-ink-3)' }}>Sin registros con esos filtros</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* F3.8: Modal accesible para ver detalle del analisis de calidad. */}
      {/* Reemplaza Swal.fire({html: ...}) con HTML rico. Usa Radix Dialog */}
      {/* para a11y completa (focus trap, ESC, role=dialog, aria-labelledby). */}
      <RDialog.Root open={!!detalleViewer} onOpenChange={(open) => { if (!open) setDetalleViewer(null) }}>
        <RDialog.Portal>
          <RDialog.Overlay style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            zIndex: 9998, animation: 'at-dialog-overlay-in 120ms ease-out',
          }} />
          <RDialog.Content
            style={{
              position: 'fixed', top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              background: 'var(--at-surface)', borderRadius: '16px',
              padding: '24px 28px', maxWidth: '760px', width: 'calc(100vw - 32px)',
              maxHeight: 'calc(100vh - 32px)', overflowY: 'auto',
              boxShadow: '0 20px 60px rgba(0,0,0,0.25)', zIndex: 9999,
              animation: 'at-dialog-content-in 160ms ease-out',
            }}
          >
            {detalleViewer && (() => {
              const r = detalleViewer
              const fuente = r.fuentes_agua
              const tipologia = fuente ? TIPOLOGIAS_CALIDAD[fuente.tipo_agua] : null
              return (
                <>
                  <RDialog.Title style={{ margin: '0 0 6px', fontSize: '18px', fontWeight: 700, color: 'var(--at-ink)' }}>
                    Análisis — {fuente?.identificador ?? ''}
                  </RDialog.Title>
                  <RDialog.Description style={{ margin: 0, fontSize: '13px', color: 'var(--at-ink-2)' }}>
                    {new Date(r.fecha).toLocaleString('es-GT')} · {tipologia?.label ?? fuente?.tipo_agua ?? ''}
                  </RDialog.Description>
                  <div style={{ margin: '12px 0' }}>
                    {r.observaciones && (
                      <p style={{ margin: '0 0 8px', fontSize: '13px', color: 'var(--at-ink-2)' }}>
                        <strong>Observaciones:</strong> {r.observaciones}
                      </p>
                    )}
                    <p style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: r.cumple_total ? 'var(--at-success-strong)' : 'var(--at-danger-strong)' }}>
                      Resultado: {r.cumple_total ? '✅ CUMPLE' : '❌ NO CUMPLE'}
                    </p>
                  </div>
                  {tipologia && (
                    <div className="table-scroll-wrapper">
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                        <thead>
                          <tr style={{ background: 'var(--at-chip)' }}>
                            <th scope="col" style={{ padding: '8px', textAlign: 'left' }}>Parámetro</th>
                            <th scope="col" style={{ padding: '8px', textAlign: 'center' }}>Unidad</th>
                            <th scope="col" style={{ padding: '8px', textAlign: 'center' }}>Valor</th>
                            <th scope="col" style={{ padding: '8px', textAlign: 'center' }}>Rango</th>
                            <th scope="col" style={{ padding: '8px', textAlign: 'center' }}>Estado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tipologia.parametros.map(p => {
                            const val = r.parametros[p.key]
                            const cumple = r.cumplimiento[p.key]
                            const rango = p.min === p.max && p.min === 0 ? '= 0' : p.min > 0 ? `${p.min} – ${p.max}` : `≤ ${p.max}`
                            const bg = cumple === false ? '#fff5f5' : cumple === true ? 'var(--at-success-tint)' : 'transparent'
                            return (
                              <tr key={p.key} style={{ borderBottom: '1px solid var(--at-chip)', background: bg }}>
                                <td style={{ padding: '8px' }}>{p.label}</td>
                                <td style={{ padding: '8px', textAlign: 'center' }}>{p.unidad || '—'}</td>
                                <td style={{ padding: '8px', textAlign: 'center' }}>{val !== undefined ? val : '—'}</td>
                                <td style={{ padding: '8px', textAlign: 'center' }}>{rango}</td>
                                <td style={{ padding: '8px', textAlign: 'center' }}>
                                  {cumple === null || val === undefined ? <span style={{ color: 'var(--at-ink-3)' }}>—</span>
                                    : cumple ? <span style={{ color: 'var(--at-success-strong)', fontWeight: 600 }}>✅ CUMPLE</span>
                                    : <span style={{ color: 'var(--at-danger-strong)', fontWeight: 600 }}>❌ NO CUMPLE</span>}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                    <RDialog.Close asChild>
                      <button
                        type="button"
                        style={{
                          padding: '9px 18px', borderRadius: '10px', border: 'none',
                          background: 'var(--at-primary)', color: 'white',
                          fontSize: '14px', fontWeight: 700, cursor: 'pointer',
                        }}
                      >
                        Cerrar
                      </button>
                    </RDialog.Close>
                  </div>
                </>
              )
            })()}
          </RDialog.Content>
        </RDialog.Portal>
      </RDialog.Root>
    </div>
  )
}
