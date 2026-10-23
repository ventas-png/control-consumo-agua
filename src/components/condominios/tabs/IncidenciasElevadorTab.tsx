import { hoyLocalISO, esFechaCalendarioVencida, formatNumber } from '../../../lib/format'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { createCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { notify } from '../../shared/Dialog'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { IncidenciaElevador, TipoIncidenciaElevador, EstadoIncidenciaElevador } from '../../../types'

interface Props {
  registros: IncidenciaElevador[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPOS: { value: TipoIncidenciaElevador; label: string; icon: string; color: string }[] = [
  { value: 'falla',                    label: 'Falla',              icon: '⚠️', color: 'var(--at-danger)' },
  { value: 'mantenimiento_preventivo', label: 'Mant. preventivo',  icon: '🔧', color: 'var(--at-accent)' },
  { value: 'mantenimiento_correctivo', label: 'Mant. correctivo',  icon: '🛠️', color: 'var(--at-warning)' },
  { value: 'inspeccion_legal',         label: 'Inspección legal',  icon: '🏛️', color: 'var(--at-success)' },
  { value: 'otro',                     label: 'Otro',              icon: '📋', color: 'var(--at-ink-3)' },
]

const ESTADOS: { value: EstadoIncidenciaElevador; label: string; color: string; bg: string }[] = [
  { value: 'reportado',            label: 'Reportado',           color: 'var(--at-accent)', bg: 'var(--at-accent-tint)' },
  { value: 'en_atencion',          label: 'En atención',         color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
  { value: 'resuelto',             label: 'Resuelto',            color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  { value: 'requiere_seguimiento', label: 'Req. seguimiento',    color: 'var(--at-danger)', bg: 'var(--at-danger-tint)' },
]

/**
 * Siguiente paso de una incidencia. «Requiere seguimiento» también se
 * resuelve: antes quedaba fuera del flujo y su botón «Resolver» no hacía nada.
 */
const SIGUIENTE: Partial<Record<EstadoIncidenciaElevador, EstadoIncidenciaElevador>> = {
  reportado: 'en_atencion',
  en_atencion: 'resuelto',
  requiere_seguimiento: 'resuelto',
}

const formVacio = () => ({
  elevador: 'Elevador 1',
  tipo: 'falla' as TipoIncidenciaElevador,
  descripcion: '',
  fecha: hoyLocalISO(),
  hora_inicio: '', hora_fin: '',
  empresa_servicio: '', tecnico: '',
  estado: 'reportado' as EstadoIncidenciaElevador,
  costo: '', proxima_inspeccion: '', observaciones: '',
})

const tipoDe = (t: TipoIncidenciaElevador) => TIPOS.find(x => x.value === t)
const estadoDe = (e: EstadoIncidenciaElevador) => ESTADOS.find(x => x.value === e)

function duracion(ini: string | null | undefined, fin: string | null | undefined): string | null {
  if (!ini || !fin) return null
  const [ih, im] = ini.split(':').map(Number)
  const [fh, fm] = fin.split(':').map(Number)
  const minutos = (fh * 60 + fm) - (ih * 60 + im)
  if (minutos < 0) return null
  const h = Math.floor(minutos / 60)
  const m = minutos % 60
  return h > 0 ? `${h}h ${m}min` : `${m}min`
}

const recortar = (s: string, n: number) => s.length > n ? s.slice(0, n) + '…' : s

function EstadoBadge({ estado }: { estado: EstadoIncidenciaElevador }) {
  const est = estadoDe(estado)
  return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: est?.bg, color: est?.color, fontWeight: 600, whiteSpace: 'nowrap' }}>{est?.label ?? estado}</span>
}

export default function IncidenciasElevadorTab({ registros, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [detalleId, setDetalleId] = useState<string | null>(null)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [avanzando, setAvanzando] = useState(false)
  const [filtroElevador, setFiltroElevador] = useState('')
  const [filtroTipo, setFiltroTipo] = useState<TipoIncidenciaElevador | ''>('')
  const [filtroEstado, setFiltroEstado] = useState<EstadoIncidenciaElevador | ''>('')

  const [form, setForm] = useState(formVacio)

  const elevadores = [...new Set(registros.map(r => r.elevador))].sort()

  const lista = registros.filter(r =>
    (filtroElevador === '' || r.elevador === filtroElevador) &&
    (filtroTipo === '' || r.tipo === filtroTipo) &&
    (filtroEstado === '' || r.estado === filtroEstado)
  )

  const esFallaAbierta = (r: IncidenciaElevador) => r.tipo === 'falla' && r.estado !== 'resuelto'
  const fallas = registros.filter(esFallaAbierta).length

  // Próxima inspección de cada elevador: la más lejana que tenga programada.
  // Antes se ordenaban todas las fechas, también las ya pasadas, y con el
  // tiempo las viejas tapaban a las que vienen.
  const proxInspecciones = Object.values(registros.reduce<Record<string, IncidenciaElevador>>((acc, r) => {
    if (r.proxima_inspeccion && (!acc[r.elevador] || r.proxima_inspeccion > acc[r.elevador].proxima_inspeccion!)) acc[r.elevador] = r
    return acc
  }, {})).sort((a, b) => a.proxima_inspeccion!.localeCompare(b.proxima_inspeccion!))

  const dinero = (v: number) => `${moneda}\u00a0${formatNumber(v, 2)}`

  function abrirForm() {
    setDetalleId(null)
    setMostrarForm(true)
  }

  // No se cierra a mitad del guardado: cerrar ahí escondería el error.
  const cerrarForm = () => { if (!saving) setMostrarForm(false) }

  async function guardar() {
    if (saving) return
    if (!form.elevador.trim() || !form.descripcion.trim()) {
      notify({ variant: 'warning', title: 'Faltan datos', text: 'Elevador y descripción son obligatorios' }); return
    }
    setSaving(true)
    const { error } = await createCondominioRow('incidencias_elevador', {
      company_id: companyId, project_id: proyectoId,
      elevador: form.elevador.trim(), tipo: form.tipo,
      descripcion: form.descripcion.trim(), fecha: form.fecha,
      hora_inicio: form.hora_inicio || null,
      hora_fin: form.hora_fin || null,
      empresa_servicio: form.empresa_servicio.trim() || null,
      tecnico: form.tecnico.trim() || null,
      estado: form.estado,
      costo: form.costo ? parseFloat(form.costo) : null,
      proxima_inspeccion: form.proxima_inspeccion || null,
      observaciones: form.observaciones.trim() || null,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setForm(formVacio())
    setMostrarForm(false)
    onRefresh()
  }

  async function avanzarEstado(r: IncidenciaElevador) {
    const next = SIGUIENTE[r.estado]
    if (!next || avanzando) return
    setAvanzando(true)
    const { error } = await updateCondominioRow('incidencias_elevador', r.id, { estado: next })
    setAvanzando(false)
    // Antes el error se ignoraba: el botón no hacía nada y no decía por qué.
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13, boxSizing: 'border-box', minWidth: 0, background: 'var(--at-surface)', color: 'var(--at-ink)' }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

  const durForm = duracion(form.hora_inicio, form.hora_fin)
  const finAntes = !!form.hora_inicio && !!form.hora_fin && !durForm

  // Se lee el registro vigente, no una copia (antes el panel guardaba la fila
  // y había que parcharla a mano al avanzar el estado).
  const detalle = detalleId ? registros.find(r => r.id === detalleId) ?? null : null

  return (
    <div style={{ padding: 16 }}>
      {fallas > 0 && (
        <div style={{ background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--at-danger)' }}>
          ⚠️ <strong>{fallas} falla{fallas > 1 ? 's' : ''} sin resolver</strong>
        </div>
      )}

      {/* Próxima inspección de cada elevador: cada una abre su registro */}
      {proxInspecciones.length > 0 && (
        <div style={{ background: 'var(--at-accent-tint)', borderRadius: 10, padding: '10px 14px', marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--at-accent)', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase' }}>🏛️ Próximas inspecciones</div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>
            {proxInspecciones.map(r => {
              const vencida = esFechaCalendarioVencida(r.proxima_inspeccion)
              return (
                <li key={r.elevador}>
                  <button type="button" onClick={() => setDetalleId(r.id)} className="cond-barra-fila"
                    style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', borderRadius: 6, padding: '4px 6px', font: 'inherit', fontSize: 13, color: 'var(--at-ink-2)', cursor: 'pointer' }}>
                    🛗 {r.elevador} · <strong style={{ color: vencida ? 'var(--at-danger)' : undefined }}>{r.proxima_inspeccion}</strong>
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
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', flex: '1 1 320px' }}>
          <select aria-label="Filtrar por elevador" style={{ ...inp, width: 'auto', flex: '1 1 170px' }} value={filtroElevador} onChange={e => setFiltroElevador(e.target.value)}>
            <option value="">Todos los elevadores</option>
            {elevadores.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
          <select aria-label="Filtrar por tipo" style={{ ...inp, width: 'auto', flex: '1 1 170px' }} value={filtroTipo} onChange={e => setFiltroTipo(e.target.value as TipoIncidenciaElevador | '')}>
            <option value="">Todos los tipos</option>
            {TIPOS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
          </select>
          <select aria-label="Filtrar por estado" style={{ ...inp, width: 'auto', flex: '1 1 170px' }} value={filtroEstado} onChange={e => setFiltroEstado(e.target.value as EstadoIncidenciaElevador | '')}>
            <option value="">Todos los estados</option>
            {ESTADOS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
          </select>
          <span style={{ fontSize: 13, color: 'var(--at-ink-3)' }}>{lista.length} registros</span>
        </div>
        {canCreate && (
          <Button onClick={abrirForm}>+ Nueva incidencia</Button>
        )}
      </div>

      {/* Nueva incidencia en ventana (antes, en un panel al lado de una lista
          de 300px fijos: en el teléfono no cabían los dos). */}
      {mostrarForm && (
        <EditModal
          title="🛗 Nueva incidencia de elevador"
          maxWidth="640px"
          fullScreenOnMobile
          onClose={cerrarForm}
          closeOnBackdropClick={!saving}
          closeOnEscape={!saving}
          footer={
            <>
              <Button variant="secondary" onClick={cerrarForm} disabled={saving}>Cancelar</Button>
              <Button type="submit" form="elevador-form" variant="success" loading={saving} loadingText="Guardando…">✅ Registrar</Button>
            </>
          }
        >
          <form
            id="elevador-form"
            onSubmit={e => { e.preventDefault(); void guardar() }}
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: 12, alignItems: 'start' }}
          >
            <div>
              <label htmlFor="elevador-nombre" style={lbl}>Elevador *</label>
              {/* Sugiere los elevadores ya registrados: «elevador 1» y «Elevador 1» eran dos. */}
              <input id="elevador-nombre" list="elevador-nombres" style={inp} placeholder="Elevador 1, Torre A…" value={form.elevador} onChange={e => setForm(p => ({ ...p, elevador: e.target.value }))} />
              <datalist id="elevador-nombres">
                {elevadores.map(e => <option key={e} value={e} />)}
              </datalist>
            </div>
            <div>
              <label htmlFor="elevador-tipo" style={lbl}>Tipo</label>
              <select id="elevador-tipo" style={inp} value={form.tipo} onChange={e => setForm(p => ({ ...p, tipo: e.target.value as TipoIncidenciaElevador }))}>
                {TIPOS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="elevador-estado" style={lbl}>Estado</label>
              <select id="elevador-estado" style={inp} value={form.estado} onChange={e => setForm(p => ({ ...p, estado: e.target.value as EstadoIncidenciaElevador }))}>
                {ESTADOS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="elevador-descripcion" style={lbl}>Descripción *</label>
              <textarea id="elevador-descripcion" rows={3} style={{ ...inp, fontFamily: 'inherit', resize: 'vertical' }} value={form.descripcion} onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="elevador-fecha" style={lbl}>Fecha</label>
              <input id="elevador-fecha" type="date" style={inp} value={form.fecha} onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="elevador-hora-inicio" style={lbl}>Hora inicio</label>
              <input id="elevador-hora-inicio" type="time" style={inp} value={form.hora_inicio} onChange={e => setForm(p => ({ ...p, hora_inicio: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="elevador-hora-fin" style={lbl}>Hora fin</label>
              <input id="elevador-hora-fin" type="time" style={inp} value={form.hora_fin} onChange={e => setForm(p => ({ ...p, hora_fin: e.target.value }))} />
              {durForm && <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 3 }}>Duración: {durForm}</div>}
              {finAntes && (
                <div role="alert" style={{ fontSize: 11, color: 'var(--at-warning-strong, var(--at-warning))', background: 'var(--at-warning-tint)', borderRadius: 6, padding: '4px 8px', marginTop: 4 }}>
                  La hora fin es anterior a la de inicio.
                </div>
              )}
            </div>
            <div>
              <label htmlFor="elevador-empresa" style={lbl}>Empresa de servicio</label>
              <input id="elevador-empresa" style={inp} value={form.empresa_servicio} onChange={e => setForm(p => ({ ...p, empresa_servicio: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="elevador-tecnico" style={lbl}>Técnico</label>
              <input id="elevador-tecnico" style={inp} value={form.tecnico} onChange={e => setForm(p => ({ ...p, tecnico: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="elevador-costo" style={lbl}>Costo ({moneda})</label>
              <input id="elevador-costo" type="number" inputMode="decimal" min="0" step="0.01" style={inp} value={form.costo} onChange={e => setForm(p => ({ ...p, costo: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="elevador-proxima" style={lbl}>Próxima inspección</label>
              <input id="elevador-proxima" type="date" min={form.fecha || undefined} style={inp} value={form.proxima_inspeccion} onChange={e => setForm(p => ({ ...p, proxima_inspeccion: e.target.value }))} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="elevador-observaciones" style={lbl}>Observaciones</label>
              <textarea id="elevador-observaciones" rows={2} style={{ ...inp, fontFamily: 'inherit', resize: 'vertical' }} value={form.observaciones} onChange={e => setForm(p => ({ ...p, observaciones: e.target.value }))} />
            </div>
          </form>
        </EditModal>
      )}

      {/* Detalle de la incidencia en ventana */}
      {detalle && (() => {
        const tipo = tipoDe(detalle.tipo)
        const dur = duracion(detalle.hora_inicio, detalle.hora_fin)
        const siguiente = SIGUIENTE[detalle.estado]
        return (
          <EditModal
            title={`🛗 ${detalle.elevador}`}
            subtitle={
              <span style={{ display: 'inline-flex', gap: '4px 8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ color: tipo?.color, fontWeight: 600 }}>{tipo?.icon} {tipo?.label ?? detalle.tipo}</span>
                <span>
                  {detalle.fecha}
                  {detalle.hora_inicio && ` · ${detalle.hora_inicio.slice(0, 5)}`}
                  {detalle.hora_fin && `–${detalle.hora_fin.slice(0, 5)}`}
                  {dur && ` · ${dur}`}
                </span>
                <EstadoBadge estado={detalle.estado} />
              </span>
            }
            maxWidth="520px"
            fullScreenOnMobile
            onClose={() => setDetalleId(null)}
            footer={
              <>
                {canEdit && siguiente && (
                  <Button variant="success" onClick={() => void avanzarEstado(detalle)} loading={avanzando}>
                    ▶ {siguiente === 'en_atencion' ? 'Atender' : 'Resolver'}
                  </Button>
                )}
                <Button variant="secondary" onClick={() => setDetalleId(null)}>Cerrar</Button>
              </>
            }
          >
            <IncidenciaDetalle registro={detalle} dinero={dinero} />
          </EditModal>
        )
      })()}

      {/* Historial: en el teléfono cada incidencia es una tarjeta; tocarla abre
          su detalle y «Ver» es el camino de teclado. */}
      <DataTable<IncidenciaElevador>
        data={lista}
        rowKey="id"
        pageSize={30}
        mobileCardLayout
        defaultSort={{ key: 'fecha', direction: 'desc' }}
        emptyState={{ icon: '🛗', title: 'Sin registros' }}
        rowStyle={(r) => esFallaAbierta(r) ? { background: 'var(--at-danger-tint)' } : {}}
        onRowClick={(r) => setDetalleId(r.id)}
        columns={[
          { key: 'elevador', header: 'Elevador', sortable: true,
            render: (r) => <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>🛗 {r.elevador}</span> },
          { key: 'tipo', header: 'Tipo', sortable: true,
            accessor: (r) => tipoDe(r.tipo)?.label ?? r.tipo,
            render: (r) => {
              const tipo = tipoDe(r.tipo)
              return <span style={{ color: tipo?.color, fontWeight: 600, whiteSpace: 'nowrap' }}>{tipo?.icon} {tipo?.label ?? r.tipo}</span>
            } },
          { key: 'descripcion', header: 'Descripción',
            render: (r) => <span style={{ color: 'var(--at-ink-2)' }}>{recortar(r.descripcion, 55)}</span> },
          { key: 'fecha', header: 'Fecha', sortable: true,
            accessor: (r) => `${r.fecha} ${r.hora_inicio ?? ''}`,
            render: (r) => <span style={{ whiteSpace: 'nowrap' }}>{r.fecha}</span> },
          { key: 'empresa_servicio', header: 'Empresa', sortable: true, hideOnMobile: true,
            accessor: (r) => r.empresa_servicio ?? '',
            render: (r) => <span style={{ color: 'var(--at-ink-3)' }}>{r.empresa_servicio || '—'}</span> },
          { key: 'estado', header: 'Estado', sortable: true,
            accessor: (r) => estadoDe(r.estado)?.label ?? r.estado,
            render: (r) => <EstadoBadge estado={r.estado} /> },
          { key: 'ver', header: '', align: 'right',
            render: (r) => (
              <span onClick={e => e.stopPropagation()}>
                <Button size="sm" variant="secondary" onClick={() => setDetalleId(r.id)} aria-label={`Ver incidencia de ${r.elevador} del ${r.fecha}`}>Ver</Button>
              </span>
            ) },
        ] satisfies DataTableColumn<IncidenciaElevador>[]}
      />
    </div>
  )
}

/** Detalle de solo lectura de una incidencia de elevador. */
function IncidenciaDetalle({ registro: r, dinero }: { registro: IncidenciaElevador; dinero: (v: number) => string }) {
  const fila = (label: string, valor: ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '7px 0', borderBottom: '1px solid var(--at-chip)', fontSize: 14 }}>
      <span style={{ color: 'var(--at-ink-3)' }}>{label}</span>
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{valor}</span>
    </div>
  )
  const vencida = !!r.proxima_inspeccion && esFechaCalendarioVencida(r.proxima_inspeccion)
  return (
    <div>
      <p style={{ margin: '0 0 14px', whiteSpace: 'pre-wrap', fontSize: 14, color: 'var(--at-ink-2)', lineHeight: 1.6 }}>{r.descripcion}</p>
      {fila('Empresa de servicio', r.empresa_servicio || '—')}
      {fila('Técnico', r.tecnico || '—')}
      {fila('Costo', r.costo != null ? <strong style={{ color: 'var(--at-success)' }}>{dinero(r.costo)}</strong> : '—')}
      {fila('Próxima inspección', r.proxima_inspeccion
        ? <strong style={{ color: vencida ? 'var(--at-danger)' : 'var(--at-accent)' }}>{r.proxima_inspeccion}{vencida ? ' · vencida' : ''}</strong>
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
