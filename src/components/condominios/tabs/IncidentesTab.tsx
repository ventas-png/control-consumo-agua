import { hoyLocalISO, mesLocalISO, datetimeLocalISO } from '../../../lib/format'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { EmptyState } from '../../shared/EmptyState'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { createCondominioRow, deleteCondominioRowAfectando, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { estaAbierto, diasAbierto, agregarSeguimiento, masRecientePrimero, reportanteDe } from '../../../domain/condominios/incidentes'
import { areaUnicaPorNombre, nombreAreaDe, vinculoArea } from '../../../domain/condominios/areas'
import type { AreaCondominio, CargoCatalogo, IncidenteSeguridad, PersonalCondominio } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'
import { exportarPDFTabla, exportarExcel } from '../exportUtils'

interface Props {
  incidentes: IncidenteSeguridad[]
  /** Catálogo compartido: el área del incidente se ELIGE de aquí (tab Áreas), no se escribe. */
  areas: AreaCondominio[]
  /** Expediente del condominio: si el usuario tiene ficha, «Reportado por» lleva su cargo. */
  personal: PersonalCondominio[]
  cargos?: CargoCatalogo[]
  /** Usuario que registra: se propone como «Reportado por». */
  userId?: string
  proyectoId: string
  companyId: string
  proyectoNombre?: string
  /** Quién anota el seguimiento (va en cada nota). */
  autorNombre?: string
  canCreate: boolean
  canEdit: boolean
  /** Eliminar tiene su propio permiso (condominios.tab.<tab>.delete): ver o
   *  editar no basta. */
  canDelete: boolean
  /** Visibilidad del tab Áreas: decide si se ofrece el atajo para configurarlas. */
  puedeConfigurarAreas: boolean
  onIrATab: (tabId: 'areas_config') => void
  onRefresh: () => void
}

const TIPO_STYLE: Record<string, { bg: string; color: string; label: string; icon: string }> = {
  robo:       { bg: 'var(--at-danger-tint)', color: 'var(--at-danger)', label: 'Robo',       icon: '🚨' },
  vandalismo: { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', label: 'Vandalismo', icon: '🔨' },
  accidente:  { bg: 'var(--at-warning-border)', color: 'var(--at-warning-strong)', label: 'Accidente',  icon: '🩺' },
  incendio:   { bg: 'var(--at-danger-border)', color: 'var(--at-danger-strong)', label: 'Incendio',   icon: '🔥' },
  pelea:      { bg: 'var(--at-accent-tint)', color: 'var(--at-accent-hover)', label: 'Pelea',      icon: '⚡' },
  otro:       { bg: 'var(--at-chip)', color: 'var(--at-ink-3)', label: 'Otro',       icon: '📋' },
}
const tipoDe = (t: string) => TIPO_STYLE[t] ?? TIPO_STYLE.otro

const ESTADO_FLOW: Record<string, { bg: string; color: string; label: string; next?: string; nextLabel?: string }> = {
  reportado:    { bg: 'var(--at-danger-tint)', color: 'var(--at-danger)', label: 'Reportado',    next: 'investigando', nextLabel: 'Iniciar Investigación' },
  investigando: { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', label: 'Investigando', next: 'resuelto',     nextLabel: 'Marcar Resuelto' },
  resuelto:     { bg: 'var(--at-success-tint)', color: 'var(--at-success)', label: 'Resuelto',     next: 'cerrado',      nextLabel: 'Cerrar' },
  cerrado:      { bg: 'var(--at-chip)', color: 'var(--at-ink-3)', label: 'Cerrado' },
}
const ORDEN_ESTADOS = Object.keys(ESTADO_FLOW)
const estadoDe = (e: string) => ESTADO_FLOW[e] ?? ESTADO_FLOW.reportado

/** Abierto más de esto, el aviso de antigüedad se pinta de alerta. */
const DIAS_ALERTA = 7

type FiltroEstado = 'todos' | 'abiertos' | keyof typeof ESTADO_FLOW
const FILTROS_ESTADO: { value: FiltroEstado; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'abiertos', label: 'Abiertos' },
  ...ORDEN_ESTADOS.map(e => ({ value: e as FiltroEstado, label: ESTADO_FLOW[e].label })),
]

// Fecha y hora de AHORA cada vez que se abre: como constante del módulo, la
// fecha quedaba fija en el día en que se cargó la página.
const blank = (): Record<string, string> => {
  const ahora = datetimeLocalISO()
  return {
    fecha: hoyLocalISO(), hora: ahora.slice(11, 16),
    tipo: 'otro', descripcion: '', area_id: '', area: '',
    reportado_por: '', estado: 'reportado', involucrados: '', seguimiento: '',
  }
}

const inputStyle: CSSProperties = {
  width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)',
  borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box', minWidth: 0,
  background: 'var(--at-surface-2)', color: 'var(--at-ink)',
}
const labelStyle: CSSProperties = { fontSize: '11.5px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }
const pill = (bg: string, color: string): CSSProperties => ({ padding: '2px 8px', borderRadius: '99px', fontSize: '11px', fontWeight: 700, background: bg, color, whiteSpace: 'nowrap' })
const seccion: CSSProperties = { fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }

/** La descripción hace de título de la ventana: se acorta si es un párrafo
 *  (el texto completo va en el cuerpo). */
function tituloCorto(texto: string): string {
  return texto.length > 80 ? `${texto.slice(0, 79).trimEnd()}…` : texto
}

const haceDias = (d: number) => d === 0 ? 'abierto desde hoy' : `abierto hace ${d} día${d === 1 ? '' : 's'}`

/** Reportado → Investigando → Resuelto → Cerrado, con el paso actual marcado. */
function LineaEstados({ estado }: { estado: string }) {
  const actual = ORDEN_ESTADOS.indexOf(estado)
  return (
    <ol aria-label="Avance del incidente" style={{ display: 'flex', gap: '4px', listStyle: 'none', margin: '0 0 14px', padding: 0 }}>
      {ORDEN_ESTADOS.map((e, idx) => {
        const hecho = idx < actual
        const esActual = idx === actual
        const cfg = ESTADO_FLOW[e]
        return (
          <li key={e} aria-current={esActual ? 'step' : undefined}
            style={{ flex: 1, minWidth: 0, textAlign: 'center', padding: '6px 4px', borderRadius: '8px', fontSize: '11.5px', fontWeight: esActual ? 800 : 600,
              background: esActual ? cfg.bg : hecho ? 'var(--at-surface-2)' : 'transparent',
              color: esActual ? cfg.color : hecho ? 'var(--at-ink-2)' : 'var(--at-ink-3)',
              border: `1.5px solid ${esActual ? cfg.color : 'var(--at-line)'}` }}>
            {hecho ? '✓ ' : ''}{cfg.label}
          </li>
        )
      })}
    </ol>
  )
}

export function IncidentesTab({ incidentes, areas, personal, cargos = [], userId, proyectoId, companyId, proyectoNombre = 'Condominio', autorNombre, canCreate, canEdit, canDelete, puedeConfigurarAreas, onIrATab, onRefresh }: Props) {
  // Por id y no la fila: tras editar o avanzar de estado, `incidentes` llega
  // refrescado y la ventana muestra el dato nuevo (la copia quedaba vieja).
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, string>>(blank)
  const [filterTipo, setFilterTipo] = useState('')
  const [filterEstado, setFilterEstado] = useState<FiltroEstado>('todos')
  const [busqueda, setBusqueda] = useState('')
  const [saving, setSaving] = useState(false)
  // Avance de estado y nota de seguimiento: uno a la vez, sin repetirse.
  const [ocupado, setOcupado] = useState(false)
  const [nota, setNota] = useState('')

  const setF = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  // El área es del catálogo (tab Áreas). Solo las activas se ofrecen al
  // registrar; las inactivas siguen nombrando lo ya registrado.
  const areasActivas = [...areas]
    .filter(a => a.activo)
    .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))
  const areaDe = (i: IncidenteSeguridad) => nombreAreaDe(i.area_id, areas, i.area ?? '')

  // Texto libre de un incidente anterior al catálogo que nadie ha vinculado: se
  // conserva mientras no se elija un área.
  const editando = editId ? incidentes.find(i => i.id === editId) : undefined
  const areaLegada = editando && !editando.area_id ? (editando.area ?? '').trim() : ''
  // El área guardada puede estar inactiva: se sigue ofreciendo para no perderla.
  const areaFueraDeLista = form.area_id && !areasActivas.some(a => a.id === form.area_id) ? form.area_id : null

  // Quien registra es quien reporta, salvo que lo cambie: se propone su nombre
  // (con su cargo si su usuario tiene ficha de empleado).
  const reportantePropio = reportanteDe(userId, autorNombre, personal, cargos)
  const openNew = () => {
    setForm({ ...blank(), reportado_por: reportantePropio })
    setEditId(null); setShowForm(true); setSelectedId(null)
  }
  const openEdit = (i: IncidenteSeguridad) => {
    setForm({
      fecha: i.fecha, hora: i.hora ?? '',
      tipo: i.tipo, descripcion: i.descripcion, area: i.area ?? '',
      // Lo legado se propone vinculado si su texto coincide con UNA sola área.
      area_id: i.area_id ?? areaUnicaPorNombre(i.area, areasActivas)?.id ?? '',
      reportado_por: i.reportado_por ?? '', estado: i.estado,
      involucrados: i.involucrados ?? '', seguimiento: i.seguimiento ?? '',
    })
    setEditId(i.id); setShowForm(true)
  }

  const handleSave = async () => {
    if (saving) return
    if (!form.descripcion.trim()) return notify({ variant: 'warning', title: 'Campo requerido', text: 'La descripción es obligatoria.' })
    // La fecha es obligatoria en la base: antes, al borrarla, el error llegaba de la base.
    if (!form.fecha) return notify({ variant: 'warning', title: 'Campo requerido', text: 'Indica la fecha del incidente.' })
    setSaving(true)
    // `area` es el snapshot del nombre del área al guardar.
    const area = vinculoArea(form.area_id, areas, editando && { area_id: editando.area_id, texto: editando.area })
    const payload = {
      company_id: companyId, project_id: proyectoId,
      fecha: form.fecha, hora: form.hora || null,
      tipo: form.tipo, descripcion: form.descripcion.trim(),
      area_id: area.area_id, area: area.nombre, reportado_por: form.reportado_por.trim() || null,
      estado: form.estado, involucrados: form.involucrados.trim() || null,
      seguimiento: form.seguimiento.trim() || null,
    }
    const { error } = editId
      ? await updateCondominioRow('incidentes_seguridad', editId, payload)
      : await createCondominioRow('incidentes_seguridad', payload)
    setSaving(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setShowForm(false); onRefresh()
  }

  const avanzarEstado = async (i: IncidenteSeguridad) => {
    const cfg = estadoDe(i.estado)
    if (!cfg.next || ocupado) return
    setOcupado(true)
    const { error } = await updateCondominioRow('incidentes_seguridad', i.id, { estado: cfg.next })
    setOcupado(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    onRefresh()
  }

  const anotar = async (i: IncidenteSeguridad) => {
    if (ocupado || !nota.trim()) return
    setOcupado(true)
    const { error } = await updateCondominioRow('incidentes_seguridad', i.id, { seguimiento: agregarSeguimiento(i.seguimiento, nota, new Date(), autorNombre) })
    setOcupado(false)
    // Si falla, la nota se queda escrita para reintentar.
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setNota('')
    onRefresh()
  }

  const handleDelete = async (i: IncidenteSeguridad) => {
    // El botón ya se oculta sin permiso; esto cubre cualquier otra vía.
    if (!canDelete) return
    const r = await confirm({ title: '¿Eliminar incidente?', text: i.descripcion, icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    const { error } = await deleteCondominioRowAfectando('incidentes_seguridad', i.id)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    if (selectedId === i.id) setSelectedId(null)
    onRefresh()
  }

  const cerrarForm = () => {
    if (saving) return
    setShowForm(false)
  }

  const abrirDetalle = (id: string) => { setSelectedId(id); setShowForm(false); setNota('') }

  const pasaEstado = (i: IncidenteSeguridad, f: FiltroEstado) =>
    f === 'todos' || (f === 'abiertos' ? estaAbierto(i) : i.estado === f)

  // Busca en todo lo que se escribe del incidente (antes sólo en el área).
  const q = busqueda.trim().toLowerCase()
  const filtered = incidentes.filter(i =>
    (!filterTipo || i.tipo === filterTipo) &&
    pasaEstado(i, filterEstado) &&
    (!q || [i.descripcion, areaDe(i), i.reportado_por, i.involucrados].some(t => (t ?? '').toLowerCase().includes(q)))
  ).sort(masRecientePrimero)

  function exportarPDF() {
    exportarPDFTabla({
      titulo: 'Registro de Incidentes de Seguridad',
      proyectoNombre,
      headers: ['Fecha', 'Hora', 'Tipo', 'Área', 'Descripción', 'Reportado por', 'Estado'],
      rows: filtered.map(i => [i.fecha, i.hora ?? '—', tipoDe(i.tipo).label, areaDe(i) || '—', i.descripcion, i.reportado_por ?? '—', estadoDe(i.estado).label]),
      filename: `incidentes-${hoyLocalISO()}`,
      landscape: true,
    })
  }

  function exportarXlsx() {
    exportarExcel(`incidentes-${hoyLocalISO()}`, [{
      name: 'Incidentes',
      headers: ['Fecha', 'Hora', 'Tipo', 'Área', 'Descripción', 'Reportado por', 'Estado', 'Involucrados', 'Seguimiento'],
      rows: filtered.map(i => [i.fecha, i.hora ?? '', tipoDe(i.tipo).label, areaDe(i), i.descripcion, i.reportado_por ?? '', estadoDe(i.estado).label, i.involucrados ?? '', i.seguimiento ?? '']),
    }])
  }

  const abiertos = incidentes.filter(estaAbierto)
  const esteMes = incidentes.filter(i => i.fecha.startsWith(mesLocalISO())).length
  const masAntiguo = abiertos.reduce<number | null>((max, i) => {
    const d = diasAbierto(i)
    return d !== null && (max === null || d > max) ? d : max
  }, null)
  const selected = selectedId ? incidentes.find(i => i.id === selectedId) ?? null : null

  const kpi = (icono: string, label: string, valor: string, color: string, filtro?: FiltroEstado): ReactNode => {
    const contenido = (
      <>
        <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', fontWeight: 600 }}>{icono} {label}</div>
        <div style={{ fontSize: '20px', fontWeight: 800, color, marginTop: '2px' }}>{valor}</div>
      </>
    )
    const estilo: CSSProperties = { background: 'var(--at-surface)', border: `1.5px solid ${filtro && filterEstado === filtro ? 'var(--at-primary)' : 'var(--at-line)'}`, borderRadius: '12px', padding: '10px 14px', textAlign: 'left', font: 'inherit', color: 'inherit', minWidth: 0 }
    return filtro
      ? <button key={label} type="button" className="cond-kpi-link" onClick={() => setFilterEstado(filtro)} aria-pressed={filterEstado === filtro} aria-label={`${label}: ${valor}`} style={{ ...estilo, cursor: 'pointer' }}>{contenido}</button>
      : <div key={label} style={estilo}>{contenido}</div>
  }

  // La lista ocupa la página; el detalle y el formulario se abren en ventana
  // (antes eran un panel fijo de 360px y un detalle al lado que no cabían en
  // el teléfono).
  return (
    <div style={{ padding: 'clamp(14px, 4vw, 24px)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>🚨 Incidentes de seguridad</h2>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <Button size="sm" variant="secondary" onClick={exportarPDF} disabled={incidentes.length === 0} aria-label="Exportar a PDF">📄 PDF</Button>
          <Button size="sm" variant="secondary" onClick={exportarXlsx} disabled={incidentes.length === 0} aria-label="Exportar a Excel">📊 Excel</Button>
          {canCreate && <Button size="sm" variant="danger" onClick={openNew}>🚨 Registrar incidente</Button>}
        </div>
      </div>

      {/* Resumen: «Abiertos» filtra la lista */}
      {incidentes.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))', gap: '10px', marginBottom: '14px' }}>
          {kpi('🔴', 'Abiertos', String(abiertos.length), abiertos.length > 0 ? 'var(--at-danger)' : 'var(--at-success)', 'abiertos')}
          {kpi('⏳', 'Más antiguo abierto', masAntiguo === null ? '—' : `${masAntiguo} día${masAntiguo === 1 ? '' : 's'}`, masAntiguo !== null && masAntiguo > DIAS_ALERTA ? 'var(--at-warning-strong)' : 'var(--at-ink-2)')}
          {kpi('📅', 'Este mes', String(esteMes), 'var(--at-ink-2)')}
          {kpi('📋', 'Total', String(incidentes.length), 'var(--at-ink-2)', 'todos')}
        </div>
      )}

      {/* Filtros: estado en botones con su cuenta, tipo y búsqueda */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}>
        {FILTROS_ESTADO.map(f => {
          const activo = filterEstado === f.value
          return (
            <button key={f.value} type="button" onClick={() => setFilterEstado(f.value)} aria-pressed={activo}
              style={{ padding: '5px 12px', borderRadius: '20px', border: '1.5px solid', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                borderColor: activo ? 'var(--at-primary)' : 'var(--at-line)', background: activo ? 'var(--at-primary-soft)' : 'var(--at-surface)', color: activo ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
              {f.label} ({incidentes.filter(i => pasaEstado(i, f.value)).length})
            </button>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar en descripción, área, personas…" aria-label="Buscar incidentes" style={{ ...inputStyle, flex: '2 1 220px', width: 'auto' }} />
        <select value={filterTipo} onChange={e => setFilterTipo(e.target.value)} aria-label="Filtrar por tipo" style={{ ...inputStyle, flex: '1 1 140px', width: 'auto' }}>
          <option value="">Todos los tipos</option>
          {Object.keys(TIPO_STYLE).map(k => <option key={k} value={k}>{TIPO_STYLE[k].icon} {TIPO_STYLE[k].label}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon="📋" title={incidentes.length === 0 ? 'Sin incidentes' : 'Ningún incidente con estos filtros'} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.map(i => {
            const ts = tipoDe(i.tipo)
            const es = estadoDe(i.estado)
            const dias = diasAbierto(i)
            return (
              <button key={i.id} type="button" className="cond-kpi-link" onClick={() => abrirDetalle(i.id)}
                style={{ width: '100%', textAlign: 'left', background: 'var(--at-surface)', border: `1.5px solid ${estaAbierto(i) ? 'var(--at-danger-border)' : 'var(--at-line)'}`, borderRadius: '10px', padding: '12px 14px', cursor: 'pointer', font: 'inherit', color: 'inherit' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                      <span aria-hidden style={{ fontSize: '16px', lineHeight: '18px' }}>{ts.icon}</span>
                      {/* Dos líneas, no una cortada: la descripción es lo que distingue cada incidente. */}
                      <span style={{ fontWeight: 700, fontSize: '13.5px', color: 'var(--at-ink)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}>{i.descripcion}</span>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '3px' }}>
                      {i.fecha}{i.hora ? ` ${i.hora.slice(0, 5)}` : ''}{areaDe(i) ? ` · ${areaDe(i)}` : ''}{i.reportado_por ? ` · ${i.reportado_por}` : ''}
                    </div>
                    {dias !== null && (
                      <div style={{ fontSize: '11.5px', fontWeight: 600, marginTop: '2px', color: dias > DIAS_ALERTA ? 'var(--at-danger)' : 'var(--at-warning-strong)' }}>⏳ {haceDias(dias)}</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0, alignItems: 'flex-end' }}>
                    <span style={pill(ts.bg, ts.color)}>{ts.label}</span>
                    <span style={pill(es.bg, es.color)}>{es.label}</span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* Form en ventana. Mientras está abierto se oculta el detalle, como
          antes; al cerrarlo vuelve el incidente que se estaba editando. */}
      {showForm && (
        <EditModal
          title={editId ? '✏️ Editar incidente' : '🚨 Registrar incidente'}
          maxWidth="680px"
          fullScreenOnMobile
          closeOnBackdropClick={!saving}
          closeOnEscape={!saving}
          onClose={cerrarForm}
          footer={<>
            <Button variant="secondary" onClick={cerrarForm} disabled={saving}>Cancelar</Button>
            <Button type="submit" form="incidente-form" loading={saving} loadingText="Guardando…">Guardar</Button>
          </>}
        >
          {/* `1 / -1` y no `span 2`: con una sola columna (teléfono) el span
              creaba una columna implícita y el campo se salía de la ventana. */}
          <form id="incidente-form" onSubmit={e => { e.preventDefault(); void handleSave() }}
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: '10px', alignItems: 'start' }}>
            <div>
              <label htmlFor="inc-tipo" style={labelStyle}>Tipo *</label>
              <select id="inc-tipo" style={inputStyle} value={form.tipo} onChange={e => setF('tipo', e.target.value)}>
                {Object.entries(TIPO_STYLE).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="inc-fecha" style={labelStyle}>Fecha *</label>
              <input id="inc-fecha" style={inputStyle} type="date" max={hoyLocalISO()} value={form.fecha} onChange={e => setF('fecha', e.target.value)} />
            </div>
            <div>
              <label htmlFor="inc-hora" style={labelStyle}>Hora</label>
              <input id="inc-hora" style={inputStyle} type="time" value={form.hora} onChange={e => setF('hora', e.target.value)} />
            </div>
            <div>
              <label htmlFor="inc-area" style={labelStyle}>Área</label>
              <select id="inc-area" style={inputStyle} value={form.area_id} onChange={e => setF('area_id', e.target.value)}>
                <option value="">— Sin área —</option>
                {areasActivas.map(a => <option key={a.id} value={a.id}>{a.icono} {a.nombre}</option>)}
                {areaFueraDeLista && (
                  <option value={areaFueraDeLista}>{nombreAreaDe(areaFueraDeLista, areas, form.area)} (inactiva)</option>
                )}
              </select>
              {!form.area_id && areaLegada && (
                <div style={{ fontSize: '11px', color: 'var(--at-warning-strong)', marginTop: '4px' }}>
                  Antes: «{areaLegada}», sin vincular a un área. Se conserva hasta que elijas una.
                </div>
              )}
              {areasActivas.length === 0 && (
                <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '4px' }}>
                  Sin áreas activas.{' '}
                  {puedeConfigurarAreas
                    ? (
                      <button type="button" onClick={() => onIrATab('areas_config')}
                        style={{ background: 'none', border: 'none', padding: 0, color: 'var(--at-accent)', fontWeight: 600, fontSize: '11px', cursor: 'pointer', textDecoration: 'underline' }}>
                        Crearlas en el tab Áreas
                      </button>
                    )
                    : 'Se dan de alta en el tab Áreas.'}
                </div>
              )}
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="inc-descripcion" style={labelStyle}>Descripción *</label>
              <textarea id="inc-descripcion" style={{ ...inputStyle, resize: 'vertical', minHeight: '70px' }} value={form.descripcion} onChange={e => setF('descripcion', e.target.value)} placeholder="Qué pasó, dónde y cómo se detectó" autoFocus />
            </div>
            <div>
              <label htmlFor="inc-reportado-por" style={labelStyle}>Reportado por</label>
              <input id="inc-reportado-por" style={inputStyle} value={form.reportado_por} onChange={e => setF('reportado_por', e.target.value)} placeholder="Nombre o cargo" />
              {!editId && form.reportado_por && form.reportado_por === reportantePropio && (
                <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '4px' }}>Con tu usuario. Cámbialo si lo reportó otra persona.</div>
              )}
            </div>
            <div>
              <label htmlFor="inc-estado" style={labelStyle}>Estado</label>
              <select id="inc-estado" style={inputStyle} value={form.estado} onChange={e => setF('estado', e.target.value)}>
                {Object.entries(ESTADO_FLOW).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="inc-involucrados" style={labelStyle}>Involucrados</label>
              <input id="inc-involucrados" style={inputStyle} value={form.involucrados} onChange={e => setF('involucrados', e.target.value)} placeholder="Personas o unidades involucradas" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="inc-seguimiento" style={labelStyle}>Seguimiento</label>
              <textarea id="inc-seguimiento" style={{ ...inputStyle, resize: 'vertical', minHeight: '60px' }} value={form.seguimiento} onChange={e => setF('seguimiento', e.target.value)} placeholder="Acciones tomadas, estado de la investigación..." />
            </div>
          </form>
        </EditModal>
      )}

      {/* Detalle en ventana: a pantalla completa en el teléfono. */}
      {!showForm && selected && (() => {
        const ts = tipoDe(selected.tipo)
        const es = estadoDe(selected.estado)
        const dias = diasAbierto(selected)
        return (
          <EditModal
            title={`${ts.icon} ${tituloCorto(selected.descripcion)}`}
            subtitle={<span style={{ display: 'inline-flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={pill(ts.bg, ts.color)}>{ts.label}</span>
              <span style={pill(es.bg, es.color)}>{es.label}</span>
              <span>{selected.fecha}{selected.hora ? ` a las ${selected.hora.slice(0, 5)}` : ''}{areaDe(selected) ? ` · ${areaDe(selected)}` : ''}</span>
            </span>}
            maxWidth="640px"
            fullScreenOnMobile
            onClose={() => setSelectedId(null)}
            // Dos acciones al pie (antes eran tres y en el teléfono no cabían):
            // eliminar baja al cuerpo.
            footer={<>
              {canEdit && <Button variant="secondary" onClick={() => openEdit(selected)}>✏️ Editar</Button>}
              {canEdit && es.next && <Button onClick={() => void avanzarEstado(selected)} loading={ocupado} disabled={ocupado}>→ {es.nextLabel}</Button>}
              {!canEdit && <Button variant="secondary" onClick={() => setSelectedId(null)}>Cerrar</Button>}
            </>}
          >
            <LineaEstados estado={selected.estado} />
            {dias !== null && (
              <div style={{ fontSize: '12.5px', fontWeight: 600, marginBottom: '12px', color: dias > DIAS_ALERTA ? 'var(--at-danger)' : 'var(--at-warning-strong)' }}>⏳ {haceDias(dias)}</div>
            )}

            <div style={{ background: 'var(--at-surface-2)', borderRadius: '8px', padding: '14px', marginBottom: '14px' }}>
              <div style={seccion}>Descripción</div>
              <p style={{ margin: 0, fontSize: '14px', color: 'var(--at-ink)', lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{selected.descripcion}</p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: '10px', marginBottom: '14px' }}>
              {[
                { label: 'Reportado por', val: selected.reportado_por ?? '—' },
                { label: 'Involucrados', val: selected.involucrados ?? '—' },
              ].map(row => (
                <div key={row.label} style={{ background: 'var(--at-surface-2)', borderRadius: '8px', padding: '10px 12px', minWidth: 0 }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '2px' }}>{row.label}</div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)', overflowWrap: 'anywhere' }}>{row.val}</div>
                </div>
              ))}
            </div>

            <div style={{ background: 'var(--at-warning-tint)', borderRadius: '8px', padding: '12px', border: '1px solid var(--at-warning-border)' }}>
              <div style={{ ...seccion, color: 'var(--at-warning-strong)' }}>Seguimiento</div>
              {selected.seguimiento
                ? <p style={{ margin: 0, fontSize: '13px', color: 'var(--at-ink-2)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.55 }}>{selected.seguimiento}</p>
                : <p style={{ margin: 0, fontSize: '13px', color: 'var(--at-ink-3)' }}>Sin notas todavía.</p>}
              {/* Agregar una nota sin abrir Editar: queda con fecha, hora y quién la escribió. */}
              {canEdit && (
                <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label htmlFor="inc-nota" style={{ ...labelStyle, marginBottom: 0 }}>Agregar nota de seguimiento</label>
                  <textarea id="inc-nota" rows={2} value={nota} onChange={e => setNota(e.target.value)} placeholder="Ej. Se revisaron las cámaras; se presentó denuncia."
                    style={{ ...inputStyle, resize: 'vertical', background: 'var(--at-surface)' }} />
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <Button size="sm" onClick={() => void anotar(selected)} disabled={!nota.trim() || ocupado} loading={ocupado}>+ Agregar nota</Button>
                  </div>
                </div>
              )}
            </div>

            {canDelete && (
              <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid var(--at-line)' }}>
                <Button size="sm" variant="outline-danger" onClick={() => void handleDelete(selected)}>🗑 Eliminar incidente</Button>
              </div>
            )}
          </EditModal>
        )
      })()}
    </div>
  )
}
