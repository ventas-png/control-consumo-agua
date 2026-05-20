import { useState, useMemo } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../../lib/supabase'
import { CuotaCondominio, Unidad, GeneracionCuotasLog } from '../../../types'

interface Props {
  cuotas: CuotaCondominio[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  onRefresh: () => void
}

const CONCEPTOS = ['Mantenimiento', 'Administración', 'Fondo de reserva', 'Áreas comunes', 'Seguridad', 'Extraordinaria', 'CAM', 'Otro']

function mesAnterior(): string {
  const d = new Date()
  d.setMonth(d.getMonth() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function GeneracionCuotasTab({ cuotas, unidades, proyectoId, companyId, moneda, canCreate, onRefresh }: Props) {
  const [periodo, setPeriodo] = useState(mesAnterior())
  const [concepto, setConcepto] = useState('Mantenimiento')
  const [conceptoCustom, setConceptoCustom] = useState('')
  const [monto, setMonto] = useState('')
  const [fechaVenc, setFechaVenc] = useState('')
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set())
  const [generando, setGenerando] = useState(false)
  const [logs, setLogs] = useState<GeneracionCuotasLog[]>([])
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [tab, setTab] = useState<'generar' | 'historial'>('generar')

  const conceptoFinal = concepto === 'Otro' ? conceptoCustom : concepto

  const yaExisten = useMemo(() => {
    const existentes = new Set(
      cuotas
        .filter(c => c.periodo === periodo && c.concepto === conceptoFinal)
        .map(c => c.unidad_id)
    )
    return existentes
  }, [cuotas, periodo, conceptoFinal])

  const unidadesFiltradas = unidades.filter(u => !yaExisten.has(u.id))
  const unidadesYaTienen = unidades.filter(u => yaExisten.has(u.id))

  function toggleAll() {
    if (seleccionadas.size === unidadesFiltradas.length) {
      setSeleccionadas(new Set())
    } else {
      setSeleccionadas(new Set(unidadesFiltradas.map(u => u.id)))
    }
  }

  function toggleUnidad(id: string) {
    setSeleccionadas(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  async function generar() {
    if (!monto || parseFloat(monto) <= 0) { Swal.fire('Campo requerido', 'Ingresa un monto válido.', 'warning'); return }
    if (!fechaVenc) { Swal.fire('Campo requerido', 'Selecciona la fecha de vencimiento.', 'warning'); return }
    if (!conceptoFinal.trim()) { Swal.fire('Campo requerido', 'Ingresa el concepto.', 'warning'); return }
    if (seleccionadas.size === 0) { Swal.fire('Sin unidades', 'Selecciona al menos una unidad.', 'warning'); return }

    const r = await Swal.fire({
      title: `¿Generar ${seleccionadas.size} cuotas?`,
      html: `<b>${conceptoFinal}</b> · ${moneda} ${parseFloat(monto).toFixed(2)}<br>Período: ${periodo} · Vence: ${fechaVenc}`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: 'var(--at-primary)',
      confirmButtonText: 'Generar',
      cancelButtonText: 'Cancelar',
    })
    if (!r.isConfirmed) return

    setGenerando(true)
    const rows = [...seleccionadas].map(uid => {
      const u = unidades.find(x => x.id === uid)
      return {
        company_id: companyId,
        project_id: proyectoId,
        unidad_id: uid,
        unidad_nombre: u?.nombre ?? '',
        concepto: conceptoFinal,
        monto: parseFloat(monto),
        periodo,
        fecha_vencimiento: fechaVenc,
        estado: 'pendiente',
      }
    })

    const { error } = await supabase.from('cuotas_condominio').insert(rows)
    if (error) { Swal.fire('Error', error.message, 'error'); setGenerando(false); return }

    // Log de auditoría
    await supabase.from('generacion_cuotas_log').insert({
      company_id: companyId,
      project_id: proyectoId,
      periodo,
      concepto: conceptoFinal,
      monto_unitario: parseFloat(monto),
      fecha_vencimiento: fechaVenc,
      unidades_generadas: seleccionadas.size,
    })

    setGenerando(false)
    setSeleccionadas(new Set())
    onRefresh()
    Swal.fire('¡Listo!', `Se generaron ${seleccionadas.size} cuotas de ${conceptoFinal} para el período ${periodo}.`, 'success')
  }

  async function cargarLogs() {
    setLoadingLogs(true)
    const { data } = await supabase
      .from('generacion_cuotas_log')
      .select('*')
      .eq('project_id', proyectoId)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(50)
    setLogs((data ?? []) as GeneracionCuotasLog[])
    setLoadingLogs(false)
  }

  function cambiarTab(t: 'generar' | 'historial') {
    setTab(t)
    if (t === 'historial') cargarLogs()
  }

  const montoN = parseFloat(monto) || 0
  const totalGenerar = montoN * seleccionadas.size

  return (
    <div style={{ padding: 16 }}>
      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--at-line)', paddingBottom: 1 }}>
        {(['generar', 'historial'] as const).map(t => (
          <button key={t} onClick={() => cambiarTab(t)}
            style={{ padding: '7px 16px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: tab === t ? 700 : 500,
              background: tab === t ? 'var(--at-surface-2)' : 'transparent', color: tab === t ? 'var(--at-primary)' : 'var(--at-ink-3)',
              borderBottom: tab === t ? '2px solid var(--at-primary)' : '2px solid transparent', borderRadius: '6px 6px 0 0' }}>
            {t === 'generar' ? '🏭 Generar cuotas' : '📋 Historial de generaciones'}
          </button>
        ))}
      </div>

      {tab === 'generar' && (
        <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 16, alignItems: 'start' }}>
          {/* Configuración */}
          <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 14, color: 'var(--at-ink)' }}>⚙️ Parámetros de generación</div>

            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Período *</label>
              <input type="month" value={periodo} onChange={e => setPeriodo(e.target.value)}
                style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' }} />
            </div>

            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Concepto *</label>
              <select value={concepto} onChange={e => setConcepto(e.target.value)}
                style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 7, fontSize: 13 }}>
                {CONCEPTOS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              {concepto === 'Otro' && (
                <input value={conceptoCustom} onChange={e => setConceptoCustom(e.target.value)}
                  placeholder="Escribe el concepto…"
                  style={{ marginTop: 6, width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' }} />
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Monto ({moneda}) *</label>
                <input type="number" min="0" step="0.01" value={monto} onChange={e => setMonto(e.target.value)}
                  placeholder="0.00"
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Fecha vencimiento *</label>
                <input type="date" value={fechaVenc} onChange={e => setFechaVenc(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' }} />
              </div>
            </div>

            {/* Resumen */}
            <div style={{ background: 'var(--at-primary-tint)', borderRadius: 8, padding: '10px 12px', marginBottom: 14, fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ color: 'var(--at-primary-hover)' }}>Unidades seleccionadas</span>
                <span style={{ fontWeight: 700, color: 'var(--at-primary-hover)' }}>{seleccionadas.size} / {unidadesFiltradas.length}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ color: 'var(--at-primary-hover)' }}>Ya tienen cuota este período</span>
                <span style={{ fontWeight: 700, color: '#d97706' }}>{unidadesYaTienen.length}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--at-primary-soft-2)', marginTop: 4, paddingTop: 4 }}>
                <span style={{ fontWeight: 700, color: 'var(--at-primary-hover)' }}>Total a generar</span>
                <span style={{ fontWeight: 800, color: 'var(--at-primary-hover)' }}>{moneda} {totalGenerar.toLocaleString('es', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>

            {canCreate && (
              <button onClick={generar} disabled={generando || seleccionadas.size === 0}
                style={{ width: '100%', padding: '10px 0', background: seleccionadas.size === 0 ? 'var(--at-ink-3)' : 'var(--at-primary)', color: '#fff', border: 'none', borderRadius: 8, cursor: seleccionadas.size === 0 ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 700, opacity: generando ? 0.7 : 1 }}>
                {generando ? 'Generando…' : `🏭 Generar ${seleccionadas.size} cuotas`}
              </button>
            )}
          </div>

          {/* Lista de unidades */}
          <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>Unidades disponibles ({unidadesFiltradas.length})</div>
              {unidadesFiltradas.length > 0 && (
                <button onClick={toggleAll}
                  style={{ fontSize: 11, padding: '4px 12px', border: '1px solid var(--at-line-strong)', borderRadius: 6, cursor: 'pointer', background: 'var(--at-surface-2)' }}>
                  {seleccionadas.size === unidadesFiltradas.length ? 'Deseleccionar todas' : 'Seleccionar todas'}
                </button>
              )}
            </div>

            {unidadesFiltradas.length === 0 && (
              <div style={{ textAlign: 'center', color: '#16a34a', padding: '30px 0', fontSize: 13 }}>
                <div style={{ fontSize: 28, marginBottom: 6 }}>✅</div>
                Todas las unidades ya tienen cuota de <strong>{conceptoFinal}</strong> para {periodo}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 6, maxHeight: 400, overflowY: 'auto' }}>
              {unidadesFiltradas.map(u => {
                const sel = seleccionadas.has(u.id)
                return (
                  <div key={u.id} onClick={() => toggleUnidad(u.id)} style={{ padding: '8px 10px', border: `1.5px solid ${sel ? 'var(--at-primary)' : 'var(--at-line)'}`, borderRadius: 8, cursor: 'pointer', background: sel ? 'var(--at-primary-tint)' : 'var(--at-surface-2)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 16, height: 16, border: `2px solid ${sel ? 'var(--at-primary)' : 'var(--at-line-strong)'}`, borderRadius: 4, background: sel ? 'var(--at-primary)' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {sel && <span style={{ color: '#fff', fontSize: 10, fontWeight: 900 }}>✓</span>}
                    </div>
                    <span style={{ fontSize: 12, fontWeight: sel ? 600 : 400, color: sel ? 'var(--at-primary-hover)' : 'var(--at-ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.nombre}</span>
                  </div>
                )
              })}
            </div>

            {unidadesYaTienen.length > 0 && (
              <div style={{ marginTop: 12, padding: '8px 12px', background: '#fffbeb', borderRadius: 8, fontSize: 11, color: '#d97706' }}>
                ⚠️ {unidadesYaTienen.length} unidad(es) omitidas — ya tienen cuota de {conceptoFinal} en {periodo}:{' '}
                {unidadesYaTienen.slice(0, 5).map(u => u.nombre).join(', ')}{unidadesYaTienen.length > 5 ? `… +${unidadesYaTienen.length - 5}` : ''}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'historial' && (
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>Historial de generaciones masivas</div>
          {loadingLogs ? (
            <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: 30 }}>Cargando…</div>
          ) : logs.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: 40 }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📋</div>
              No hay generaciones registradas
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {logs.map(l => (
                <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'var(--at-surface-2)', borderRadius: 8, fontSize: 12 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--at-primary-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>🏭</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, color: 'var(--at-ink)' }}>{l.concepto} — {l.periodo}</div>
                    <div style={{ color: 'var(--at-ink-3)' }}>{l.unidades_generadas} unidades · {moneda} {l.monto_unitario.toFixed(2)} c/u · vence {l.fecha_vencimiento}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontWeight: 700, color: 'var(--at-primary)' }}>{moneda} {(l.monto_unitario * l.unidades_generadas).toLocaleString('es', { minimumFractionDigits: 2 })}</div>
                    <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>{l.created_at?.slice(0, 16)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
