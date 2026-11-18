import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type {
  ConceptoRenta, EstadoReservaRenta, LiquidacionRenta, PlataformaRenta, PoliticaCancelacionRenta, PropiedadRenta, Proyecto, ReservaUnificada,
} from '../../../types'
import {
  ESTADO_RESERVA_LABEL, ESTADOS_RESERVA, PLATAFORMA_LABEL, PLATAFORMAS,
  mensajeErrorRentas, noches, numeroONulo, reservasSolapadas,
} from '../../../domain/rentas/logica'
import {
  MONEDA_DEFECTO, POLITICA_CANCELACION_LABEL, POLITICAS_CANCELACION, claveReserva, importesDeFormulario, monedaDeReserva,
  tieneDesglose, totalesDesglose,
} from '../../../domain/rentas/finanzas'
import { useReservasRentaMutations, type DatosReserva } from '../../../domain/rentas/mutations'
import { cargarGrupo, guardarGrupo, type PersonaGrupo } from '../../../domain/rentas/grupo'
import { formatCurrency, formatFechaCalendario } from '../../../lib/format'
import { confirm, notify } from '../../shared/Dialog'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { EmptyState } from '../../shared/EmptyState'
import { FilterChips } from '../../shared/FilterChips'
import { StatusBadge } from '../../shared/StatusBadge'
import { ImageUploader } from '../../shared/ImageUploader'
import { MediaScopeProvider } from '../../shared/MediaScopeContext'
import { GrupoHuespedes } from '../GrupoHuespedes'
import type { PermisosModulo } from '../RentasSection'
import { DesgloseCampos } from '../finanzas/DesgloseCampos'
import { ImportarReservasModal } from '../finanzas/ImportarReservasModal'
import { SelectMoneda } from '../finanzas/SelectMoneda'
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
  hoy: string
  permisos: PermisosModulo
}

interface Form {
  propiedad_id: string
  huesped_nombre: string; huesped_telefono: string; huesped_email: string
  fecha_entrada: string; fecha_salida: string
  num_adultos: string; num_ninos: string; num_bebes: string
  fecha_reservacion: string; hora_llegada: string; hora_salida: string
  foto_url: string | null; foto_documento_url: string | null
  plataforma: PlataformaRenta; codigo_confirmacion: string
  monto_noche: string; monto_total: string
  estado: EstadoReservaRenta; notas: string
  politica_cancelacion: PoliticaCancelacionRenta | ''; num_mascotas: string
  /** Concepto → texto. */
  desglose: Record<string, string>
  /** Moneda de la reserva (ISO): aplica al total y al desglose. */
  moneda: string
}

const txt = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v))
const nulo = (v: string) => (v.trim() === '' ? null : v.trim())

function formDe(r?: ReservaUnificada, propiedadId = '', liquidacion?: LiquidacionRenta): Form {
  return {
    politica_cancelacion: r?.politica_cancelacion ?? '', num_mascotas: txt(r?.num_mascotas ?? 0),
    moneda: liquidacion?.moneda ?? MONEDA_DEFECTO,
    desglose: Object.fromEntries(Object.entries(liquidacion?.importes ?? {}).map(([k, v]) => [k, String(v)])),
    propiedad_id: r?.propiedad_id ?? propiedadId,
    huesped_nombre: r?.huesped_nombre ?? '', huesped_telefono: txt(r?.huesped_telefono), huesped_email: txt(r?.huesped_email),
    fecha_entrada: r?.fecha_entrada ?? '', fecha_salida: r?.fecha_salida ?? '',
    num_adultos: txt(r?.num_adultos ?? 1), num_ninos: txt(r?.num_ninos ?? 0), num_bebes: txt(r?.num_bebes ?? 0),
    fecha_reservacion: txt(r?.fecha_reservacion), hora_llegada: txt(r?.hora_llegada_estimada).slice(0, 5), hora_salida: txt(r?.hora_salida_estimada).slice(0, 5),
    foto_url: r?.foto_url ?? null, foto_documento_url: r?.foto_documento_url ?? null,
    plataforma: r?.plataforma ?? 'directo', codigo_confirmacion: txt(r?.codigo_confirmacion),
    monto_noche: txt(r?.monto_noche), monto_total: txt(r?.monto_total),
    estado: r?.estado ?? 'confirmada', notas: txt(r?.notas),
  }
}

type Filtro = 'todas' | EstadoReservaRenta

export default function ReservasTab({ propiedades, reservas, proyectos, conceptos, liquidaciones, companyId, hoy, permisos }: Props) {
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [propiedadFiltro, setPropiedadFiltro] = useState('')
  const [editando, setEditando] = useState<ReservaUnificada | 'nueva' | null>(null)
  const [importando, setImportando] = useState(false)
  // Personas del grupo (sólo reservas de propiedades enlazadas): como estaban y como quedan.
  const [grupoInicial, setGrupoInicial] = useState<PersonaGrupo[]>([])
  const [grupo, setGrupo] = useState<PersonaGrupo[]>([])
  const [subiendo, setSubiendo] = useState(false)
  const idEnEdicion = editando && editando !== 'nueva' && editando.origen === 'condominio' ? editando.id : null
  useEffect(() => {
    setGrupo([]); setGrupoInicial([])
    if (!idEnEdicion) return
    let vigente = true
    void cargarGrupo(idEnEdicion).then(g => { if (vigente) { setGrupo(g); setGrupoInicial(g) } }).catch(() => undefined)
    return () => { vigente = false }
  }, [idEnEdicion])
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
    const adultos = Number(form.num_adultos), ninos = Number(form.num_ninos || '0'), bebes = Number(form.num_bebes || '0')
    if (!Number.isInteger(adultos) || adultos < 1) { notify({ variant: 'error', title: 'Indica cuántos adultos son (al menos 1)' }); return }
    if (!Number.isInteger(ninos) || ninos < 0 || !Number.isInteger(bebes) || bebes < 0) { notify({ variant: 'error', title: 'Revisa cuántos niños y bebés son' }); return }
    const enlazada = !!(propiedad.unidad_id && propiedad.project_id)
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
    // La ficha (moneda + desglose) sólo se toca si hay algo que guardar o algo que cambiar.
    const habiaFicha = editando !== 'nueva' && liquidaciones.has(claveReserva(editando))
    const importesAGuardar = conDesglose || habiaFicha || form.moneda !== MONEDA_DEFECTO ? importes : undefined
    const datos: DatosReserva = {
      huesped_nombre: form.huesped_nombre.trim(), huesped_email: nulo(form.huesped_email), huesped_telefono: nulo(form.huesped_telefono),
      fecha_entrada: form.fecha_entrada, fecha_salida: form.fecha_salida,
      num_huespedes: adultos + ninos + bebes, num_adultos: adultos, num_ninos: ninos, num_bebes: bebes,
      fecha_reservacion: nulo(form.fecha_reservacion), hora_llegada_estimada: nulo(form.hora_llegada), hora_salida_estimada: nulo(form.hora_salida),
      ...(enlazada ? { foto_url: form.foto_url, foto_documento_url: form.foto_documento_url } : {}),
      plataforma: form.plataforma, codigo_confirmacion: nulo(form.codigo_confirmacion),
      monto_noche: noche, monto_total: recibido ?? total ?? totalSugerido,
      estado: form.estado, notas: nulo(form.notas),
      politica_cancelacion: form.politica_cancelacion === '' ? null : form.politica_cancelacion, num_mascotas: mascotas,
    }
    try {
      let reservaStrId: string | null = null
      if (editando === 'nueva') {
        const ref = await crear.mutateAsync({ propiedad, datos, importes: importesAGuardar, moneda: form.moneda })
        if (ref?.origen === 'condominio') reservaStrId = ref.id
      } else {
        await actualizar.mutateAsync({ reserva: editando, datos, propiedad, importes: importesAGuardar, moneda: form.moneda })
        if (editando.origen === 'condominio') reservaStrId = editando.id
      }
      // La reserva ya quedó guardada: si el grupo falla se avisa aparte, sin perderla.
      if (reservaStrId && (grupo.length > 0 || grupoInicial.length > 0)) {
        try {
          await guardarGrupo(reservaStrId, grupoInicial, grupo)
        } catch (e) {
          notify({ variant: 'warning', title: 'La reserva se guardó, pero no las personas del grupo', text: mensajeErrorRentas(e, 'Edita la reserva e intenta de nuevo.') })
        }
      }
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
        {permisos.crear && deCortoPlazo.length > 0 && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={() => setImportando(true)}>Carga masiva</Button>
            <Button onClick={() => abrir('nueva')}>+ Nueva reserva</Button>
          </div>
        )}
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
                      {r.monto_total === null ? '—' : formatCurrency(r.monto_total, monedaDeReserva(r, liquidaciones))}
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

      {importando && (
        <ImportarReservasModal
          propiedades={deCortoPlazo.filter(p => p.estado !== 'inactiva')}
          propiedadFija={propiedadPorId.get(propiedadFiltro)}
          reservas={reservas} conceptos={conceptos} hoy={hoy} onClose={() => setImportando(false)}
        />
      )}

      {editando && (
        <EditModal
          title={editando === 'nueva' ? 'Nueva reserva' : `Reserva de ${editando.huesped_nombre}`}
          onClose={cerrar} size="md" fullScreenOnMobile
          closeOnBackdropClick={!guardando} closeOnEscape={!guardando}
          footer={<>
            <Button variant="secondary" onClick={cerrar} disabled={guardando}>Cancelar</Button>
            <Button type="submit" form="rentas-reserva-form" loading={guardando} loadingText="Guardando..." disabled={subiendo}>Guardar</Button>
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
              <div>
                <label htmlFor="rr-reservacion" style={etiqueta}>Fecha de reservación</label>
                <input id="rr-reservacion" type="date" value={form.fecha_reservacion} onChange={e => set('fecha_reservacion', e.target.value)} style={campo} />
              </div>
            </div>
            <div style={rejilla(200)}>
              <div>
                <label htmlFor="rr-llegada" style={etiqueta}>Hora estimada de llegada</label>
                <input id="rr-llegada" type="time" value={form.hora_llegada} onChange={e => set('hora_llegada', e.target.value)} style={campo} />
              </div>
              <div>
                <label htmlFor="rr-hsalida" style={etiqueta}>Hora estimada de salida</label>
                <input id="rr-hsalida" type="time" value={form.hora_salida} onChange={e => set('hora_salida', e.target.value)} style={campo} />
              </div>
            </div>
            <div style={rejilla(110)}>
              <div>
                <label htmlFor="rr-adultos" style={etiqueta}>Adultos</label>
                <input id="rr-adultos" type="text" inputMode="numeric" value={form.num_adultos} onChange={e => set('num_adultos', e.target.value)} style={campo} />
              </div>
              <div>
                <label htmlFor="rr-ninos" style={etiqueta}>Niños</label>
                <input id="rr-ninos" type="text" inputMode="numeric" value={form.num_ninos} onChange={e => set('num_ninos', e.target.value)} style={campo} />
              </div>
              <div>
                <label htmlFor="rr-bebes" style={etiqueta}>Bebés</label>
                <input id="rr-bebes" type="text" inputMode="numeric" value={form.num_bebes} onChange={e => set('num_bebes', e.target.value)} style={campo} />
              </div>
              <div>
                <label htmlFor="rr-mascotas" style={etiqueta}>Mascotas</label>
                {propiedadForm?.unidad_id ? (
                  <select id="rr-mascotas" value={Number(form.num_mascotas) > 0 ? '1' : '0'} onChange={e => set('num_mascotas', e.target.value)} style={campo}>
                    <option value="0">No</option>
                    <option value="1">Sí</option>
                  </select>
                ) : (
                  <input id="rr-mascotas" type="text" inputMode="numeric" value={form.num_mascotas} onChange={e => set('num_mascotas', e.target.value)} style={campo} />
                )}
              </div>
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
              <div>
                <label htmlFor="rr-moneda" style={etiqueta}>Moneda</label>
                <SelectMoneda id="rr-moneda" value={form.moneda} onChange={m => set('moneda', m)} />
              </div>
            </div>
            {conceptos.length > 0 && (
              <details open={tieneDesglose(importesDeFormulario(form.desglose)) || undefined}>
                <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '14px', marginBottom: '0.6rem' }}>Desglose de cobro</summary>
                <p style={{ ...tenue, margin: '0 0 0.6rem' }}>
                  Lo que la plataforma le cobró al huésped y lo que recibió el anfitrión. Al guardar, el total de la reserva pasa a ser el «Total recibido».
                </p>
                <DesgloseCampos conceptos={conceptos} valores={form.desglose} moneda={form.moneda} idPrefijo="rr-dg"
                  onChange={(id, texto) => setForm(prev => ({ ...prev, desglose: { ...prev.desglose, [id]: texto } }))} />
              </details>
            )}
            <div style={rejilla(150)}>
              <div>
                <label htmlFor="rr-noche" style={etiqueta}>Monto por noche ({form.moneda})</label>
                <input id="rr-noche" type="text" inputMode="decimal" value={form.monto_noche} onChange={e => set('monto_noche', e.target.value)} style={campo} />
              </div>
              <div>
                <label htmlFor="rr-total" style={etiqueta}>Total ({form.moneda})</label>
                <input id="rr-total" type="text" inputMode="decimal" value={form.monto_total} onChange={e => set('monto_total', e.target.value)} style={campo}
                  placeholder={totalSugerido !== null ? String(totalSugerido) : ''} />
              </div>
            </div>
            {nNoches > 0 && (
              <p style={{ ...tenue, margin: 0 }}>
                {nNoches} noche{nNoches === 1 ? '' : 's'}
                {totalSugerido !== null && form.monto_total.trim() === '' ? ` · si dejas el total vacío se guarda ${formatCurrency(totalSugerido, form.moneda)}` : ''}
              </p>
            )}
            <div>
              <label htmlFor="rr-notas" style={etiqueta}>Notas</label>
              <textarea id="rr-notas" value={form.notas} onChange={e => set('notas', e.target.value)} rows={3} style={campo} maxLength={1000} />
            </div>
            {propiedadForm?.unidad_id && propiedadForm.project_id ? (
              <MediaScopeProvider projectId={propiedadForm.project_id}>
                <section aria-label="Fotografías del huésped principal" style={{ borderTop: '1px solid var(--at-line)', paddingTop: '0.75rem' }}>
                  <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '0.5rem' }}>
                    Fotografías del huésped principal <span style={{ ...tenue, fontWeight: 400 }}>(opcional — se pueden completar al ingreso)</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 200px))', gap: '0.75rem' }}>
                    <ImageUploader value={form.foto_url} onChange={v => set('foto_url', v)} folder="str_guests" label="Foto del huésped" capture onSubiendo={setSubiendo} />
                    <ImageUploader value={form.foto_documento_url} onChange={v => set('foto_documento_url', v)} folder="str_guests" label="DPI / Documento" capture onSubiendo={setSubiendo} />
                  </div>
                </section>
                <GrupoHuespedes personas={grupo} onChange={setGrupo} principal={form.huesped_nombre} onSubiendo={setSubiendo}
                  maximo={(Number(form.num_adultos) || 0) + (Number(form.num_ninos) || 0) - 1} />
              </MediaScopeProvider>
            ) : propiedadForm ? (
              <p style={{ ...tenue, margin: 0 }}>
                Las fotos del huésped y las personas del grupo se registran en las propiedades enlazadas a un condominio.
              </p>
            ) : null}
          </form>
        </EditModal>
      )}
    </div>
  )
}
