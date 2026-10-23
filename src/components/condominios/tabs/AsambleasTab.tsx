import { useRef, useState, type CSSProperties } from 'react'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { FileUploader } from '../../shared/FileUploader'
import { SecureFileLink } from '../../shared/SecureFileLink'
import { createCondominioRow, updateCondominioRow, deleteCondominioRowAfectando, upsertCondominioRow } from '../../../domain/condominios/tabMutations'
import { fetchPuntosAsambleaConVotos, fetchPadronAsamblea, fetchAsistenciaAsamblea, fetchEscrutinioAsamblea } from '../../../domain/condominios/tabQueries'
import { removeCondominiosMedia } from '../../../domain/shared/storage'
import { toast } from '../../../lib/toast'
import { confirm } from '../../shared/Dialog'
import type {
  Asamblea, PuntoAsamblea, VotoAsamblea, Unidad, TipoAsamblea, EstadoAsamblea, TipoPunto, TipoVoto,
  TipoMayoria, ModalidadAsistencia, DecisionPunto, PadronAsamblea, AsistenciaAsamblea, EscrutinioAsamblea, EscrutinioPunto,
} from '../../../types'

interface Props {
  asambleas: Asamblea[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  userId: string
  canCreate: boolean
  canEdit: boolean
  /** Eliminar tiene su propio permiso (condominios.tab.<tab>.delete): ver o
   *  editar no basta. */
  canDelete: boolean
  onRefresh: () => void
}

const ESTADO_CONFIG: Record<EstadoAsamblea, { label: string; bg: string; color: string }> = {
  programada: { label: 'Programada', bg: 'var(--at-primary-tint)', color: 'var(--at-primary)' },
  en_curso:   { label: 'En curso',   bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  finalizada: { label: 'Finalizada', bg: 'var(--at-surface-2)', color: 'var(--at-ink-3)' },
  cancelada:  { label: 'Cancelada',  bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' },
}

// Las mismas que impone la base (asambleas_tg_transicion_estado): una asamblea
// finalizada o cancelada ya no cambia de estado, y su agenda y sus votos
// quedan congelados.
const TRANSICIONES: Record<EstadoAsamblea, EstadoAsamblea[]> = {
  programada: ['en_curso', 'cancelada'],
  en_curso:   ['finalizada', 'cancelada'],
  finalizada: [],
  cancelada:  [],
}

const VOTO_CONFIG: Record<TipoVoto, { label: string; bg: string; color: string }> = {
  a_favor:    { label: 'A favor',    bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  en_contra:  { label: 'En contra',  bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' },
  abstencion: { label: 'Abstención', bg: 'var(--at-surface-2)', color: 'var(--at-ink-3)' },
}

// Las reglas que aplica la base al finalizar (asambleas_calcular_escrutinio).
const MAYORIA_CONFIG: Record<TipoMayoria, { label: string; regla: string }> = {
  simple:     { label: 'Mayoría simple',   regla: 'Más votos a favor que en contra.' },
  absoluta:   { label: 'Mayoría absoluta', regla: 'A favor más de la mitad de lo presente.' },
  calificada: { label: 'Calificada',       regla: 'A favor, al menos ese porcentaje del padrón completo.' },
}

const MODALIDAD_LABEL: Record<ModalidadAsistencia, string> = {
  presencial: 'Presencial',
  virtual:    'Virtual',
  poder:      'Por poder',
}

const DECISION_CONFIG: Record<DecisionPunto, { label: string; bg: string; color: string }> = {
  aprobado:   { label: 'Aprobado',   bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  rechazado:  { label: 'Rechazado',  bg: 'var(--at-danger-tint)',  color: 'var(--at-danger)' },
  sin_quorum: { label: 'Sin quórum', bg: 'var(--at-surface-2)',    color: 'var(--at-ink-3)' },
}

function pct(n: number): string {
  return `${Number(n).toLocaleString('es-MX', { maximumFractionDigits: 2 })} %`
}

function etiquetaMayoria(p: Pick<PuntoAsamblea, 'mayoria' | 'mayoria_pct'>): string {
  const m = p.mayoria ?? 'simple'
  return m === 'calificada' && p.mayoria_pct != null ? `Calificada ${pct(p.mayoria_pct)}` : MAYORIA_CONFIG[m].label
}

export function AsambleasTab({ asambleas, unidades, proyectoId, companyId, userId, canCreate, canEdit, canDelete, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [puntos, setPuntos] = useState<(PuntoAsamblea & { votos: VotoAsamblea[] })[]>([])
  const [padron, setPadron] = useState<PadronAsamblea[]>([])
  const [asistencia, setAsistencia] = useState<AsistenciaAsamblea[]>([])
  const [escrutinio, setEscrutinio] = useState<EscrutinioAsamblea | null>(null)
  const [loadingPuntos, setLoadingPuntos] = useState(false)
  // Asistencia por poder en curso de captura: una unidad a la vez.
  const [poder, setPoder] = useState<{ unidadId: string; apoderado: string; documento: string | null } | null>(null)
  const [showPuntoForm, setShowPuntoForm] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<EstadoAsamblea | 'todos'>('todos')

  const [form, setForm] = useState({
    titulo: '', tipo: 'ordinaria' as TipoAsamblea,
    fecha: '', hora_inicio: '', hora_fin: '', lugar: '',
    quorum_requerido: '50',
  })
  const [puntoForm, setPuntoForm] = useState({ titulo: '', descripcion: '', tipo: 'informativo' as TipoPunto, mayoria: 'simple' as TipoMayoria, mayoria_pct: '66.67' })
  const actaRef = useRef<HTMLTextAreaElement>(null)

  const filtradas = filtroEstado === 'todos' ? asambleas : asambleas.filter(a => a.estado === filtroEstado)
  const proximas = asambleas.filter(a => a.estado === 'programada').length
  const selectedAsamblea = asambleas.find(a => a.id === selectedId)

  function resetForm() {
    setForm({ titulo: '', tipo: 'ordinaria', fecha: '', hora_inicio: '', hora_fin: '', lugar: '', quorum_requerido: '50' })
    setShowForm(false)
  }

  function cerrarForm() {
    if (saving) return
    resetForm()
  }

  function cerrarDetalle() {
    // El acta se guarda en onBlur, pero al cerrar con Escape el textarea se
    // desmontaba con el foco puesto y ese blur no llegaba: se perdía lo escrito.
    if (actaRef.current && document.activeElement === actaRef.current) actaRef.current.blur()
    descartarPoder()
    setSelectedId(null)
    setShowPuntoForm(false)
  }

  async function handleGuardar() {
    if (!form.titulo.trim()) { toast.error('Ingrese el título.'); return }
    if (!form.fecha || !form.hora_inicio) { toast.error('Ingrese fecha y hora de inicio.'); return }
    setSaving(true)
    const { error } = await createCondominioRow('asambleas', {
      company_id: companyId, project_id: proyectoId,
      titulo: form.titulo.trim(), tipo: form.tipo,
      fecha: form.fecha, hora_inicio: form.hora_inicio,
      hora_fin: form.hora_fin || null, lugar: form.lugar.trim() || null,
      quorum_requerido: Number(form.quorum_requerido),
      estado: 'programada', convocado_por: userId,
    })
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success('Asamblea convocada')
    resetForm(); onRefresh()
  }

  async function cambiarEstado(id: string, estado: EstadoAsamblea) {
    const { error } = await updateCondominioRow('asambleas', id, { estado })
    if (error) { toast.error(`No se cambió el estado: ${error.message}`); return }
    onRefresh()
  }

  async function cargarPuntos(asambleaId: string) {
    // Otra asamblea: que no se vea el quórum de la anterior mientras carga.
    if (asambleaId !== selectedId) { setPadron([]); setAsistencia([]); setEscrutinio(null) }
    setSelectedId(asambleaId)
    setLoadingPuntos(true)
    // Programada: todavía no hay padrón, asistencia ni escrutinio.
    const abierta = asambleas.find(a => a.id === asambleaId)?.estado !== 'programada'
    const [puntosData, padronData, asistenciaData, esc] = await Promise.all([
      fetchPuntosAsambleaConVotos(asambleaId),
      abierta ? fetchPadronAsamblea<PadronAsamblea>(asambleaId) : Promise.resolve([]),
      abierta ? fetchAsistenciaAsamblea<AsistenciaAsamblea>(asambleaId) : Promise.resolve([]),
      abierta ? fetchEscrutinioAsamblea<EscrutinioAsamblea>(asambleaId) : Promise.resolve(null),
    ])
    setPuntos(puntosData.map((p: Record<string, unknown>) => ({
      ...p,
      votos: ((p.votos_asamblea as Record<string, unknown>[]) ?? []).map((v: Record<string, unknown>) => ({
        ...v,
        unidad_nombre: (v.unidades as { nombre: string } | null)?.nombre,
      } as VotoAsamblea)),
    } as PuntoAsamblea & { votos: VotoAsamblea[] })))
    setPadron(padronData)
    setAsistencia(asistenciaData)
    setEscrutinio(esc)
    setLoadingPuntos(false)
  }

  async function agregarPunto() {
    if (!puntoForm.titulo.trim() || !selectedId) return
    const votacion = puntoForm.tipo === 'votacion'
    const mayoria: TipoMayoria = votacion ? puntoForm.mayoria : 'simple'
    const mayoriaPct = mayoria === 'calificada' ? Number(puntoForm.mayoria_pct) : null
    if (mayoriaPct !== null && !(mayoriaPct > 50 && mayoriaPct <= 100)) {
      toast.error('La mayoría calificada va de más del 50 % hasta el 100 % del padrón.'); return
    }
    const maxOrden = puntos.length > 0 ? Math.max(...puntos.map(p => p.orden)) + 1 : 1
    const { error } = await createCondominioRow('puntos_asamblea', {
      asamblea_id: selectedId, orden: maxOrden,
      titulo: puntoForm.titulo.trim(), descripcion: puntoForm.descripcion.trim() || null, tipo: puntoForm.tipo,
      mayoria, mayoria_pct: mayoriaPct,
    })
    if (error) { toast.error(error.message); return }
    setPuntoForm({ titulo: '', descripcion: '', tipo: 'informativo', mayoria: 'simple', mayoria_pct: '66.67' })
    setShowPuntoForm(false)
    cargarPuntos(selectedId)
  }

  async function registrarVoto(puntoId: string, unidadId: string, voto: TipoVoto) {
    const { error } = await upsertCondominioRow('votos_asamblea', {
      punto_id: puntoId, unidad_id: unidadId, voto, registrado_por: userId,
    }, 'punto_id,unidad_id')
    // Antes el error se ignoraba: un voto rechazado (RLS, candado de plan)
    // parecía registrado hasta que la recarga lo desmentía en silencio.
    if (error) { toast.error(`No se registró el voto: ${error.message}`); return }
    if (selectedId) cargarPuntos(selectedId)
  }

  async function registrarAsistencia(unidadId: string, modalidad: ModalidadAsistencia, apoderado: string | null = null, documento: string | null = null) {
    if (!selectedId) return false
    const { error } = await createCondominioRow('asistencia_asamblea', {
      asamblea_id: selectedId, unidad_id: unidadId, modalidad,
      apoderado_nombre: apoderado, poder_documento: documento, registrado_por: userId,
    })
    if (error) { toast.error(`No se registró la asistencia: ${error.message}`); return false }
    cargarPuntos(selectedId)
    return true
  }

  async function guardarPoder() {
    if (!poder) return
    if (!poder.apoderado.trim() || !poder.documento) { toast.error('El poder lleva el nombre del apoderado y el documento.'); return }
    if (await registrarAsistencia(poder.unidadId, 'poder', poder.apoderado.trim(), poder.documento)) setPoder(null)
  }

  // Un documento subido para un poder que no se guardó queda huérfano en storage.
  function descartarPoder() {
    if (poder?.documento) void removeCondominiosMedia([poder.documento])
    setPoder(null)
  }

  function abrirPoder(unidadId: string) {
    descartarPoder()
    setPoder({ unidadId, apoderado: '', documento: null })
  }

  async function quitarAsistencia(id: string) {
    const { error } = await deleteCondominioRowAfectando('asistencia_asamblea', id)
    if (error) { toast.error(`No se quitó la asistencia: ${error.message}`); return }
    if (selectedId) cargarPuntos(selectedId)
  }

  async function guardarActa(id: string, acta: string) {
    const { error } = await updateCondominioRow('asambleas', id, { acta })
    if (error) { toast.error(`No se guardó el acta: ${error.message}`); return }
    onRefresh()
  }

  async function eliminar(id: string) {
    // El botón ya se oculta sin permiso; esto cubre cualquier otra vía.
    if (!canDelete) return
    const r = await confirm({ title: '¿Eliminar asamblea?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    const { error } = await deleteCondominioRowAfectando('asambleas', id)
    if (error) { toast.error(error.message); return }
    if (selectedId === id) setSelectedId(null)
    onRefresh()
  }

  const inputStyle: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', fontFamily: 'inherit', color: 'var(--at-ink)', background: 'var(--at-surface-2)' }
  const labelStyle: CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }
  const puntoInputStyle: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '7px', fontSize: '13.5px', fontFamily: 'inherit', color: 'var(--at-ink)', background: 'var(--at-surface)' }

  return (
    <div style={{ padding: '24px', maxWidth: '1200px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--at-ink)' }}>Asambleas y Votaciones</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--at-ink-3)', fontSize: '13.5px' }}>
            {asambleas.length} asambleas · <span style={{ color: 'var(--at-primary)', fontWeight: 600 }}>{proximas} programadas</span>
          </p>
        </div>
        {canCreate && (
          <button onClick={() => setShowForm(true)} style={{ padding: '10px 20px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
            + Convocar asamblea
          </button>
        )}
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {(['todos', 'programada', 'en_curso', 'finalizada', 'cancelada'] as const).map(e => (
          <button key={e} onClick={() => setFiltroEstado(e)} aria-pressed={filtroEstado === e}
            style={{ padding: '7px 14px', borderRadius: '8px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', border: '1.5px solid', borderColor: filtroEstado === e ? 'var(--at-primary)' : 'var(--at-line)', background: filtroEstado === e ? 'var(--at-primary-tint)' : 'var(--at-surface)', color: filtroEstado === e ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
            {e === 'todos' ? 'Todas' : ESTADO_CONFIG[e as EstadoAsamblea].label}
          </button>
        ))}
      </div>

      {/* Form en ventana: antes se desplegaba arriba de la lista y en el
          teléfono la empujaba fuera de la vista. */}
      {showForm && (
        <EditModal
          title="Convocar asamblea"
          maxWidth="620px"
          fullScreenOnMobile
          closeOnBackdropClick={!saving}
          closeOnEscape={!saving}
          onClose={cerrarForm}
          footer={<>
            <Button variant="secondary" onClick={cerrarForm} disabled={saving}>Cancelar</Button>
            <Button onClick={handleGuardar} loading={saving} loadingText="Guardando...">📅 Convocar</Button>
          </>}
        >
          {/* Columnas que se acomodan al ancho: con `1fr 1fr` fijo cada campo
              quedaba a media pantalla del teléfono. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '14px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="asam-titulo" style={labelStyle}>Título *</label>
              <input id="asam-titulo" value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} placeholder="Ej. Asamblea Ordinaria Abril 2026"
                style={inputStyle} autoFocus />
            </div>
            <div>
              <label htmlFor="asam-tipo" style={labelStyle}>Tipo</label>
              <select id="asam-tipo" value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value as TipoAsamblea }))}
                style={inputStyle}>
                <option value="ordinaria">Ordinaria</option>
                <option value="extraordinaria">Extraordinaria</option>
              </select>
            </div>
            <div>
              <label htmlFor="asam-quorum" style={labelStyle}>Quórum requerido (%)</label>
              <input id="asam-quorum" type="number" value={form.quorum_requerido} onChange={e => setForm(f => ({ ...f, quorum_requerido: e.target.value }))} min="1" max="100"
                style={inputStyle} />
            </div>
            <div>
              <label htmlFor="asam-fecha" style={labelStyle}>Fecha *</label>
              <input id="asam-fecha" type="date" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))}
                style={inputStyle} />
            </div>
            <div>
              <label htmlFor="asam-hora-inicio" style={labelStyle}>Hora inicio *</label>
              <input id="asam-hora-inicio" type="time" value={form.hora_inicio} onChange={e => setForm(f => ({ ...f, hora_inicio: e.target.value }))}
                style={inputStyle} />
            </div>
            <div>
              <label htmlFor="asam-hora-fin" style={labelStyle}>Hora fin</label>
              <input id="asam-hora-fin" type="time" value={form.hora_fin} onChange={e => setForm(f => ({ ...f, hora_fin: e.target.value }))}
                style={inputStyle} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="asam-lugar" style={labelStyle}>Lugar</label>
              <input id="asam-lugar" value={form.lugar} onChange={e => setForm(f => ({ ...f, lugar: e.target.value }))} placeholder="Salón de reuniones, Área BBQ..."
                style={inputStyle} />
            </div>
          </div>
        </EditModal>
      )}

      {/* Lista — cada asamblea abre su agenda en ventana. Antes la agenda iba
          en una columna al lado que en el teléfono dejaba la lista en una
          franja y la votación fuera de la pantalla. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {filtradas.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>🏛️</div>
            <p style={{ fontWeight: 600, color: 'var(--at-ink-3)' }}>No hay asambleas</p>
          </div>
        ) : filtradas.map(a => {
          const ec = ESTADO_CONFIG[a.estado]
          return (
            <div key={a.id}
              style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '14px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 10px', paddingRight: '14px' }}>
              <button type="button" className="cond-row-main" onClick={() => cargarPuntos(a.id)}
                style={{ flex: '1 1 260px', minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: '14px 4px 14px 16px', cursor: 'pointer', font: 'inherit', color: 'inherit' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                  <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>{a.titulo}</span>
                  <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, background: 'var(--at-chip)', color: 'var(--at-ink-3)' }}>{a.tipo}</span>
                </div>
                <div style={{ fontSize: '12.5px', color: 'var(--at-ink-3)', display: 'flex', gap: '4px 10px', flexWrap: 'wrap' }}>
                  <span>📅 {a.fecha} {a.hora_inicio}</span>
                  {a.lugar && <span>📍 {a.lugar}</span>}
                  <span>{a.quorum_alcanzado != null
                    ? `Quórum: ${pct(a.quorum_alcanzado)} de ${pct(a.quorum_requerido)}`
                    : `Quórum requerido: ${pct(a.quorum_requerido)}`}</span>
                </div>
              </button>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0, marginLeft: 'auto', padding: '8px 0' }}>
                {canEdit && TRANSICIONES[a.estado].length > 0 ? (
                  <select value={a.estado} onChange={e => cambiarEstado(a.id, e.target.value as EstadoAsamblea)} aria-label={`Estado de ${a.titulo}`}
                    style={{ padding: '3px 8px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 700, border: 'none', cursor: 'pointer', background: ec.bg, color: ec.color }}>
                    {[a.estado, ...TRANSICIONES[a.estado]].map(v => (
                      <option key={v} value={v}>{ESTADO_CONFIG[v].label}</option>
                    ))}
                  </select>
                ) : (
                  <span style={{ padding: '3px 8px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 700, background: ec.bg, color: ec.color }}>{ec.label}</span>
                )}
                {canDelete && <button onClick={() => eliminar(a.id)} aria-label={`Eliminar ${a.titulo}`} title="Eliminar" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--at-danger)', fontSize: '14px', padding: '4px 6px' }}>🗑</button>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Agenda y votación en ventana (a pantalla completa en el teléfono). */}
      {selectedId && selectedAsamblea && (() => {
        const ec = ESTADO_CONFIG[selectedAsamblea.estado]
        // Finalizada o cancelada: la base ya no acepta cambios en la agenda.
        const agendaAbierta = canEdit && TRANSICIONES[selectedAsamblea.estado].length > 0
        const enCurso = selectedAsamblea.estado === 'en_curso'
        // Votan las unidades del padrón (tomado al abrir); sin padrón (programada,
        // o una lectura fallida), las activas de hoy, como antes.
        const votantes = padron.length > 0
          ? padron.map(p => ({ id: p.unidad_id, nombre: p.unidad_nombre }))
          : unidades.filter(u => u.activo).map(u => ({ id: u.id, nombre: u.nombre }))
        const porAlicuota = escrutinio?.base === 'alicuota'
        const asistenciaDe = new Map(asistencia.map(s => [s.unidad_id, s]))
        const votaron = new Set(puntos.flatMap(p => (p.votos ?? []).map(v => v.unidad_id)))
        const escrutinioDe = new Map((escrutinio?.puntos ?? []).map(e => [e.punto_id, e]))
        return (
          <EditModal
            title={selectedAsamblea.titulo}
            subtitle={<span style={{ display: 'inline-flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: ec.bg, color: ec.color }}>{ec.label}</span>
              <span>{selectedAsamblea.tipo} · 📅 {selectedAsamblea.fecha} {selectedAsamblea.hora_inicio}{selectedAsamblea.lugar ? ` · 📍 ${selectedAsamblea.lugar}` : ''}</span>
            </span>}
            maxWidth="720px"
            fullScreenOnMobile
            onClose={cerrarDetalle}
            footer={agendaAbierta ? (
              <Button variant="secondary" onClick={() => setShowPuntoForm(v => !v)} aria-expanded={showPuntoForm}>+ Punto</Button>
            ) : undefined}
          >
            {escrutinio && (
              <section aria-label="Quórum" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 14px', background: 'var(--at-surface-2)', borderRadius: '10px', padding: '10px 14px', marginBottom: '14px', fontSize: '12.5px', color: 'var(--at-ink-2)' }}>
                <strong style={{ color: 'var(--at-ink)' }}>Quórum</strong>
                <span>Presentes {escrutinio.presentes.unidades} de {escrutinio.padron.unidades}{porAlicuota ? ` · ${pct(escrutinio.quorum_pct)} de las alícuotas` : ` (${pct(escrutinio.quorum_pct)})`}</span>
                <span>Requerido {pct(escrutinio.quorum_requerido)}</span>
                <span>{porAlicuota ? 'Vota por alícuota' : 'Vota por unidad'}</span>
                <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 700,
                  background: escrutinio.hay_quorum ? 'var(--at-success-tint)' : 'var(--at-danger-tint)',
                  color: escrutinio.hay_quorum ? 'var(--at-success)' : 'var(--at-danger)' }}>
                  {escrutinio.hay_quorum ? 'Hay quórum' : 'Sin quórum'}
                </span>
              </section>
            )}

            {/* Asistencia: en curso se toma; cerrada queda a la vista. Votar
                también cuenta como presente (el voto del portal es asistencia
                virtual). */}
            {padron.length > 0 && (enCurso || asistencia.length > 0) && (
              <details style={{ marginBottom: '14px' }} open={enCurso && canEdit}>
                <summary style={{ cursor: 'pointer', fontSize: '12.5px', fontWeight: 600, color: 'var(--at-ink-2)' }}>
                  Asistencia · {asistencia.length} registradas
                </summary>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
                  {padron.map(u => {
                    const s = asistenciaDe.get(u.unidad_id)
                    return (
                      <div key={u.unidad_id}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '12.5px' }}>
                          <span style={{ flex: '1 1 140px', color: 'var(--at-ink-2)' }}>
                            {u.unidad_nombre}{porAlicuota && <span style={{ color: 'var(--at-ink-3)' }}> · {pct(u.peso)}</span>}
                          </span>
                          {s ? (
                            <>
                              <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, background: 'var(--at-success-tint)', color: 'var(--at-success)' }}>
                                {MODALIDAD_LABEL[s.modalidad]}{s.apoderado_nombre ? `: ${s.apoderado_nombre}` : ''}
                              </span>
                              {s.poder_documento && <SecureFileLink src={s.poder_documento} style={{ fontSize: '11.5px' }}>Ver poder</SecureFileLink>}
                              {canEdit && enCurso && (
                                <button onClick={() => quitarAsistencia(s.id)} aria-label={`Quitar asistencia — ${u.unidad_nombre}`}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--at-ink-3)', fontSize: '11.5px' }}>Quitar</button>
                              )}
                            </>
                          ) : votaron.has(u.unidad_id) ? (
                            <span style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>Votó (presente)</span>
                          ) : canEdit && enCurso ? (
                            (['presencial', 'virtual', 'poder'] as ModalidadAsistencia[]).map(m => (
                              <button key={m} aria-label={`${MODALIDAD_LABEL[m]} — ${u.unidad_nombre}`}
                                onClick={() => m === 'poder' ? abrirPoder(u.unidad_id) : registrarAsistencia(u.unidad_id, m)}
                                style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', border: '1px solid var(--at-line)', background: 'var(--at-surface)', color: 'var(--at-ink-3)' }}>
                                {MODALIDAD_LABEL[m]}
                              </button>
                            ))
                          ) : (
                            <span style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>Ausente</span>
                          )}
                        </div>
                        {poder?.unidadId === u.unidad_id && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'var(--at-surface-2)', borderRadius: '8px', padding: '10px', marginTop: '6px' }}>
                            <input value={poder.apoderado} onChange={e => setPoder(p => p && { ...p, apoderado: e.target.value })}
                              placeholder="Nombre del apoderado" aria-label={`Apoderado de ${u.unidad_nombre}`} style={puntoInputStyle} autoFocus />
                            <FileUploader value={poder.documento} onChange={documento => setPoder(p => p && { ...p, documento })}
                              folder="asambleas/poderes" label="Documento del poder" />
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button onClick={guardarPoder} disabled={!poder.apoderado.trim() || !poder.documento}
                                style={{ padding: '7px 14px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontWeight: 600, fontSize: '12.5px', opacity: !poder.apoderado.trim() || !poder.documento ? 0.5 : 1 }}>
                                Guardar poder
                              </button>
                              <button onClick={descartarPoder} aria-label="Cancelar poder" style={{ padding: '7px 12px', background: 'var(--at-chip)', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '12.5px' }}>✕</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </details>
            )}

            <p style={{ margin: '0 0 14px', fontSize: '12.5px', color: 'var(--at-ink-3)' }}>
              <strong style={{ color: 'var(--at-ink)' }}>Agenda</strong> · {puntos.length} puntos · {votantes.length} {padron.length > 0 ? 'unidades en el padrón' : 'unidades'}
            </p>

            {agendaAbierta && showPuntoForm && (
              <div style={{ background: 'var(--at-surface-2)', borderRadius: '10px', padding: '14px', marginBottom: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {/* autoFocus: el botón que lo abre está al pie, así el campo queda a la vista. */}
                <input value={puntoForm.titulo} onChange={e => setPuntoForm(f => ({ ...f, titulo: e.target.value }))} placeholder="Título del punto" aria-label="Título del punto"
                  style={puntoInputStyle} autoFocus />
                <input value={puntoForm.descripcion} onChange={e => setPuntoForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Descripción (opcional)" aria-label="Descripción del punto"
                  style={puntoInputStyle} />
                <div style={{ display: 'flex', gap: '8px' }}>
                  <select value={puntoForm.tipo} onChange={e => setPuntoForm(f => ({ ...f, tipo: e.target.value as TipoPunto }))} aria-label="Tipo de punto"
                    style={{ ...puntoInputStyle, flex: 1, width: 'auto', minWidth: 0 }}>
                    <option value="informativo">Informativo</option>
                    <option value="votacion">Votación</option>
                    <option value="debate">Debate</option>
                  </select>
                  {puntoForm.tipo === 'votacion' && (
                    <select value={puntoForm.mayoria} onChange={e => setPuntoForm(f => ({ ...f, mayoria: e.target.value as TipoMayoria }))} aria-label="Mayoría"
                      title={MAYORIA_CONFIG[puntoForm.mayoria].regla}
                      style={{ ...puntoInputStyle, flex: 1, width: 'auto', minWidth: 0 }}>
                      {(Object.keys(MAYORIA_CONFIG) as TipoMayoria[]).map(m => <option key={m} value={m}>{MAYORIA_CONFIG[m].label}</option>)}
                    </select>
                  )}
                  {puntoForm.tipo === 'votacion' && puntoForm.mayoria === 'calificada' && (
                    <input type="number" min="50.01" max="100" step="0.01" value={puntoForm.mayoria_pct}
                      onChange={e => setPuntoForm(f => ({ ...f, mayoria_pct: e.target.value }))} aria-label="Porcentaje del padrón"
                      style={{ ...puntoInputStyle, width: '84px' }} />
                  )}
                  <button onClick={agregarPunto} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>Agregar</button>
                  <button onClick={() => setShowPuntoForm(false)} aria-label="Cancelar punto" style={{ padding: '8px 12px', background: 'var(--at-chip)', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '13px' }}>✕</button>
                </div>
              </div>
            )}

            {loadingPuntos ? (
              <p style={{ color: 'var(--at-ink-3)', fontSize: '13px' }}>Cargando...</p>
            ) : puntos.length === 0 ? (
              <p style={{ color: 'var(--at-ink-3)', fontSize: '13px', textAlign: 'center', padding: '20px' }}>No hay puntos en la agenda. Agrega el primero.</p>
            ) : (
              // Sin tope de alto propio: la ventana ya se desplaza y dos barras
              // anidadas en el teléfono atrapaban el gesto.
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {puntos.map((p, idx) => {
                  const votosMap = Object.fromEntries((p.votos ?? []).map(v => [v.unidad_id, v.voto]))
                  // Con escrutinio, el de la base (sólo el padrón, con su peso);
                  // sin él, el conteo de los votos registrados.
                  const esc: EscrutinioPunto | undefined = escrutinioDe.get(p.id)
                  const conteo = { a_favor: 0, en_contra: 0, abstencion: 0 }
                  if (esc) (['a_favor', 'en_contra', 'abstencion'] as TipoVoto[]).forEach(v => { conteo[v] = esc[v].unidades })
                  else Object.values(votosMap).forEach(v => { if (v in conteo) conteo[v as TipoVoto]++ })
                  const totalVotos = Object.values(conteo).reduce((a, b) => a + b, 0)
                  const decision = selectedAsamblea.estado === 'finalizada' ? esc?.decision : undefined

                  return (
                    <div key={p.id} style={{ border: '1px solid var(--at-line)', borderRadius: '10px', overflow: 'hidden' }}>
                      <div style={{ background: 'var(--at-surface-2)', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--at-primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 800, flexShrink: 0 }}>{idx + 1}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontWeight: 700, fontSize: '13.5px', color: 'var(--at-ink)' }}>{p.titulo}</span>
                          {p.descripcion && <span style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginLeft: '8px' }}>{p.descripcion}</span>}
                        </div>
                        {p.tipo === 'votacion' && (
                          <span title={MAYORIA_CONFIG[p.mayoria ?? 'simple'].regla} style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{etiquetaMayoria(p)}</span>
                        )}
                        <span style={{ fontSize: '11px', padding: '2px 7px', borderRadius: '20px', background: p.tipo === 'votacion' ? 'var(--at-primary-tint)' : 'var(--at-chip)', color: p.tipo === 'votacion' ? 'var(--at-primary)' : 'var(--at-ink-3)', fontWeight: 600 }}>{p.tipo}</span>
                      </div>

                      {p.tipo === 'votacion' && (
                        <div style={{ padding: '12px 14px' }}>
                          {/* Resultados */}
                          {decision && (
                            <p style={{ margin: '0 0 8px' }}>
                              <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, background: DECISION_CONFIG[decision].bg, color: DECISION_CONFIG[decision].color }}>
                                {DECISION_CONFIG[decision].label}
                              </span>
                            </p>
                          )}
                          {!decision && selectedAsamblea.estado === 'finalizada' && p.resultado && (
                            <p style={{ margin: '0 0 8px', fontSize: '12.5px', color: 'var(--at-ink-2)' }}>Resultado: {p.resultado}</p>
                          )}
                          {totalVotos > 0 && (
                            <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
                              {(['a_favor', 'en_contra', 'abstencion'] as TipoVoto[]).map(v => (
                                <span key={v} style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, background: VOTO_CONFIG[v].bg, color: VOTO_CONFIG[v].color }}>
                                  {VOTO_CONFIG[v].label}: {conteo[v]}{porAlicuota && esc ? ` · ${pct(esc[v].peso)}` : ''}
                                </span>
                              ))}
                              <span style={{ fontSize: '12px', color: 'var(--at-ink-3)', alignSelf: 'center' }}>Total: {totalVotos}/{votantes.length}</span>
                            </div>
                          )}
                          {/* Registro de votos por unidad */}
                          {canEdit && enCurso && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '160px', overflowY: 'auto' }}>
                              {votantes.map(u => (
                                <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px' }}>
                                  <span style={{ flex: 1, color: 'var(--at-ink-2)' }}>{u.nombre}</span>
                                  {(['a_favor', 'en_contra', 'abstencion'] as TipoVoto[]).map(v => (
                                    <button key={v} onClick={() => registrarVoto(p.id, u.id, v)}
                                      aria-label={`${VOTO_CONFIG[v].label} — ${u.nombre}`} aria-pressed={votosMap[u.id] === v}
                                      style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', border: '1px solid',
                                        borderColor: votosMap[u.id] === v ? VOTO_CONFIG[v].color : 'var(--at-line)',
                                        background: votosMap[u.id] === v ? VOTO_CONFIG[v].bg : 'var(--at-surface)',
                                        color: votosMap[u.id] === v ? VOTO_CONFIG[v].color : 'var(--at-ink-3)' }}>
                                      {v === 'a_favor' ? '✓' : v === 'en_contra' ? '✗' : '—'}
                                    </button>
                                  ))}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Acta */}
            {canEdit && selectedAsamblea.estado === 'finalizada' && (
              <div style={{ marginTop: '16px', borderTop: '1px solid var(--at-line)', paddingTop: '14px' }}>
                <label htmlFor="asam-acta" style={{ ...labelStyle, marginBottom: '6px' }}>📝 Acta de la asamblea</label>
                <textarea id="asam-acta" ref={actaRef} defaultValue={selectedAsamblea.acta ?? ''} onBlur={e => guardarActa(selectedAsamblea.id, e.target.value)} rows={4} placeholder="Redacta el acta de la asamblea..."
                  style={{ ...inputStyle, fontSize: '13.5px', resize: 'vertical' }} />
              </div>
            )}
            {selectedAsamblea.acta && selectedAsamblea.estado !== 'en_curso' && !canEdit && (
              <div style={{ marginTop: '14px', borderTop: '1px solid var(--at-line)', paddingTop: '12px' }}>
                <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '6px' }}>📝 Acta</p>
                <p style={{ fontSize: '13.5px', color: 'var(--at-ink-2)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{selectedAsamblea.acta}</p>
              </div>
            )}
          </EditModal>
        )
      })()}
    </div>
  )
}
