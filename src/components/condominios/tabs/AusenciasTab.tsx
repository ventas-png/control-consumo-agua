import { useMemo, useState, type CSSProperties } from 'react'
import {
  createCondominioRow,
  deleteCondominioRow,
  updateCondominioRow,
} from '../../../domain/condominios/tabMutations'
import { diasDeAusencia, diasHabilesDeAusencia } from '../../../domain/condominios/turnos'
import { hoyLocalISO } from '../../../lib/format'
import { confirm, notify } from '../../shared/Dialog'
import { EditModal, EmptyState } from '../../shared'
import { TabStrip } from '../../shared/TabStrip'
import type {
  AusenciaPersonal,
  DiaNoLaborable,
  EstadoAusencia,
  PersonalCondominio,
  TipoAusencia,
  TipoDiaNoLaborable,
} from '../../../types'

interface Props {
  ausencias: AusenciaPersonal[]
  diasNoLaborables: DiaNoLaborable[]
  personal: PersonalCondominio[]
  proyectoId: string
  companyId: string
  userId?: string | null
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

type Vista = 'ausencias' | 'calendario'

const TIPOS_AUSENCIA: { value: TipoAusencia; label: string; icon: string; goce: boolean }[] = [
  { value: 'vacaciones',       label: 'Vacaciones',        icon: '🌴', goce: true },
  { value: 'permiso_goce',     label: 'Permiso con goce',  icon: '📄', goce: true },
  { value: 'permiso_sin_goce', label: 'Permiso sin goce',  icon: '📃', goce: false },
  { value: 'incapacidad',      label: 'Incapacidad',       icon: '🏥', goce: true },
  { value: 'suspension',       label: 'Suspensión',        icon: '⛔', goce: false },
  { value: 'falta',            label: 'Falta',             icon: '❗', goce: false },
  { value: 'licencia',         label: 'Licencia',          icon: '🗂️', goce: true },
]

const ESTADOS: { value: EstadoAusencia; label: string; color: string; bg: string }[] = [
  { value: 'solicitada', label: 'Solicitada', color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
  { value: 'aprobada',   label: 'Aprobada',   color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  { value: 'rechazada',  label: 'Rechazada',  color: 'var(--at-danger)',  bg: 'var(--at-danger-tint)' },
  { value: 'cancelada',  label: 'Cancelada',  color: 'var(--at-ink-3)',   bg: 'var(--at-chip)' },
]

const TIPOS_DIA: { value: TipoDiaNoLaborable; label: string }[] = [
  { value: 'festivo_nacional',   label: 'Festivo nacional' },
  { value: 'asueto_local',       label: 'Asueto local' },
  { value: 'suspension_labores', label: 'Suspensión de labores' },
  { value: 'dia_no_laboral',     label: 'Día no laboral' },
]

const inp: CSSProperties = {
  width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)',
  borderRadius: 6, fontSize: 13, background: 'var(--at-surface)', color: 'var(--at-ink)',
}
const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

const formAusenciaVacio = {
  personal_id: '', tipo: 'vacaciones' as TipoAusencia,
  fecha_inicio: hoyLocalISO(), fecha_fin: hoyLocalISO(),
  goce_salario: true, aprobar_ya: false, motivo: '',
}

const formDiaVacio = {
  fecha: hoyLocalISO(), nombre: '', tipo: 'festivo_nacional' as TipoDiaNoLaborable,
  recurre_anual: true, paga_recargo: true, factor_recargo: '2.00',
}

/**
 * Ausencias del personal y calendario laboral del condominio.
 *
 * Las dos caras de "qué días NO se trabaja":
 *   · Ausencias   de una persona y con rango (vacaciones, permisos,
 *                 incapacidades, suspensiones). Sustituye a la bandera de un
 *                 clic de PersonalTab, que no sabía cuándo vuelve la persona.
 *   · Calendario  del condominio entero (festivos y asuetos), con el factor de
 *                 recargo que se paga a quien lo cubre.
 *
 * Ambas alimentan la generación de turnos: `generar_bloques_turno()` se salta
 * los días cubiertos por una ausencia APROBADA y los no laborables, salvo que
 * la regla declare cubrirlos.
 */
export default function AusenciasTab({
  ausencias, diasNoLaborables, personal, proyectoId, companyId, userId,
  canCreate, canEdit, onRefresh,
}: Props) {
  const hoy = hoyLocalISO()
  const [vista, setVista] = useState<Vista>('ausencias')
  const [filtroEstado, setFiltroEstado] = useState<EstadoAusencia | 'todas'>('todas')
  const [saving, setSaving] = useState(false)
  const [modalAusencia, setModalAusencia] = useState<AusenciaPersonal | 'nueva' | null>(null)
  const [modalDia, setModalDia] = useState<DiaNoLaborable | 'nuevo' | null>(null)
  const [formAusencia, setFormAusencia] = useState(formAusenciaVacio)
  const [formDia, setFormDia] = useState(formDiaVacio)

  const nombrePorId = useMemo(
    () => Object.fromEntries(personal.map(p => [p.id, p.nombre])) as Record<string, string>,
    [personal],
  )

  const visibles = useMemo(
    () => filtroEstado === 'todas' ? ausencias : ausencias.filter(a => a.estado === filtroEstado),
    [ausencias, filtroEstado],
  )

  const kpis = useMemo(() => ({
    pendientes: ausencias.filter(a => a.estado === 'solicitada').length,
    vigentes: ausencias.filter(a => a.estado === 'aprobada' && a.fecha_inicio <= hoy && a.fecha_fin >= hoy).length,
    proximas: ausencias.filter(a => a.estado === 'aprobada' && a.fecha_inicio > hoy).length,
    festivos: diasNoLaborables.length,
  }), [ausencias, diasNoLaborables, hoy])

  // ── Ausencias ─────────────────────────────────────────────────────────────

  function abrirAusencia(a: AusenciaPersonal | 'nueva') {
    setFormAusencia(a === 'nueva' ? formAusenciaVacio : {
      personal_id: a.personal_id, tipo: a.tipo,
      fecha_inicio: a.fecha_inicio, fecha_fin: a.fecha_fin,
      goce_salario: a.goce_salario, aprobar_ya: a.estado === 'aprobada',
      motivo: a.motivo ?? '',
    })
    setModalAusencia(a)
  }

  async function guardarAusencia() {
    if (!formAusencia.personal_id) {
      notify({ variant: 'warning', title: 'Faltan datos', text: 'Elegí al empleado' }); return
    }
    if (formAusencia.fecha_fin < formAusencia.fecha_inicio) {
      notify({ variant: 'warning', title: 'Rango inválido', text: 'La ausencia termina antes de empezar' }); return
    }
    setSaving(true)
    const aprobada = formAusencia.aprobar_ya
    const payload: Record<string, unknown> = {
      personal_id: formAusencia.personal_id,
      tipo: formAusencia.tipo,
      fecha_inicio: formAusencia.fecha_inicio,
      fecha_fin: formAusencia.fecha_fin,
      dias_habiles: diasHabilesDeAusencia(formAusencia, diasNoLaborables),
      goce_salario: formAusencia.goce_salario,
      estado: aprobada ? 'aprobada' : 'solicitada',
      motivo: formAusencia.motivo.trim() || null,
    }
    // El alta directa en estado aprobada la sella la UI: `sellar_cierre` es
    // BEFORE UPDATE (convención del repo) y no dispara en el INSERT.
    if (aprobada && modalAusencia === 'nueva') {
      payload.aprobada_por = userId ?? null
      payload.aprobada_en = new Date().toISOString()
    }
    const { error } = modalAusencia === 'nueva'
      ? await createCondominioRow('ausencias_personal', { company_id: companyId, project_id: proyectoId, ...payload })
      : await updateCondominioRow('ausencias_personal', (modalAusencia as AusenciaPersonal).id, payload)
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setModalAusencia(null)
    onRefresh()
  }

  async function cambiarEstado(a: AusenciaPersonal, estado: EstadoAusencia) {
    // `aprobada_por` lo sella la BD en el UPDATE (trg_sellar_cierre); aquí solo
    // se marca el hito.
    const patch: Record<string, unknown> = { estado }
    if (estado === 'aprobada') patch.aprobada_en = new Date().toISOString()
    const { error } = await updateCondominioRow('ausencias_personal', a.id, patch)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
  }

  async function borrarAusencia(a: AusenciaPersonal) {
    const { isConfirmed } = await confirm({
      title: 'Eliminar la ausencia',
      text: 'Los turnos que se dejaron de generar por esta ausencia no se recuperan solos: volvé a generar el mes si hace falta.',
      variant: 'danger', confirmText: 'Eliminar',
    })
    if (!isConfirmed) return
    const { error } = await deleteCondominioRow('ausencias_personal', a.id)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
  }

  // ── Calendario laboral ────────────────────────────────────────────────────

  function abrirDia(d: DiaNoLaborable | 'nuevo') {
    setFormDia(d === 'nuevo' ? formDiaVacio : {
      fecha: d.fecha, nombre: d.nombre, tipo: d.tipo,
      recurre_anual: d.recurre_anual, paga_recargo: d.paga_recargo,
      factor_recargo: String(d.factor_recargo),
    })
    setModalDia(d)
  }

  async function guardarDia() {
    if (!formDia.nombre.trim()) {
      notify({ variant: 'warning', title: 'Faltan datos', text: 'Poné el nombre del día (Navidad, feria titular…)' }); return
    }
    setSaving(true)
    const payload = {
      fecha: formDia.fecha,
      nombre: formDia.nombre.trim(),
      tipo: formDia.tipo,
      recurre_anual: formDia.recurre_anual,
      paga_recargo: formDia.paga_recargo,
      factor_recargo: Number(formDia.factor_recargo) || 1,
    }
    const { error } = modalDia === 'nuevo'
      ? await createCondominioRow('dias_no_laborables', { company_id: companyId, project_id: proyectoId, ...payload })
      : await updateCondominioRow('dias_no_laborables', (modalDia as DiaNoLaborable).id, payload)
    setSaving(false)
    if (error) {
      // El único conflicto posible es el índice único (project_id, fecha).
      const dup = /duplicate key|unique/i.test(error.message)
      notify({
        variant: 'error',
        title: dup ? 'Ya hay un día registrado en esa fecha' : 'Error',
        text: dup ? 'Editá el existente en vez de crear otro.' : error.message,
      })
      return
    }
    setModalDia(null)
    onRefresh()
  }

  async function borrarDia(d: DiaNoLaborable) {
    const { isConfirmed } = await confirm({
      title: `Eliminar «${d.nombre}»`,
      text: 'Los turnos generados no cambian; sí cambia el recargo que se computa a partir de ahora.',
      variant: 'danger', confirmText: 'Eliminar',
    })
    if (!isConfirmed) return
    const { error } = await deleteCondominioRow('dias_no_laborables', d.id)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: 16 }}>
      <TabStrip
        items={[
          { id: 'ausencias', label: `Ausencias (${ausencias.length})`, icon: '🌴' },
          { id: 'calendario', label: `Días no laborables (${diasNoLaborables.length})`, icon: '📅' },
        ]}
        value={vista}
        onChange={setVista}
        ariaLabel="Vistas de ausencias y calendario laboral"
        marginBottom={16}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 16 }}>
        {[
          { label: 'Por autorizar', val: kpis.pendientes, color: kpis.pendientes ? 'var(--at-warning)' : 'var(--at-ink-3)' },
          { label: 'Ausentes hoy', val: kpis.vigentes, color: kpis.vigentes ? 'var(--at-accent)' : 'var(--at-ink-3)' },
          { label: 'Próximas', val: kpis.proximas, color: 'var(--at-primary)' },
          { label: 'Días no laborables', val: kpis.festivos, color: 'var(--at-ink-2)' },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--at-surface-2)', borderRadius: 10, padding: '10px 12px', textAlign: 'center', border: '1px solid var(--at-line)' }}>
            <div style={{ fontSize: 19, fontWeight: 800, color: k.color }}>{k.val}</div>
            <div style={{ fontSize: 10.5, color: 'var(--at-ink-3)' }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* ── Ausencias ── */}
      {vista === 'ausencias' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(['todas', ...ESTADOS.map(e => e.value)] as const).map(e => (
                <button
                  key={e}
                  onClick={() => setFiltroEstado(e)}
                  style={{
                    padding: '5px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
                    background: filtroEstado === e ? 'var(--at-accent)' : 'var(--at-chip)',
                    color: filtroEstado === e ? 'var(--at-on-status)' : 'var(--at-ink-2)',
                    border: `1px solid ${filtroEstado === e ? 'var(--at-accent)' : 'var(--at-line)'}`,
                  }}
                >{e === 'todas' ? 'Todas' : ESTADOS.find(x => x.value === e)?.label}</button>
              ))}
            </div>
            {canCreate && (
              <button onClick={() => abrirAusencia('nueva')} style={{ padding: '8px 16px', background: 'var(--at-accent)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                + Registrar ausencia
              </button>
            )}
          </div>

          {visibles.length === 0 ? (
            <EmptyState
              icon="🌴"
              title={ausencias.length === 0 ? 'Sin ausencias registradas' : 'Nada con ese filtro'}
              description={ausencias.length === 0
                ? 'Registrá vacaciones, permisos, incapacidades y suspensiones con su rango de fechas: el calendario de turnos deja de asignar esos días automáticamente.'
                : 'Probá con otro estado.'}
            />
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {visibles.map(a => {
                const tipo = TIPOS_AUSENCIA.find(t => t.value === a.tipo)
                const est = ESTADOS.find(e => e.value === a.estado)
                const vigente = a.estado === 'aprobada' && a.fecha_inicio <= hoy && a.fecha_fin >= hoy
                return (
                  <div key={a.id} style={{
                    background: 'var(--at-surface)', border: `1px solid ${vigente ? 'var(--at-accent)' : 'var(--at-line)'}`,
                    borderRadius: 10, padding: '10px 14px',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                  }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 240, flex: 1 }}>
                      <span style={{ fontSize: 20 }}>{tipo?.icon}</span>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--at-ink)' }}>
                          {a.personal_nombre ?? nombrePorId[a.personal_id] ?? 'Empleado'}
                          <span style={{ fontWeight: 400, color: 'var(--at-ink-3)' }}> · {tipo?.label}</span>
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--at-ink-3)', marginTop: 2 }}>
                          {a.fecha_inicio} → {a.fecha_fin} · {diasDeAusencia(a)} días
                          {a.dias_habiles != null && ` (${a.dias_habiles} hábiles)`}
                          {!a.goce_salario && ' · sin goce'}
                          {vigente && <span style={{ color: 'var(--at-accent)', fontWeight: 600 }}> · en curso</span>}
                        </div>
                        {a.motivo && <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 2 }}>{a.motivo}</div>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: est?.bg, color: est?.color }}>
                        {est?.label}
                      </span>
                      {canEdit && a.estado === 'solicitada' && (
                        <>
                          <button onClick={() => cambiarEstado(a, 'aprobada')} style={{ padding: '5px 10px', background: 'var(--at-success-tint)', border: '1px solid var(--at-success-border)', borderRadius: 6, cursor: 'pointer', fontSize: 11, color: 'var(--at-success)' }}>
                            ✔ Autorizar
                          </button>
                          <button onClick={() => cambiarEstado(a, 'rechazada')} style={{ padding: '5px 10px', background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', borderRadius: 6, cursor: 'pointer', fontSize: 11, color: 'var(--at-danger)' }}>
                            ✕ Denegar
                          </button>
                        </>
                      )}
                      {canEdit && a.estado === 'aprobada' && (
                        <button onClick={() => cambiarEstado(a, 'cancelada')} style={{ padding: '5px 10px', background: 'var(--at-chip)', border: '1px solid var(--at-line)', borderRadius: 6, cursor: 'pointer', fontSize: 11, color: 'var(--at-ink)' }}>
                          Cancelar
                        </button>
                      )}
                      {canEdit && (
                        <>
                          <button onClick={() => abrirAusencia(a)} style={{ padding: '5px 10px', background: 'var(--at-chip)', border: '1px solid var(--at-line)', borderRadius: 6, cursor: 'pointer', fontSize: 11, color: 'var(--at-ink)' }}>Editar</button>
                          <button onClick={() => borrarAusencia(a)} style={{ padding: '5px 10px', background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', borderRadius: 6, cursor: 'pointer', fontSize: 11, color: 'var(--at-danger)' }}>Eliminar</button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* ── Calendario laboral ── */}
      {vista === 'calendario' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            <div style={{ fontSize: 12.5, color: 'var(--at-ink-3)' }}>
              Los días que este condominio no labora. Las reglas de turno los saltan, salvo las que declaran cubrirlos.
            </div>
            {canCreate && (
              <button onClick={() => abrirDia('nuevo')} style={{ padding: '8px 16px', background: 'var(--at-accent)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                + Agregar día
              </button>
            )}
          </div>

          {diasNoLaborables.length === 0 ? (
            <EmptyState
              icon="📅"
              title="Sin días no laborables registrados"
              description="Cargá los festivos del año y los asuetos locales. A partir de ahí, quien cubra uno de esos días verá sus horas computadas con el recargo que corresponda."
            />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10 }}>
              {diasNoLaborables.map(d => (
                <div key={d.id} style={{
                  background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 10,
                  padding: 12, borderLeft: `4px solid ${d.paga_recargo ? 'var(--at-warning)' : 'var(--at-line-strong)'}`,
                }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--at-ink)' }}>{d.nombre}</div>
                  <div style={{ fontSize: 12, color: 'var(--at-ink-2)', marginTop: 3 }}>{d.fecha}</div>
                  <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 3 }}>
                    {TIPOS_DIA.find(t => t.value === d.tipo)?.label}
                    {d.recurre_anual && ' · anual'}
                  </div>
                  <div style={{ fontSize: 11, color: d.paga_recargo ? 'var(--at-warning)' : 'var(--at-ink-3)', marginTop: 3 }}>
                    {d.paga_recargo ? `Trabajarlo se paga ×${Number(d.factor_recargo).toFixed(2)}` : 'Sin recargo'}
                  </div>
                  {canEdit && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                      <button onClick={() => abrirDia(d)} style={{ padding: '4px 10px', background: 'var(--at-chip)', border: '1px solid var(--at-line)', borderRadius: 6, cursor: 'pointer', fontSize: 11, color: 'var(--at-ink)' }}>Editar</button>
                      <button onClick={() => borrarDia(d)} style={{ padding: '4px 10px', background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', borderRadius: 6, cursor: 'pointer', fontSize: 11, color: 'var(--at-danger)' }}>Eliminar</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Modal de ausencia ── */}
      {modalAusencia && (
        <EditModal
          title={modalAusencia === 'nueva' ? 'Registrar ausencia' : 'Editar ausencia'}
          subtitle="Con rango de fechas: el calendario de turnos deja de asignar esos días"
          onClose={() => setModalAusencia(null)}
          size="sm"
          footer={
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setModalAusencia(null)} style={{ padding: '8px 16px', background: 'var(--at-chip)', border: '1px solid var(--at-line)', borderRadius: 8, cursor: 'pointer', color: 'var(--at-ink)' }}>Cancelar</button>
              <button onClick={guardarAusencia} disabled={saving} style={{ padding: '8px 20px', background: 'var(--at-accent)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          }
        >
          <div style={{ display: 'grid', gap: 12 }}>
            <div>
              <label style={lbl} htmlFor="aus-empleado">Empleado *</label>
              <select id="aus-empleado" style={inp} value={formAusencia.personal_id}
                onChange={e => setFormAusencia(p => ({ ...p, personal_id: e.target.value }))}>
                <option value="">Elegir…</option>
                {personal.map(p => <option key={p.id} value={p.id}>{p.nombre} — {p.cargo}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl} htmlFor="aus-tipo">Tipo</label>
              <select id="aus-tipo" style={inp} value={formAusencia.tipo}
                onChange={e => {
                  const tipo = e.target.value as TipoAusencia
                  // El goce por defecto viene del tipo, pero sigue siendo
                  // editable: una suspensión puede ser con o sin goce según el
                  // reglamento interno de cada condominio.
                  setFormAusencia(p => ({
                    ...p, tipo,
                    goce_salario: TIPOS_AUSENCIA.find(t => t.value === tipo)?.goce ?? true,
                  }))
                }}>
                {TIPOS_AUSENCIA.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={lbl} htmlFor="aus-desde">Desde *</label>
                <input id="aus-desde" type="date" style={inp} value={formAusencia.fecha_inicio}
                  onChange={e => setFormAusencia(p => ({
                    ...p, fecha_inicio: e.target.value,
                    fecha_fin: p.fecha_fin < e.target.value ? e.target.value : p.fecha_fin,
                  }))} />
              </div>
              <div>
                <label style={lbl} htmlFor="aus-hasta">Hasta *</label>
                <input id="aus-hasta" type="date" style={inp} value={formAusencia.fecha_fin}
                  onChange={e => setFormAusencia(p => ({ ...p, fecha_fin: e.target.value }))} />
              </div>
            </div>
            <div style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: 'var(--at-ink-2)' }}>
              {diasDeAusencia(formAusencia)} días naturales ·{' '}
              <strong>{diasHabilesDeAusencia(formAusencia, diasNoLaborables)} hábiles</strong>
              <div style={{ fontSize: 10.5, color: 'var(--at-ink-3)', marginTop: 2 }}>
                Los festivos que caen dentro no consumen día: cobrárselos sería quitárselos.
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--at-ink-2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={formAusencia.goce_salario}
                onChange={e => setFormAusencia(p => ({ ...p, goce_salario: e.target.checked }))} />
              Con goce de salario
            </label>
            {modalAusencia === 'nueva' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--at-ink-2)', cursor: 'pointer' }}>
                <input type="checkbox" checked={formAusencia.aprobar_ya}
                  onChange={e => setFormAusencia(p => ({ ...p, aprobar_ya: e.target.checked }))} />
                Ya está autorizada (dejarla aprobada de una vez)
              </label>
            )}
            <div>
              <label style={lbl} htmlFor="aus-motivo">Motivo</label>
              <input id="aus-motivo" style={inp} placeholder="Opcional" value={formAusencia.motivo}
                onChange={e => setFormAusencia(p => ({ ...p, motivo: e.target.value }))} />
            </div>
          </div>
        </EditModal>
      )}

      {/* ── Modal de día no laborable ── */}
      {modalDia && (
        <EditModal
          title={modalDia === 'nuevo' ? 'Nuevo día no laborable' : 'Editar día'}
          onClose={() => setModalDia(null)}
          size="sm"
          footer={
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setModalDia(null)} style={{ padding: '8px 16px', background: 'var(--at-chip)', border: '1px solid var(--at-line)', borderRadius: 8, cursor: 'pointer', color: 'var(--at-ink)' }}>Cancelar</button>
              <button onClick={guardarDia} disabled={saving} style={{ padding: '8px 20px', background: 'var(--at-accent)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          }
        >
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={lbl} htmlFor="dia-fecha">Fecha *</label>
                <input id="dia-fecha" type="date" style={inp} value={formDia.fecha}
                  onChange={e => setFormDia(p => ({ ...p, fecha: e.target.value }))} />
              </div>
              <div>
                <label style={lbl} htmlFor="dia-tipo">Tipo</label>
                <select id="dia-tipo" style={inp} value={formDia.tipo}
                  onChange={e => setFormDia(p => ({ ...p, tipo: e.target.value as TipoDiaNoLaborable }))}>
                  {TIPOS_DIA.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label style={lbl} htmlFor="dia-nombre">Nombre *</label>
              <input id="dia-nombre" style={inp} placeholder="Navidad, feria titular…" value={formDia.nombre}
                onChange={e => setFormDia(p => ({ ...p, nombre: e.target.value }))} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--at-ink-2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={formDia.recurre_anual}
                onChange={e => setFormDia(p => ({ ...p, recurre_anual: e.target.checked }))} />
              Se repite todos los años en la misma fecha
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--at-ink-2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={formDia.paga_recargo}
                onChange={e => setFormDia(p => ({ ...p, paga_recargo: e.target.checked }))} />
              Trabajarlo se paga con recargo
            </label>
            {formDia.paga_recargo && (
              <div>
                <label style={lbl} htmlFor="dia-factor">Factor de recargo</label>
                <input id="dia-factor" type="number" min={1} max={5} step={0.25} style={inp} value={formDia.factor_recargo}
                  onChange={e => setFormDia(p => ({ ...p, factor_recargo: e.target.value }))} />
                <div style={{ fontSize: 10.5, color: 'var(--at-ink-3)', marginTop: 3 }}>
                  2.00 = día doble, el mínimo de ley para asueto trabajado en Guatemala.
                </div>
              </div>
            )}
          </div>
        </EditModal>
      )}
    </div>
  )
}
