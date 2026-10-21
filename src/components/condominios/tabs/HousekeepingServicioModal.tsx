// Alta y edición de un servicio de housekeeping en ventana emergente.
//
// Sin selector de estado: el estado lo mueven «Iniciar servicio» y «Finalizar limpieza»
// (trg_hk_estado_transicion rechaza cualquier otro salto). Aquí se captura tipo, unidad,
// reserva STR opcional, fecha, hora TENTATIVA de ingreso, hora estimada de fin, responsable
// (elegible del proyecto), costo y notas. Unidad y reserva van atadas: con una unidad
// elegida el selector lista sus reservas; elegir una reserva asigna su unidad; cambiar a
// otra unidad quita la reserva que ya no le corresponde (trg_hk_reserva la rechazaría). Al
// editar, además se puede cancelar un servicio pendiente o en proceso.
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { hoyLocalISO } from '../../../lib/format'
import { EditModal } from '../../shared'
import { notify, confirm } from '../../shared/Dialog'
import { createCondominioRow, updateCondominioRow, updateCondominioRowAfectando } from '../../../domain/condominios/tabMutations'
import { fetchReservasVinculables } from '../../../domain/condominios/housekeepingReservas'
import { mensajeErrorFlujo } from '../../../domain/condominios/housekeepingFlujo'
import { mensajeErrorResponsable, preseleccionResponsable } from '../../../domain/condominios/housekeepingResponsable'
import type { AppUser } from '../../../domain/usuarios/queries'
import type { ReservaSTRVinculable, ServicioHousekeeping, TipoHousekeeping, Unidad } from '../../../types'
import { ResponsableSelector } from './ResponsableSelector'
import { ReservaSTRPicker } from './ReservaSTRPicker'

export const TIPO_CONFIG: Record<TipoHousekeeping, { label: string; icon: string }> = {
  limpieza_estandar:   { label: 'Limpieza Estándar',  icon: '🧹' },
  limpieza_profunda:   { label: 'Limpieza Profunda',  icon: '🧽' },
  lavanderia:          { label: 'Lavandería',          icon: '👕' },
  mantenimiento_menor: { label: 'Mant. Menor',         icon: '🔧' },
  otro:                { label: 'Otro',                icon: '📋' },
}

interface Props {
  /** Servicio a editar; `null` = alta. */
  servicio: ServicioHousekeeping | null
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  userId: string
  moneda: string
  elegibles: AppUser[] | null
  cargandoElegibles: boolean
  elegiblesError: string | null
  onRecargarElegibles: () => void
  onClose: () => void
  onSaved: () => void
}

interface Form {
  unidad_id: string
  tipo: TipoHousekeeping
  reserva_str_id: string | null
  fecha: string
  hora_inicio: string
  hora_fin: string
  responsable_user_id: string | null
  costo: string
  notas: string
}

// `minWidth: 0` y `appearance: none`: en iOS los <input type="date|time"> traen un ancho
// mínimo propio y se salen de su columna si no se les quita.
const inputStyle: CSSProperties = { width: '100%', minWidth: 0, minHeight: 40, padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box', display: 'block' }
const fechaHoraStyle: CSSProperties = { ...inputStyle, WebkitAppearance: 'none', appearance: 'none', textAlign: 'left' }
const labelStyle: CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '6px', display: 'block' }
const ayudaStyle: CSSProperties = { fontSize: 12, lineHeight: 1.45, color: 'var(--at-ink-3)', marginTop: 6 }
// Dos columnas fijas que se encogen (minmax 0): en un teléfono no se aprietan ni desbordan.
const gridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '16px 12px' }
const celda: CSSProperties = { minWidth: 0 }
const fila: CSSProperties = { minWidth: 0, gridColumn: '1 / -1' }
// Tipo y unidad llevan textos largos: lado a lado si caben (≥ 240 px cada uno), si no, uno bajo otro.
const parAmplio: CSSProperties = { ...fila, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: '16px 12px' }
const btn: CSSProperties = { padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', border: '1.5px solid var(--at-line)', background: 'var(--at-surface)', color: 'var(--at-ink-3)' }

function desdeServicio(s: ServicioHousekeeping | null, userId: string, elegibles: AppUser[] | null): Form {
  if (!s) {
    return { unidad_id: '', tipo: 'limpieza_estandar', reserva_str_id: null, fecha: hoyLocalISO(), hora_inicio: '', hora_fin: '',
      responsable_user_id: preseleccionResponsable(userId, elegibles), costo: '', notas: '' }
  }
  return {
    unidad_id: s.unidad_id ?? '', tipo: s.tipo, reserva_str_id: s.reserva_str_id ?? null, fecha: s.fecha,
    hora_inicio: (s.hora_inicio ?? '').slice(0, 5), hora_fin: (s.hora_fin ?? '').slice(0, 5),
    responsable_user_id: s.responsable_user_id ?? null, costo: s.costo != null ? String(s.costo) : '', notas: s.notas ?? '',
  }
}

export function HousekeepingServicioModal({ servicio, unidades, proyectoId, companyId, userId, moneda, elegibles, cargandoElegibles, elegiblesError, onRecargarElegibles, onClose, onSaved }: Props) {
  const [form, setForm] = useState<Form>(() => desdeServicio(servicio, userId, elegibles))
  const [saving, setSaving] = useState(false)
  const [reservas, setReservas] = useState<ReservaSTRVinculable[] | null>(null)
  const [reservasError, setReservasError] = useState<string | null>(null)
  const [avisoReserva, setAvisoReserva] = useState<string | null>(null)
  const peticion = useRef(0)
  const editId = servicio?.id ?? null

  useEffect(() => {
    const n = ++peticion.current
    setReservas(null); setReservasError(null)
    void fetchReservasVinculables(proyectoId).then(({ data, error }) => {
      if (n !== peticion.current) return
      setReservas(error ? [] : data); setReservasError(error)
    })
  }, [proyectoId])

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(f => ({ ...f, [k]: v }))

  // Unidad de la reserva vinculada: del catálogo o, al editar, del resumen sellado.
  function unidadDeReservaVinculada(reservaId: string | null): string | null {
    if (!reservaId) return null
    const r = reservas?.find(x => x.id === reservaId)
    if (r) return r.unidad_id
    const res = servicio?.reserva_str_resumen
    return res && res.reserva_id === reservaId ? res.unidad_id ?? null : null
  }

  function elegirReserva(id: string | null, r: ReservaSTRVinculable | null) {
    setAvisoReserva(null)
    setForm(f => ({ ...f, reserva_str_id: id, unidad_id: r?.unidad_id ?? f.unidad_id }))
  }

  function elegirUnidad(unidadId: string) {
    const unidadReserva = unidadDeReservaVinculada(form.reserva_str_id)
    const choca = !!unidadId && !!unidadReserva && unidadReserva !== unidadId
    setAvisoReserva(choca ? 'Se quitó la reserva vinculada porque es de otra unidad.' : null)
    setForm(f => ({ ...f, unidad_id: unidadId, reserva_str_id: choca ? null : f.reserva_str_id }))
  }

  async function handleSave() {
    if (!form.fecha) return notify({ variant: 'warning', title: 'Campo requerido', text: 'Ingresa la fecha del servicio.' })
    if (!editId && !form.responsable_user_id) {
      return notify({ variant: 'warning', title: 'Responsable requerido', text: 'Elige un responsable con acceso a este proyecto y al módulo de housekeeping.' })
    }
    setSaving(true)
    // Ni `estado` (lo mueven Iniciar/Finalizar) ni `responsable` (texto heredado) ni el
    // resumen de la reserva (lo sella la base) se mandan desde aquí.
    const payload = {
      company_id: companyId, project_id: proyectoId,
      unidad_id: form.unidad_id || null,
      tipo: form.tipo,
      reserva_str_id: form.reserva_str_id,
      fecha: form.fecha, hora_inicio: form.hora_inicio || null, hora_fin: form.hora_fin || null,
      responsable_user_id: form.responsable_user_id ?? null,
      costo: form.costo !== '' ? Number(form.costo) : null, notas: form.notas.trim() || null,
    }
    const { error } = editId
      ? await updateCondominioRow('servicios_housekeeping', editId, payload)
      : await createCondominioRow('servicios_housekeeping', payload)
    setSaving(false)
    if (error) {
      notify({ variant: 'error', title: 'No se guardó el servicio', text: mensajeErrorFlujo(mensajeErrorResponsable(error.message)) })
      onRecargarElegibles()
      return
    }
    onSaved()
    onClose()
  }

  async function cancelarServicio() {
    if (!servicio) return
    const r = await confirm({ title: '¿Cancelar el servicio?', text: 'El servicio quedará cancelado. Sus observaciones y fotos se conservan.', icon: 'warning', variant: 'danger', confirmText: 'Cancelar servicio' })
    if (!r.isConfirmed) return
    const { error } = await updateCondominioRowAfectando('servicios_housekeeping', servicio.id, { estado: 'cancelado' })
    if (error) return notify({ variant: 'error', title: 'No se canceló', text: error.code === 'SIN_FILAS' ? 'El servicio ya no existe o no tienes acceso.' : mensajeErrorFlujo(error.message) })
    onSaved()
    onClose()
  }

  const unidadNombre = unidades.find(u => u.id === form.unidad_id)?.nombre ?? null
  const puedeCancelar = !!servicio && (servicio.estado === 'pendiente' || servicio.estado === 'en_proceso')

  return (
    <EditModal
      title={editId ? 'Editar servicio de housekeeping' : 'Nuevo servicio de housekeeping'}
      subtitle={servicio ? `Estado: ${servicio.estado.replace('_', ' ')}` : 'El servicio nace pendiente; se inicia y finaliza desde su tarjeta.'}
      onClose={onClose}
      size="lg"
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
          {puedeCancelar && (
            <button type="button" onClick={cancelarServicio} style={{ ...btn, marginRight: 'auto', color: 'var(--at-danger)', borderColor: 'var(--at-danger-border, var(--at-line))' }}>Cancelar servicio</button>
          )}
          <button type="button" onClick={onClose} style={btn}>Cancelar</button>
          <button type="button" onClick={handleSave} disabled={saving}
            style={{ ...btn, background: 'var(--at-primary)', color: 'white', border: 'none', opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Guardando…' : editId ? 'Actualizar' : 'Agregar'}
          </button>
        </div>
      }
    >
      <div style={gridStyle}>
        <div style={parAmplio}>
          <div style={celda}>
            <label style={labelStyle}>Tipo</label>
            <select style={inputStyle} value={form.tipo} onChange={e => set('tipo', e.target.value as TipoHousekeeping)} aria-label="Tipo">
              {Object.entries(TIPO_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
            </select>
          </div>
          <div style={celda}>
            <label style={labelStyle}>Unidad</label>
            <select style={inputStyle} value={form.unidad_id} onChange={e => elegirUnidad(e.target.value)} aria-label="Unidad">
              <option value="">Sin unidad específica</option>
              {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </select>
          </div>
        </div>
        <div style={fila}>
          <label style={labelStyle}>Reserva STR (opcional)</label>
          <ReservaSTRPicker reservas={reservas} cargando={reservas === null && !reservasError} error={reservasError}
            value={form.reserva_str_id} onChange={elegirReserva} resumen={servicio?.reserva_str_resumen ?? null}
            unidadId={form.unidad_id || null} unidadNombre={unidadNombre} fecha={form.fecha} />
          {avisoReserva && <div role="status" style={{ ...ayudaStyle, color: 'var(--at-warning-strong)' }}>{avisoReserva}</div>}
          <div style={ayudaStyle}>
            {form.reserva_str_id
              ? 'El servicio usa la unidad de la reserva; el informe llevará sus datos.'
              : form.unidad_id
              ? `Se muestran las reservas de ${unidadNombre ?? 'la unidad elegida'}. Al elegir una, el informe llevará sus datos.`
              : 'Reservas en curso o futuras del proyecto. Al elegir una, el servicio toma su unidad y el informe llevará sus datos.'}
          </div>
        </div>
        <div style={fila}>
          <label style={labelStyle}>Fecha *</label>
          <input style={fechaHoraStyle} type="date" value={form.fecha} onChange={e => set('fecha', e.target.value)} aria-label="Fecha" />
        </div>
        <div style={celda}>
          <label style={labelStyle}>Ingreso tentativo</label>
          <input style={fechaHoraStyle} type="time" value={form.hora_inicio} onChange={e => set('hora_inicio', e.target.value)} aria-label="Hora tentativa de ingreso" />
        </div>
        <div style={celda}>
          <label style={labelStyle}>Fin estimado</label>
          <input style={fechaHoraStyle} type="time" value={form.hora_fin} onChange={e => set('hora_fin', e.target.value)} aria-label="Hora estimada de fin" />
        </div>
        <div style={fila}>
          <label style={labelStyle}>Responsable{editId ? '' : ' *'}</label>
          <ResponsableSelector elegibles={elegibles} cargando={cargandoElegibles} error={elegiblesError}
            value={form.responsable_user_id} onChange={id => set('responsable_user_id', id)} userId={userId} />
          {editId && !form.responsable_user_id && servicio?.responsable && (
            <div style={ayudaStyle}>Responsable anterior sin vincular: <b>{servicio.responsable}</b>. Elige un usuario para vincularlo.</div>
          )}
          {editId && form.responsable_user_id && elegibles && !elegibles.some(u => u.id === form.responsable_user_id) && (
            <div style={{ ...ayudaStyle, color: 'var(--at-warning-strong)' }}>
              El responsable actual ya no tiene acceso a este proyecto o al módulo (requiere reasignación). Si no eliges otro, se conserva tal cual.
            </div>
          )}
          <div style={ayudaStyle}>Recibe un aviso en la campana (y por correo si la empresa tiene Gmail conectado) y un recordatorio una hora antes del ingreso tentativo.</div>
        </div>
        <div style={celda}>
          <label style={labelStyle}>Costo ({moneda})</label>
          <input style={inputStyle} type="number" inputMode="decimal" min="0" step="0.01" value={form.costo} onChange={e => set('costo', e.target.value)} placeholder="0.00" aria-label="Costo" />
        </div>
        <div style={fila}>
          <label style={labelStyle}>Notas</label>
          <textarea style={{ ...inputStyle, minHeight: 64, resize: 'vertical', fontFamily: 'inherit' }} rows={2} value={form.notas} onChange={e => set('notas', e.target.value)} aria-label="Notas" />
        </div>
      </div>
    </EditModal>
  )
}
