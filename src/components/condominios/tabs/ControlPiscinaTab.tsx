import { hoyLocalISO } from '../../../lib/format'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { createCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { notify } from '../../shared/Dialog'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { ControlPiscina, EstadoPiscina, TurbiededadPiscina } from '../../../types'

interface Props {
  registros: ControlPiscina[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESTADOS: { value: EstadoPiscina; label: string; color: string; bg: string; icon: string }[] = [
  { value: 'abierta',               label: 'Abierta',             color: 'var(--at-success)', bg: 'var(--at-success-tint)', icon: '✅' },
  { value: 'cerrada_mantenimiento', label: 'Cerrada (manto.)',    color: 'var(--at-warning)', bg: 'var(--at-warning-tint)', icon: '🔧' },
  { value: 'cerrada_quimica',       label: 'Cerrada (química)',   color: 'var(--at-accent)', bg: 'var(--at-accent-tint)', icon: '🧪' },
  { value: 'cerrada_incidente',     label: 'Cerrada (incidente)', color: 'var(--at-danger)', bg: 'var(--at-danger-tint)', icon: '🚨' },
]

const TURBIEDAD: { value: TurbiededadPiscina; label: string; color: string }[] = [
  { value: 'cristalina',          label: 'Cristalina',           color: 'var(--at-accent-2)' },
  { value: 'ligeramente_turbia',  label: 'Liger. turbia',        color: 'var(--at-warning)' },
  { value: 'turbia',              label: 'Turbia',               color: 'var(--at-danger)' },
]

const PH_MIN = 7.2
const PH_MAX = 7.8
const CLORO_MIN = 0.5
const CLORO_MAX = 3.0

type Nivel = 'ok' | 'warn' | 'bad'

function phStatus(ph: number | null | undefined): Nivel {
  if (ph == null) return 'ok'
  if (ph >= PH_MIN && ph <= PH_MAX) return 'ok'
  if (ph >= 7.0 && ph <= 8.0) return 'warn'
  return 'bad'
}

function cloroStatus(c: number | null | undefined): Nivel {
  if (c == null) return 'ok'
  if (c >= CLORO_MIN && c <= CLORO_MAX) return 'ok'
  if (c >= 0.2 && c <= 4.0) return 'warn'
  return 'bad'
}

const STATUS_COLOR = { ok: 'var(--at-success)', warn: 'var(--at-warning)', bad: 'var(--at-danger)' }
// En palabras, no sólo en color.
const STATUS_TEXTO = { ok: 'En rango', warn: 'Revisar: cerca del límite', bad: 'Fuera de rango' }

const horaActual = () => new Date().toTimeString().slice(0, 5)

/** pH o cloro con su color de rango y, si no está bien, un aviso que no depende del color. */
function Medida({ value, nivel }: { value: number | null | undefined; nivel: Nivel }) {
  if (value == null) return <span style={{ color: 'var(--at-ink-3)' }}>—</span>
  return (
    <span style={{ fontWeight: 700, color: STATUS_COLOR[nivel], whiteSpace: 'nowrap' }}>
      {value}
      {nivel !== 'ok' && <span role="img" aria-label={STATUS_TEXTO[nivel]} title={STATUS_TEXTO[nivel]}> ⚠</span>}
    </span>
  )
}

function GaugeBar({ value, min, max, status }: { value: number | null | undefined; min: number; max: number; status: Nivel }) {
  if (value == null) return <span style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>—</span>
  const pct = Math.min(Math.max(((value - (min - 1)) / ((max + 1) - (min - 1))) * 100, 0), 100)
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color: STATUS_COLOR[status] }}>{value}</div>
      <div style={{ height: 4, background: 'var(--at-line)', borderRadius: 2, overflow: 'hidden', marginTop: 2 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: STATUS_COLOR[status] }} />
      </div>
    </div>
  )
}

export default function ControlPiscinaTab({ registros, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [filtroPiscina, setFiltroPiscina] = useState('')
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [detalleId, setDetalleId] = useState<string | null>(null)
  const [cambiandoId, setCambiandoId] = useState<string | null>(null)

  const [form, setForm] = useState({
    piscina: 'Principal', fecha: hoyLocalISO(),
    hora: horaActual(),
    ph: '', cloro: '', temperatura: '',
    turbiedad: 'cristalina' as TurbiededadPiscina,
    estado: 'abierta' as EstadoPiscina,
    num_usuarios: '', registrado_por: '', observaciones: '',
  })

  const piscinas = [...new Set(registros.map(r => r.piscina))].sort()
  const lista = registros.filter(r => filtroPiscina === '' || r.piscina === filtroPiscina)

  const ultimo = piscinas.reduce<Record<string, ControlPiscina>>((acc, p) => {
    const rec = registros.filter(r => r.piscina === p).sort((a, b) => b.fecha.localeCompare(a.fecha) || (b.hora ?? '').localeCompare(a.hora ?? ''))[0]
    if (rec) acc[p] = rec
    return acc
  }, {})

  // Fecha y hora se toman al abrir: con la pestaña abierta desde la mañana,
  // la hora de montaje ya no era la de la medición.
  function abrirForm() {
    setForm(p => ({ ...p, fecha: hoyLocalISO(), hora: horaActual() }))
    setMostrarForm(true)
  }

  // No se cierra a mitad del guardado: cerrar ahí escondería el error.
  const cerrarForm = () => { if (!saving) setMostrarForm(false) }

  async function guardar() {
    if (saving) return
    if (!form.piscina.trim()) {
      notify({ variant: 'warning', title: 'Faltan datos', text: 'El nombre de la piscina es obligatorio' }); return
    }
    setSaving(true)
    const { error } = await createCondominioRow('control_piscina', {
      company_id: companyId, project_id: proyectoId,
      fecha: form.fecha, hora: form.hora || null,
      piscina: form.piscina.trim(),
      ph: form.ph ? parseFloat(form.ph) : null,
      cloro: form.cloro ? parseFloat(form.cloro) : null,
      temperatura: form.temperatura ? parseFloat(form.temperatura) : null,
      turbiedad: form.turbiedad, estado: form.estado,
      num_usuarios: form.num_usuarios ? parseInt(form.num_usuarios) : null,
      registrado_por: form.registrado_por.trim() || null,
      observaciones: form.observaciones.trim() || null,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setForm(p => ({ ...p, ph: '', cloro: '', temperatura: '', num_usuarios: '', observaciones: '' }))
    setMostrarForm(false)
    onRefresh()
  }

  async function cambiarEstado(r: ControlPiscina, estado: EstadoPiscina) {
    if (cambiandoId) return
    setCambiandoId(r.id)
    const { error } = await updateCondominioRow('control_piscina', r.id, { estado })
    setCambiandoId(null)
    // Antes el error se ignoraba: el botón no hacía nada y no decía por qué.
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13, boxSizing: 'border-box', minWidth: 0, background: 'var(--at-surface)', color: 'var(--at-ink)' }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

  const phForm = form.ph ? phStatus(parseFloat(form.ph)) : null
  const cloroForm = form.cloro ? cloroStatus(parseFloat(form.cloro)) : null
  const ayudaRango = (nivel: Nivel | null, ideal: string) => (
    <div style={{ fontSize: 11, marginTop: 3, color: nivel && nivel !== 'ok' ? STATUS_COLOR[nivel] : 'var(--at-ink-3)', fontWeight: nivel && nivel !== 'ok' ? 600 : 400 }}>
      {nivel && nivel !== 'ok' ? `${STATUS_TEXTO[nivel]} (ideal ${ideal})` : `Ideal ${ideal}`}
    </div>
  )

  // Se lee el registro vigente, no una copia.
  const detalle = detalleId ? registros.find(r => r.id === detalleId) ?? null : null

  /** Abrir / cerrar por mantenimiento, como antes, ahora con aviso si falla. */
  const botonEstado = (r: ControlPiscina, size: 'sm' | 'md') => r.estado !== 'abierta' ? (
    <Button size={size} variant="success" onClick={() => void cambiarEstado(r, 'abierta')} loading={cambiandoId === r.id}
      aria-label={size === 'sm' ? `Abrir ${r.piscina} (registro del ${r.fecha})` : undefined}>
      {size === 'sm' ? 'Abrir' : '✅ Marcar abierta'}
    </Button>
  ) : (
    <Button size={size} variant="warning" onClick={() => void cambiarEstado(r, 'cerrada_mantenimiento')} loading={cambiandoId === r.id}
      aria-label={size === 'sm' ? `Cerrar ${r.piscina} por mantenimiento (registro del ${r.fecha})` : undefined}>
      {size === 'sm' ? 'Cerrar' : '🔧 Cerrar por mantenimiento'}
    </Button>
  )

  return (
    <div style={{ padding: 16 }}>
      {/* Estado actual por piscina: cada tarjeta abre su último registro */}
      {piscinas.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))', gap: 12, marginBottom: 16 }}>
          {piscinas.map(p => {
            const r = ultimo[p]
            const est = ESTADOS.find(e => e.value === r?.estado)
            const turb = TURBIEDAD.find(t => t.value === r?.turbiedad)
            return (
              <button key={p} type="button" onClick={() => r && setDetalleId(r.id)} aria-label={`Ver último registro de ${p}${est ? `: ${est.label}` : ''}`}
                className="cond-kpi-link"
                style={{ background: est?.bg ?? 'var(--at-surface-2)', border: `1px solid ${est?.color ?? 'var(--at-line)'}`, borderRadius: 12, padding: '12px 16px', textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer', minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>🏊 {p}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: est?.color }}>{est?.icon} {est?.label}</span>
                </div>
                {r ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>pH</div>
                      <GaugeBar value={r.ph} min={PH_MIN} max={PH_MAX} status={phStatus(r.ph)} />
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>Cloro</div>
                      <GaugeBar value={r.cloro} min={CLORO_MIN} max={CLORO_MAX} status={cloroStatus(r.cloro)} />
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>°C</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--at-ink-2)' }}>{r.temperatura ?? '—'}</div>
                    </div>
                    <div style={{ gridColumn: '1 / -1', fontSize: 11, color: turb?.color, marginTop: 2 }}>
                      💧 {turb?.label} · {r.fecha} {r.hora?.slice(0, 5)}
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

      {/* Filtros + botón */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', flex: '1 1 200px' }}>
          <select aria-label="Filtrar por piscina" style={{ ...inp, width: 'auto', flex: '1 1 160px', maxWidth: 260 }} value={filtroPiscina} onChange={e => setFiltroPiscina(e.target.value)}>
            <option value="">Todas las piscinas</option>
            {piscinas.map(p => <option key={p} value={p}>{p}</option>)}
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
          title="🏊 Nuevo registro de piscina"
          maxWidth="620px"
          fullScreenOnMobile
          onClose={cerrarForm}
          closeOnBackdropClick={!saving}
          closeOnEscape={!saving}
          footer={
            <>
              <Button variant="secondary" onClick={cerrarForm} disabled={saving}>Cancelar</Button>
              <Button type="submit" form="piscina-form" variant="success" loading={saving} loadingText="Guardando…">✅ Registrar</Button>
            </>
          }
        >
          <form
            id="piscina-form"
            onSubmit={e => { e.preventDefault(); void guardar() }}
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))', gap: 12, alignItems: 'start' }}
          >
            <div>
              <label htmlFor="piscina-nombre" style={lbl}>Piscina</label>
              {/* Sugiere las piscinas ya registradas: «principal» y «Principal» eran dos tarjetas. */}
              <input id="piscina-nombre" list="piscina-nombres" style={inp} placeholder="Principal, Sur, Infantil…" value={form.piscina} onChange={e => setForm(p => ({ ...p, piscina: e.target.value }))} />
              <datalist id="piscina-nombres">
                {piscinas.map(p => <option key={p} value={p} />)}
              </datalist>
            </div>
            <div>
              <label htmlFor="piscina-fecha" style={lbl}>Fecha</label>
              <input id="piscina-fecha" type="date" style={inp} value={form.fecha} onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="piscina-hora" style={lbl}>Hora</label>
              <input id="piscina-hora" type="time" style={inp} value={form.hora} onChange={e => setForm(p => ({ ...p, hora: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="piscina-ph" style={lbl}>pH</label>
              {/* 0–14: un 72 por 7.2 se guardaba tal cual. */}
              <input id="piscina-ph" type="number" inputMode="decimal" min="0" max="14" step="0.01" style={{ ...inp, borderColor: phForm ? STATUS_COLOR[phForm] : 'var(--at-line-strong)' }} value={form.ph} onChange={e => setForm(p => ({ ...p, ph: e.target.value }))} />
              {ayudaRango(phForm, `${PH_MIN}–${PH_MAX}`)}
            </div>
            <div>
              <label htmlFor="piscina-cloro" style={lbl}>Cloro (ppm)</label>
              <input id="piscina-cloro" type="number" inputMode="decimal" min="0" step="0.01" style={{ ...inp, borderColor: cloroForm ? STATUS_COLOR[cloroForm] : 'var(--at-line-strong)' }} value={form.cloro} onChange={e => setForm(p => ({ ...p, cloro: e.target.value }))} />
              {ayudaRango(cloroForm, `${CLORO_MIN}–${CLORO_MAX}`)}
            </div>
            <div>
              <label htmlFor="piscina-temperatura" style={lbl}>Temperatura (°C)</label>
              <input id="piscina-temperatura" type="number" inputMode="decimal" step="0.01" style={inp} value={form.temperatura} onChange={e => setForm(p => ({ ...p, temperatura: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="piscina-turbiedad" style={lbl}>Turbiedad</label>
              <select id="piscina-turbiedad" style={inp} value={form.turbiedad} onChange={e => setForm(p => ({ ...p, turbiedad: e.target.value as TurbiededadPiscina }))}>
                {TURBIEDAD.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="piscina-estado" style={lbl}>Estado</label>
              <select id="piscina-estado" style={inp} value={form.estado} onChange={e => setForm(p => ({ ...p, estado: e.target.value as EstadoPiscina }))}>
                {ESTADOS.map(e => <option key={e.value} value={e.value}>{e.icon} {e.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="piscina-usuarios" style={lbl}>N° usuarios en piscina</label>
              <input id="piscina-usuarios" type="number" inputMode="numeric" min="0" step="1" style={inp} value={form.num_usuarios} onChange={e => setForm(p => ({ ...p, num_usuarios: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="piscina-registrado-por" style={lbl}>Registrado por</label>
              <input id="piscina-registrado-por" style={inp} value={form.registrado_por} onChange={e => setForm(p => ({ ...p, registrado_por: e.target.value }))} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="piscina-observaciones" style={lbl}>Observaciones</label>
              <textarea id="piscina-observaciones" rows={2} style={{ ...inp, fontFamily: 'inherit', resize: 'vertical' }} value={form.observaciones} onChange={e => setForm(p => ({ ...p, observaciones: e.target.value }))} />
            </div>
          </form>
        </EditModal>
      )}

      {/* Detalle del registro en ventana */}
      {detalle && (
        <EditModal
          title={`🏊 ${detalle.piscina}`}
          subtitle={<EstadoSubtitulo registro={detalle} />}
          maxWidth="480px"
          fullScreenOnMobile
          onClose={() => setDetalleId(null)}
          footer={
            <>
              {canEdit && botonEstado(detalle, 'md')}
              <Button variant="secondary" onClick={() => setDetalleId(null)}>Cerrar</Button>
            </>
          }
        >
          <RegistroDetalle registro={detalle} />
        </EditModal>
      )}

      {/* Historial: en el teléfono cada registro es una tarjeta; tocarlo abre
          su detalle y «Ver» es el camino de teclado. */}
      <DataTable<ControlPiscina>
        data={lista}
        rowKey="id"
        pageSize={30}
        mobileCardLayout
        defaultSort={{ key: 'fecha', direction: 'desc' }}
        emptyState={{ icon: '🏊', title: 'Sin registros' }}
        onRowClick={(r) => setDetalleId(r.id)}
        columns={[
          { key: 'piscina', header: 'Piscina', sortable: true,
            render: (r) => <span style={{ fontWeight: 600 }}>🏊 {r.piscina}</span> },
          { key: 'fecha', header: 'Fecha', sortable: true,
            accessor: (r) => `${r.fecha} ${r.hora ?? ''}`,
            render: (r) => <span style={{ whiteSpace: 'nowrap' }}>{r.fecha} {r.hora?.slice(0, 5)}</span> },
          { key: 'ph', header: 'pH', align: 'right', render: (r) => <Medida value={r.ph} nivel={phStatus(r.ph)} /> },
          { key: 'cloro', header: 'Cloro', align: 'right', render: (r) => <Medida value={r.cloro} nivel={cloroStatus(r.cloro)} /> },
          { key: 'temperatura', header: '°C', align: 'right', render: (r) => r.temperatura ?? '—' },
          { key: 'turbiedad', header: 'Turbiedad', hideOnMobile: true,
            render: (r) => {
              const turb = TURBIEDAD.find(t => t.value === r.turbiedad)
              return <span style={{ fontSize: 12, color: turb?.color }}>💧 {turb?.label}</span>
            } },
          { key: 'estado', header: 'Estado', sortable: true,
            render: (r) => {
              const est = ESTADOS.find(e => e.value === r.estado)
              return <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 6, background: est?.bg, color: est?.color, whiteSpace: 'nowrap' }}>{est?.icon} {est?.label}</span>
            } },
          { key: 'acciones', header: '', align: 'right',
            render: (r) => (
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
                {r.observaciones && <span aria-hidden="true" style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>📝</span>}
                <Button size="sm" variant="secondary" onClick={() => setDetalleId(r.id)} aria-label={`Ver registro de ${r.piscina} del ${r.fecha} ${r.hora?.slice(0, 5) ?? ''}`.trim()}>Ver</Button>
                {canEdit && botonEstado(r, 'sm')}
              </span>
            ) },
        ] satisfies DataTableColumn<ControlPiscina>[]}
      />
    </div>
  )
}

function EstadoSubtitulo({ registro: r }: { registro: ControlPiscina }) {
  const est = ESTADOS.find(e => e.value === r.estado)
  return (
    <span style={{ display: 'inline-flex', gap: '4px 8px', alignItems: 'center', flexWrap: 'wrap' }}>
      <span>{r.fecha}{r.hora ? ` · ${r.hora.slice(0, 5)}` : ''}</span>
      {est && <span style={{ padding: '2px 8px', borderRadius: 10, background: est.bg, color: est.color, fontWeight: 600 }}>{est.icon} {est.label}</span>}
    </span>
  )
}

/** Detalle de solo lectura de un registro de piscina. */
function RegistroDetalle({ registro: r }: { registro: ControlPiscina }) {
  const fila = (label: string, valor: ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '7px 0', borderBottom: '1px solid var(--at-chip)', fontSize: 14 }}>
      <span style={{ color: 'var(--at-ink-3)' }}>{label}</span>
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{valor}</span>
    </div>
  )
  const medida = (value: number | null | undefined, nivel: Nivel, ideal: string) => value == null ? '—' : (
    <span>
      <strong style={{ color: STATUS_COLOR[nivel] }}>{value}</strong>
      <span style={{ display: 'block', fontSize: 12, color: nivel === 'ok' ? 'var(--at-ink-3)' : STATUS_COLOR[nivel] }}>{STATUS_TEXTO[nivel]} · ideal {ideal}</span>
    </span>
  )
  const turb = TURBIEDAD.find(t => t.value === r.turbiedad)
  return (
    <div>
      {fila('pH', medida(r.ph, phStatus(r.ph), `${PH_MIN}–${PH_MAX}`))}
      {fila('Cloro (ppm)', medida(r.cloro, cloroStatus(r.cloro), `${CLORO_MIN}–${CLORO_MAX}`))}
      {fila('Temperatura', r.temperatura != null ? `${r.temperatura} °C` : '—')}
      {fila('Turbiedad', <span style={{ color: turb?.color }}>💧 {turb?.label ?? r.turbiedad}</span>)}
      {fila('Usuarios en piscina', r.num_usuarios ?? '—')}
      {fila('Registrado por', r.registrado_por || '—')}
      {r.observaciones && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 4 }}>Observaciones</div>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 14 }}>{r.observaciones}</p>
        </div>
      )}
    </div>
  )
}
