import { useState } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../../lib/supabase'
import type { Visitante, Unidad } from '../../../types'
import { ImageUploader } from '../ImageUploader'
import { exportarPDFTabla, exportarExcel } from '../exportUtils'

interface Props {
  visitantes: Visitante[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  userId: string
  proyectoNombre?: string
  canCreate: boolean
  onRefresh: () => void
}

type FiltroFecha = 'hoy' | 'semana' | 'mes' | 'todos'

export function VisitantesTab({ visitantes, unidades, proyectoId, companyId, userId, proyectoNombre = 'Condominio', canCreate, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [soloActivos, setSoloActivos] = useState(false)
  const [filtroFecha, setFiltroFecha] = useState<FiltroFecha>('todos')
  const [fotoUrl, setFotoUrl] = useState<string | null>(null)
  const [fotoDocumentoUrl, setFotoDocumentoUrl] = useState<string | null>(null)
  const [fotoVehiculoUrl, setFotoVehiculoUrl] = useState<string | null>(null)
  const [form, setForm] = useState({
    unidad_id: '',
    nombre: '',
    identificacion: '',
    placa_vehiculo: '',
    motivo: '',
    notas: '',
  })

  const hoy = new Date().toISOString().slice(0, 10)

  const inicioSemana = (() => {
    const d = new Date()
    const diff = d.getDay() === 0 ? -6 : 1 - d.getDay()
    d.setDate(d.getDate() + diff)
    return d.toISOString().slice(0, 10)
  })()

  const inicioMes = hoy.slice(0, 7) + '-01'

  // KPIs
  const visitasHoy = visitantes.filter(v => v.hora_entrada.startsWith(hoy)).length
  const enPremisas = visitantes.filter(v => !v.hora_salida).length
  const estaSemana = visitantes.filter(v => v.hora_entrada.slice(0, 10) >= inicioSemana).length
  const totalHistorico = visitantes.length

  // Deduped frequent visitor suggestions when name >= 3 chars
  const sugerencias = form.nombre.length >= 3
    ? visitantes
        .filter(v => v.nombre.toLowerCase().includes(form.nombre.toLowerCase()))
        .reduce<Visitante[]>((acc, v) => {
          if (!acc.some(a => a.nombre === v.nombre && a.identificacion === v.identificacion)) acc.push(v)
          return acc
        }, [])
        .slice(0, 5)
    : []

  const filtrados = visitantes.filter(v => {
    const matchBusqueda = !busqueda
      || v.nombre.toLowerCase().includes(busqueda.toLowerCase())
      || (v.identificacion ?? '').includes(busqueda)
    const matchActivo = !soloActivos || !v.hora_salida
    const fecha = v.hora_entrada.slice(0, 10)
    const matchFecha = filtroFecha === 'todos' ? true
      : filtroFecha === 'hoy' ? fecha === hoy
      : filtroFecha === 'semana' ? fecha >= inicioSemana
      : fecha >= inicioMes
    return matchBusqueda && matchActivo && matchFecha
  })

  function resetForm() {
    setForm({ unidad_id: '', nombre: '', identificacion: '', placa_vehiculo: '', motivo: '', notas: '' })
    setFotoUrl(null)
    setFotoDocumentoUrl(null)
    setFotoVehiculoUrl(null)
    setShowForm(false)
  }

  function autocompletar(v: Visitante) {
    setForm(f => ({
      ...f,
      nombre: v.nombre,
      identificacion: v.identificacion ?? '',
      placa_vehiculo: v.placa_vehiculo ?? '',
      unidad_id: v.unidad_id,
      motivo: v.motivo ?? '',
    }))
  }

  async function handleRegistrar() {
    if (!form.nombre.trim()) { Swal.fire('Error', 'Ingrese el nombre del visitante.', 'error'); return }
    if (!form.unidad_id) { Swal.fire('Error', 'Seleccione la unidad a visitar.', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('visitantes').insert({
      company_id: companyId,
      project_id: proyectoId,
      unidad_id: form.unidad_id,
      nombre: form.nombre.trim(),
      identificacion: form.identificacion.trim() || null,
      placa_vehiculo: form.placa_vehiculo.trim() || null,
      motivo: form.motivo.trim() || null,
      notas: form.notas.trim() || null,
      foto_url: fotoUrl,
      foto_documento_url: fotoDocumentoUrl,
      foto_vehiculo_url: fotoVehiculoUrl,
      registrado_por: userId,
      hora_entrada: new Date().toISOString(),
    })
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    Swal.fire({ icon: 'success', title: 'Visita registrada', timer: 1500, showConfirmButton: false })
    resetForm()
    onRefresh()
  }

  async function registrarSalida(id: string) {
    const { error } = await supabase.from('visitantes').update({ hora_salida: new Date().toISOString() }).eq('id', id)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    onRefresh()
  }

  function exportarPDF() {
    const subtitulo = filtroFecha === 'hoy' ? `Hoy: ${hoy}`
      : filtroFecha === 'semana' ? `Semana desde ${inicioSemana}`
      : filtroFecha === 'mes' ? `Mes: ${hoy.slice(0, 7)}`
      : 'Todos los registros'
    exportarPDFTabla({
      titulo: 'Registro de Visitantes',
      subtitulo,
      proyectoNombre,
      headers: ['Nombre', 'Unidad', 'Entrada', 'Salida', 'Motivo', 'ID/DPI', 'Placa'],
      rows: filtrados.map(v => [
        v.nombre,
        v.unidad_nombre ?? '—',
        new Date(v.hora_entrada).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
        v.hora_salida ? new Date(v.hora_salida).toLocaleString('es', { hour: '2-digit', minute: '2-digit' }) : 'En premisas',
        v.motivo ?? '—',
        v.identificacion ?? '—',
        v.placa_vehiculo ?? '—',
      ]),
      filename: `visitantes-${hoy}`,
      landscape: true,
    })
  }

  function exportarXlsx() {
    exportarExcel(`visitantes-${hoy}`, [{
      name: 'Visitantes',
      headers: ['Nombre', 'Unidad', 'Hora entrada', 'Hora salida', 'Motivo', 'Identificación', 'Placa'],
      rows: filtrados.map(v => [
        v.nombre,
        v.unidad_nombre ?? '',
        v.hora_entrada,
        v.hora_salida ?? '',
        v.motivo ?? '',
        v.identificacion ?? '',
        v.placa_vehiculo ?? '',
      ]),
    }])
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>Control de Visitantes</h2>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '13.5px' }}>
            {visitasHoy} visitas hoy · <span style={{ color: '#16a34a', fontWeight: 600 }}>{enPremisas} en premisas</span>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={exportarPDF} disabled={filtrados.length === 0}
            style={{ padding: '9px 14px', background: '#eff6ff', color: '#2563eb', border: '1.5px solid #bfdbfe', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
            📄 PDF
          </button>
          <button onClick={exportarXlsx} disabled={filtrados.length === 0}
            style={{ padding: '9px 14px', background: '#f0fdf4', color: '#16a34a', border: '1.5px solid #86efac', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
            📊 Excel
          </button>
          {canCreate && (
            <button onClick={() => setShowForm(true)}
              style={{ padding: '10px 20px', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
              + Registrar visita
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
        {([
          { label: 'Hoy', value: visitasHoy, icon: '📅', color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
          { label: 'En premisas', value: enPremisas, icon: '🟢', color: '#16a34a', bg: '#f0fdf4', border: '#86efac' },
          { label: 'Esta semana', value: estaSemana, icon: '📆', color: '#7c3aed', bg: '#f5f3ff', border: '#c4b5fd' },
          { label: 'Total histórico', value: totalHistorico, icon: '📊', color: '#475569', bg: '#f8fafc', border: '#e2e8f0' },
        ] as const).map(kpi => (
          <div key={kpi.label} style={{ background: kpi.bg, border: `1.5px solid ${kpi.border}`, borderRadius: '12px', padding: '14px 16px' }}>
            <div style={{ fontSize: '20px', marginBottom: '4px' }}>{kpi.icon}</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: kpi.color }}>{kpi.value}</div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>{kpi.label}</div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar visitante o DPI..."
          style={{ flex: 1, minWidth: '180px', padding: '9px 14px', border: '1.5px solid #e2e8f0', borderRadius: '10px', fontSize: '14px', background: '#f8fafc' }} />
        {(['hoy', 'semana', 'mes', 'todos'] as FiltroFecha[]).map(f => (
          <button key={f} onClick={() => setFiltroFecha(f)}
            style={{
              padding: '8px 14px', borderRadius: '10px', border: '1.5px solid', cursor: 'pointer', fontSize: '12.5px', fontWeight: 600,
              background: filtroFecha === f ? '#0f172a' : '#f8fafc',
              color: filtroFecha === f ? 'white' : '#374151',
              borderColor: filtroFecha === f ? '#0f172a' : '#e2e8f0',
            }}>
            {f === 'hoy' ? 'Hoy' : f === 'semana' ? 'Semana' : f === 'mes' ? 'Mes' : 'Todos'}
          </button>
        ))}
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13.5px', color: '#374151', cursor: 'pointer', padding: '9px 14px', border: '1.5px solid #e2e8f0', borderRadius: '10px', background: soloActivos ? '#f0fdf4' : '#f8fafc', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={soloActivos} onChange={e => setSoloActivos(e.target.checked)} />
          Solo en premisas
        </label>
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>Registrar visitante</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Nombre completo *</label>
              <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                placeholder="Nombre del visitante"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
              {sugerencias.length > 0 && (
                <div style={{ marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>Frecuente:</span>
                  {sugerencias.map((v, i) => (
                    <button key={i} type="button" onClick={() => autocompletar(v)}
                      style={{ padding: '3px 10px', background: '#f0f9ff', color: '#0369a1', border: '1px solid #bae6fd', borderRadius: '20px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                      {v.nombre}{v.identificacion ? ` · ${v.identificacion}` : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Unidad a visitar *</label>
              <select value={form.unidad_id} onChange={e => setForm(f => ({ ...f, unidad_id: e.target.value }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }}>
                <option value="">Seleccionar...</option>
                {unidades.filter(u => u.activo).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>DPI / Identificación</label>
              <input value={form.identificacion} onChange={e => setForm(f => ({ ...f, identificacion: e.target.value }))}
                placeholder="Número de documento"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Placa de vehículo</label>
              <input value={form.placa_vehiculo} onChange={e => setForm(f => ({ ...f, placa_vehiculo: e.target.value }))}
                placeholder="Ej. ABC-123"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Motivo de visita</label>
              <input value={form.motivo} onChange={e => setForm(f => ({ ...f, motivo: e.target.value }))}
                placeholder="Ej. Entrega, Social, Mantenimiento..."
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Notas</label>
              <input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                placeholder="Opcional"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
              <ImageUploader value={fotoUrl} onChange={setFotoUrl} folder="visitantes" label="Foto del visitante" />
              <ImageUploader value={fotoDocumentoUrl} onChange={setFotoDocumentoUrl} folder="visitantes" label="Foto del DPI / Documento" />
              <ImageUploader value={fotoVehiculoUrl} onChange={setFotoVehiculoUrl} folder="visitantes" label="Foto del vehículo" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button onClick={handleRegistrar} disabled={saving}
              style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Registrando...' : '✓ Registrar entrada'}
            </button>
            <button onClick={resetForm} style={{ padding: '10px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Lista */}
      {filtrados.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>🚪</div>
          <p style={{ fontWeight: 600, color: '#64748b' }}>No hay visitantes registrados{filtroFecha !== 'todos' ? ' para este período' : ''}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtrados.map(v => {
            const enPremisa = !v.hora_salida
            return (
              <div key={v.id} style={{ background: 'white', border: `1.5px solid ${enPremisa ? '#bbf7d0' : '#e2e8f0'}`, borderRadius: '12px', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '14px' }}>
                {v.foto_url
                  ? <img src={v.foto_url} alt={v.nombre} style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: `2px solid ${enPremisa ? '#10b981' : '#e2e8f0'}` }} />
                  : <div style={{ width: 40, height: 40, borderRadius: '50%', background: enPremisa ? 'linear-gradient(135deg,#10b981,#059669)' : '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: enPremisa ? 'white' : '#94a3b8', fontWeight: 700, fontSize: '15px', flexShrink: 0 }}>
                      {v.nombre.charAt(0).toUpperCase()}
                    </div>
                }
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>{v.nombre}</div>
                  <div style={{ fontSize: '12px', color: '#64748b', display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '2px' }}>
                    {v.unidad_nombre && <span>📍 {v.unidad_nombre}</span>}
                    {v.motivo && <span>· {v.motivo}</span>}
                    {v.identificacion && <span>· ID: {v.identificacion}</span>}
                    {v.placa_vehiculo && <span>· 🚗 {v.placa_vehiculo}</span>}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>Entrada: {new Date(v.hora_entrada).toLocaleString('es', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}</div>
                  {v.hora_salida && <div style={{ fontSize: '12px', color: '#94a3b8' }}>Salida: {new Date(v.hora_salida).toLocaleString('es', { hour: '2-digit', minute: '2-digit' })}</div>}
                  {enPremisa && <span style={{ display: 'inline-block', marginTop: '4px', padding: '2px 8px', borderRadius: '20px', fontSize: '11px', background: '#dcfce7', color: '#16a34a', fontWeight: 700 }}>En premisas</span>}
                </div>
                {enPremisa && (() => {
                  const esSTR = v.motivo?.startsWith('Renta corta')
                  const fechaSalidaSTR = esSTR ? (v.notas?.match(/Salida: (\d{4}-\d{2}-\d{2})/)?.[1] ?? null) : null
                  const salidaHabilitada = !fechaSalidaSTR || hoy >= fechaSalidaSTR
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', flexShrink: 0 }}>
                      <button onClick={() => salidaHabilitada && registrarSalida(v.id)}
                        title={!salidaHabilitada ? `Salida programada: ${fechaSalidaSTR}` : undefined}
                        style={{ padding: '7px 14px', background: salidaHabilitada ? '#fef3c7' : '#f1f5f9', color: salidaHabilitada ? '#92400e' : '#94a3b8', border: `1px solid ${salidaHabilitada ? '#fde68a' : '#e2e8f0'}`, borderRadius: '8px', cursor: salidaHabilitada ? 'pointer' : 'not-allowed', fontSize: '12.5px', fontWeight: 600 }}>
                        Registrar salida
                      </button>
                      {!salidaHabilitada && <span style={{ fontSize: '10.5px', color: '#94a3b8' }}>Hasta {fechaSalidaSTR}</span>}
                    </div>
                  )
                })()}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
