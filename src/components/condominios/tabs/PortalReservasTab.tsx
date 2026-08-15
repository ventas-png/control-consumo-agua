import { hoyLocalISO } from '../../../lib/format'
import { useId, useMemo, useState, type ReactNode } from 'react'
import { notify, confirm } from '../../shared/Dialog'
import { EditModal } from '../../shared/EditModal'
import { reservarAmenidad, cancelarReservaAmenidad } from '../../../domain/portal/reservas'
import { useSignedUrls } from '../../../lib/storageUrls'
import type { Amenidad, ReservaAmenidad, BloqueoAmenidad, MetodoPagoTarifa } from '../../../types'
import { bloqueoSolapaReserva, validarReglasAmenidad, tarifaAplicable, esFinDeSemana, addMinutosToTime } from '../../../lib/amenidadesReglas'

// Card de amenidad con background-image signed-URL. La URL viene firmada
// del padre vía useSignedUrls (batch) — antes cada card llamaba al hook
// singular, lo que generaba N peticiones HTTP a Storage al renderizar la
// grilla.
function AmenidadHeroButton({ signedFotoUrl, onClick, children }: { signedFotoUrl: string | null; onClick: () => void; children: ReactNode }) {
  const fondo = signedFotoUrl
    ? `linear-gradient(180deg, rgba(15,23,42,0.05) 0%, rgba(15,23,42,0.85) 100%), center/cover no-repeat url(${signedFotoUrl})`
    : 'linear-gradient(135deg,var(--at-primary) 0%,var(--at-accent-2) 100%)'
  return (
    <button
      onClick={onClick}
      style={{
        position: 'relative',
        height: 180,
        background: fondo,
        border: 'none', borderRadius: 16,
        cursor: 'pointer',
        color: 'white',
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
        padding: 14, textAlign: 'left',
        boxShadow: '0 4px 14px -6px rgba(15,23,42,0.25)',
        transition: 'transform 0.18s ease, box-shadow 0.18s ease',
        overflow: 'hidden',
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 18px 36px -14px rgba(15,23,42,0.35)' }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 14px -6px rgba(15,23,42,0.25)' }}>
      {children}
    </button>
  )
}

interface Props {
  amenidades: Amenidad[]
  reservas: ReservaAmenidad[]
  bloqueos: BloqueoAmenidad[]
  unidadId: string
  moneda: string
  onRefresh: () => void
}

const MOTIVO_LABEL: Record<BloqueoAmenidad['motivo'], string> = {
  mantenimiento: 'Mantenimiento',
  limpieza: 'Limpieza profunda',
  evento_privado: 'Evento privado',
  reparacion: 'Reparación',
  otro: 'No disponible',
}

type EstadoReserva = 'confirmada' | 'cancelada' | 'pendiente'

const ESTADO_RES: Record<EstadoReserva, { label: string; bg: string; color: string }> = {
  confirmada: { label: 'Confirmada', bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  pendiente:  { label: 'Pendiente',  bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' },
  cancelada:  { label: 'Cancelada',  bg: 'var(--at-surface-2)', color: 'var(--at-ink-3)' },
}

function blankForm(): { amenidad_id: string; fecha: string; hora_inicio: string; hora_fin: string; num_invitados: number; notas: string; metodo_pago_tarifa: MetodoPagoTarifa; reglamento_aceptado: boolean } {
  return { amenidad_id: '', fecha: '', hora_inicio: '', hora_fin: '', num_invitados: 0, notas: '', metodo_pago_tarifa: 'cargar_unidad', reglamento_aceptado: false }
}

export function PortalReservasTab({ amenidades, reservas, bloqueos, unidadId, moneda, onRefresh }: Props) {
  const [showForm, setShowForm]   = useState(false)
  const [saving, setSaving]       = useState(false)
  const [form, setForm]           = useState(blankForm())
  const [vistaFutura, setVistaFutura] = useState(true)

  // ids estables para asociar cada <label htmlFor> con su control. Sin la
  // asociación, un lector de pantalla anuncia "cuadro combinado, en blanco" y dos
  // campos de hora idénticos, y tocar el texto del label no enfoca el campo.
  // useId da un prefijo único aunque el tab se monte más de una vez.
  const uid = useId()
  const ids = useMemo(() => ({
    amenidad:   `${uid}-amenidad`,
    fecha:      `${uid}-fecha`,
    invitados:  `${uid}-invitados`,
    horaInicio: `${uid}-hora-inicio`,
    horaFin:    `${uid}-hora-fin`,
    notas:      `${uid}-notas`,
  }), [uid])

  const hoy = hoyLocalISO()
  const misReservas = reservas.filter(r => r.unidad_id === unidadId)
  const futuras = misReservas.filter(r => r.fecha >= hoy && r.estado !== 'cancelada')
  const pasadas = misReservas.filter(r => r.fecha < hoy || r.estado === 'cancelada')
  const amenidadesActivas = amenidades.filter(a => a.activo)
  const amenidadSel = amenidades.find(a => a.id === form.amenidad_id)

  // Firma todas las fotos en UNA petición (createSignedUrls batch) en vez de
  // N peticiones desde cada card hijo.
  const signedFotoUrls = useSignedUrls(amenidadesActivas.map(a => a.foto_url), 'condominios-media')

  /** Cierra el modal CONSERVANDO lo escrito (× y Escape). No borra el formulario:
   *  un cierre accidental no debe costarle al residente todo lo que capturó.
   *  Bloqueado mientras se guarda para no ocultar una reserva en vuelo. */
  function cerrarForm() {
    if (saving) return
    setShowForm(false)
  }

  /** Descarta el formulario (botón Cancelar y camino de éxito). NUNCA se bloquea:
   *  es la salida de emergencia si una petición se queda colgada — el modal es un
   *  overlay que tapa todo el portal y el cliente de Supabase no tiene timeout. */
  function descartarForm() {
    setShowForm(false)
    setForm(blankForm())
  }

  async function hacerReserva() {
    if (!form.amenidad_id) { notify({ variant: 'error', title: 'Error', text: 'Seleccione una amenidad.' }); return }
    if (!form.fecha || !form.hora_inicio || !form.hora_fin) { notify({ variant: 'error', title: 'Error', text: 'Complete fecha y horario.' }); return }
    if (form.hora_fin <= form.hora_inicio) { notify({ variant: 'error', title: 'Error', text: 'La hora de fin debe ser posterior al inicio.' }); return }
    if (amenidadSel?.reglamento && !form.reglamento_aceptado) {
      notify({ variant: 'warning', title: 'Reglamento', text: 'Debes leer y aceptar el reglamento antes de continuar.' }); return
    }
    // Conflict check (sólo contra reservas confirmadas, incluyendo tiempos de preparación)
    const conflicto = reservas.find(r => {
      if (r.amenidad_id !== form.amenidad_id) return false
      if (r.fecha !== form.fecha) return false
      if (r.estado !== 'confirmada') return false
      const amenR = amenidades.find(a => a.id === r.amenidad_id)
      const efectivoInicio = (amenR?.minutos_preparacion_previa ?? 0) > 0
        ? addMinutosToTime(r.hora_inicio, -(amenR!.minutos_preparacion_previa!))
        : r.hora_inicio
      const efectivoFin = (amenR?.minutos_preparacion_posterior ?? 0) > 0
        ? addMinutosToTime(r.hora_fin, amenR!.minutos_preparacion_posterior!)
        : r.hora_fin
      return form.hora_inicio < efectivoFin && form.hora_fin > efectivoInicio
    })
    if (conflicto) { notify({ variant: 'warning', title: 'Horario ocupado', text: 'Esa amenidad ya está reservada en ese horario (o en su tiempo de preparación). Elija otro.' }); return }

    const bloqueo = bloqueos.find(b =>
      b.amenidad_id === form.amenidad_id &&
      bloqueoSolapaReserva(b, form.fecha, form.hora_inicio, form.hora_fin)
    )
    if (bloqueo) {
      const detalle = bloqueo.hora_inicio
        ? `${bloqueo.fecha_inicio === bloqueo.fecha_fin ? bloqueo.fecha_inicio : `${bloqueo.fecha_inicio} → ${bloqueo.fecha_fin}`} ${bloqueo.hora_inicio}–${bloqueo.hora_fin}`
        : `${bloqueo.fecha_inicio === bloqueo.fecha_fin ? bloqueo.fecha_inicio : `${bloqueo.fecha_inicio} → ${bloqueo.fecha_fin}`} (día completo)`
      notify({ variant: 'warning', title: 'Amenidad no disponible', text: `${MOTIVO_LABEL[bloqueo.motivo]} · ${detalle}. Por favor elige otra fecha u horario.` })
      return
    }

    if (amenidadSel) {
      const errReglas = validarReglasAmenidad(amenidadSel, form.fecha, form.hora_inicio, form.hora_fin, unidadId, reservas)
      if (errReglas) { notify({ variant: 'warning', title: 'No permitido', text: errReglas }); return }
    }

    // La tarifa client-side solo decide si hay que ENVIAR método de pago; el
    // monto real lo calcula y sella el servidor (RPC 20260822030000).
    const tarifaCalc = amenidadSel ? tarifaAplicable(amenidadSel, form.fecha) : 0
    const aplicaTarifa = !!(amenidadSel?.requiere_tarifa && tarifaCalc > 0)

    setSaving(true)
    // Todo lo anterior es pre-chequeo UX (mensajes inmediatos); el RPC re-valida
    // TODO server-side — incluido el conflicto GLOBAL contra reservas de otras
    // unidades que este cliente no puede ver — y crea cuota + reserva en una
    // sola transacción (muere la compensación best-effort del navegador).
    const { data, error } = await reservarAmenidad({
      amenidadId: form.amenidad_id,
      unidadId,
      fecha: form.fecha,
      horaInicio: form.hora_inicio,
      horaFin: form.hora_fin,
      numInvitados: form.num_invitados,
      notas: form.notas.trim() || undefined,
      metodoPago: aplicaTarifa ? form.metodo_pago_tarifa : null,
      reglamentoAceptado: form.reglamento_aceptado,
    })
    setSaving(false)
    if (error || !data) {
      notify({ variant: 'error', title: 'No se pudo reservar', text: error ?? 'Error desconocido. Intenta de nuevo.' })
      return
    }
    // El toast usa el monto DEVUELTO por el servidor — es el que realmente se cargó.
    const montoSrv = data.monto_tarifa != null ? Number(data.monto_tarifa) : null
    const titulo = data.estado === 'pendiente'
      ? 'Solicitud enviada. La administración debe aprobarla.'
      : montoSrv != null
        ? data.metodo_pago_tarifa === 'cargar_unidad'
          ? `Reserva confirmada. Se cargó ${moneda} ${montoSrv.toFixed(2)} a tu cuenta.`
          : `Reserva confirmada. Pagar ${moneda} ${montoSrv.toFixed(2)} en sitio.`
        : '¡Reserva confirmada!'
    notify({ variant: 'success', title: titulo, duration: 2600 })
    descartarForm(); onRefresh()
  }

  async function cancelarReserva(id: string) {
    const r = await confirm({ title: '¿Cancelar reserva?', icon: 'question', confirmText: 'Sí, cancelar', cancelText: 'No' })
    if (!r.isConfirmed) return
    // El RPC cancela y anula la cuota pendiente en una sola operación; antes el
    // update + softDelete corrían por separado y sus errores morían en silencio.
    const { error } = await cancelarReservaAmenidad(id)
    if (error) { notify({ variant: 'error', title: 'No se pudo cancelar', text: error }); return }
    notify({ variant: 'success', title: 'Reserva cancelada', duration: 1600 })
    onRefresh()
  }

  return (
    <div>
      {/* Header del portal */}
      <div style={{
        background: 'linear-gradient(135deg,var(--at-primary-hover) 0%,var(--at-accent-2) 100%)',
        borderRadius: 16, padding: '18px 22px', marginBottom: 18,
        color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 12,
        boxShadow: '0 10px 24px -10px rgba(29,78,216,0.4)',
      }}>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, opacity: 0.85, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Tu condominio</div>
          <h3 style={{ margin: '2px 0 0', fontSize: 19, fontWeight: 800, letterSpacing: '-0.01em' }}>Amenidades y reservas</h3>
          <div style={{ fontSize: 12, opacity: 0.9, marginTop: 3 }}>
            {futuras.length} próxima{futuras.length === 1 ? '' : 's'} · {misReservas.filter(r => r.estado === 'pendiente').length > 0 ? `${misReservas.filter(r => r.estado === 'pendiente').length} pendiente${misReservas.filter(r => r.estado === 'pendiente').length === 1 ? '' : 's'} de aprobación` : 'Tap en una amenidad para reservar'}
          </div>
        </div>
        {amenidadesActivas.length > 0 && (
          <button onClick={() => setShowForm(true)}
            style={{ padding: '10px 18px', background: 'rgba(255,255,255,0.18)', color: 'white', border: '1.5px solid rgba(255,255,255,0.4)', borderRadius: 12, fontWeight: 700, cursor: 'pointer', fontSize: 13.5, backdropFilter: 'blur(6px)' }}>
            + Nueva reserva
          </button>
        )}
      </div>

      {/* Amenidades disponibles - estilo hero card */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14, marginBottom: 22 }}>
        {amenidadesActivas.map((a, idx) => (
          <AmenidadHeroButton key={a.id} signedFotoUrl={signedFotoUrls[idx] ?? null}
            onClick={() => { setForm(f => ({ ...f, amenidad_id: a.id })); setShowForm(true) }}>
              {/* Icono fallback si no hay foto */}
              {!a.foto_url && (
                <div style={{ position: 'absolute', top: 16, right: 16, fontSize: 36, opacity: 0.55 }}>🏖</div>
              )}
              {/* Badges arriba */}
              <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-start' }}>
                {a.requiere_aprobacion && (
                  <span style={{ padding: '3px 9px', borderRadius: 999, background: 'rgba(254,215,170,0.95)', color: 'var(--at-warning-strong)', fontSize: 10, fontWeight: 800, backdropFilter: 'blur(4px)' }}>Aprobación</span>
                )}
                {a.requiere_deposito && a.monto_deposito && (
                  <span style={{ padding: '3px 9px', borderRadius: 999, background: 'rgba(254,243,199,0.95)', color: 'var(--at-warning-strong)', fontSize: 10, fontWeight: 800, backdropFilter: 'blur(4px)' }}>Depósito {moneda} {a.monto_deposito.toFixed(0)}</span>
                )}
                {a.requiere_tarifa && a.tarifa_uso != null && (
                  <span style={{ padding: '3px 9px', borderRadius: 999, background: 'rgba(219,234,254,0.95)', color: 'var(--at-primary-hover)', fontSize: 10, fontWeight: 800, backdropFilter: 'blur(4px)' }}>
                    Tarifa {moneda} {Number(a.tarifa_uso).toFixed(0)}
                    {a.tarifa_uso_finde != null && ` / ${Number(a.tarifa_uso_finde).toFixed(0)}`}
                  </span>
                )}
              </div>
              {/* Footer con datos */}
              <div style={{ position: 'relative', zIndex: 1 }}>
                <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.01em', textShadow: '0 1px 4px rgba(0,0,0,0.3)' }}>{a.nombre}</div>
                <div style={{ fontSize: 11.5, opacity: 0.92, marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {a.capacidad_max && <span>👥 Hasta {a.capacidad_max}</span>}
                  {a.horario_inicio && a.horario_fin && <span>⏰ {a.horario_inicio}–{a.horario_fin}</span>}
                </div>
                {(a.max_reservas_mes_unidad != null || (a.horas_minimas_antelacion ?? 0) > 0 || a.duracion_max_horas != null) && (
                  <div style={{ fontSize: 10.5, opacity: 0.85, marginTop: 4 }}>
                    {a.max_reservas_mes_unidad != null && `Máx ${a.max_reservas_mes_unidad}/mes`}
                    {(a.horas_minimas_antelacion ?? 0) > 0 && ` · ${a.horas_minimas_antelacion}h antelación`}
                    {a.duracion_max_horas != null && ` · hasta ${a.duracion_max_horas}h`}
                  </div>
                )}
              </div>
          </AmenidadHeroButton>
        ))}
        {amenidadesActivas.length === 0 && (
          <div style={{ gridColumn: '1/-1', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 20px', borderRadius: 14, background: 'linear-gradient(180deg,#ffffff,var(--at-surface-2))', border: '1.5px dashed var(--at-line-strong)', textAlign: 'center' }}>
            <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'linear-gradient(135deg,var(--at-primary-soft),#ccfbf1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, marginBottom: 10 }}>🏖</div>
            <p style={{ fontWeight: 700, color: 'var(--at-ink)', margin: '0 0 4px' }}>No hay amenidades disponibles</p>
            <p style={{ fontSize: 12.5, color: 'var(--at-ink-3)', margin: 0 }}>Cuando la administración active las áreas comunes, aparecerán aquí.</p>
          </div>
        )}
      </div>

      {/* Formulario en modal (EditModal: focus trap + Escape + backdrop, igual que
          el resto de tabs del portal). Antes era un bloque inline al final de la
          página: al tocar una amenidad había que hacer scroll para llenarlo. */}
      {showForm && (
        <EditModal
          title="Solicitar reserva"
          subtitle={amenidadSel
            ? `${amenidadSel.nombre}${amenidadSel.horario_inicio && amenidadSel.horario_fin ? ` · ${amenidadSel.horario_inicio}–${amenidadSel.horario_fin}` : ''}`
            : 'Elige la amenidad y tu horario'}
          size="md"
          onClose={cerrarForm}
          /* Sin cierre por backdrop: en móvil el panel deja una franja tocable a
             los lados y un roce accidental cerraría el formulario a medio llenar. */
          closeOnBackdropClick={false}
          footer={
            <>
              {/* Cancelar NUNCA va disabled: es la escotilla de salida si el guardado se cuelga. */}
              <button onClick={descartarForm}
                style={{ padding: '10px 16px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', fontSize: '13.5px', cursor: 'pointer' }}>
                Cancelar
              </button>
              <button onClick={hacerReserva} disabled={saving}
                style={{ padding: '10px 16px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-primary-hover))', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, fontSize: '13.5px', whiteSpace: 'nowrap', cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1 }}>
                {saving ? 'Reservando…' : '📅 Confirmar reserva'}
              </button>
            </>
          }
        >
          {/* minmax(min(100%,300px)): 2 columnas en escritorio, 1 en móvil, sin media queries. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: '12px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor={ids.amenidad} style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Amenidad *</label>
              {/* autoFocus: mete el foco DENTRO del diálogo al abrirlo, que es lo que
                  activa el focus trap de EditModal (su handler vive en el div del modal). */}
              <select autoFocus id={ids.amenidad} value={form.amenidad_id} onChange={e => setForm(f => ({ ...f, amenidad_id: e.target.value }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '16px', background: 'var(--at-surface-2)' }}>
                <option value="">Seleccionar...</option>
                {amenidadesActivas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select>
              {amenidadSel?.requiere_deposito && amenidadSel.monto_deposito && (
                <p style={{ margin: '5px 0 0', fontSize: '12px', color: 'var(--at-warning-strong)' }}>⚠ Esta amenidad requiere depósito de {moneda} {amenidadSel.monto_deposito.toFixed(2)}</p>
              )}
              {(() => {
                if (!amenidadSel) return null
                const proximos = bloqueos
                  .filter(b => b.amenidad_id === amenidadSel.id && b.fecha_fin >= hoy)
                  .slice()
                  .sort((a, b) => a.fecha_inicio < b.fecha_inicio ? -1 : 1)
                  .slice(0, 3)
                if (proximos.length === 0) return null
                return (
                  <div style={{ marginTop: 6, padding: '6px 10px', borderRadius: 8, background: 'var(--at-warning-tint)', border: '1px solid var(--at-warning-border)', fontSize: 11.5, color: 'var(--at-warning-strong)' }}>
                    🚫 Fechas no disponibles: {proximos.map(b => `${b.fecha_inicio === b.fecha_fin ? b.fecha_inicio : `${b.fecha_inicio}→${b.fecha_fin}`}${b.hora_inicio ? ` ${b.hora_inicio}-${b.hora_fin}` : ''}`).join(' · ')}
                  </div>
                )
              })()}
            </div>
            {amenidadSel?.requiere_tarifa && (() => {
              const tarifa = tarifaAplicable(amenidadSel, form.fecha)
              if (tarifa <= 0) return null
              const finde = form.fecha && esFinDeSemana(form.fecha) && amenidadSel.tarifa_uso_finde != null
              return (
              <div style={{ gridColumn: '1 / -1', background: 'var(--at-primary-tint)', border: '1.5px solid var(--at-primary-soft-2)', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--at-primary-hover)', marginBottom: 8 }}>
                  🎟 Tarifa por uso: {moneda} {tarifa.toFixed(2)} {finde && <span style={{ fontSize: 11, fontWeight: 600 }}>(fin de semana)</span>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--at-ink-2)', marginBottom: 8 }}>¿Cómo deseas pagar la tarifa?</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--at-ink-2)', cursor: 'pointer' }}>
                    <input type="radio" name="metodo_pago" checked={form.metodo_pago_tarifa === 'cargar_unidad'}
                      onChange={() => setForm(f => ({ ...f, metodo_pago_tarifa: 'cargar_unidad' }))} />
                    <span><strong>Cargar a mi unidad</strong> — el monto aparecerá como cargo pendiente en mi cuenta.</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--at-ink-2)', cursor: 'pointer' }}>
                    <input type="radio" name="metodo_pago" checked={form.metodo_pago_tarifa === 'pagar_momento'}
                      onChange={() => setForm(f => ({ ...f, metodo_pago_tarifa: 'pagar_momento' }))} />
                    <span><strong>Pagar al momento</strong> — pagaré directamente a la administración antes de usar la amenidad.</span>
                  </label>
                </div>
              </div>
              )
            })()}
            {amenidadSel?.requiere_aprobacion && (
              <div style={{ gridColumn: '1 / -1', background: 'var(--at-warning-tint)', border: '1.5px solid var(--at-warning-border)', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, color: 'var(--at-warning-strong)' }}>
                ⚠ Esta amenidad requiere aprobación del administrador. Tu solicitud quedará en estado <strong>pendiente</strong> hasta ser confirmada.
              </div>
            )}
            {amenidadSel?.reglamento && (
              <div style={{ gridColumn: '1 / -1', background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--at-ink)', marginBottom: 6 }}>📜 Reglamento</div>
                {/* Scroller anidado dentro del body del modal: overscrollBehavior contain
                    evita que al llegar al final el gesto arrastre el formulario detrás. */}
                <div style={{ fontSize: 12, color: 'var(--at-ink-2)', whiteSpace: 'pre-wrap', maxHeight: 'min(280px, 40vh)', overflowY: 'auto', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch', padding: '6px 8px', background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 8, lineHeight: 1.5 }}>
                  {amenidadSel.reglamento}
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12.5, color: 'var(--at-ink-2)', cursor: 'pointer', fontWeight: 600 }}>
                  <input type="checkbox" checked={form.reglamento_aceptado} onChange={e => setForm(f => ({ ...f, reglamento_aceptado: e.target.checked }))} />
                  He leído y acepto el reglamento
                </label>
              </div>
            )}
            <div>
              <label htmlFor={ids.fecha} style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Fecha *</label>
              <input type="date" id={ids.fecha} value={form.fecha} min={hoy} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '16px', background: 'var(--at-surface-2)' }} />
            </div>
            <div>
              <label htmlFor={ids.invitados} style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>No. invitados</label>
              <input type="number" id={ids.invitados} min={0} value={form.num_invitados} onChange={e => setForm(f => ({ ...f, num_invitados: parseInt(e.target.value) || 0 }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '16px', background: 'var(--at-surface-2)' }} />
            </div>
            <div>
              <label htmlFor={ids.horaInicio} style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Hora inicio *</label>
              <input type="time" id={ids.horaInicio} value={form.hora_inicio} onChange={e => setForm(f => ({ ...f, hora_inicio: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '16px', background: 'var(--at-surface-2)' }} />
            </div>
            <div>
              <label htmlFor={ids.horaFin} style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Hora fin *</label>
              <input type="time" id={ids.horaFin} value={form.hora_fin} onChange={e => setForm(f => ({ ...f, hora_fin: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '16px', background: 'var(--at-surface-2)' }} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor={ids.notas} style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Notas</label>
              {/* type="text" explícito: sin él, el selector de index.css no lo alcanza y se queda sin el min-height táctil de 44px. */}
              <input type="text" id={ids.notas} value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} placeholder="Observaciones adicionales..."
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '16px', background: 'var(--at-surface-2)' }} />
            </div>
          </div>
        </EditModal>
      )}

      {/* Mis reservas */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
        {([true, false] as const).map(v => (
          <button key={String(v)} onClick={() => setVistaFutura(v)}
            style={{ padding: '7px 16px', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer', border: '1.5px solid', borderColor: vistaFutura === v ? 'var(--at-primary)' : 'var(--at-line)', background: vistaFutura === v ? 'var(--at-primary-tint)' : 'var(--at-surface)', color: vistaFutura === v ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
            {v ? `📅 Próximas (${futuras.length})` : `📋 Historial (${pasadas.length})`}
          </button>
        ))}
      </div>

      {(vistaFutura ? futuras : pasadas).length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 20px', borderRadius: 14, background: 'linear-gradient(180deg,#ffffff,var(--at-surface-2))', border: '1.5px dashed var(--at-line-strong)', textAlign: 'center' }}>
          <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'linear-gradient(135deg,var(--at-primary-soft),#ccfbf1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, marginBottom: 10 }}>
            {vistaFutura ? '📅' : '📜'}
          </div>
          <p style={{ fontWeight: 700, color: 'var(--at-ink)', margin: '0 0 4px' }}>Sin reservas {vistaFutura ? 'próximas' : 'anteriores'}</p>
          <p style={{ fontSize: 12.5, color: 'var(--at-ink-3)', margin: 0, maxWidth: 320, lineHeight: 1.5 }}>
            {vistaFutura ? 'Reserva una amenidad arriba para que aparezca aquí.' : 'Tu historial de reservas pasadas se mostrará aquí.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {(vistaFutura ? futuras : pasadas).sort((a, b) => a.fecha < b.fecha ? -1 : 1).map(r => {
            const ec = ESTADO_RES[(r.estado as EstadoReserva) ?? 'confirmada']
            const amenidad = amenidades.find(a => a.id === r.amenidad_id)
            const accent = r.estado === 'confirmada' ? 'var(--at-success)' : r.estado === 'pendiente' ? 'var(--at-warning-strong)' : 'var(--at-ink-3)'
            return (
              <div key={r.id} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: 14, padding: '14px 16px 14px 22px', display: 'flex', alignItems: 'center', gap: 12, position: 'relative', overflow: 'hidden', transition: 'box-shadow 0.15s ease' }}
                onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 6px 16px -8px rgba(15,23,42,0.18)' }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none' }}>
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: accent }} />
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg,var(--at-primary-soft),#ccfbf1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>📅</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--at-ink)' }}>{amenidad?.nombre ?? 'Amenidad'}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--at-ink-3)', marginTop: 2, textTransform: 'capitalize' }}>
                    {new Date(r.fecha + 'T12:00:00').toLocaleDateString('es', { weekday: 'long', day: '2-digit', month: 'long' })} · {r.hora_inicio} – {r.hora_fin}
                    {r.num_invitados > 0 && ` · ${r.num_invitados} invitado${r.num_invitados > 1 ? 's' : ''}`}
                  </div>
                  {r.monto_tarifa != null && r.monto_tarifa > 0 && (
                    <div style={{ fontSize: 11.5, marginTop: 3, fontWeight: 700, color: r.metodo_pago_tarifa === 'cargar_unidad' ? 'var(--at-primary-hover)' : (r.tarifa_pagada ? 'var(--at-success)' : 'var(--at-warning-strong)') }}>
                      🎟 {moneda} {Number(r.monto_tarifa).toFixed(2)}
                      {r.metodo_pago_tarifa === 'cargar_unidad' && ' · cargado a tu unidad'}
                      {r.metodo_pago_tarifa === 'pagar_momento' && (r.tarifa_pagada ? ' · pagado' : ' · pagar en sitio')}
                    </div>
                  )}
                  {r.rechazada_motivo && (
                    <div style={{ fontSize: 11.5, color: 'var(--at-danger-strong)', marginTop: 3, fontStyle: 'italic', background: 'var(--at-danger-tint)', padding: '3px 8px', borderRadius: 6, display: 'inline-block' }}>↩ {r.rechazada_motivo}</div>
                  )}
                </div>
                <span style={{ padding: '4px 11px', borderRadius: 999, fontSize: 11, fontWeight: 800, background: ec.bg, color: ec.color, flexShrink: 0, border: `1px solid ${ec.color}33` }}>{ec.label}</span>
                {vistaFutura && r.estado !== 'cancelada' && (
                  <button onClick={() => cancelarReserva(r.id)} style={{ padding: '6px 12px', background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', borderRadius: 8, cursor: 'pointer', fontSize: 12, color: 'var(--at-danger)', fontWeight: 700, flexShrink: 0 }}>
                    Cancelar
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
