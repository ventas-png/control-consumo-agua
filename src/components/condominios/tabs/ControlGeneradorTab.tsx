import { hoyLocalISO, esFechaCalendarioVencida, formatNumber } from '../../../lib/format'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { createCondominioRow } from '../../../domain/condominios/tabMutations'
import { notify } from '../../shared/Dialog'
import { tint } from '../../shared/statusTone'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { ControlGenerador, TipoRegistroGenerador, EstadoGenerador } from '../../../types'

interface Props {
  registros: ControlGenerador[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPOS: { value: TipoRegistroGenerador; label: string; icon: string; color: string }[] = [
  { value: 'lectura',              label: 'Lectura',             icon: '📊', color: 'var(--at-accent-2)' },
  { value: 'mantenimiento',        label: 'Mantenimiento',       icon: '🔧', color: 'var(--at-accent)' },
  { value: 'prueba',               label: 'Prueba',              icon: '⚡', color: 'var(--at-warning)' },
  { value: 'falla',                label: 'Falla',               icon: '⚠️', color: 'var(--at-danger)' },
  { value: 'arranque_emergencia',  label: 'Arranque emergencia', icon: '🚨', color: 'var(--at-danger)' },
]

const ESTADOS: { value: EstadoGenerador; label: string; color: string; bg: string; icon: string }[] = [
  { value: 'standby',      label: 'Standby',      color: 'var(--at-success)', bg: 'var(--at-success-tint)', icon: '✅' },
  { value: 'operando',     label: 'Operando',      color: 'var(--at-accent)', bg: 'var(--at-accent-tint)', icon: '⚡' },
  { value: 'mantenimiento',label: 'Mantenimiento', color: 'var(--at-warning)', bg: 'var(--at-warning-tint)', icon: '🔧' },
  { value: 'falla',        label: 'Falla',         color: 'var(--at-danger)', bg: 'var(--at-danger-tint)', icon: '⚠️' },
  { value: 'apagado',      label: 'Apagado',       color: 'var(--at-ink-3)', bg: 'var(--at-chip)', icon: '⭕' },
]

function nivelCombColor(pct: number | null | undefined): string {
  if (pct == null) return 'var(--at-ink-3)'
  if (pct >= 50) return 'var(--at-success)'
  if (pct >= 25) return 'var(--at-warning)'
  return 'var(--at-danger)'
}

const tipoDe = (t: TipoRegistroGenerador) => TIPOS.find(x => x.value === t)
const estadoDe = (e: EstadoGenerador) => ESTADOS.find(x => x.value === e)

/** El más reciente: por fecha y, el mismo día, por hora de captura. */
const masReciente = (a: ControlGenerador, b: ControlGenerador) =>
  b.fecha.localeCompare(a.fecha) || (b.created_at ?? '').localeCompare(a.created_at ?? '')

function EstadoBadge({ estado }: { estado: EstadoGenerador }) {
  const est = estadoDe(estado)
  return <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 6, background: est?.bg, color: est?.color, whiteSpace: 'nowrap' }}>{est?.icon} {est?.label ?? estado}</span>
}

export default function ControlGeneradorTab({ registros, proyectoId, companyId, moneda, canCreate, onRefresh }: Props) {
  const [filtroGenerador, setFiltroGenerador] = useState('')
  const [filtroTipo, setFiltroTipo] = useState<TipoRegistroGenerador | ''>('')
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [detalleId, setDetalleId] = useState<string | null>(null)

  const [form, setForm] = useState({
    generador: 'Generador principal',
    fecha: hoyLocalISO(),
    tipo: 'lectura' as TipoRegistroGenerador,
    nivel_combustible_pct: '', horas_operacion: '', horas_acumuladas: '',
    estado: 'standby' as EstadoGenerador,
    voltaje: '', frecuencia: '',
    operador: '', empresa_servicio: '', costo: '',
    proximo_mantenimiento: '', observaciones: '',
  })

  const generadores = [...new Set(registros.map(r => r.generador))].sort()

  const lista = registros.filter(r =>
    (filtroGenerador === '' || r.generador === filtroGenerador) &&
    (filtroTipo === '' || r.tipo === filtroTipo)
  )

  const delGenerador = (g: string) => registros.filter(r => r.generador === g).sort(masReciente)
  const ultimo = generadores.reduce<Record<string, ControlGenerador>>((acc, g) => {
    const rec = delGenerador(g)[0]
    if (rec) acc[g] = rec
    return acc
  }, {})

  // Próximo mantenimiento de cada generador: el más lejano programado en
  // cualquiera de sus registros. Antes sólo se leía del último, y una lectura
  // posterior sin fecha lo hacía desaparecer de la tarjeta.
  const proxMant = (g: string) => registros
    .filter(r => r.generador === g && r.proximo_mantenimiento)
    .reduce<string | null>((max, r) => !max || r.proximo_mantenimiento! > max ? r.proximo_mantenimiento! : max, null)

  /** Última lectura del horómetro de un generador (la más reciente con horas acumuladas). */
  const ultimoHorometro = (g: string) => delGenerador(g.trim()).find(r => r.horas_acumuladas != null)

  const totalHoras = registros.reduce((s, r) => s + (r.horas_operacion ?? 0), 0)
  const fallas = registros.filter(r => r.tipo === 'falla').length

  function abrirForm() {
    setForm(p => ({ ...p, fecha: hoyLocalISO() }))
    setMostrarForm(true)
  }

  // No se cierra a mitad del guardado: cerrar ahí escondería el error.
  const cerrarForm = () => { if (!saving) setMostrarForm(false) }

  async function guardar() {
    if (saving) return
    if (!form.generador.trim()) {
      notify({ variant: 'warning', title: 'Faltan datos', text: 'El nombre del generador es obligatorio' }); return
    }
    setSaving(true)
    const { error } = await createCondominioRow('control_generador', {
      company_id: companyId, project_id: proyectoId,
      generador: form.generador.trim(), fecha: form.fecha, tipo: form.tipo,
      nivel_combustible_pct: form.nivel_combustible_pct ? parseFloat(form.nivel_combustible_pct) : null,
      horas_operacion: form.horas_operacion ? parseFloat(form.horas_operacion) : null,
      horas_acumuladas: form.horas_acumuladas ? parseFloat(form.horas_acumuladas) : null,
      estado: form.estado,
      voltaje: form.voltaje ? parseFloat(form.voltaje) : null,
      frecuencia: form.frecuencia ? parseFloat(form.frecuencia) : null,
      operador: form.operador.trim() || null,
      empresa_servicio: form.empresa_servicio.trim() || null,
      costo: form.costo ? parseFloat(form.costo) : null,
      proximo_mantenimiento: form.proximo_mantenimiento || null,
      observaciones: form.observaciones.trim() || null,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    // Las horas acumuladas también se vacían: arrastradas al siguiente
    // registro, era fácil volver a guardar la misma lectura del horómetro.
    setForm(p => ({ ...p, nivel_combustible_pct: '', horas_operacion: '', horas_acumuladas: '', voltaje: '', frecuencia: '', costo: '', observaciones: '' }))
    setMostrarForm(false)
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13, boxSizing: 'border-box', minWidth: 0, background: 'var(--at-surface)', color: 'var(--at-ink)' }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }
  const ayuda: CSSProperties = { fontSize: 11, color: 'var(--at-ink-3)', marginTop: 3 }

  const combForm = form.nivel_combustible_pct ? parseFloat(form.nivel_combustible_pct) : null
  const horometro = ultimoHorometro(form.generador)
  const acumForm = form.horas_acumuladas ? parseFloat(form.horas_acumuladas) : null
  const horometroAtras = acumForm != null && horometro?.horas_acumuladas != null && acumForm < horometro.horas_acumuladas

  const dinero = (v: number) => `${moneda}\u00a0${formatNumber(v, 2)}`

  // Se lee el registro vigente, no una copia.
  const detalle = detalleId ? registros.find(r => r.id === detalleId) ?? null : null

  return (
    <div style={{ padding: 16 }}>
      {/* Estado actual por generador: cada tarjeta abre su último registro */}
      {generadores.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 230px), 1fr))', gap: 12, marginBottom: 16 }}>
          {generadores.map(g => {
            const r = ultimo[g]
            const est = estadoDe(r?.estado)
            const mant = proxMant(g)
            const mantVencido = !!mant && esFechaCalendarioVencida(mant)
            return (
              <button key={g} type="button" onClick={() => r && setDetalleId(r.id)} aria-label={`Ver último registro de ${g}${est ? `: ${est.label}` : ''}`}
                className="cond-kpi-link"
                style={{ background: est?.bg ?? 'var(--at-surface-2)', border: `1px solid ${est?.color ?? 'var(--at-line)'}`, borderRadius: 12, padding: '12px 16px', textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer', minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>⚡ {g}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: est?.color }}>{est?.icon} {est?.label}</span>
                </div>
                {r ? (
                  <div>
                    {r.nivel_combustible_pct != null && (
                      <div style={{ marginBottom: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>Combustible</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: nivelCombColor(r.nivel_combustible_pct) }}>{r.nivel_combustible_pct}%{r.nivel_combustible_pct < 25 ? ' · bajo' : ''}</span>
                        </div>
                        <div style={{ height: 6, background: 'var(--at-line)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.min(r.nivel_combustible_pct, 100)}%`, background: nivelCombColor(r.nivel_combustible_pct) }} />
                        </div>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 10, fontSize: 11, flexWrap: 'wrap' }}>
                      {r.horas_acumuladas != null && <span style={{ color: 'var(--at-ink-3)' }}>⏱ {r.horas_acumuladas}h acum.</span>}
                      {r.voltaje != null && <span style={{ color: 'var(--at-accent)' }}>{r.voltaje}V</span>}
                      {r.frecuencia != null && <span style={{ color: 'var(--at-accent)' }}>{r.frecuencia}Hz</span>}
                    </div>
                    {mant && (
                      <div style={{ fontSize: 11, color: mantVencido ? 'var(--at-danger)' : 'var(--at-warning)', fontWeight: mantVencido ? 600 : 400, marginTop: 4 }}>
                        🔧 Manto: {mant}{mantVencido ? ' · vencido' : ''}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>Sin registros</div>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* KPIs (dos o tres por fila según el ancho) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))', gap: 12, marginBottom: 16 }}>
        <div style={{ background: 'var(--at-accent-tint)', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--at-accent)' }}>{registros.length}</div>
          <div style={{ fontSize: 11, color: 'var(--at-accent)' }}>Registros totales</div>
        </div>
        <div style={{ background: 'var(--at-warning-tint)', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--at-warning)' }}>{formatNumber(totalHoras, 1)}h</div>
          <div style={{ fontSize: 11, color: 'var(--at-warning)' }}>Horas operación totales</div>
        </div>
        <div style={{ background: fallas > 0 ? 'var(--at-danger-tint)' : 'var(--at-chip)', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: fallas > 0 ? 'var(--at-danger)' : 'var(--at-ink-3)' }}>{fallas}</div>
          <div style={{ fontSize: 11, color: fallas > 0 ? 'var(--at-danger)' : 'var(--at-ink-3)' }}>Fallas registradas</div>
        </div>
      </div>

      {/* Filtros + botón */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', flex: '1 1 260px' }}>
          <select aria-label="Filtrar por generador" style={{ ...inp, width: 'auto', flex: '1 1 170px' }} value={filtroGenerador} onChange={e => setFiltroGenerador(e.target.value)}>
            <option value="">Todos los generadores</option>
            {generadores.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <select aria-label="Filtrar por tipo" style={{ ...inp, width: 'auto', flex: '1 1 170px' }} value={filtroTipo} onChange={e => setFiltroTipo(e.target.value as TipoRegistroGenerador | '')}>
            <option value="">Todos los tipos</option>
            {TIPOS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
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
          title="⚡ Nuevo registro de generador"
          maxWidth="640px"
          fullScreenOnMobile
          onClose={cerrarForm}
          closeOnBackdropClick={!saving}
          closeOnEscape={!saving}
          footer={
            <>
              <Button variant="secondary" onClick={cerrarForm} disabled={saving}>Cancelar</Button>
              <Button type="submit" form="generador-form" variant="success" loading={saving} loadingText="Guardando…">✅ Registrar</Button>
            </>
          }
        >
          <form
            id="generador-form"
            onSubmit={e => { e.preventDefault(); void guardar() }}
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: 12, alignItems: 'start' }}
          >
            <div>
              <label htmlFor="generador-nombre" style={lbl}>Generador</label>
              {/* Sugiere los generadores ya registrados: con otra mayúscula eran dos tarjetas. */}
              <input id="generador-nombre" list="generador-nombres" style={inp} placeholder="Generador principal…" value={form.generador} onChange={e => setForm(p => ({ ...p, generador: e.target.value }))} />
              <datalist id="generador-nombres">
                {generadores.map(g => <option key={g} value={g} />)}
              </datalist>
            </div>
            <div>
              <label htmlFor="generador-fecha" style={lbl}>Fecha</label>
              <input id="generador-fecha" type="date" style={inp} value={form.fecha} onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="generador-tipo" style={lbl}>Tipo de registro</label>
              <select id="generador-tipo" style={inp} value={form.tipo} onChange={e => setForm(p => ({ ...p, tipo: e.target.value as TipoRegistroGenerador }))}>
                {TIPOS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="generador-combustible" style={lbl}>Nivel de combustible (%)</label>
              <input id="generador-combustible" type="number" inputMode="decimal" step="0.01" min="0" max="100" style={{ ...inp, borderColor: combForm != null && combForm < 25 ? 'var(--at-danger)' : 'var(--at-line-strong)' }} value={form.nivel_combustible_pct} onChange={e => setForm(p => ({ ...p, nivel_combustible_pct: e.target.value }))} />
              {combForm != null && combForm < 25 && (
                <div style={{ ...ayuda, color: 'var(--at-danger)', fontWeight: 600 }}>Combustible bajo (menos de 25%)</div>
              )}
            </div>
            <div>
              <label htmlFor="generador-horas" style={lbl}>Horas de operación</label>
              <input id="generador-horas" type="number" inputMode="decimal" step="0.01" min="0" style={inp} value={form.horas_operacion} onChange={e => setForm(p => ({ ...p, horas_operacion: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="generador-acumuladas" style={lbl}>Horas acumuladas</label>
              <input id="generador-acumuladas" type="number" inputMode="decimal" step="0.01" min="0" style={inp} value={form.horas_acumuladas} onChange={e => setForm(p => ({ ...p, horas_acumuladas: e.target.value }))} />
              {horometro?.horas_acumuladas != null && (
                <div style={ayuda}>Última: {horometro.horas_acumuladas} h ({horometro.fecha})</div>
              )}
              {horometroAtras && (
                <div role="alert" style={{ fontSize: 11, color: 'var(--at-warning-strong, var(--at-warning))', background: 'var(--at-warning-tint)', borderRadius: 6, padding: '4px 8px', marginTop: 4 }}>
                  Es menor que la última lectura del horómetro. ¿Se cambió el horómetro?
                </div>
              )}
            </div>
            <div>
              <label htmlFor="generador-estado" style={lbl}>Estado</label>
              <select id="generador-estado" style={inp} value={form.estado} onChange={e => setForm(p => ({ ...p, estado: e.target.value as EstadoGenerador }))}>
                {ESTADOS.map(e => <option key={e.value} value={e.value}>{e.icon} {e.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="generador-voltaje" style={lbl}>Voltaje (V)</label>
              <input id="generador-voltaje" type="number" inputMode="decimal" step="0.01" min="0" style={inp} value={form.voltaje} onChange={e => setForm(p => ({ ...p, voltaje: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="generador-frecuencia" style={lbl}>Frecuencia (Hz)</label>
              <input id="generador-frecuencia" type="number" inputMode="decimal" step="0.01" min="0" style={inp} value={form.frecuencia} onChange={e => setForm(p => ({ ...p, frecuencia: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="generador-operador" style={lbl}>Operador</label>
              <input id="generador-operador" style={inp} value={form.operador} onChange={e => setForm(p => ({ ...p, operador: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="generador-empresa" style={lbl}>Empresa de servicio</label>
              <input id="generador-empresa" style={inp} value={form.empresa_servicio} onChange={e => setForm(p => ({ ...p, empresa_servicio: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="generador-costo" style={lbl}>Costo ({moneda})</label>
              <input id="generador-costo" type="number" inputMode="decimal" step="0.01" min="0" style={inp} value={form.costo} onChange={e => setForm(p => ({ ...p, costo: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="generador-proximo" style={lbl}>Próximo mantenimiento</label>
              <input id="generador-proximo" type="date" min={form.fecha || undefined} style={inp} value={form.proximo_mantenimiento} onChange={e => setForm(p => ({ ...p, proximo_mantenimiento: e.target.value }))} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="generador-observaciones" style={lbl}>Observaciones</label>
              <textarea id="generador-observaciones" rows={2} style={{ ...inp, fontFamily: 'inherit', resize: 'vertical' }} value={form.observaciones} onChange={e => setForm(p => ({ ...p, observaciones: e.target.value }))} />
            </div>
          </form>
        </EditModal>
      )}

      {/* Detalle del registro en ventana */}
      {detalle && (
        <EditModal
          title={`⚡ ${detalle.generador}`}
          subtitle={
            <span style={{ display: 'inline-flex', gap: '4px 8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span>{tipoDe(detalle.tipo)?.icon} {tipoDe(detalle.tipo)?.label ?? detalle.tipo} · {detalle.fecha}</span>
              <EstadoBadge estado={detalle.estado} />
            </span>
          }
          maxWidth="480px"
          fullScreenOnMobile
          onClose={() => setDetalleId(null)}
          footer={<Button variant="secondary" onClick={() => setDetalleId(null)}>Cerrar</Button>}
        >
          <RegistroDetalle registro={detalle} dinero={dinero} />
        </EditModal>
      )}

      {/* Historial: en el teléfono cada registro es una tarjeta; tocarlo abre
          su detalle y «Ver» es el camino de teclado. */}
      <DataTable<ControlGenerador>
        data={lista}
        rowKey="id"
        pageSize={30}
        mobileCardLayout
        defaultSort={{ key: 'fecha', direction: 'desc' }}
        emptyState={{ icon: '⚡', title: 'Sin registros' }}
        rowStyle={(r) => r.tipo === 'falla' ? { background: 'var(--at-danger-tint)' } : {}}
        onRowClick={(r) => setDetalleId(r.id)}
        columns={[
          { key: 'generador', header: 'Generador', sortable: true,
            render: (r) => <span style={{ fontWeight: 600 }}>⚡ {r.generador}</span> },
          { key: 'tipo', header: 'Tipo', sortable: true,
            accessor: (r) => tipoDe(r.tipo)?.label ?? r.tipo,
            render: (r) => {
              const tipo = tipoDe(r.tipo)
              return <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 6, background: tipo && tint(tipo.color, 12), color: tipo?.color, whiteSpace: 'nowrap' }}>{tipo?.icon} {tipo?.label ?? r.tipo}</span>
            } },
          { key: 'fecha', header: 'Fecha', sortable: true,
            accessor: (r) => `${r.fecha} ${r.created_at ?? ''}`,
            render: (r) => <span style={{ whiteSpace: 'nowrap' }}>{r.fecha}</span> },
          { key: 'nivel_combustible_pct', header: 'Combustible', align: 'right',
            render: (r) => r.nivel_combustible_pct != null
              ? <span style={{ fontWeight: 700, color: nivelCombColor(r.nivel_combustible_pct) }}>{r.nivel_combustible_pct}%</span>
              : <span style={{ color: 'var(--at-ink-3)' }}>—</span> },
          { key: 'horas_operacion', header: 'Horas', align: 'right',
            render: (r) => r.horas_operacion != null ? `${r.horas_operacion}h` : <span style={{ color: 'var(--at-ink-3)' }}>—</span> },
          { key: 'voltaje', header: 'Voltaje', align: 'right', hideOnMobile: true,
            render: (r) => r.voltaje != null ? <span style={{ color: 'var(--at-accent)' }}>{r.voltaje}V</span> : <span style={{ color: 'var(--at-ink-3)' }}>—</span> },
          { key: 'estado', header: 'Estado', sortable: true,
            accessor: (r) => estadoDe(r.estado)?.label ?? r.estado,
            render: (r) => <EstadoBadge estado={r.estado} /> },
          { key: 'ver', header: '', align: 'right',
            render: (r) => (
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                {r.observaciones && <span aria-hidden="true" style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>📝</span>}
                <Button size="sm" variant="secondary" onClick={() => setDetalleId(r.id)} aria-label={`Ver registro de ${r.generador} del ${r.fecha}`}>Ver</Button>
              </span>
            ) },
        ] satisfies DataTableColumn<ControlGenerador>[]}
      />
    </div>
  )
}

/** Detalle de solo lectura de un registro de generador. */
function RegistroDetalle({ registro: r, dinero }: { registro: ControlGenerador; dinero: (v: number) => string }) {
  const fila = (label: string, valor: ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '7px 0', borderBottom: '1px solid var(--at-chip)', fontSize: 14 }}>
      <span style={{ color: 'var(--at-ink-3)' }}>{label}</span>
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{valor}</span>
    </div>
  )
  const vencido = !!r.proximo_mantenimiento && esFechaCalendarioVencida(r.proximo_mantenimiento)
  return (
    <div>
      {fila('Combustible', r.nivel_combustible_pct != null
        ? <span><strong style={{ color: nivelCombColor(r.nivel_combustible_pct) }}>{r.nivel_combustible_pct}%</strong>{r.nivel_combustible_pct < 25 && <span style={{ display: 'block', fontSize: 12, color: 'var(--at-danger)' }}>Combustible bajo</span>}</span>
        : '—')}
      {fila('Horas de operación', r.horas_operacion != null ? `${r.horas_operacion} h` : '—')}
      {fila('Horas acumuladas', r.horas_acumuladas != null ? `${r.horas_acumuladas} h` : '—')}
      {fila('Voltaje', r.voltaje != null ? `${r.voltaje} V` : '—')}
      {fila('Frecuencia', r.frecuencia != null ? `${r.frecuencia} Hz` : '—')}
      {fila('Operador', r.operador || '—')}
      {fila('Empresa de servicio', r.empresa_servicio || '—')}
      {fila('Costo', r.costo != null ? <strong style={{ color: 'var(--at-success)' }}>{dinero(r.costo)}</strong> : '—')}
      {fila('Próximo mantenimiento', r.proximo_mantenimiento
        ? <strong style={{ color: vencido ? 'var(--at-danger)' : 'var(--at-warning)' }}>{r.proximo_mantenimiento}{vencido ? ' · vencido' : ''}</strong>
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
