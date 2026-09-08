import { hoyLocalISO } from '../../../lib/format'
import { useEffect, useMemo, useState, type CSSProperties} from 'react'
import { createCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { anularPresencia, corregirPresencia, fetchMiFichaPresencia } from '../../../domain/condominios/presenciaAutoservicio'
import { openPromptDialog } from '../../shared/PromptDialog'
import { formatHoras, horasJornada } from '../../../domain/condominios/turnos'
import { notify } from '../../shared/Dialog'
import MarcajeTurno from './presencia/MarcajeTurno'
import { SecureImage } from '../../shared/SecureImage'
import { BUCKET_PRESENCIA } from '../../../domain/shared/buckets'
import { PresenciaPersonal, EstadoPresencia, PersonalCondominio, BloqueTurno, MiFichaPresencia } from '../../../types'

interface Props {
  registros: PresenciaPersonal[]
  /** Plantilla del condominio: el marcaje se ata a un empleado, no a un texto. */
  personal: PersonalCondominio[]
  /** Turnos planificados del día, para atar el marcaje al que le corresponde. */
  bloques: BloqueTurno[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  /** Anular exige `.delete`, no `.edit`: es el acto con forma de borrado —saca
   *  el día de la planilla— aunque no destruya nada. */
  canDelete: boolean
  onRefresh: () => void
}

const ESTADOS_PRESENCIA: { value: EstadoPresencia; label: string; color: string; bg: string }[] = [
  { value: 'presente', label: 'Presente', color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  { value: 'ausente', label: 'Ausente', color: 'var(--at-danger)', bg: 'var(--at-danger-tint)' },
  { value: 'tardanza', label: 'Tardanza', color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
  { value: 'permiso', label: 'Permiso', color: 'var(--at-accent)', bg: 'var(--at-accent-tint)' },
  { value: 'vacaciones', label: 'Vacaciones', color: 'var(--at-primary-2)', bg: 'var(--at-primary-soft)' },
]

/**
 * Qué vino a hacer quien abre el tab. Es la primera pregunta y no la contesta el
 * sistema: entrar a marcar el turno y venir a revisar la asistencia del equipo
 * son dos cosas distintas, y hasta ahora el tab solo sabía hacer la segunda.
 * `resolviendo` es el instante en que se averigua si esta cuenta tiene
 * expediente aquí — sin eso no se puede ni ofrecer la primera opción.
 */
type ModoPresencia = 'resolviendo' | 'elegir' | 'marcar' | 'consulta'

export default function PresenciaPersonalTab({ registros, personal, bloques, proyectoId, companyId, canCreate, canEdit, canDelete, onRefresh }: Props) {
  const hoy = hoyLocalISO()
  const [fechaFiltro, setFechaFiltro] = useState(hoy)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [modo, setModo] = useState<ModoPresencia>('resolviendo')
  const [miFicha, setMiFicha] = useState<MiFichaPresencia | null>(null)

  // ¿Es esta cuenta un empleado de ESTE condominio? Lo contesta la base
  // (presencia_mi_ficha, 20260908000000), porque la sesión no lo sabe: el
  // vínculo cuenta→expediente vive en personal_condominio.user_id y el personal
  // operativo no tiene permiso para leerlo.
  //
  // Si la consulta falla —una base sin la migración, la red— se cae a la vista
  // de siempre. Nunca se deja el tab bloqueado por una función auxiliar.
  useEffect(() => {
    let vivo = true
    void fetchMiFichaPresencia(proyectoId).then(({ ficha }) => {
      if (!vivo) return
      setMiFicha(ficha)
      setModo(ficha ? 'elegir' : 'consulta')
    })
    return () => { vivo = false }
  }, [proyectoId])

  const [form, setForm] = useState({
    personal_id: '',
    nombre: '',
    cargo: '',
    fecha: hoy,
    hora_entrada: '',
    hora_salida: '',
    estado: 'presente' as EstadoPresencia,
    observaciones: '',
  })

  const registrosDia = registros.filter(r => r.fecha === fechaFiltro)

  // Solo se ficha a quien sigue en plantilla. Si el condominio todavía no tiene
  // personal registrado, el campo degrada a texto libre para no bloquear el
  // fichaje (es como funcionaba antes de que la tabla tuviera personal_id).
  const activos = useMemo(() => personal.filter(p => p.estado !== 'inactivo'), [personal])

  const turnoDelDia = useMemo(() => {
    if (!form.personal_id) return null
    const b = bloques.find(x => x.personal_id === form.personal_id && x.fecha === form.fecha)
    if (!b) return null
    return b.hora_inicio && b.hora_fin
      ? `${b.hora_inicio.slice(0, 5)}–${b.hora_fin.slice(0, 5)}`
      : b.turno
  }, [bloques, form.personal_id, form.fecha])

  // Los KPIs cuentan lo VIGENTE. Una jornada anulada sigue en la lista —es
  // evidencia y su rastro importa— pero no debe inflar el «Presente» del día,
  // igual que no suma horas a la planilla.
  const vigentesDia = registrosDia.filter(r => !r.anulado_en)

  const contadores = ESTADOS_PRESENCIA.reduce((acc, s) => {
    acc[s.value] = vigentesDia.filter(r => r.estado === s.value).length
    return acc
  }, {} as Record<EstadoPresencia, number>)

  async function guardar() {
    if (!form.nombre.trim()) { notify({ variant: 'warning', title: 'Faltan datos', text: 'Nombre obligatorio' }); return }
    setSaving(true)
    // `personal_id` es lo que hace posible el cómputo de horas por empleado: sin
    // él, «Juan Pérez» y «J. Pérez» son dos personas distintas. Se conserva
    // `nombre` porque la tabla también registra a quien no está en plantilla.
    const bloqueDelDia = form.personal_id
      ? bloques.find(b => b.personal_id === form.personal_id && b.fecha === form.fecha)
      : undefined
    const { error } = await createCondominioRow('presencia_personal', {
      company_id: companyId,
      project_id: proyectoId,
      personal_id: form.personal_id || null,
      bloque_id: bloqueDelDia?.id ?? null,
      nombre: form.nombre.trim(),
      cargo: form.cargo.trim() || null,
      fecha: form.fecha,
      hora_entrada: form.hora_entrada || null,
      hora_salida: form.hora_salida || null,
      estado: form.estado,
      observaciones: form.observaciones.trim() || null,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setForm({ personal_id: '', nombre: '', cargo: '', fecha: hoy, hora_entrada: '', hora_salida: '', estado: 'presente', observaciones: '' })
    setMostrarForm(false)
    onRefresh()
  }

  async function actualizarEstado(id: string, estado: EstadoPresencia) {
    const { error } = await updateCondominioRow('presencia_personal', id, { estado })
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
  }

  /**
   * Corregir es un acto DISTINTO de marcar, y por eso pide motivo. La foto y el
   * GPS no viajan: son del marcaje original y no se tocan — la base tampoco los
   * dejaría cambiar.
   */
  async function corregir(r: PresenciaPersonal) {
    const datos = await openPromptDialog({
      title: `Corregir el marcaje de ${r.nombre}`,
      description: 'La foto y la ubicación siguen siendo las del marcaje original: '
        + 'corregir la hora no reescribe lo que la cámara vio. Queda constancia de quién corrigió y por qué.',
      fields: [
        { name: 'hora_entrada', label: 'Hora de entrada', type: 'time', initialValue: (r.hora_entrada ?? '').slice(0, 5) },
        { name: 'hora_salida', label: 'Hora de salida (vacío = jornada abierta)', type: 'time', initialValue: (r.hora_salida ?? '').slice(0, 5) },
        {
          name: 'estado', label: 'Estado', control: 'select', initialValue: r.estado,
          options: ESTADOS_PRESENCIA.map(s => ({ value: s.value, label: s.label })),
        },
        { name: 'motivo', label: 'Motivo de la corrección', control: 'textarea', rows: 2 },
      ],
      submitText: 'Guardar corrección',
      validate: d => !d.hora_entrada
        ? 'La hora de entrada es obligatoria. Si el registro no debe contar, anulalo.'
        : d.motivo.trim().length < 5 ? 'Escribí el motivo de la corrección (al menos 5 caracteres)' : null,
    })
    if (!datos) return
    const { error } = await corregirPresencia({
      registroId: r.id,
      horaEntrada: datos.hora_entrada,
      horaSalida: datos.hora_salida || null,
      estado: datos.estado,
      motivo: datos.motivo,
    })
    if (error) { notify({ variant: 'error', title: 'No se corrigió', text: error }); return }
    notify({ variant: 'success', title: 'Marcaje corregido' })
    onRefresh()
  }

  /** Anular NO borra: la fila queda visible y fuera del cómputo de horas. */
  async function anular(r: PresenciaPersonal) {
    const datos = await openPromptDialog({
      title: `Anular el marcaje de ${r.nombre}`,
      description: 'La fila no se borra —es evidencia de planilla—: queda visible y marcada, '
        + 'pero deja de contar para las horas. No se puede deshacer desde aquí.',
      fields: [{ name: 'motivo', label: 'Motivo de la anulación', control: 'textarea', rows: 2 }],
      submitText: 'Anular el marcaje',
      validate: d => d.motivo.trim().length < 5
        ? 'Escribí el motivo de la anulación (al menos 5 caracteres)' : null,
    })
    if (!datos) return
    const { error } = await anularPresencia(r.id, datos.motivo)
    if (error) { notify({ variant: 'error', title: 'No se anuló', text: error }); return }
    notify({ variant: 'success', title: 'Marcaje anulado', text: 'Deja de contar para las horas.' })
    onRefresh()
  }

  async function registrarSalida(id: string) {
    const hora = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
    const { error } = await updateCondominioRow('presencia_personal', id, { hora_salida: hora })
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

  if (modo === 'resolviendo') {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--at-ink-3)', fontSize: 13 }}>
        Preparando tu registro…
      </div>
    )
  }

  // La pregunta de entrada. Solo se ve cuando la cuenta TIENE expediente aquí:
  // a quien no puede marcar no se le ofrece marcar.
  if (modo === 'elegir' && miFicha) {
    const yaCompleto = Boolean(miFicha.hora_entrada && miFicha.hora_salida)
    return (
      <div style={{ padding: 24, maxWidth: 560, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Hola, {miFicha.nombre}</div>
          <div style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>¿Qué vas a hacer?</div>
        </div>
        <button
          onClick={() => setModo('marcar')}
          style={{
            width: '100%', padding: '18px 16px', marginBottom: 10, border: 'none', borderRadius: 12,
            background: 'var(--at-success)', color: 'var(--at-on-status)', cursor: 'pointer', textAlign: 'left',
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 700 }}>🟢 Ingresar a mi turno</div>
          <div style={{ fontSize: 12, opacity: 0.9, marginTop: 2 }}>
            {yaCompleto
              ? 'Tu jornada de hoy ya está cerrada — podés revisarla'
              : miFicha.hora_entrada
                ? `Entraste a las ${miFicha.hora_entrada.slice(0, 5)} · marcar salida con foto y ubicación`
                : 'Se abre la cámara y el sistema registra la hora'}
          </div>
        </button>
        <button
          onClick={() => setModo('consulta')}
          style={{
            width: '100%', padding: '18px 16px', border: '1px solid var(--at-line-strong)', borderRadius: 12,
            background: 'var(--at-surface-2)', color: 'var(--at-ink-2)', cursor: 'pointer', textAlign: 'left',
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 700 }}>🔎 Solo estoy consultando</div>
          <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 2 }}>
            Ver la asistencia del día sin registrar nada
          </div>
        </button>
      </div>
    )
  }

  if (modo === 'marcar') {
    return (
      <div style={{ padding: 16 }}>
        <MarcajeTurno
          proyectoId={proyectoId}
          fichaInicial={miFicha}
          onRefresh={onRefresh}
          onConsultar={() => setModo('consulta')}
        />
      </div>
    )
  }

  return (
    <div style={{ padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 14, color: 'var(--at-ink-2)' }}>Fecha:</span>
          <input type="date" value={fechaFiltro} onChange={e => setFechaFiltro(e.target.value)}
            style={{ ...inp, width: 'auto', padding: '6px 10px' }} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
        {miFicha && (
          <button onClick={() => setModo('marcar')}
            style={{ padding: '8px 16px', background: 'var(--at-success)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            🟢 Marcar mi turno
          </button>
        )}
        {canCreate && (
          <button onClick={() => setMostrarForm(!mostrarForm)}
            style={{ padding: '8px 16px', background: 'var(--at-accent)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {mostrarForm ? '✕ Cancelar' : '+ Registrar persona'}
          </button>
        )}
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {ESTADOS_PRESENCIA.map(s => (
          <div key={s.value} style={{ background: s.bg, borderRadius: 8, padding: '8px 14px', textAlign: 'center', minWidth: 80 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{contadores[s.value] || 0}</div>
            <div style={{ fontSize: 11, color: s.color }}>{s.label}</div>
          </div>
        ))}
        <div style={{ background: 'var(--at-chip)', borderRadius: 8, padding: '8px 14px', textAlign: 'center', minWidth: 80 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--at-ink-2)' }}>{vigentesDia.length}</div>
          <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>Total</div>
        </div>
      </div>

      {/* Formulario */}
      {mostrarForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>Registrar asistencia</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={lbl} htmlFor="presencia-empleado">Empleado *</label>
              {activos.length > 0 ? (
                <select
                  id="presencia-empleado"
                  style={inp}
                  value={form.personal_id}
                  onChange={e => {
                    const emp = activos.find(p => p.id === e.target.value)
                    setForm(p => ({
                      ...p,
                      personal_id: e.target.value,
                      nombre: emp?.nombre ?? '',
                      cargo: emp?.cargo ?? '',
                    }))
                  }}
                >
                  <option value="">Elegir…</option>
                  {activos.map(p => <option key={p.id} value={p.id}>{p.nombre} — {p.cargo}</option>)}
                </select>
              ) : (
                <input style={inp} placeholder="Juan Pérez" value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} />
              )}
              {activos.length > 0 && (
                <div style={{ fontSize: 10.5, color: 'var(--at-ink-3)', marginTop: 3 }}>
                  {turnoDelDia ? `Turno asignado: ${turnoDelDia}` : 'Sin turno asignado ese día'}
                </div>
              )}
            </div>
            <div>
              <label style={lbl} htmlFor="presencia-cargo">Cargo</label>
              <input id="presencia-cargo" style={inp} placeholder="Guardia, Conserje…" value={form.cargo} onChange={e => setForm(p => ({ ...p, cargo: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Fecha</label>
              <input type="date" style={inp} value={form.fecha} onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Estado</label>
              <select style={inp} value={form.estado} onChange={e => setForm(p => ({ ...p, estado: e.target.value as EstadoPresencia }))}>
                {ESTADOS_PRESENCIA.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Hora entrada</label>
              <input type="time" style={inp} value={form.hora_entrada} onChange={e => setForm(p => ({ ...p, hora_entrada: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Hora salida</label>
              <input type="time" style={inp} value={form.hora_salida} onChange={e => setForm(p => ({ ...p, hora_salida: e.target.value }))} />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={lbl}>Observaciones</label>
            <input style={inp} placeholder="Opcional" value={form.observaciones} onChange={e => setForm(p => ({ ...p, observaciones: e.target.value }))} />
          </div>
          <button onClick={guardar} disabled={saving}
            style={{ padding: '8px 20px', background: 'var(--at-success)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {saving ? 'Guardando…' : '✅ Guardar'}
          </button>
        </div>
      )}

      {/* Lista del día */}
      {registrosDia.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '40px 0', fontSize: 13 }}>
          Sin registros para {fechaFiltro}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {registrosDia.map(r => {
            const est = ESTADOS_PRESENCIA.find(s => s.value === r.estado)
            // Antes esto restaba a pelo y devolvía null si el resultado era
            // negativo: un turno de 22:00 a 06:00 daba -960 minutos y las horas
            // desaparecían de pantalla. `horasJornada` trata fin <= inicio como
            // cruce de medianoche, que es la única lectura posible.
            const horas = horasJornada(r.hora_entrada, r.hora_salida)
            const horasTotal = horas ? formatHoras(horas) : null
            return (
              <div key={r.id} style={{
                background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 8,
                padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                // Anulada: se ve, pero se ve APAGADA. No se esconde — es
                // evidencia, y esconderla sería la mitad de borrarla.
                opacity: r.anulado_en ? 0.6 : 1,
              }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span style={{ padding: '3px 10px', borderRadius: 10, background: est?.bg, color: est?.color, fontSize: 12, fontWeight: 600 }}>{est?.label}</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{r.nombre}</div>
                    <div style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>
                      {r.cargo && <span>{r.cargo} · </span>}
                      {r.hora_entrada && <span>Entrada: {r.hora_entrada}</span>}
                      {r.hora_salida && <span> · Salida: {r.hora_salida}</span>}
                      {horasTotal && <span style={{ color: 'var(--at-accent)' }}> · {horasTotal}</span>}
                    </div>
                    {r.observaciones && <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 2 }}>{r.observaciones}</div>}
                    <EvidenciaMarcaje registro={r} />
                    <HuellaCorreccion registro={r} />
                  </div>
                </div>
                {/* Sobre una fila anulada no se actúa: ya no cuenta, y dejar los
                    controles vivos invitaría a «arreglarla» editándola. */}
                {!r.anulado_en && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {canEdit && !r.hora_salida && r.estado === 'presente' && (
                      <button onClick={() => registrarSalida(r.id)}
                        style={{ padding: '5px 10px', background: 'var(--at-warning)', color: 'var(--at-on-status)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>
                        Registrar salida
                      </button>
                    )}
                    {canEdit && (
                      <select value={r.estado} onChange={e => actualizarEstado(r.id, e.target.value as EstadoPresencia)}
                        style={{ padding: '4px 8px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}>
                        {ESTADOS_PRESENCIA.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    )}
                    {canEdit && (
                      <button onClick={() => void corregir(r)}
                        style={{ padding: '5px 10px', background: 'var(--at-surface-2)', color: 'var(--at-ink-2)', border: '1px solid var(--at-line-strong)', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>
                        ✏️ Corregir
                      </button>
                    )}
                    {canDelete && (
                      <button onClick={() => void anular(r)}
                        style={{ padding: '5px 10px', background: 'var(--at-surface-2)', color: 'var(--at-danger)', border: '1px solid var(--at-line-strong)', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>
                        Anular
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * La prueba del marcaje, junto al registro que sustenta. Una evidencia que
 * nadie puede ver no es una evidencia: si la foto y la ubicación solo viven en
 * la base, discutir un fichaje sigue siendo la palabra de uno contra la de otro.
 *
 * Solo aparece en los marcajes de autoservicio — el registro manual no tiene
 * nada de esto y una fila vacía con iconos apagados diría lo contrario.
 */
function EvidenciaMarcaje({ registro }: { registro: PresenciaPersonal }) {
  if (registro.origen !== 'autoservicio') return null
  const gps = registro.gps_entrada ?? registro.gps_salida
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 8, background: 'var(--at-primary-soft)', color: 'var(--at-primary-2)' }}>
        Marcado por la persona
      </span>
      {[registro.foto_entrada, registro.foto_salida].filter(Boolean).map(path => (
        <SecureImage
          key={path}
          src={path}
          bucket={BUCKET_PRESENCIA}
          alt="Foto del marcaje"
          style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--at-line)' }}
        />
      ))}
      {gps && (
        <span style={{ fontSize: 10.5, color: 'var(--at-ink-3)' }}>
          📍 {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}
          {gps.exactitud_m ? ` (±${Math.round(gps.exactitud_m)} m)` : ''}
        </span>
      )}
    </div>
  )
}

/**
 * La huella de la corrección, en la fila y no en otra pestaña.
 *
 * `bitacora_acciones` ya guarda el antes/después de cada columna con su autor
 * desde 20260731000100, así que el forense existía. Lo que faltaba es que se vea
 * DONDE SE LEE EL DATO: una corrección que solo consta en la bitácora es, en la
 * práctica, invisible — nadie audita la bitácora para leer una lista de
 * asistencia.
 */
function HuellaCorreccion({ registro }: { registro: PresenciaPersonal }) {
  if (!registro.corregido_en) return null
  const quien = registro.corregido_por_nombre ?? 'un administrador'
  const cuando = registro.corregido_en.slice(0, 10)
  const anulada = Boolean(registro.anulado_en)
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginTop: 6, flexWrap: 'wrap' }}>
      <span style={{
        fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 8,
        background: anulada ? 'var(--at-danger-tint)' : 'var(--at-warning-tint)',
        color: anulada ? 'var(--at-danger)' : 'var(--at-warning)',
      }}>
        {anulada ? 'ANULADA' : 'Corregida'}
      </span>
      <span style={{ fontSize: 10.5, color: 'var(--at-ink-3)' }}>
        {anulada ? 'Anulada' : 'Corregida'} por {quien} el {cuando}
        {registro.motivo_correccion ? ` — ${registro.motivo_correccion}` : ''}
      </span>
    </div>
  )
}
