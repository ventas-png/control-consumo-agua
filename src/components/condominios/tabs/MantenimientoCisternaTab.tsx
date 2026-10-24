import { hoyLocalISO, esFechaCalendarioVencida, formatNumber } from '../../../lib/format'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { createCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { notify } from '../../shared/Dialog'
import { tint } from '../../shared/statusTone'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { useProveedoresQuery } from '../../../domain/cxp/queries'
import { useAsignacionesQuery } from '../../../domain/proveedores/queries'
import type { ProveedorCatalogo } from '../../../types/proveedores'
import { ProveedorSelector } from '../../proveedores/ProveedorSelector'
import { OperacionesLegadoPanel } from '../../proveedores/OperacionesLegadoPanel'
import { MantenimientoCisterna, TipoMantenimientoCisterna, EstadoCisterna } from '../../../types'

interface Props {
  registros: MantenimientoCisterna[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPOS: { value: TipoMantenimientoCisterna; label: string; icon: string; color: string }[] = [
  { value: 'lectura',    label: 'Lectura',    icon: '📊', color: 'var(--at-accent-2)' },
  { value: 'limpieza',   label: 'Limpieza',   icon: '🧹', color: 'var(--at-success)' },
  { value: 'cloracion',  label: 'Cloración',  icon: '🧪', color: 'var(--at-accent)' },
  { value: 'inspeccion', label: 'Inspección', icon: '🔍', color: 'var(--at-accent)' },
  { value: 'reparacion', label: 'Reparación', icon: '🔧', color: 'var(--at-warning)' },
]

const ESTADOS: { value: EstadoCisterna; label: string; color: string; bg: string; icon: string }[] = [
  { value: 'normal',        label: 'Normal',        color: 'var(--at-success)', bg: 'var(--at-success-tint)', icon: '✅' },
  { value: 'bajo_nivel',    label: 'Bajo nivel',    color: 'var(--at-warning)', bg: 'var(--at-warning-tint)', icon: '⚠️' },
  { value: 'mantenimiento', label: 'Mantenimiento', color: 'var(--at-accent)', bg: 'var(--at-accent-tint)', icon: '🔧' },
  { value: 'fuera_servicio',label: 'Fuera servicio',color: 'var(--at-danger)', bg: 'var(--at-danger-tint)', icon: '🚫' },
]

const CLORO_MIN = 0.2
const CLORO_MAX = 1.0
const PH_MIN = 6.5
const PH_MAX = 8.5

function nivelColor(pct: number | null | undefined): string {
  if (pct == null) return 'var(--at-ink-3)'
  if (pct >= 60) return 'var(--at-success)'
  if (pct >= 30) return 'var(--at-warning)'
  return 'var(--at-danger)'
}

const enRango = (v: number, min: number, max: number) => v >= min && v <= max

const tipoDe = (t: TipoMantenimientoCisterna) => TIPOS.find(x => x.value === t)
const estadoDe = (e: EstadoCisterna) => ESTADOS.find(x => x.value === e)

/** Cloro o pH con su color de rango y, si está fuera, un aviso que no depende del color. */
function Medida({ value, min, max }: { value: number | null | undefined; min: number; max: number }) {
  if (value == null) return <span style={{ color: 'var(--at-ink-3)' }}>—</span>
  const ok = enRango(value, min, max)
  return (
    <span style={{ fontWeight: 700, color: ok ? 'var(--at-success)' : 'var(--at-danger)', whiteSpace: 'nowrap' }}>
      {value}
      {!ok && <span role="img" aria-label="Fuera de rango" title="Fuera de rango"> ⚠</span>}
    </span>
  )
}

function EstadoBadge({ estado }: { estado: EstadoCisterna }) {
  const est = estadoDe(estado)
  return <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 6, background: est?.bg, color: est?.color, whiteSpace: 'nowrap' }}>{est?.icon} {est?.label ?? estado}</span>
}

/** El más reciente: por fecha y, el mismo día, por hora de captura. */
const masReciente = (a: MantenimientoCisterna, b: MantenimientoCisterna) =>
  b.fecha.localeCompare(a.fecha) || (b.created_at ?? '').localeCompare(a.created_at ?? '')

export default function MantenimientoCisternaTab({ registros, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [filtrocisterna, setFiltroCisterna] = useState('')
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [detalleId, setDetalleId] = useState<string | null>(null)
  const [cambiandoId, setCambiandoId] = useState<string | null>(null)

  const [form, setForm] = useState({
    cisterna: 'Cisterna principal',
    fecha: hoyLocalISO(),
    tipo: 'lectura' as TipoMantenimientoCisterna,
    nivel_agua_pct: '', cloro_residual: '', ph: '',
    estado: 'normal' as EstadoCisterna,
    proveedor_id: '', empresa_servicio: '', tecnico: '',
    costo: '', proxima_revision: '', observaciones: '',
  })

  const cisternas = [...new Set(registros.map(r => r.cisterna))].sort()
  const lista = registros.filter(r => filtrocisterna === '' || r.cisterna === filtrocisterna)

  const ultimo = cisternas.reduce<Record<string, MantenimientoCisterna>>((acc, c) => {
    const rec = registros.filter(r => r.cisterna === c).sort(masReciente)[0]
    if (rec) acc[c] = rec
    return acc
  }, {})

  // Próxima revisión de cada cisterna: la más lejana que tenga programada,
  // marcada si ya venció. Antes se escondían las vencidas y una cisterna podía
  // salir repetida.
  const proximas = Object.values(registros.reduce<Record<string, MantenimientoCisterna>>((acc, r) => {
    if (r.proxima_revision && (!acc[r.cisterna] || r.proxima_revision > acc[r.cisterna].proxima_revision!)) acc[r.cisterna] = r
    return acc
  }, {})).sort((a, b) => a.proxima_revision!.localeCompare(b.proxima_revision!))

  const dinero = (v: number) => `${moneda}\u00a0${formatNumber(v, 2)}`

  function abrirForm() {
    setForm(p => ({ ...p, fecha: hoyLocalISO() }))
    setMostrarForm(true)
  }

  // No se cierra a mitad del guardado: cerrar ahí escondería el error.
  const cerrarForm = () => { if (!saving) setMostrarForm(false) }

  // La empresa de servicio sale del CATÁLOGO COMPARTIDO por id (el mismo de
  // Contabilidad y Operaciones), no de texto libre: así el registro sabe si el
  // proveedor sigue autorizado en este proyecto y el servidor lo valida al guardar.
  const { data: catalogo = [] } = useProveedoresQuery(companyId)
  const { data: asignaciones = [] } = useAsignacionesQuery(companyId, proyectoId)

  async function guardar() {
    if (saving) return
    if (!form.cisterna.trim()) {
      notify({ variant: 'warning', title: 'Faltan datos', text: 'El nombre de la cisterna es obligatorio' }); return
    }
    setSaving(true)
    const { error } = await createCondominioRow('mantenimiento_cisterna', {
      company_id: companyId, project_id: proyectoId,
      fecha: form.fecha, cisterna: form.cisterna.trim(),
      tipo: form.tipo,
      nivel_agua_pct: form.nivel_agua_pct ? parseFloat(form.nivel_agua_pct) : null,
      cloro_residual: form.cloro_residual ? parseFloat(form.cloro_residual) : null,
      ph: form.ph ? parseFloat(form.ph) : null,
      estado: form.estado,
      proveedor_id: form.proveedor_id || null,
      empresa_servicio: form.empresa_servicio.trim() || null,
      tecnico: form.tecnico.trim() || null,
      costo: form.costo ? parseFloat(form.costo) : null,
      proxima_revision: form.proxima_revision || null,
      observaciones: form.observaciones.trim() || null,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setForm(p => ({ ...p, nivel_agua_pct: '', cloro_residual: '', ph: '', costo: '', observaciones: '' }))
    setMostrarForm(false)
    onRefresh()
  }

  async function cambiarEstado(r: MantenimientoCisterna, estado: EstadoCisterna) {
    if (cambiandoId) return
    setCambiandoId(r.id)
    const { error } = await updateCondominioRow('mantenimiento_cisterna', r.id, { estado })
    setCambiandoId(null)
    // Antes el error se ignoraba: el botón no hacía nada y no decía por qué.
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13, boxSizing: 'border-box', minWidth: 0, background: 'var(--at-surface)', color: 'var(--at-ink)' }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

  const nivelForm = form.nivel_agua_pct ? parseFloat(form.nivel_agua_pct) : null
  const cloroForm = form.cloro_residual ? parseFloat(form.cloro_residual) : null
  const phForm = form.ph ? parseFloat(form.ph) : null
  const ayudaRango = (valor: number | null, min: number, max: number) => {
    const fuera = valor != null && !enRango(valor, min, max)
    return (
      <div style={{ fontSize: 11, marginTop: 3, color: fuera ? 'var(--at-danger)' : 'var(--at-ink-3)', fontWeight: fuera ? 600 : 400 }}>
        {fuera ? `Fuera de rango (ideal ${min}–${max})` : `Ideal ${min}–${max}`}
      </div>
    )
  }

  // Se lee el registro vigente, no una copia.
  const detalle = detalleId ? registros.find(r => r.id === detalleId) ?? null : null

  const botonNormalizar = (r: MantenimientoCisterna, size: 'sm' | 'md') => (
    <Button size={size} variant="success" onClick={() => void cambiarEstado(r, 'normal')} loading={cambiandoId === r.id}
      aria-label={size === 'sm' ? `Normalizar ${r.cisterna} (registro del ${r.fecha})` : undefined}>
      {size === 'sm' ? 'Normalizar' : '✅ Normalizar'}
    </Button>
  )

  return (
    <div style={{ padding: 16 }}>
      {/* Estado actual por cisterna: cada tarjeta abre su último registro */}
      {cisternas.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))', gap: 12, marginBottom: 16 }}>
          {cisternas.map(c => {
            const r = ultimo[c]
            const est = estadoDe(r?.estado)
            return (
              <button key={c} type="button" onClick={() => r && setDetalleId(r.id)} aria-label={`Ver último registro de ${c}${est ? `: ${est.label}` : ''}`}
                className="cond-kpi-link"
                style={{ background: est?.bg ?? 'var(--at-surface-2)', border: `1px solid ${est?.color ?? 'var(--at-line)'}`, borderRadius: 12, padding: '12px 16px', textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer', minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>🏗️ {c}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: est?.color }}>{est?.icon} {est?.label}</span>
                </div>
                {r ? (
                  <div>
                    {r.nivel_agua_pct != null && (
                      <div style={{ marginBottom: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>Nivel</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: nivelColor(r.nivel_agua_pct) }}>{r.nivel_agua_pct}%</span>
                        </div>
                        <div style={{ height: 6, background: 'var(--at-line)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.min(r.nivel_agua_pct, 100)}%`, background: nivelColor(r.nivel_agua_pct) }} />
                        </div>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: '4px 12px', fontSize: 11, flexWrap: 'wrap' }}>
                      {r.cloro_residual != null && <span>Cl: <Medida value={r.cloro_residual} min={CLORO_MIN} max={CLORO_MAX} /></span>}
                      {r.ph != null && <span>pH: <Medida value={r.ph} min={PH_MIN} max={PH_MAX} /></span>}
                      <span style={{ color: 'var(--at-ink-3)' }}>{r.fecha}</span>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>Sin registros</div>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Próxima revisión de cada cisterna: cada una abre su registro */}
      {proximas.length > 0 && (
        <div style={{ background: 'var(--at-accent-tint)', border: '1px solid var(--at-accent-soft)', borderRadius: 10, padding: '10px 14px', marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--at-accent)', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase' }}>🔍 Próximas revisiones</div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>
            {proximas.map(r => {
              const vencida = esFechaCalendarioVencida(r.proxima_revision)
              return (
                <li key={r.cisterna}>
                  <button type="button" onClick={() => setDetalleId(r.id)} className="cond-barra-fila"
                    style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', borderRadius: 6, padding: '4px 6px', font: 'inherit', fontSize: 13, color: 'var(--at-ink-2)', cursor: 'pointer' }}>
                    🏗️ {r.cisterna} · <strong style={{ color: vencida ? 'var(--at-danger)' : 'var(--at-accent)' }}>{r.proxima_revision}</strong>
                    {vencida && <span style={{ color: 'var(--at-danger)', fontWeight: 600 }}> · vencida</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Filtros + botón */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', flex: '1 1 200px' }}>
          <select aria-label="Filtrar por cisterna" style={{ ...inp, width: 'auto', flex: '1 1 170px', maxWidth: 280 }} value={filtrocisterna} onChange={e => setFiltroCisterna(e.target.value)}>
            <option value="">Todas las cisternas</option>
            {cisternas.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <span style={{ fontSize: 13, color: 'var(--at-ink-3)' }}>{lista.length} registros</span>
        </div>
        {canCreate && (
          <Button onClick={abrirForm}>+ Nuevo registro</Button>
        )}
      </div>

      {/* Nuevo registro en ventana (antes, un formulario fijo de tres columnas
          sobre el historial que en el teléfono dejaba campos de ~90px). */}
      {mostrarForm && (
        <EditModal
          title="🏗️ Nuevo registro de cisterna"
          maxWidth="640px"
          fullScreenOnMobile
          onClose={cerrarForm}
          closeOnBackdropClick={!saving}
          closeOnEscape={!saving}
          footer={
            <>
              <Button variant="secondary" onClick={cerrarForm} disabled={saving}>Cancelar</Button>
              <Button type="submit" form="cisterna-form" variant="success" loading={saving} loadingText="Guardando…">✅ Registrar</Button>
            </>
          }
        >
          <form
            id="cisterna-form"
            onSubmit={e => { e.preventDefault(); void guardar() }}
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: 12, alignItems: 'start' }}
          >
            <div>
              <label htmlFor="cisterna-nombre" style={lbl}>Cisterna</label>
              {/* Sugiere las cisternas ya registradas: con otra mayúscula eran dos tarjetas. */}
              <input id="cisterna-nombre" list="cisterna-nombres" style={inp} placeholder="Cisterna principal, Ala B…" value={form.cisterna} onChange={e => setForm(p => ({ ...p, cisterna: e.target.value }))} />
              <datalist id="cisterna-nombres">
                {cisternas.map(c => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div>
              <label htmlFor="cisterna-fecha" style={lbl}>Fecha</label>
              <input id="cisterna-fecha" type="date" style={inp} value={form.fecha} onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="cisterna-tipo" style={lbl}>Tipo</label>
              <select id="cisterna-tipo" style={inp} value={form.tipo} onChange={e => setForm(p => ({ ...p, tipo: e.target.value as TipoMantenimientoCisterna }))}>
                {TIPOS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="cisterna-nivel" style={lbl}>Nivel de agua (%)</label>
              <input id="cisterna-nivel" type="number" inputMode="decimal" step="0.01" min="0" max="100" style={{ ...inp, borderColor: nivelForm != null && nivelForm < 30 ? 'var(--at-danger)' : 'var(--at-line-strong)' }} value={form.nivel_agua_pct} onChange={e => setForm(p => ({ ...p, nivel_agua_pct: e.target.value }))} />
              {nivelForm != null && nivelForm < 30 && (
                <div style={{ fontSize: 11, marginTop: 3, color: 'var(--at-danger)', fontWeight: 600 }}>Nivel bajo (menos de 30%)</div>
              )}
            </div>
            <div>
              <label htmlFor="cisterna-cloro" style={lbl}>Cloro residual (ppm)</label>
              {/* Tres decimales, como la columna (numeric(6,3)). */}
              <input id="cisterna-cloro" type="number" inputMode="decimal" step="0.001" min="0" style={{ ...inp, borderColor: cloroForm != null && !enRango(cloroForm, CLORO_MIN, CLORO_MAX) ? 'var(--at-danger)' : 'var(--at-line-strong)' }} value={form.cloro_residual} onChange={e => setForm(p => ({ ...p, cloro_residual: e.target.value }))} />
              {ayudaRango(cloroForm, CLORO_MIN, CLORO_MAX)}
            </div>
            <div>
              <label htmlFor="cisterna-ph" style={lbl}>pH</label>
              {/* 0–14: un 75 por 7.5 se guardaba tal cual. */}
              <input id="cisterna-ph" type="number" inputMode="decimal" step="0.01" min="0" max="14" style={{ ...inp, borderColor: phForm != null && !enRango(phForm, PH_MIN, PH_MAX) ? 'var(--at-danger)' : 'var(--at-line-strong)' }} value={form.ph} onChange={e => setForm(p => ({ ...p, ph: e.target.value }))} />
              {ayudaRango(phForm, PH_MIN, PH_MAX)}
            </div>
            <div>
              <label htmlFor="cisterna-estado" style={lbl}>Estado</label>
              <select id="cisterna-estado" style={inp} value={form.estado} onChange={e => setForm(p => ({ ...p, estado: e.target.value as EstadoCisterna }))}>
                {ESTADOS.map(e => <option key={e.value} value={e.value}>{e.icon} {e.label}</option>)}
              </select>
            </div>
            <div>
              <ProveedorSelector
                proveedores={catalogo as ProveedorCatalogo[]} asignaciones={asignaciones} projectId={proyectoId}
                value={form.proveedor_id || null} soloHabilitados label="Empresa de servicio"
                onChange={(id, pr) => setForm(p => ({ ...p, proveedor_id: id ?? '', empresa_servicio: pr?.nombre ?? '' }))}
              />
            </div>
            <div>
              <label htmlFor="cisterna-tecnico" style={lbl}>Técnico</label>
              <input id="cisterna-tecnico" style={inp} value={form.tecnico} onChange={e => setForm(p => ({ ...p, tecnico: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="cisterna-costo" style={lbl}>Costo ({moneda})</label>
              <input id="cisterna-costo" type="number" inputMode="decimal" min="0" step="0.01" style={inp} value={form.costo} onChange={e => setForm(p => ({ ...p, costo: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="cisterna-proxima" style={lbl}>Próxima revisión</label>
              <input id="cisterna-proxima" type="date" min={form.fecha || undefined} style={inp} value={form.proxima_revision} onChange={e => setForm(p => ({ ...p, proxima_revision: e.target.value }))} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="cisterna-observaciones" style={lbl}>Observaciones</label>
              <textarea id="cisterna-observaciones" rows={2} style={{ ...inp, fontFamily: 'inherit', resize: 'vertical' }} value={form.observaciones} onChange={e => setForm(p => ({ ...p, observaciones: e.target.value }))} />
            </div>
          </form>
        </EditModal>
      )}

      {/* Detalle del registro en ventana */}
      {detalle && (
        <EditModal
          title={`🏗️ ${detalle.cisterna}`}
          subtitle={
            <span style={{ display: 'inline-flex', gap: '4px 8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span>{tipoDe(detalle.tipo)?.icon} {tipoDe(detalle.tipo)?.label ?? detalle.tipo} · {detalle.fecha}</span>
              <EstadoBadge estado={detalle.estado} />
            </span>
          }
          maxWidth="480px"
          fullScreenOnMobile
          onClose={() => setDetalleId(null)}
          footer={
            <>
              {canEdit && detalle.estado === 'bajo_nivel' && botonNormalizar(detalle, 'md')}
              <Button variant="secondary" onClick={() => setDetalleId(null)}>Cerrar</Button>
            </>
          }
        >
          <RegistroDetalle registro={detalle} dinero={dinero} />
        </EditModal>
      )}

      {/* Historial: en el teléfono cada registro es una tarjeta; tocarlo abre
          su detalle y «Ver» es el camino de teclado. */}
      <DataTable<MantenimientoCisterna>
        data={lista}
        rowKey="id"
        pageSize={30}
        mobileCardLayout
        defaultSort={{ key: 'fecha', direction: 'desc' }}
        emptyState={{ icon: '🏗️', title: 'Sin registros' }}
        onRowClick={(r) => setDetalleId(r.id)}
        columns={[
          { key: 'cisterna', header: 'Cisterna', sortable: true,
            render: (r) => <span style={{ fontWeight: 600 }}>🏗️ {r.cisterna}</span> },
          { key: 'tipo', header: 'Tipo', sortable: true,
            accessor: (r) => tipoDe(r.tipo)?.label ?? r.tipo,
            render: (r) => {
              const tipo = tipoDe(r.tipo)
              return <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 6, background: tipo && tint(tipo.color, 12), color: tipo?.color, whiteSpace: 'nowrap' }}>{tipo?.icon} {tipo?.label ?? r.tipo}</span>
            } },
          { key: 'fecha', header: 'Fecha', sortable: true,
            accessor: (r) => `${r.fecha} ${r.created_at ?? ''}`,
            render: (r) => <span style={{ whiteSpace: 'nowrap' }}>{r.fecha}</span> },
          { key: 'nivel_agua_pct', header: 'Nivel', align: 'right',
            render: (r) => r.nivel_agua_pct != null
              ? <span style={{ fontWeight: 700, color: nivelColor(r.nivel_agua_pct) }}>{r.nivel_agua_pct}%</span>
              : <span style={{ color: 'var(--at-ink-3)' }}>—</span> },
          { key: 'cloro_residual', header: 'Cloro', align: 'right', render: (r) => <Medida value={r.cloro_residual} min={CLORO_MIN} max={CLORO_MAX} /> },
          { key: 'ph', header: 'pH', align: 'right', render: (r) => <Medida value={r.ph} min={PH_MIN} max={PH_MAX} /> },
          { key: 'estado', header: 'Estado', sortable: true,
            accessor: (r) => estadoDe(r.estado)?.label ?? r.estado,
            render: (r) => <EstadoBadge estado={r.estado} /> },
          { key: 'acciones', header: '', align: 'right',
            render: (r) => (
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
                {r.observaciones && <span aria-hidden="true" style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>📝</span>}
                <Button size="sm" variant="secondary" onClick={() => setDetalleId(r.id)} aria-label={`Ver registro de ${r.cisterna} del ${r.fecha}`}>Ver</Button>
                {canEdit && r.estado === 'bajo_nivel' && botonNormalizar(r, 'sm')}
              </span>
            ) },
        ] satisfies DataTableColumn<MantenimientoCisterna>[]}
      />
      <OperacionesLegadoPanel companyId={companyId} tabla="mantenimiento_cisterna" projectId={proyectoId} canEdit={canEdit} />
    </div>
  )
}

/** Detalle de solo lectura de un registro de cisterna. */
function RegistroDetalle({ registro: r, dinero }: { registro: MantenimientoCisterna; dinero: (v: number) => string }) {
  const fila = (label: string, valor: ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '7px 0', borderBottom: '1px solid var(--at-chip)', fontSize: 14 }}>
      <span style={{ color: 'var(--at-ink-3)' }}>{label}</span>
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{valor}</span>
    </div>
  )
  const medida = (value: number | null | undefined, min: number, max: number) => {
    if (value == null) return '—'
    const ok = enRango(value, min, max)
    return (
      <span>
        <strong style={{ color: ok ? 'var(--at-success)' : 'var(--at-danger)' }}>{value}</strong>
        <span style={{ display: 'block', fontSize: 12, color: ok ? 'var(--at-ink-3)' : 'var(--at-danger)' }}>{ok ? 'En rango' : 'Fuera de rango'} · ideal {min}–{max}</span>
      </span>
    )
  }
  const vencida = !!r.proxima_revision && esFechaCalendarioVencida(r.proxima_revision)
  return (
    <div>
      {fila('Nivel de agua', r.nivel_agua_pct != null
        ? <span><strong style={{ color: nivelColor(r.nivel_agua_pct) }}>{r.nivel_agua_pct}%</strong>{r.nivel_agua_pct < 30 && <span style={{ display: 'block', fontSize: 12, color: 'var(--at-danger)' }}>Nivel bajo</span>}</span>
        : '—')}
      {fila('Cloro residual (ppm)', medida(r.cloro_residual, CLORO_MIN, CLORO_MAX))}
      {fila('pH', medida(r.ph, PH_MIN, PH_MAX))}
      {fila('Empresa de servicio', r.empresa_servicio ? <>{r.empresa_servicio}{!r.proveedor_id && <span style={{ color: 'var(--at-ink-3)' }}> (sin vincular al catálogo)</span>}</> : '—')}
      {fila('Técnico', r.tecnico || '—')}
      {fila('Costo', r.costo != null ? <strong style={{ color: 'var(--at-success)' }}>{dinero(r.costo)}</strong> : '—')}
      {fila('Próxima revisión', r.proxima_revision
        ? <strong style={{ color: vencida ? 'var(--at-danger)' : 'var(--at-accent)' }}>{r.proxima_revision}{vencida ? ' · vencida' : ''}</strong>
        : '—')}
      {r.observaciones && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 4 }}>Observaciones</div>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 14 }}>{r.observaciones}</p>
        </div>
      )}
    </div>
  )
}
