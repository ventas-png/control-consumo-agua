import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type {
  ConceptoRenta, EstadoReservaRenta, LiquidacionRenta, PlataformaRenta, PoliticaCancelacionRenta, PropiedadRenta, Proyecto, ReservaUnificada,
} from '../../../types'
import {
  ESTADO_RESERVA_LABEL, ESTADOS_RESERVA, PLATAFORMA_LABEL, PLATAFORMAS,
  mensajeErrorRentas, noches, numeroONulo, reservasSolapadas,
} from '../../../domain/rentas/logica'
import {
  POLITICA_CANCELACION_LABEL, POLITICAS_CANCELACION, claveReserva, importesDeFormulario, tieneDesglose, totalesDesglose,
} from '../../../domain/rentas/finanzas'
import { useReservasRentaMutations, type DatosReserva } from '../../../domain/rentas/mutations'
import { formatCurrency, formatFechaCalendario } from '../../../lib/format'
import { confirm, notify } from '../../shared/Dialog'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { EmptyState } from '../../shared/EmptyState'
import { FilterChips } from '../../shared/FilterChips'
import { StatusBadge } from '../../shared/StatusBadge'
import type { PermisosModulo } from '../RentasSection'
import { DesgloseCampos } from '../finanzas/DesgloseCampos'
import { TONO_RESERVA, accionesFila, barraFiltros, campo, encabezadoTab, etiqueta, fila, rejilla, td, tenue, th, thead } from '../ui'

interface Props {
  propiedades: PropiedadRenta[]
  reservas: ReservaUnificada[]
  proyectos: Proyecto[]
  /** Columnas del desglose de cobro (vacío si aún no llegaron o no se pueden leer). */
  conceptos: ConceptoRenta[]
  /** Desglose guardado de cada reserva, por `claveReserva`. */
  liquidaciones: Map<string, LiquidacionRenta>
  companyId: string
  moneda: string
  hoy: string
  permisos: PermisosModulo
}

interface Form {
  propiedad_id: string
  huesped_nombre: string; huesped_telefono: string; huesped_email: string
  fecha_entrada: string; fecha_salida: string; num_huespedes: string
  plataforma: PlataformaRenta; codigo_confirmacion: string
  monto_noche: string; monto_total: string
  estado: EstadoReservaRenta; notas: string
  politica_cancelacion: PoliticaCancelacionRenta | ''; num_mascotas: string
  /** Concepto → texto. */
  desglose: Record<string, string>
}

const txt = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v))
const nulo = (v: string) => (v.trim() === '' ? null : v.trim())

function formDe(r?: ReservaUnificada, propiedadId = '', liquidacion?: LiquidacionRenta): Form {
  return {
    politica_cancelacion: r?.politica_cancelacion ?? '', num_mascotas: txt(r?.num_mascotas ?? 0),
    desglose: Object.fromEntries(Object.entries(liquidacion?.importes ?? {}).map(([k, v]) => [k, String(v)])),
    propiedad_id: r?.propiedad_id ?? propiedadId,
    huesped_nombre: r?.huesped_nombre ?? '', huesped_telefono: txt(r?.huesped_telefono), huesped_email: txt(r?.huesped_email),
    fecha_entrada: r?.fecha_entrada ?? '', fecha_salida: r?.fecha_salida ?? '', num_huespedes: txt(r?.num_huespedes ?? 1),
    plataforma: r?.plataforma ?? 'directo', codigo_confirmacion: txt(r?.codigo_confirmacion),
    monto_noche: txt(r?.monto_noche), monto_total: txt(r?.monto_total),
    estado: r?.estado ?? 'confirmada', notas: txt(r?.notas),
  }
}

type Filtro = 'todas' | EstadoReservaRenta

export default function ReservasTab({ propiedades, reservas, proyectos, conceptos, liquidaciones, companyId, moneda, hoy, permisos }: Props) {
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [propiedadFiltro, setPropiedadFiltro] = useState('')
  const [editando, setEditando] = useState<ReservaUnificada | 'nueva' | null>(null)
  const [form, setForm] = useState<Form>(formDe())
  const { crear, actualizar, eliminar } = useReservasRentaMutations(companyId)
  const guardando = crear.isPending || actualizar.isPending

  const propiedadPorId = useMemo(() => new Map(propiedades.map(p => [p.id, p])), [propiedades])
  const nombreProyecto = useMemo(() => new Map(proyectos.map(p => [p.id, p.nombre])), [proyectos])
  // Sólo las de corto plazo llevan reservas por noche; las inactivas no reciben nuevas.
  const deCortoPlazo = useMemo(() => propiedades.filter(p => p.tipo_renta === 'corto_plazo'), [propiedades])

  const visibles = useMemo(() => reservas.filter(r =>
    (filtro === 'todas' || r.estado === filtro) && (propiedadFiltro === '' || r.propiedad_id === propiedadFiltro)),
  [reservas, filtro, propiedadFiltro])

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(prev => ({ ...prev, [k]: v }))
  const abrir = (r: ReservaUnificada | 'nueva') => {
    setForm(r === 'nueva' ? formDe(undefined, propiedadFiltro) : formDe(r, '', liquidaciones.get(claveReserva(r))))
    setEditando(r)
  }
  const cerrar = () => { if (!guardando) setEditando(null) }

  const nNoches = noches(form.fecha_entrada, form.fecha_salida)
  const totalSugerido = (() => {
    const n = numeroONulo(form.monto_noche)
    return typeof n === 'number' && nNoches > 0 ? Math.round(n * nNoches * 100) / 100 : null
  })()
  const solapes = editando
    ? reservasSolapadas(reservas, form.propiedad_id, form.fecha_entrada, form.fecha_salida, editando === 'nueva' ? undefined : editando.id)
    : []
  const propiedadForm = propiedadPorId.get(form.propiedad_id)

  const guardar = async () => {
    if (guardando || !editando) return
    const propiedad = propiedadPorId.get(form.propiedad_id)
    if (!propiedad) { notify({ variant: 'error', title: 'Elige la propiedad' }); return }
    if (!form.huesped_nombre.trim()) { notify({ variant: 'error', title: 'Falta el nombre del huésped' }); return }
    if (!form.fecha_entrada || !form.fecha_salida) { notify({ variant: 'error', title: 'Faltan las fechas de entrada y salida' }); return }
    if (form.fecha_salida <= form.fecha_entrada) { notify({ variant: 'error', title: 'La salida debe ser posterior a la entrada' }); return }
    const huespedes = Number(form.num_huespedes)
    if (!Number.isInteger(huespedes) || huespedes < 1) { notify({ variant: 'error', title: 'Indica cuántos huéspedes son (al menos 1)' }); return }
    const noche = numeroONulo(form.monto_noche)
    const total = numeroONulo(form.monto_total)
    if (noche === undefined || total === undefined) { notify({ variant: 'error', title: 'Revisa los montos', text: 'Deben ser números positivos.' }); return }
    const mascotas = Number(form.num_mascotas || '0')
    if (!Number.isInteger(mascotas) || mascotas < 0) { notify({ variant: 'error', title: 'Revisa cuántas mascotas son' }); return }
    const importes = importesDeFormulario(form.desglose)
    if (importes === null) { notify({ variant: 'error', title: 'Revisa el desglose de cobro', text: 'Cada monto debe ser un número mayor o igual a cero.' }); return }
    const conDesglose = tieneDesglose(importes)
    // Con desglose, el total de la reserva ES lo recibido por el anfitrión.
    const recibido = conDesglose ? totalesDesglose(conceptos, importes).anfitrion : null
    // Sólo se toca el desglose si hay algo que guardar o algo que vaciar.
    const habiaDesglose = editando !== 'nueva' && liquidaciones.has(claveReserva(editando))
    const importesAGuardar = conDesglose || habiaDesglose ? importes : undefined
    const datos: DatosReserva = {
      huesped_nombre: form.huesped_nombre.trim(), huesped_email: nulo(form.huesped_email), huesped_telefono: nulo(form.huesped_telefono),
      fecha_entrada: form.fecha_entrada, fecha_salida: form.fecha_salida, num_huespedes: huespedes,
      plataforma: form.plataforma, codigo_confirmacion: nulo(form.codigo_confirmacion),
      monto_noche: noche, monto_total: recibido ?? total ?? totalSugerido,
      estado: form.estado, notas: nulo(form.notas),
      politica_cancelacion: form.politica_cancelacion === '' ? null : form.politica_cancelacion, num_mascotas: mascotas,
    }
    try {
      if (editando === 'nueva') await crear.mutateAsync({ propiedad, datos, importes: importesAGuardar })
      else await actualizar.mutateAsync({ reserva: editando, datos, propiedad, importes: importesAGuardar })
      setEditando(null)
      notify({ variant: 'success', title: editando === 'nueva' ? 'Reserva registrada' : 'Reserva actualizada', duration: 1500 })
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo guardar', text: mensajeErrorRentas(e, 'Intenta de nuevo.') })
    }
  }

  const cambiarEstado = async (r: ReservaUnificada, estado: EstadoReservaRenta) => {
    if (estado === r.estado) return
    if (estado === 'cancelada') {
      const { isConfirmed } = await confirm({
        title: '¿Cancelar la reserva?', text: `${r.huesped_nombre}, del ${formatFechaCalendario(r.fecha_entrada)} al ${formatFechaCalendario(r.fecha_salida)}.`,
        icon: 'warning', variant: 'danger', confirmText: 'Cancelar reserva', cancelText: 'Volver',
      })
      if (!isConfirmed) return
    }
    try {
      await actualizar.mutateAsync({ reserva: r, datos: { estado } })
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo cambiar el estado', text: mensajeErrorRentas(e, 'Intenta de nuevo.') })
    }
  }

  const borrar = async (r: ReservaUnificada) => {
    const { isConfirmed } = await confirm({
      title: '¿Eliminar la reserva?', text: `${r.huesped_nombre} será eliminada permanentemente. Si sólo se canceló, mejor márcala como cancelada.`,
      icon: 'warning', variant: 'danger', confirmText: 'Eliminar',
    })
    if (!isConfirmed) return
    try {
      await eliminar.mutateAsync(r.id)
      notify({ variant: 'success', title: 'Reserva eliminada', duration: 1500 })
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo eliminar', text: mensajeErrorRentas(e, 'Intenta de nuevo.') })
    }
  }

  return (
    <div>
      <div style={encabezadoTab}>
        <h2 style={{ margin: 0 }}>Reservas de corto plazo</h2>
        {permisos.crear && deCortoPlazo.length > 0 && <Button onClick={() => abrir('nueva')}>+ Nueva reserva</Button>}
      </div>

      <div style={barraFiltros}>
        <FilterChips<Filtro>
          ariaLabel="Filtrar por estado"
          value={filtro} onChange={setFiltro}
          options={[
            { value: 'todas', label: 'Todas', count: reservas.length },
            ...ESTADOS_RESERVA.map(e => ({ value: e as Filtro, label: ESTADO_RESERVA_LABEL[e], count: reservas.filter(r => r.estado === e).length })),
          ]}
        />
        <select value={propiedadFiltro} onChange={e => setPropiedadFiltro(e.target.value)} aria-label="Filtrar por propiedad"
          style={{ ...campo, maxWidth: '280px' }}>
          <option value="">Todas las propiedades</option>
          {deCortoPlazo.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </div>

      {deCortoPlazo.length === 0 ? (
        <EmptyState icon="📅" title="No hay propiedades de corto plazo"
          description="Registra primero una propiedad de tipo «Corto plazo (STR)» en la pestaña Propiedades para llevar sus reservas." />
      ) : reservas.length === 0 ? (
        <EmptyState icon="📅" title="Aún no hay reservas"
          description="Aquí verás las reservas de todas tus propiedades de corto plazo: las de tus condominios y las independientes."
          action={permisos.crear ? <Button onClick={() => abrir('nueva')}>+ Nueva reserva</Button> : undefined} />
      ) : visibles.length === 0 ? (
        <p style={{ ...tenue, fontStyle: 'italic' }}>Ninguna reserva coincide con el filtro.</p>
      ) : (
        <div className="table-scroll-wrapper">
          <table className="table-cards-on-mobile" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={thead}>
                <th scope="col" style={th}>Propiedad</th>
                <th scope="col" style={th}>Huésped</th>
                <th scope="col" style={th}>Estancia</th>
                <th scope="col" style={th}>Plataforma</th>
                <th scope="col" style={{ ...th, textAlign: 'right' }}>Total</th>
                <th scope="col" style={th}>Estado</th>
                {(permisos.editar || permisos.eliminar) && <th scope="col" style={{ ...th, textAlign: 'center' }}>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {visibles.map(r => {
                const p = propiedadPorId.get(r.propiedad_id)
                const n = noches(r.fecha_entrada, r.fecha_salida)
                return (
                  <tr key={`${r.origen}-${r.id}`} style={fila}>
                    <td data-label="Propiedad" style={td}>
                      <div style={{ fontWeight: 600 }}>{p?.nombre ?? 'Propiedad'}</div>
                      <div style={tenue}>
                        {r.origen === 'condominio' ? `🏢 ${p?.project_id ? nombreProyecto.get(p.project_id) ?? 'Condominio' : 'Condominio'}` : 'Independiente'}
                      </div>
                    </td>
                    <td data-label="Huésped" style={td}>
                      <div>{r.huesped_nombre}</div>
                      <div style={tenue}>{[r.huesped_telefono, `${r.num_huespedes} huésped${r.num_huespedes === 1 ? '' : 'es'}`].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td data-label="Estancia" style={td}>
                      <div>{formatFechaCalendario(r.fecha_entrada)} → {formatFechaCalendario(r.fecha_salida)}</div>
                      <div style={tenue}>{n} noche{n === 1 ? '' : 's'}{r.fecha_entrada <= hoy && hoy < r.fecha_salida && r.estado !== 'cancelada' ? ' · hoy' : ''}</div>
                    </td>
                    <td data-label="Plataforma" style={td}>
                      {PLATAFORMA_LABEL[r.plataforma]}
                      {r.codigo_confirmacion && <div style={tenue}>{r.codigo_confirmacion}</div>}
                    </td>
                    <td data-label="Total" style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {r.monto_total === null ? '—' : formatCurrency(r.monto_total, moneda)}
                      {tieneDesglose(liquidaciones.get(claveReserva(r))?.importes) && <div style={tenue}>con desglose</div>}
                    </td>
                    <td data-label="Estado" style={td}>
                      {permisos.editar ? (
                        <select value={r.estado} aria-label={`Estado de la reserva de ${r.huesped_nombre}`}
                          onChange={e => void cambiarEstado(r, e.target.value as EstadoReservaRenta)}
                          style={{ ...campo, width: 'auto', padding: '0.3rem 0.4rem' }}>
                          {ESTADOS_RESERVA.map(e => <option key={e} value={e}>{ESTADO_RESERVA_LABEL[e]}</option>)}
                        </select>
                      ) : <StatusBadge tone={TONO_RESERVA[r.estado]}>{ESTADO_RESERVA_LABEL[r.estado]}</StatusBadge>}
                    </td>
                    {(permisos.editar || permisos.eliminar) && (
                      <td style={{ ...td, textAlign: 'center' }}>
                        <div style={accionesFila}>
                          {permisos.editar && <Button size="sm" onClick={() => abrir(r)} aria-label={`Editar la reserva de ${r.huesped_nombre}`}>Editar</Button>}
                          {permisos.eliminar && r.origen === 'rentas' && (
                            <Button size="sm" variant="danger" onClick={() => void borrar(r)} aria-label={`Eliminar la reserva de ${r.huesped_nombre}`}>Eliminar</Button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {reservas.some(r => r.origen === 'condominio') && (
        <p style={{ ...tenue, marginTop: '0.75rem' }}>
          🏢 Las reservas de propiedades enlazadas a un condominio son las mismas de su pestaña STR: el check-in, los huéspedes y el
          housekeeping se llevan allá, en <Link to="/condominios/str">Condominios › STR</Link>.
        </p>
      )}

      {editando && (
        <EditModal
          title={editando === 'nueva' ? 'Nueva reserva' : `Reserva de ${editando.huesped_nombre}`}
          onClose={cerrar} size="md" fullScreenOnMobile
          closeOnBackdropClick={!guardando} closeOnEscape={!guardando}
          footer={<>
            <Button variant="secondary" onClick={cerrar} disabled={guardando}>Cancelar</Button>
            <Button type="submit" form="rentas-reserva-form" loading={guardando} loadingText="Guardando...">Guardar</Button>
          </>}
        >
          <form id="rentas-reserva-form" onSubmit={e => { e.preventDefault(); void guardar() }}
            style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
            <div>
              <label htmlFor="rr-propiedad" style={etiqueta}>Propiedad *</label>
              <select id="rr-propiedad" value={form.propiedad_id} onChange={e => set('propiedad_id', e.target.value)} style={campo}
                disabled={editando !== 'nueva'}>
                <option value="">Elige una propiedad…</option>
                {deCortoPlazo.filter(p => p.estado !== 'inactiva' || p.id === form.propiedad_id).map(p => (
                  <option key={p.id} value={p.id}>{p.nombre}{p.project_id ? ` — ${nombreProyecto.get(p.project_id) ?? 'Condominio'}` : ''}</option>
                ))}
              </select>
              {propiedadForm?.unidad_id && (
                <p style={{ ...tenue, margin: '0.35rem 0 0' }}>Se guarda en la pestaña STR de su condominio.</p>
              )}
            </div>
            <div style={rejilla(200)}>
              <div>
                <label htmlFor="rr-huesped" style={etiqueta}>Huésped *</label>
                <input id="rr-huesped" type="text" value={form.huesped_nombre} onChange={e => set('huesped_nombre', e.target.value)} style={campo} maxLength={150} />
              </div>
              <div>
                <label htmlFor="rr-tel" style={etiqueta}>Teléfono</label>
                <input id="rr-tel" type="tel" value={form.huesped_telefono} onChange={e => set('huesped_telefono', e.target.value)} style={campo} maxLength={30} />
              </div>
              <div>
                <label htmlFor="rr-email" style={etiqueta}>Correo</label>
                <input id="rr-email" type="email" value={form.huesped_email} onChange={e => set('huesped_email', e.target.value)} style={campo} maxLength={150} />
              </div>
            </div>
            <div style={rejilla(150)}>
              <div>
                <label htmlFor="rr-entrada" style={etiqueta}>Entrada *</label>
                <input id="rr-entrada" type="date" value={form.fecha_entrada} onChange={e => set('fecha_entrada', e.target.value)} style={campo} />
              </div>
              <div>
                <label htmlFor="rr-salida" style={etiqueta}>Salida *</label>
                <input id="rr-salida" type="date" value={form.fecha_salida} min={form.fecha_entrada || undefined} onChange={e => set('fecha_salida', e.target.value)} style={campo} />
              </div>
              {(editando === 'nueva' || editando.origen === 'rentas') && (
                <div>
                  <label htmlFor="rr-huespedes" style={etiqueta}>Huéspedes</label>
                  <input id="rr-huespedes" type="text" inputMode="numeric" value={form.num_huespedes} onChange={e => set('num_huespedes', e.target.value)} style={campo} />
                </div>
              )}
            </div>
            {solapes.length > 0 && (
              <p role="status" style={{ margin: 0, padding: '0.5rem 0.75rem', borderRadius: '6px', background: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', fontSize: '13px' }}>
                ⚠️ Esas fechas se cruzan con {solapes.length === 1 ? 'la reserva de' : `${solapes.length} reservas:`}{' '}
                {solapes.slice(0, 3).map(s => `${s.huesped_nombre} (${formatFechaCalendario(s.fecha_entrada)} → ${formatFechaCalendario(s.fecha_salida)})`).join(', ')}. Puedes guardarla igual.
              </p>
            )}
            <div style={rejilla(150)}>
              <div>
                <label htmlFor="rr-plataforma" style={etiqueta}>Plataforma</label>
                <select id="rr-plataforma" value={form.plataforma} onChange={e => set('plataforma', e.target.value as PlataformaRenta)} style={campo}>
                  {PLATAFORMAS.map(p => <option key={p} value={p}>{PLATAFORMA_LABEL[p]}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="rr-codigo" style={etiqueta}>Código de confirmación</label>
                <input id="rr-codigo" type="text" value={form.codigo_confirmacion} onChange={e => set('codigo_confirmacion', e.target.value)} style={campo} maxLength={60} />
              </div>
              <div>
                <label htmlFor="rr-estado" style={etiqueta}>Estado</label>
                <select id="rr-estado" value={form.estado} onChange={e => set('estado', e.target.value as EstadoReservaRenta)} style={campo}>
                  {ESTADOS_RESERVA.map(e => <option key={e} value={e}>{ESTADO_RESERVA_LABEL[e]}</option>)}
                </select>
              </div>
            </div>
            <div style={rejilla(150)}>
              <div>
                <label htmlFor="rr-politica" style={etiqueta}>Política de cancelación</label>
                <select id="rr-politica" value={form.politica_cancelacion}
                  onChange={e => set('politica_cancelacion', e.target.value as PoliticaCancelacionRenta | '')} style={campo}>
                  <option value="">Sin especificar</option>
                  {POLITICAS_CANCELACION.map(p => <option key={p} value={p}>{POLITICA_CANCELACION_LABEL[p]}</option>)}
                </select>
              </div>
              {(editando === 'nueva' || editando.origen === 'rentas') && (
                <div>
                  <label htmlFor="rr-mascotas" style={etiqueta}>Mascotas</label>
                  <input id="rr-mascotas" type="text" inputMode="numeric" value={form.num_mascotas} onChange={e => set('num_mascotas', e.target.value)} style={campo} />
                </div>
              )}
            </div>
            {conceptos.length > 0 && (
              <details open={tieneDesglose(importesDeFormulario(form.desglose)) || undefined}>
                <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '14px', marginBottom: '0.6rem' }}>Desglose de cobro</summary>
                <p style={{ ...tenue, margin: '0 0 0.6rem' }}>
                  Lo que la plataforma le cobró al huésped y lo que recibió el anfitrión. Al guardar, el total de la reserva pasa a ser el «Total recibido».
                </p>
                <DesgloseCampos conceptos={conceptos} valores={form.desglose} moneda={moneda} idPrefijo="rr-dg"
                  onChange={(id, texto) => setForm(prev => ({ ...prev, desglose: { ...prev.desglose, [id]: texto } }))} />
              </details>
            )}
            <div style={rejilla(150)}>
              <div>
                <label htmlFor="rr-noche" style={etiqueta}>Monto por noche ({moneda})</label>
                <input id="rr-noche" type="text" inputMode="decimal" value={form.monto_noche} onChange={e => set('monto_noche', e.target.value)} style={campo} />
              </div>
              <div>
                <label htmlFor="rr-total" style={etiqueta}>Total ({moneda})</label>
                <input id="rr-total" type="text" inputMode="decimal" value={form.monto_total} onChange={e => set('monto_total', e.target.value)} style={campo}
                  placeholder={totalSugerido !== null ? String(totalSugerido) : ''} />
              </div>
            </div>
            {nNoches > 0 && (
              <p style={{ ...tenue, margin: 0 }}>
                {nNoches} noche{nNoches === 1 ? '' : 's'}
                {totalSugerido !== null && form.monto_total.trim() === '' ? ` · si dejas el total vacío se guarda ${formatCurrency(totalSugerido, moneda)}` : ''}
              </p>
            )}
            <div>
              <label htmlFor="rr-notas" style={etiqueta}>Notas</label>
              <textarea id="rr-notas" value={form.notas} onChange={e => set('notas', e.target.value)} rows={3} style={campo} maxLength={1000} />
            </div>
          </form>
        </EditModal>
      )}
    </div>
  )
}
