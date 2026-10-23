import { hoyLocalISO, diasHastaFechaCalendario, formatNumber, sumarDiasCalendario } from '../../../lib/format'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { createCondominioRow } from '../../../domain/condominios/tabMutations'
import { planPorTipo, resumenProyeccion, DIAS_PROYECCION, type PlanTipo } from '../../../domain/condominios/plagas'
import { notify } from '../../shared/Dialog'
import { tint } from '../../shared/statusTone'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { ControlPlagas, TipoControlPlagas, ResultadoControlPlagas } from '../../../types'

interface Props {
  registros: ControlPlagas[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit?: boolean
  onRefresh: () => void
}

const TIPOS: { value: TipoControlPlagas; label: string; icon: string }[] = [
  { value: 'fumigacion',  label: 'Fumigación',   icon: '💨' },
  { value: 'inspeccion',  label: 'Inspección',   icon: '🔍' },
  { value: 'tratamiento', label: 'Tratamiento',  icon: '🧪' },
  { value: 'preventivo',  label: 'Preventivo',   icon: '🛡️' },
]

const RESULTADOS: { value: ResultadoControlPlagas; label: string; color: string }[] = [
  { value: 'satisfactorio',        label: 'Satisfactorio',        color: 'var(--at-success)' },
  { value: 'con_observaciones',    label: 'Con observaciones',    color: 'var(--at-warning)' },
  { value: 'requiere_seguimiento', label: 'Requiere seguimiento', color: 'var(--at-danger)' },
  { value: 'no_realizado',         label: 'No realizado',         color: 'var(--at-ink-3)' },
]

const AREAS_COMUNES = ['Lobby', 'Piscina', 'Gimnasio', 'Parqueo', 'Jardines', 'Azotea', 'Cuarto de basura', 'Cuarto de máquinas', 'Pasillos', 'Escaleras', 'Sótano']

const tipoDe = (t: TipoControlPlagas) => TIPOS.find(x => x.value === t)
const resultadoDe = (r: ResultadoControlPlagas) => RESULTADOS.find(x => x.value === r)

/** La base guarda la hora con segundos (08:00:00); se muestra 08:00. */
const hora = (h?: string | null) => (h ? h.slice(0, 5) : '')

/** «en 5 días», «hoy», «atrasada 3 días». Días de calendario locales. */
function cuandoToca(dias: number): string {
  if (dias < 0) return `atrasada ${-dias} día${dias === -1 ? '' : 's'}`
  if (dias === 0) return 'hoy'
  return `en ${dias} día${dias === 1 ? '' : 's'}`
}
const colorPlazo = (dias: number) => dias <= 7 ? 'var(--at-danger)' : dias <= 30 ? 'var(--at-warning-strong)' : 'var(--at-accent)'

function ResultadoBadge({ resultado }: { resultado: ResultadoControlPlagas }) {
  const res = resultadoDe(resultado)
  return <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 6, background: res && tint(res.color, 12), color: res?.color, whiteSpace: 'nowrap' }}>{res?.label ?? resultado}</span>
}

/** Plazos rápidos para la próxima visita, en días desde la fecha de la visita. */
const PLAZOS = [15, 30, 60, 90]

const tarjeta: CSSProperties = { background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 10, padding: '10px 14px', textAlign: 'left', font: 'inherit', color: 'inherit', minWidth: 0 }

const formVacio = () => ({
  tipo: 'fumigacion' as TipoControlPlagas,
  empresa: '', tecnico: '', productos: '',
  fecha: hoyLocalISO(),
  hora_inicio: '', hora_fin: '',
  resultado: 'satisfactorio' as ResultadoControlPlagas,
  proxima_visita: '', costo: '', observaciones: '',
  areas: [] as string[],
})
type Form = ReturnType<typeof formVacio>

export default function ControlPlagasTab({ registros, proyectoId, companyId, moneda, canCreate, onRefresh }: Props) {
  const [detalleId, setDetalleId] = useState<string | null>(null)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroTipo, setFiltroTipo] = useState<TipoControlPlagas | ''>('')
  const [filtroResultado, setFiltroResultado] = useState<ResultadoControlPlagas | ''>('')
  const [areaCustom, setAreaCustom] = useState('')
  const [form, setForm] = useState(formVacio)
  // Mientras no se toque, la próxima visita sigue a la sugerida.
  const [proximaManual, setProximaManual] = useState(false)

  const lista = registros.filter(r =>
    (filtroTipo === '' || r.tipo === filtroTipo) &&
    (filtroResultado === '' || r.resultado === filtroResultado)
  )

  // Cada tipo lleva su calendario: la próxima fumigación es la que dejó
  // programada la última fumigación (o, si no dejó, la probable según su
  // frecuencia). Antes había una sola próxima visita, la de la última visita
  // de cualquier tipo: una inspección sin fecha «borraba» la fumigación.
  const hoy = hoyLocalISO()
  const planes = planPorTipo(registros, hoy)
  const planDe = (tipo: TipoControlPlagas) => planes.find(p => p.tipo === tipo) ?? null
  const esVigente = (r: ControlPlagas) => planDe(r.tipo)?.ultima.id === r.id
  const proyeccion = resumenProyeccion(planes, hoy)

  const empresas = [...new Set(registros.map(r => r.empresa?.trim()).filter((e): e is string => !!e))].sort()

  function toggleArea(area: string) {
    setForm(p => ({
      ...p,
      areas: p.areas.includes(area) ? p.areas.filter(a => a !== area) : [...p.areas, area],
    }))
  }

  function agregarAreaCustom() {
    const a = areaCustom.trim()
    if (!a) return
    if (!form.areas.includes(a)) setForm(p => ({ ...p, areas: [...p.areas, a] }))
    setAreaCustom('')
  }

  // Las áreas propias sólo se listaban como texto: no se podían quitar.
  const areasOfrecidas = [...AREAS_COMUNES, ...form.areas.filter(a => !AREAS_COMUNES.includes(a))]

  /** La fecha más la frecuencia del tipo. Una visita no realizada no se sugiere: hay que reponerla. */
  function sugerida(f: Form): string | null {
    if (f.resultado === 'no_realizado') return null
    const dias = planDe(f.tipo)?.intervaloDias
    return dias ? sumarDiasCalendario(f.fecha, dias) : null
  }

  /** Cambia tipo, fecha o resultado y, si la próxima visita no se ha tocado, la recalcula. */
  function cambiar(cambios: Partial<Form>) {
    setForm(p => {
      const n = { ...p, ...cambios }
      return proximaManual ? n : { ...n, proxima_visita: sugerida(n) ?? '' }
    })
  }

  function fijarProxima(valor: string) {
    setProximaManual(true)
    setForm(p => ({ ...p, proxima_visita: valor }))
  }

  function abrirForm() {
    cambiar({ fecha: hoyLocalISO() })
    setDetalleId(null)
    setMostrarForm(true)
  }

  // No se cierra a mitad del guardado: cerrar ahí escondería el error.
  const cerrarForm = () => { if (!saving) setMostrarForm(false) }

  async function guardar() {
    if (saving) return
    if (!form.fecha || form.areas.length === 0) {
      notify({ variant: 'warning', title: 'Faltan datos', text: 'Fecha y al menos un área son obligatorios' }); return
    }
    setSaving(true)
    const { error } = await createCondominioRow('control_plagas', {
      company_id: companyId, project_id: proyectoId,
      tipo: form.tipo, empresa: form.empresa.trim() || null,
      tecnico: form.tecnico.trim() || null, areas: form.areas,
      productos: form.productos.trim() || null, fecha: form.fecha,
      hora_inicio: form.hora_inicio || null, hora_fin: form.hora_fin || null,
      resultado: form.resultado,
      proxima_visita: form.proxima_visita || null,
      costo: form.costo ? parseFloat(form.costo) : null,
      observaciones: form.observaciones.trim() || null,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setForm(formVacio())
    setProximaManual(false)
    setAreaCustom('')
    setMostrarForm(false)
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13, boxSizing: 'border-box', minWidth: 0, background: 'var(--at-surface)', color: 'var(--at-ink)' }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

  // Montos con el formato regional de la app (antes, el del navegador).
  const dinero = (v: number) => `${moneda}\u00a0${formatNumber(v, 2)}`

  // Se lee el registro vigente, no una copia.
  const detalle = detalleId ? registros.find(r => r.id === detalleId) ?? null : null

  const textoProyeccion = proyeccion.visitas === 0
    ? `Sin visitas previstas en los próximos ${DIAS_PROYECCION} días`
    : `Próximos ${DIAS_PROYECCION} días: ${proyeccion.visitas} visita${proyeccion.visitas === 1 ? '' : 's'}`
      + (proyeccion.costo > 0 ? ` · ≈\u00a0${dinero(proyeccion.costo)}` : '')
      + (proyeccion.sinCosto > 0 ? ` (${proyeccion.sinCosto} sin costo de referencia)` : '')

  const nombreTipo = tipoDe(form.tipo)?.label ?? form.tipo
  const sugerenciaForm = sugerida(form)
  const ayudaProxima = proximaManual
    ? null
    : form.resultado === 'no_realizado'
      ? 'No se realizó: programa cuándo se repone.'
      : sugerenciaForm
        ? `Sugerida: cada ~${planDe(form.tipo)?.intervaloDias} días, según el historial de ${nombreTipo}.`
        : `Sin historial de ${nombreTipo} para sugerir: elige un plazo.`

  return (
    <div style={{ padding: 16 }}>
      {/* Próxima visita de cada tipo (programada o probable) y la proyección;
          cada tarjeta abre la última visita de su tipo. */}
      {planes.length > 0 && (
        <section aria-labelledby="plagas-proximas" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '2px 12px', flexWrap: 'wrap', marginBottom: 8 }}>
            <h3 id="plagas-proximas" style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--at-ink)' }}>⏰ Próximas visitas por tipo</h3>
            <span style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>{textoProyeccion}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 12 }}>
            {planes.map(p => <TarjetaTipo key={p.tipo} plan={p} onAbrir={() => setDetalleId(p.ultima.id)} />)}
          </div>
        </section>
      )}

      {/* Filtros + botón */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', flex: '1 1 260px' }}>
          <select aria-label="Filtrar por tipo" style={{ ...inp, width: 'auto', flex: '1 1 170px' }} value={filtroTipo} onChange={e => setFiltroTipo(e.target.value as TipoControlPlagas | '')}>
            <option value="">Todos los tipos</option>
            {TIPOS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
          </select>
          <select aria-label="Filtrar por resultado" style={{ ...inp, width: 'auto', flex: '1 1 170px' }} value={filtroResultado} onChange={e => setFiltroResultado(e.target.value as ResultadoControlPlagas | '')}>
            <option value="">Todos los resultados</option>
            {RESULTADOS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <span style={{ fontSize: 13, color: 'var(--at-ink-3)' }}>{lista.length} registros</span>
        </div>
        {canCreate && (
          <Button onClick={abrirForm}>+ Nueva visita</Button>
        )}
      </div>

      {/* Nueva visita en ventana (antes, en un panel al lado de una lista de
          300px fijos: en el teléfono no cabían los dos). */}
      {mostrarForm && (
        <EditModal
          title="🧪 Nueva visita de control de plagas"
          maxWidth="640px"
          fullScreenOnMobile
          onClose={cerrarForm}
          closeOnBackdropClick={!saving}
          closeOnEscape={!saving}
          footer={
            <>
              <Button variant="secondary" onClick={cerrarForm} disabled={saving}>Cancelar</Button>
              <Button type="submit" form="plagas-form" variant="success" loading={saving} loadingText="Guardando…">✅ Registrar</Button>
            </>
          }
        >
          <form
            id="plagas-form"
            onSubmit={e => { e.preventDefault(); void guardar() }}
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: 12, alignItems: 'start' }}
          >
            <div>
              <label htmlFor="plagas-tipo" style={lbl}>Tipo</label>
              <select id="plagas-tipo" style={inp} value={form.tipo} onChange={e => cambiar({ tipo: e.target.value as TipoControlPlagas })}>
                {TIPOS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="plagas-fecha" style={lbl}>Fecha *</label>
              <input id="plagas-fecha" type="date" style={inp} value={form.fecha} onChange={e => cambiar({ fecha: e.target.value })} />
            </div>
            <div>
              <label htmlFor="plagas-resultado" style={lbl}>Resultado</label>
              <select id="plagas-resultado" style={inp} value={form.resultado} onChange={e => cambiar({ resultado: e.target.value as ResultadoControlPlagas })}>
                {RESULTADOS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="plagas-inicio" style={lbl}>Hora inicio</label>
              <input id="plagas-inicio" type="time" style={inp} value={form.hora_inicio} onChange={e => setForm(p => ({ ...p, hora_inicio: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="plagas-fin" style={lbl}>Hora fin</label>
              <input id="plagas-fin" type="time" style={inp} value={form.hora_fin} onChange={e => setForm(p => ({ ...p, hora_fin: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="plagas-empresa" style={lbl}>Empresa</label>
              <input id="plagas-empresa" list="plagas-empresas" style={inp} placeholder="Nombre de la empresa" value={form.empresa} onChange={e => setForm(p => ({ ...p, empresa: e.target.value }))} />
              <datalist id="plagas-empresas">
                {empresas.map(e => <option key={e} value={e} />)}
              </datalist>
            </div>
            <div>
              <label htmlFor="plagas-tecnico" style={lbl}>Técnico</label>
              <input id="plagas-tecnico" style={inp} value={form.tecnico} onChange={e => setForm(p => ({ ...p, tecnico: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="plagas-costo" style={lbl}>Costo ({moneda})</label>
              <input id="plagas-costo" type="number" inputMode="decimal" min="0" step="0.01" style={inp} value={form.costo} onChange={e => setForm(p => ({ ...p, costo: e.target.value }))} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="plagas-proxima" style={lbl}>Próxima visita</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <input id="plagas-proxima" type="date" min={form.fecha || undefined} style={{ ...inp, flex: '1 1 180px', width: 'auto' }} value={form.proxima_visita}
                  aria-describedby="plagas-proxima-ayuda" onChange={e => fijarProxima(e.target.value)} />
                {/* Los plazos bajan juntos de línea, no uno suelto. */}
                <div style={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>
                  {PLAZOS.map(d => {
                    const fecha = sumarDiasCalendario(form.fecha, d)
                    return (
                      <button key={d} type="button" disabled={!fecha} aria-pressed={!!fecha && form.proxima_visita === fecha}
                        aria-label={`Próxima visita en ${d} días`} onClick={() => fecha && fijarProxima(fecha)}
                        style={{ padding: '6px 9px', borderRadius: 6, border: '1px solid var(--at-line-strong)', fontSize: 12, cursor: fecha ? 'pointer' : 'default',
                          background: fecha && form.proxima_visita === fecha ? 'var(--at-accent)' : 'var(--at-surface)', color: fecha && form.proxima_visita === fecha ? 'white' : 'var(--at-ink-2)' }}>
                        +{d}&nbsp;d
                      </button>
                    )
                  })}
                </div>
              </div>
              <div id="plagas-proxima-ayuda" style={{ fontSize: 11.5, color: 'var(--at-ink-3)', marginTop: 4 }}>
                {ayudaProxima}
                {proximaManual && sugerenciaForm && sugerenciaForm !== form.proxima_visita && (
                  <button type="button" onClick={() => { setProximaManual(false); setForm(p => ({ ...p, proxima_visita: sugerenciaForm })) }}
                    style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'var(--at-accent)', textDecoration: 'underline', cursor: 'pointer' }}>
                    Usar la sugerida ({sugerenciaForm})
                  </button>
                )}
              </div>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="plagas-productos" style={lbl}>Productos utilizados</label>
              <input id="plagas-productos" style={inp} placeholder="Nombre y concentración de productos" value={form.productos} onChange={e => setForm(p => ({ ...p, productos: e.target.value }))} />
            </div>
            <fieldset style={{ gridColumn: '1 / -1', border: 'none', margin: 0, padding: 0, minWidth: 0 }}>
              <legend style={{ ...lbl, padding: 0 }}>Áreas tratadas *</legend>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                {areasOfrecidas.map(a => {
                  const activa = form.areas.includes(a)
                  return (
                    <button key={a} type="button" aria-pressed={activa} onClick={() => toggleArea(a)}
                      style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid', fontSize: 12, cursor: 'pointer', background: activa ? 'var(--at-accent)' : 'var(--at-surface)', color: activa ? 'white' : 'var(--at-ink-2)', borderColor: activa ? 'var(--at-accent)' : 'var(--at-line-strong)' }}>
                      {activa ? '✓ ' : ''}{a}
                    </button>
                  )
                })}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input aria-label="Agregar otra área" style={{ ...inp, flex: 1 }} placeholder="Otra área…" value={areaCustom} onChange={e => setAreaCustom(e.target.value)}
                  // Enter agrega el área (sin esto, dentro del formulario lo registraría).
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); agregarAreaCustom() } }} />
                <Button type="button" variant="secondary" onClick={agregarAreaCustom} disabled={!areaCustom.trim()}>Agregar</Button>
              </div>
            </fieldset>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="plagas-observaciones" style={lbl}>Observaciones</label>
              <textarea id="plagas-observaciones" rows={2} style={{ ...inp, fontFamily: 'inherit', resize: 'vertical' }} value={form.observaciones} onChange={e => setForm(p => ({ ...p, observaciones: e.target.value }))} />
            </div>
          </form>
        </EditModal>
      )}

      {/* Detalle de la visita en ventana */}
      {detalle && (() => {
        const tipo = tipoDe(detalle.tipo)
        return (
          <EditModal
            title={`${tipo?.icon ?? '🧪'} ${tipo?.label ?? detalle.tipo}`}
            subtitle={
              <span style={{ display: 'inline-flex', gap: '4px 8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span>{detalle.fecha}{detalle.hora_inicio ? ` · ${hora(detalle.hora_inicio)}–${hora(detalle.hora_fin) || '?'}` : ''}</span>
                <ResultadoBadge resultado={detalle.resultado} />
              </span>
            }
            maxWidth="520px"
            fullScreenOnMobile
            onClose={() => setDetalleId(null)}
            footer={<Button variant="secondary" onClick={() => setDetalleId(null)}>Cerrar</Button>}
          >
            <VisitaDetalle registro={detalle} vigente={esVigente(detalle)} plan={planDe(detalle.tipo)} dinero={dinero} />
          </EditModal>
        )
      })()}

      {/* Historial: en el teléfono cada visita es una tarjeta; tocarla abre su
          detalle y «Ver» es el camino de teclado. */}
      <DataTable<ControlPlagas>
        data={lista}
        rowKey="id"
        pageSize={30}
        mobileCardLayout
        defaultSort={{ key: 'fecha', direction: 'desc' }}
        emptyState={{ icon: '🧪', title: 'Sin registros' }}
        onRowClick={(r) => setDetalleId(r.id)}
        columns={[
          { key: 'fecha', header: 'Fecha', sortable: true,
            accessor: (r) => `${r.fecha} ${r.created_at ?? ''}`,
            render: (r) => <span style={{ whiteSpace: 'nowrap' }}>{r.fecha}</span> },
          { key: 'tipo', header: 'Tipo', sortable: true,
            accessor: (r) => tipoDe(r.tipo)?.label ?? r.tipo,
            render: (r) => <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{tipoDe(r.tipo)?.icon} {tipoDe(r.tipo)?.label ?? r.tipo}</span> },
          { key: 'areas', header: 'Áreas',
            render: (r) => <span style={{ color: 'var(--at-ink-2)' }}>{r.areas.slice(0, 3).join(', ')}{r.areas.length > 3 ? ` +${r.areas.length - 3}` : ''}</span> },
          { key: 'empresa', header: 'Empresa', sortable: true, hideOnMobile: true,
            accessor: (r) => r.empresa ?? '',
            render: (r) => <span style={{ color: 'var(--at-ink-3)' }}>{r.empresa || '—'}</span> },
          { key: 'proxima_visita', header: 'Próx. visita', sortable: true, hideOnMobile: true,
            accessor: (r) => r.proxima_visita ?? '',
            render: (r) => {
              const plan = planDe(r.tipo)
              if (!r.proxima_visita) {
                // La última de su tipo sin fecha muestra la probable.
                return esVigente(r) && plan?.origen === 'probable'
                  ? <span style={{ whiteSpace: 'nowrap', color: 'var(--at-ink-3)', fontStyle: 'italic' }} title="Probable, según la frecuencia del tipo">≈ {plan.proxima}</span>
                  : <span style={{ color: 'var(--at-ink-3)' }}>—</span>
              }
              // Sólo la próxima vigente (la de la última visita de su tipo) puede estar atrasada.
              const atrasada = esVigente(r) && (diasHastaFechaCalendario(r.proxima_visita) ?? 0) < 0
              return <span style={{ whiteSpace: 'nowrap', color: atrasada ? 'var(--at-danger)' : 'var(--at-ink-3)', fontWeight: atrasada ? 600 : 400 }}>{r.proxima_visita}{atrasada ? ' · atrasada' : ''}</span>
            } },
          { key: 'costo', header: 'Costo', align: 'right', sortable: true, hideOnMobile: true,
            accessor: (r) => r.costo ?? 0,
            render: (r) => r.costo != null ? <span style={{ whiteSpace: 'nowrap' }}>{dinero(r.costo)}</span> : '—' },
          { key: 'resultado', header: 'Resultado', sortable: true,
            accessor: (r) => resultadoDe(r.resultado)?.label ?? r.resultado,
            render: (r) => <ResultadoBadge resultado={r.resultado} /> },
          { key: 'ver', header: '', align: 'right',
            render: (r) => (
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                {r.observaciones && <span aria-hidden="true" style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>📝</span>}
                <Button size="sm" variant="secondary" onClick={() => setDetalleId(r.id)} aria-label={`Ver ${tipoDe(r.tipo)?.label ?? r.tipo} del ${r.fecha}`}>Ver</Button>
              </span>
            ) },
        ] satisfies DataTableColumn<ControlPlagas>[]}
      />
    </div>
  )
}

/** Detalle de solo lectura de una visita. */
function VisitaDetalle({ registro: r, vigente, plan, dinero }: { registro: ControlPlagas; vigente: boolean; plan: PlanTipo | null; dinero: (v: number) => string }) {
  const fila = (label: string, valor: ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '7px 0', borderBottom: '1px solid var(--at-chip)', fontSize: 14 }}>
      <span style={{ color: 'var(--at-ink-3)' }}>{label}</span>
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{valor}</span>
    </div>
  )
  // El plazo sólo se cuenta para la próxima visita vigente (la de la última visita del tipo).
  const dias = vigente ? diasHastaFechaCalendario(r.proxima_visita) : null
  const probable = vigente && !r.proxima_visita && plan?.origen === 'probable' && plan.proxima ? plan.proxima : null
  const diasProbable = diasHastaFechaCalendario(probable)
  return (
    <div>
      {!vigente && r.proxima_visita && (
        <div style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 13, color: 'var(--at-ink-3)' }}>
          Hay una visita más reciente de tipo «{tipoDe(r.tipo)?.label ?? r.tipo}»: la próxima vigente es la que dejó programada esa.
        </div>
      )}
      {fila('Fecha', r.fecha)}
      {fila('Horario', r.hora_inicio || r.hora_fin ? `${hora(r.hora_inicio) || '?'} – ${hora(r.hora_fin) || '?'}` : '—')}
      {fila('Empresa', r.empresa || '—')}
      {fila('Técnico', r.tecnico || '—')}
      {fila('Productos', r.productos || '—')}
      {fila('Próxima visita', r.proxima_visita
        ? <strong style={{ color: dias !== null ? colorPlazo(dias) : 'var(--at-ink-2)' }}>{r.proxima_visita}{dias !== null ? ` · ${cuandoToca(dias)}` : ''}</strong>
        : probable && diasProbable !== null
          ? <span>
              <strong style={{ color: colorPlazo(diasProbable) }}>Probable {probable} · {cuandoToca(diasProbable)}</strong>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--at-ink-3)' }}>No se programó; cada ~{plan?.intervaloDias} días según el historial</span>
            </span>
          : '—')}
      {fila('Costo', r.costo != null ? <strong style={{ color: 'var(--at-success)' }}>{dinero(r.costo)}</strong> : '—')}

      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 6 }}>Áreas tratadas</div>
        {r.areas.length === 0 ? <span style={{ color: 'var(--at-ink-3)', fontSize: 13 }}>—</span> : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {r.areas.map(a => (
              <span key={a} style={{ padding: '3px 10px', background: 'var(--at-accent-tint)', color: 'var(--at-accent)', borderRadius: 6, fontSize: 12 }}>{a}</span>
            ))}
          </div>
        )}
      </div>

      {r.observaciones && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 4 }}>Observaciones</div>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 14 }}>{r.observaciones}</p>
        </div>
      )}
    </div>
  )
}

/** Próxima visita de un tipo: la fecha, si es programada o probable, y cuándo toca. Abre la última visita del tipo. */
function TarjetaTipo({ plan, onAbrir }: { plan: PlanTipo; onAbrir: () => void }) {
  const tipo = tipoDe(plan.tipo)
  const nombre = tipo?.label ?? plan.tipo
  const dias = diasHastaFechaCalendario(plan.proxima)
  const origen = plan.origen === 'programada' ? 'Programada' : 'Probable'
  const fondo = dias === null ? 'var(--at-surface-2)' : dias <= 7 ? 'var(--at-danger-tint)' : dias <= 30 ? 'var(--at-warning-tint)' : 'var(--at-surface-2)'
  const borde = dias === null ? 'var(--at-line)' : dias <= 7 ? 'var(--at-danger-border)' : dias <= 30 ? 'var(--at-warning-border)' : 'var(--at-line)'
  return (
    <button type="button" className="cond-kpi-link" onClick={onAbrir} style={{ ...tarjeta, cursor: 'pointer', background: fondo, borderColor: borde }}
      aria-label={plan.proxima && dias !== null
        ? `${nombre}: próxima visita ${plan.proxima}, ${origen.toLowerCase()}, ${cuandoToca(dias)}`
        : `${nombre}: sin próxima visita`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{tipo?.icon} {nombre}</span>
        {plan.origen && (
          <span style={{ fontSize: 10.5, fontWeight: 700, padding: '1px 7px', borderRadius: 10, whiteSpace: 'nowrap',
            background: plan.origen === 'programada' ? 'var(--at-accent-tint)' : 'var(--at-surface)',
            color: plan.origen === 'programada' ? 'var(--at-accent)' : 'var(--at-ink-3)',
            border: plan.origen === 'programada' ? '1px solid transparent' : '1px dashed var(--at-line-strong)' }}>
            {origen}
          </span>
        )}
      </div>
      {plan.proxima && dias !== null ? (
        <div style={{ display: 'flex', gap: '2px 8px', alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{plan.proxima}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: colorPlazo(dias) }}>{cuandoToca(dias)}</span>
        </div>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--at-ink-3)' }}>Sin fecha: programa la próxima al registrar</div>
      )}
      <div style={{ display: 'flex', gap: '2px 6px', alignItems: 'center', flexWrap: 'wrap', fontSize: 11.5, color: 'var(--at-ink-3)', marginTop: 4 }}>
        <span>Última {plan.ultima.fecha}{plan.intervaloDias ? ` · cada ~${plan.intervaloDias} días` : ''}</span>
        {plan.ultima.resultado !== 'satisfactorio' && <ResultadoBadge resultado={plan.ultima.resultado} />}
      </div>
      {plan.siguientes.length > 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--at-ink-3)', marginTop: 2 }}>Luego: {plan.siguientes.join(', ')}</div>
      )}
    </button>
  )
}
