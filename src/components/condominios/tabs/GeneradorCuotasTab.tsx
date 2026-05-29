import { useState, useMemo, useCallback } from 'react'
import Swal from 'sweetalert2'
import { notify } from '../../shared/Dialog'
import { supabase } from '../../../lib/supabase'
import { CuotaCondominio, Unidad, GeneracionCuotasLog, RubroConfig, RubroDetalle } from '../../../types'
import { RubrosBuilder } from '../RubrosBuilder'

interface Props {
  cuotas: CuotaCondominio[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  onRefresh: () => void
  onVerCuotas?: () => void
}

const CONCEPTOS = ['Mantenimiento', 'Administración', 'Fondo de reserva', 'Áreas comunes', 'Seguridad', 'Extraordinaria', 'CAM', 'Otro']

function mesProximo(): string {
  const d = new Date()
  d.setMonth(d.getMonth() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function calcularMontoPorUnidad(
  unidad: Unidad,
  rubros: RubroConfig[],
  totalM2: number,
): { rubrosDetalle: RubroDetalle[]; total: number } {
  const rubrosDetalle = rubros.map(r => {
    let monto = 0
    if (r.metodo === 'fijo') {
      monto = r.valor
    } else if (r.metodo === 'por_m2') {
      monto = (unidad.area_m2 ?? 0) * r.valor
    } else if (r.metodo === 'alicuota') {
      const pct = unidad.alicuota_pct != null
        ? unidad.alicuota_pct
        : totalM2 > 0
          ? ((unidad.area_m2 ?? 0) / totalM2) * 100
          : 0
      monto = r.valor * (pct / 100)
    }
    return { ...r, monto_calculado: Math.round(monto * 100) / 100 }
  })
  return { rubrosDetalle, total: rubrosDetalle.reduce((s, r) => s + r.monto_calculado, 0) }
}

type Paso = 'config' | 'preview' | 'resultado'

interface ResultadoGeneracion {
  generadas: number
  total: number
}

export default function GeneradorCuotasTab({ cuotas, unidades, proyectoId, companyId, moneda, canCreate, onRefresh, onVerCuotas }: Props) {
  const [paso, setPaso] = useState<Paso>('config')
  const [tab, setTab] = useState<'generar' | 'historial'>('generar')

  // Paso A — Configuración
  const [periodo, setPeriodo] = useState(mesProximo())
  const [concepto, setConcepto] = useState('Mantenimiento')
  const [conceptoCustom, setConceptoCustom] = useState('')
  const [fechaVenc, setFechaVenc] = useState('')
  const [rubros, setRubros] = useState<RubroConfig[]>([
    { nombre: 'Mantenimiento general', metodo: 'fijo', valor: 0 },
  ])

  // Paso B — Preview
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set())
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set())

  // Paso C — Resultado
  const [generando, setGenerando] = useState(false)
  const [resultado, setResultado] = useState<ResultadoGeneracion | null>(null)

  // Historial
  const [logs, setLogs] = useState<GeneracionCuotasLog[]>([])
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [logExpandidas, setLogExpandidas] = useState<Set<string>>(new Set())

  const conceptoFinal = concepto === 'Otro' ? conceptoCustom : concepto

  const totalM2 = useMemo(
    () => unidades.filter(u => u.activo !== false).reduce((s, u) => s + (u.area_m2 ?? 0), 0),
    [unidades],
  )

  const yaExisten = useMemo(() => {
    return new Set(
      cuotas
        .filter(c => c.periodo === periodo && c.concepto === conceptoFinal)
        .map(c => c.unidad_id),
    )
  }, [cuotas, periodo, conceptoFinal])

  const unidadesDisponibles = unidades.filter(u => !yaExisten.has(u.id))
  const unidadesYaTienen = unidades.filter(u => yaExisten.has(u.id))

  // Cálculo por unidad
  const calculos = useMemo(() => {
    return unidadesDisponibles.map(u => ({
      unidad: u,
      ...calcularMontoPorUnidad(u, rubros, totalM2),
    }))
  }, [unidadesDisponibles, rubros, totalM2])

  const calculosMapa = useMemo(() => {
    return new Map(calculos.map(c => [c.unidad.id, c]))
  }, [calculos])

  // Advertencias
  const alertas = useMemo(() => {
    const necesitaM2 = rubros.some(r => r.metodo === 'por_m2' || r.metodo === 'alicuota')
    if (!necesitaM2) return []
    return unidadesDisponibles
      .filter(u => !u.area_m2 && !u.alicuota_pct)
      .map(u => u.nombre)
  }, [rubros, unidadesDisponibles])

  const totalSeleccionado = useMemo(() => {
    return [...seleccionadas].reduce((s, id) => {
      const c = calculosMapa.get(id)
      return s + (c?.total ?? 0)
    }, 0)
  }, [seleccionadas, calculosMapa])

  function toggleAll() {
    if (seleccionadas.size === unidadesDisponibles.length) {
      setSeleccionadas(new Set())
    } else {
      setSeleccionadas(new Set(unidadesDisponibles.map(u => u.id)))
    }
  }

  function toggleUnidad(id: string) {
    setSeleccionadas(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  function toggleExpandir(id: string) {
    setExpandidas(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  function toggleLogExpandir(id: string) {
    setLogExpandidas(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  function irAPreview() {
    if (rubros.length === 0) { notify({ variant: 'warning', title: 'Sin rubros', text: 'Agrega al menos un rubro para continuar.' }); return }
    if (rubros.some(r => !r.nombre.trim())) { notify({ variant: 'warning', title: 'Rubros incompletos', text: 'Todos los rubros deben tener nombre.' }); return }
    if (rubros.some(r => r.valor <= 0)) { notify({ variant: 'warning', title: 'Valor requerido', text: 'Todos los rubros deben tener un valor mayor a 0.' }); return }
    if (!fechaVenc) { notify({ variant: 'warning', title: 'Fecha requerida', text: 'Selecciona la fecha de vencimiento.' }); return }
    if (!conceptoFinal.trim()) { notify({ variant: 'warning', title: 'Concepto requerido', text: 'Ingresa el concepto.' }); return }
    // Seleccionar todas por defecto
    setSeleccionadas(new Set(unidadesDisponibles.map(u => u.id)))
    setPaso('preview')
  }

  const generar = useCallback(async () => {
    if (seleccionadas.size === 0) { notify({ variant: 'warning', title: 'Sin unidades', text: 'Selecciona al menos una unidad.' }); return }

    const metodosUsados = [...new Set(rubros.map(r => r.metodo))]
    const metodoCalculo = metodosUsados.length === 1 ? metodosUsados[0] : 'mixto'

    const r = await Swal.fire({
      title: `¿Generar ${seleccionadas.size} cuotas?`,
      html: `<b>${conceptoFinal}</b> · ${rubros.length} rubro(s)<br>Período: ${periodo} · Vence: ${fechaVenc}<br>Total: <b>${moneda} ${totalSeleccionado.toLocaleString('es', { minimumFractionDigits: 2 })}</b>`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: 'var(--at-primary)',
      confirmButtonText: 'Generar',
      cancelButtonText: 'Cancelar',
    })
    if (!r.isConfirmed) return

    setGenerando(true)

    const rows = [...seleccionadas].map(uid => {
      const calc = calculosMapa.get(uid)
      const u = calc?.unidad
      return {
        company_id: companyId,
        project_id: proyectoId,
        unidad_id: uid,
        unidad_nombre: u?.nombre ?? '',
        concepto: conceptoFinal,
        monto: calc?.total ?? 0,
        periodo,
        fecha_vencimiento: fechaVenc,
        estado: 'pendiente',
        rubros_detalle: calc?.rubrosDetalle ?? null,
      }
    })

    const { error } = await supabase.from('cuotas_condominio').insert(rows)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); setGenerando(false); return }

    // Log de auditoría con rubros
    const montoPromedio = seleccionadas.size > 0 ? totalSeleccionado / seleccionadas.size : 0
    await supabase.from('generacion_cuotas_log').insert({
      company_id: companyId,
      project_id: proyectoId,
      periodo,
      concepto: conceptoFinal,
      monto_unitario: Math.round(montoPromedio * 100) / 100,
      fecha_vencimiento: fechaVenc,
      unidades_generadas: seleccionadas.size,
      rubros,
      metodo_calculo: metodoCalculo,
    })

    setGenerando(false)
    setResultado({ generadas: seleccionadas.size, total: totalSeleccionado })
    setPaso('resultado')
    onRefresh()
  }, [seleccionadas, rubros, conceptoFinal, periodo, fechaVenc, totalSeleccionado, moneda, companyId, proyectoId, calculosMapa, onRefresh])

  const cargarLogs = useCallback(async () => {
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
  }, [proyectoId, companyId])

  function cambiarTab(t: 'generar' | 'historial') {
    setTab(t)
    if (t === 'historial') void cargarLogs()
  }

  function reiniciar() {
    setPaso('config')
    setResultado(null)
    setSeleccionadas(new Set())
    setExpandidas(new Set())
  }

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
        <>
          {/* Indicador de pasos */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
            {(['config', 'preview', 'resultado'] as Paso[]).map((p, i) => {
              const labels = ['1. Configurar', '2. Previsualizar', '3. Resultado']
              const activo = paso === p
              const completado = (paso === 'preview' && i === 0) || (paso === 'resultado' && i < 2)
              return (
                <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700,
                      background: completado ? 'var(--at-success)' : activo ? 'var(--at-primary)' : 'var(--at-line)',
                      color: completado || activo ? 'white' : 'var(--at-ink-3)' }}>
                      {completado ? '✓' : i + 1}
                    </div>
                    <span style={{ fontSize: 12, fontWeight: activo ? 700 : 500, color: activo ? 'var(--at-primary)' : completado ? 'var(--at-success)' : 'var(--at-ink-3)' }}>
                      {labels[i]}
                    </span>
                  </div>
                  {i < 2 && <div style={{ width: 24, height: 1, background: 'var(--at-line)' }} />}
                </div>
              )
            })}
          </div>

          {/* ─── PASO A: Configurar ─── */}
          {paso === 'config' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
              {/* Panel izquierdo: parámetros base */}
              <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 20 }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 16, color: 'var(--at-ink)' }}>⚙️ Parámetros del período</div>

                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Período *</label>
                  <input type="month" value={periodo} onChange={e => setPeriodo(e.target.value)}
                    style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' }} />
                </div>

                <div style={{ marginBottom: 12 }}>
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

                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Fecha de vencimiento *</label>
                  <input type="date" value={fechaVenc} onChange={e => setFechaVenc(e.target.value)}
                    style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' }} />
                </div>

                <div style={{ background: 'var(--at-primary-tint)', borderRadius: 8, padding: '10px 12px', fontSize: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <span style={{ color: 'var(--at-primary-hover)' }}>Unidades disponibles</span>
                    <span style={{ fontWeight: 700, color: 'var(--at-primary-hover)' }}>{unidadesDisponibles.length}</span>
                  </div>
                  {unidadesYaTienen.length > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--at-warning)' }}>Ya tienen cuota este período</span>
                      <span style={{ fontWeight: 700, color: 'var(--at-warning)' }}>{unidadesYaTienen.length}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Panel derecho: rubros */}
              <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 20 }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 16, color: 'var(--at-ink)' }}>💰 Rubros y métodos de cálculo</div>
                <RubrosBuilder rubros={rubros} onChange={setRubros} moneda={moneda} />

                {canCreate && (
                  <button onClick={irAPreview}
                    disabled={rubros.length === 0 || unidadesDisponibles.length === 0}
                    style={{ marginTop: 20, width: '100%', padding: '10px 0', background: rubros.length === 0 || unidadesDisponibles.length === 0 ? 'var(--at-ink-3)' : 'var(--at-primary)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>
                    Previsualizar por unidad →
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ─── PASO B: Preview ─── */}
          {paso === 'preview' && (
            <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--at-ink)' }}>
                    📋 Vista previa — {conceptoFinal} · {periodo}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 2 }}>
                    {rubros.length} rubro(s) · vence {fechaVenc}
                  </div>
                </div>
                <button onClick={() => setPaso('config')}
                  style={{ padding: '6px 14px', border: '1px solid var(--at-line-strong)', borderRadius: 7, fontSize: 12, cursor: 'pointer', background: 'var(--at-surface-2)' }}>
                  ← Volver a configurar
                </button>
              </div>

              {alertas.length > 0 && (
                <div style={{ background: 'var(--at-warning-tint)', border: '1px solid #fcd34d', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: 'var(--at-warning-strong)' }}>
                  ⚠️ Las siguientes unidades no tienen área m² ni alícuota definidas — su cuota será ₡0 en rubros por m² / alícuota:{' '}
                  {alertas.slice(0, 5).join(', ')}{alertas.length > 5 ? ` +${alertas.length - 5} más` : ''}
                </div>
              )}

              {/* Header de tabla */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 11, fontWeight: 600, color: 'var(--at-ink-3)', padding: '0 8px' }}>
                <div style={{ width: 20 }}>
                  <input type="checkbox"
                    checked={seleccionadas.size === unidadesDisponibles.length && unidadesDisponibles.length > 0}
                    onChange={toggleAll} />
                </div>
                <div style={{ flex: 2 }}>Unidad</div>
                <div style={{ flex: 1 }}>Tipo</div>
                <div style={{ flex: 1, textAlign: 'right' }}>Área m²</div>
                <div style={{ flex: 1, textAlign: 'right' }}>Alícuota %</div>
                <div style={{ flex: 1 }}></div>
                <div style={{ flex: 1, textAlign: 'right' }}>Total</div>
              </div>

              <div style={{ maxHeight: 420, overflowY: 'auto', border: '1px solid var(--at-chip)', borderRadius: 8 }}>
                {calculos.map(({ unidad, rubrosDetalle, total }, idx) => {
                  const sel = seleccionadas.has(unidad.id)
                  const exp = expandidas.has(unidad.id)
                  return (
                    <div key={unidad.id} style={{ borderBottom: idx < calculos.length - 1 ? '1px solid var(--at-chip)' : 'none' }}>
                      <div onClick={() => toggleUnidad(unidad.id)}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 8px', cursor: 'pointer', background: sel ? 'var(--at-primary-tint)' : idx % 2 === 0 ? 'var(--at-surface)' : 'var(--at-surface-2)' }}>
                        <div style={{ width: 20 }} onClick={e => { e.stopPropagation(); toggleUnidad(unidad.id) }}>
                          <input type="checkbox" checked={sel} onChange={() => toggleUnidad(unidad.id)} onClick={e => e.stopPropagation()} />
                        </div>
                        <div style={{ flex: 2, fontSize: 13, fontWeight: sel ? 600 : 400, color: sel ? 'var(--at-primary-hover)' : 'var(--at-ink-2)' }}>{unidad.nombre}</div>
                        <div style={{ flex: 1, fontSize: 11, color: 'var(--at-ink-3)' }}>{unidad.tipo}</div>
                        <div style={{ flex: 1, fontSize: 12, textAlign: 'right', color: 'var(--at-ink-2)' }}>{unidad.area_m2 ? `${unidad.area_m2} m²` : '—'}</div>
                        <div style={{ flex: 1, fontSize: 12, textAlign: 'right', color: 'var(--at-ink-2)' }}>
                          {unidad.alicuota_pct != null
                            ? `${unidad.alicuota_pct.toFixed(2)}%`
                            : unidad.area_m2 && totalM2 > 0
                              ? `${((unidad.area_m2 / totalM2) * 100).toFixed(2)}% ≈`
                              : '—'}
                        </div>
                        <div style={{ flex: 1, textAlign: 'center' }}>
                          <button onClick={e => { e.stopPropagation(); toggleExpandir(unidad.id) }}
                            style={{ fontSize: 10, padding: '2px 8px', border: '1px solid var(--at-line-strong)', borderRadius: 5, cursor: 'pointer', background: 'var(--at-surface-2)', color: 'var(--at-ink-3)' }}>
                            {exp ? '▲ ocultar' : '▼ detalle'}
                          </button>
                        </div>
                        <div style={{ flex: 1, fontSize: 13, fontWeight: 700, textAlign: 'right', color: 'var(--at-ink)' }}>
                          {moneda} {total.toLocaleString('es', { minimumFractionDigits: 2 })}
                        </div>
                      </div>

                      {/* Detalle de rubros expandido */}
                      {exp && (
                        <div style={{ background: 'var(--at-surface-2)', borderTop: '1px solid var(--at-accent-soft-2)', padding: '8px 12px 8px 48px' }}>
                          {rubrosDetalle.map((rd, ri) => (
                            <div key={ri} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--at-ink-2)', marginBottom: 3 }}>
                              <span style={{ color: 'var(--at-ink-2)' }}>
                                {rd.nombre}
                                <span style={{ marginLeft: 6, color: 'var(--at-ink-3)' }}>
                                  ({rd.metodo === 'fijo' ? 'fijo' : rd.metodo === 'por_m2' ? `${rd.valor}/m²` : `${rd.valor.toLocaleString('es')} × alíc.`})
                                </span>
                              </span>
                              <span style={{ fontWeight: 600 }}>{moneda} {rd.monto_calculado.toLocaleString('es', { minimumFractionDigits: 2 })}</span>
                            </div>
                          ))}
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, color: 'var(--at-primary-hover)', borderTop: '1px solid var(--at-accent-soft)', marginTop: 4, paddingTop: 4 }}>
                            <span>Total</span>
                            <span>{moneda} {total.toLocaleString('es', { minimumFractionDigits: 2 })}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {unidadesYaTienen.length > 0 && (
                <div style={{ marginTop: 10, padding: '8px 12px', background: 'var(--at-warning-tint)', borderRadius: 8, fontSize: 11, color: 'var(--at-warning)' }}>
                  ⚠️ {unidadesYaTienen.length} unidad(es) omitidas — ya tienen cuota de {conceptoFinal} en {periodo}:{' '}
                  {unidadesYaTienen.slice(0, 5).map(u => u.nombre).join(', ')}{unidadesYaTienen.length > 5 ? ` +${unidadesYaTienen.length - 5}` : ''}
                </div>
              )}

              {/* Footer */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, padding: '12px 16px', background: 'var(--at-surface-2)', borderRadius: 8, border: '1px solid var(--at-line)' }}>
                <div style={{ fontSize: 13, color: 'var(--at-ink-2)' }}>
                  <span style={{ fontWeight: 700 }}>{seleccionadas.size}</span> unidades seleccionadas
                </div>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--at-primary-hover)' }}>
                  Total: {moneda} {totalSeleccionado.toLocaleString('es', { minimumFractionDigits: 2 })}
                </div>
                {canCreate && (
                  <button onClick={generar} disabled={generando || seleccionadas.size === 0}
                    style={{ padding: '10px 24px', background: seleccionadas.size === 0 ? 'var(--at-ink-3)' : 'var(--at-primary)', color: 'white', border: 'none', borderRadius: 8, cursor: seleccionadas.size === 0 ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 700, opacity: generando ? 0.7 : 1 }}>
                    {generando ? 'Generando…' : `🏭 Confirmar y generar ${seleccionadas.size} cuotas`}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ─── PASO C: Resultado ─── */}
          {paso === 'resultado' && resultado && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 0', gap: 16 }}>
              <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--at-success-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36 }}>✅</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--at-ink)' }}>¡Cuotas generadas!</div>
              <div style={{ fontSize: 14, color: 'var(--at-ink-3)', textAlign: 'center' }}>
                Se crearon <strong>{resultado.generadas} cuotas</strong> de <strong>{conceptoFinal}</strong><br />
                para el período <strong>{periodo}</strong> — Total: <strong>{moneda} {resultado.total.toLocaleString('es', { minimumFractionDigits: 2 })}</strong>
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <button onClick={reiniciar}
                  style={{ padding: '10px 20px', border: '1px solid var(--at-line-strong)', borderRadius: 8, fontSize: 13, cursor: 'pointer', background: 'var(--at-surface-2)' }}>
                  Generar otro período
                </button>
                {onVerCuotas && (
                  <button onClick={onVerCuotas}
                    style={{ padding: '10px 20px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
                    Ver cuotas generadas →
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ─── Historial ─── */}
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
              {logs.map(l => {
                const expLog = logExpandidas.has(l.id)
                const rubrosLog = (l.rubros as RubroConfig[] | null) ?? null
                return (
                  <div key={l.id} style={{ background: 'var(--at-surface-2)', borderRadius: 8, border: '1px solid var(--at-chip)', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', fontSize: 12 }}>
                      <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--at-primary-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>🏭</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, color: 'var(--at-ink)' }}>{l.concepto} — {l.periodo}</div>
                        <div style={{ color: 'var(--at-ink-3)' }}>
                          {l.unidades_generadas} unidades · {l.metodo_calculo ? `método: ${l.metodo_calculo} · ` : ''}{moneda} {l.monto_unitario.toFixed(2)} promedio · vence {l.fecha_vencimiento}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontWeight: 700, color: 'var(--at-primary)' }}>{moneda} {(l.monto_unitario * l.unidades_generadas).toLocaleString('es', { minimumFractionDigits: 2 })}</div>
                        <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>{l.created_at?.slice(0, 16)}</div>
                      </div>
                      {rubrosLog && rubrosLog.length > 0 && (
                        <button onClick={() => toggleLogExpandir(l.id)}
                          style={{ fontSize: 10, padding: '2px 8px', border: '1px solid var(--at-line-strong)', borderRadius: 5, cursor: 'pointer', background: 'var(--at-surface)', color: 'var(--at-ink-3)', flexShrink: 0 }}>
                          {expLog ? '▲' : '▼'} rubros
                        </button>
                      )}
                    </div>
                    {expLog && rubrosLog && (
                      <div style={{ background: 'var(--at-primary-tint)', borderTop: '1px solid var(--at-accent-soft-2)', padding: '8px 14px 10px 66px' }}>
                        {rubrosLog.map((rb, ri) => (
                          <div key={ri} style={{ fontSize: 11, color: 'var(--at-ink-2)', display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                            <span>{rb.nombre} <span style={{ color: 'var(--at-ink-3)' }}>({rb.metodo})</span></span>
                            <span style={{ fontWeight: 600 }}>{moneda} {rb.valor.toLocaleString('es', { minimumFractionDigits: 2 })}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
