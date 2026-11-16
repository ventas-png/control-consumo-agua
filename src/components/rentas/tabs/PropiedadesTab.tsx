import { useMemo, useState } from 'react'
import type {
  ArticuloInventarioRenta, ContratoRenta, EstadoPropiedadRenta, PropiedadRenta, Proyecto,
  ReservaUnificada, TipoPropiedadRenta, Unidad,
} from '../../../types'
import {
  ESTADO_PROPIEDAD_LABEL, OCUPACION_LABEL, TIPO_RENTA_ICONO, TIPO_RENTA_LABEL, TIPOS_RENTA,
  mensajeErrorRentas, numeroONulo, ocupacionDePropiedad,
} from '../../../domain/rentas/logica'
import { usePropiedadesRentaMutations } from '../../../domain/rentas/mutations'
import { formatCurrency } from '../../../lib/format'
import { confirm, notify } from '../../shared/Dialog'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { EmptyState } from '../../shared/EmptyState'
import { FilterChips } from '../../shared/FilterChips'
import { StatusBadge } from '../../shared/StatusBadge'
import type { PermisosModulo } from '../RentasSection'
import { TONO_OCUPACION, accionesFila, barraFiltros, campo, encabezadoTab, etiqueta, fila, rejilla, td, tenue, th, thead } from '../ui'

interface Props {
  propiedades: PropiedadRenta[]
  reservas: ReservaUnificada[]
  contratos: ContratoRenta[]
  inventario: ArticuloInventarioRenta[]
  proyectos: Proyecto[]
  unidades: Unidad[]
  companyId: string
  moneda: string
  hoy: string
  permisos: PermisosModulo
  cargando: boolean
}

interface Form {
  nombre: string; codigo: string; tipo_renta: TipoPropiedadRenta; tipo_detalle: string; estado: EstadoPropiedadRenta
  enlazada: boolean; project_id: string; unidad_id: string
  direccion: string; ciudad: string
  propietario_nombre: string; propietario_telefono: string; propietario_email: string
  habitaciones: string; banos: string; capacidad: string; area_m2: string
  tarifa_base: string; comision_pct: string; notas: string
}

const txt = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v))
const nulo = (v: string) => (v.trim() === '' ? null : v.trim())

function formDe(p?: PropiedadRenta): Form {
  return {
    nombre: p?.nombre ?? '', codigo: txt(p?.codigo), tipo_renta: p?.tipo_renta ?? 'corto_plazo',
    tipo_detalle: txt(p?.tipo_detalle), estado: p?.estado ?? 'activa',
    enlazada: !!p?.unidad_id, project_id: txt(p?.project_id), unidad_id: txt(p?.unidad_id),
    direccion: txt(p?.direccion), ciudad: txt(p?.ciudad),
    propietario_nombre: txt(p?.propietario_nombre), propietario_telefono: txt(p?.propietario_telefono),
    propietario_email: txt(p?.propietario_email),
    habitaciones: txt(p?.habitaciones), banos: txt(p?.banos), capacidad: txt(p?.capacidad), area_m2: txt(p?.area_m2),
    tarifa_base: txt(p?.tarifa_base), comision_pct: txt(p?.comision_pct), notas: txt(p?.notas),
  }
}

type Filtro = 'todas' | TipoPropiedadRenta

export default function PropiedadesTab({
  propiedades, reservas, contratos, inventario, proyectos, unidades, companyId, moneda, hoy, permisos, cargando,
}: Props) {
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [buscar, setBuscar] = useState('')
  const [editando, setEditando] = useState<PropiedadRenta | 'nueva' | null>(null)
  const [form, setForm] = useState<Form>(formDe())
  const { crear, actualizar, eliminar } = usePropiedadesRentaMutations(companyId)
  const guardando = crear.isPending || actualizar.isPending

  const nombreProyecto = useMemo(() => new Map(proyectos.map(p => [p.id, p.nombre])), [proyectos])
  const unidadPorId = useMemo(() => new Map(unidades.map(u => [u.id, u])), [unidades])
  const articulosPorPropiedad = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of inventario) m.set(a.propiedad_id, (m.get(a.propiedad_id) ?? 0) + 1)
    return m
  }, [inventario])

  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    return propiedades.filter(p =>
      (filtro === 'todas' || p.tipo_renta === filtro)
      && (q === '' || [p.nombre, p.codigo, p.ciudad, p.direccion, p.propietario_nombre]
        .some(v => (v ?? '').toLowerCase().includes(q))))
  }, [propiedades, filtro, buscar])

  // Unidades que se pueden enlazar: activas, del proyecto elegido y que aún no
  // son propiedad en renta (salvo la de la propiedad que se está editando).
  const unidadesLibres = useMemo(() => {
    const usadas = new Set(propiedades.filter(p => p.unidad_id && (editando === 'nueva' || editando === null || p.id !== editando.id)).map(p => p.unidad_id as string))
    return unidades.filter(u => u.project_id === form.project_id && u.activo !== false && !usadas.has(u.id))
  }, [unidades, propiedades, form.project_id, editando])

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(prev => ({ ...prev, [k]: v }))

  const abrir = (p: PropiedadRenta | 'nueva') => {
    setForm(formDe(p === 'nueva' ? undefined : p))
    setEditando(p)
  }
  const cerrar = () => { if (!guardando) setEditando(null) }

  // Al elegir la unidad se proponen su nombre y su propietario, sin pisar lo ya escrito.
  const elegirUnidad = (id: string) => {
    const u = unidadPorId.get(id)
    setForm(prev => ({
      ...prev, unidad_id: id,
      nombre: prev.nombre.trim() || (u?.nombre ?? ''),
      propietario_nombre: prev.propietario_nombre.trim() || (u?.propietario_nombre ?? ''),
      propietario_telefono: prev.propietario_telefono.trim() || (u?.propietario_telefono ?? ''),
      propietario_email: prev.propietario_email.trim() || (u?.propietario_email ?? ''),
    }))
  }

  const guardar = async () => {
    if (guardando || !editando) return
    if (!form.nombre.trim()) { notify({ variant: 'error', title: 'Falta el nombre de la propiedad' }); return }
    if (form.enlazada && (!form.project_id || !form.unidad_id)) {
      notify({ variant: 'error', title: 'Elige el proyecto y la unidad', text: 'O desmarca «Es una unidad de un proyecto» para registrarla como independiente.' })
      return
    }
    const numeros = {
      habitaciones: numeroONulo(form.habitaciones), banos: numeroONulo(form.banos), capacidad: numeroONulo(form.capacidad),
      area_m2: numeroONulo(form.area_m2), tarifa_base: numeroONulo(form.tarifa_base), comision_pct: numeroONulo(form.comision_pct),
    }
    if (Object.values(numeros).some(n => n === undefined)) {
      notify({ variant: 'error', title: 'Revisa los números', text: 'Habitaciones, baños, capacidad, área, tarifa y comisión deben ser números positivos.' })
      return
    }
    if (typeof numeros.comision_pct === 'number' && numeros.comision_pct > 100) {
      notify({ variant: 'error', title: 'La comisión es un porcentaje entre 0 y 100' }); return
    }
    for (const k of ['habitaciones', 'capacidad'] as const) {
      const n = numeros[k]
      if (typeof n === 'number' && !Number.isInteger(n)) { notify({ variant: 'error', title: 'Habitaciones y capacidad son números enteros' }); return }
    }
    const payload = {
      company_id: companyId,
      nombre: form.nombre.trim(), codigo: nulo(form.codigo), tipo_renta: form.tipo_renta,
      tipo_detalle: form.tipo_renta === 'otro' ? nulo(form.tipo_detalle) : null, estado: form.estado,
      project_id: form.enlazada ? form.project_id : null, unidad_id: form.enlazada ? form.unidad_id : null,
      direccion: nulo(form.direccion), ciudad: nulo(form.ciudad),
      propietario_nombre: nulo(form.propietario_nombre), propietario_telefono: nulo(form.propietario_telefono),
      propietario_email: nulo(form.propietario_email),
      habitaciones: numeros.habitaciones as number | null, banos: numeros.banos as number | null,
      capacidad: numeros.capacidad as number | null, area_m2: numeros.area_m2 as number | null,
      tarifa_base: numeros.tarifa_base as number | null, comision_pct: numeros.comision_pct as number | null,
      notas: nulo(form.notas),
    }
    try {
      if (editando === 'nueva') await crear.mutateAsync(payload)
      else {
        const { company_id: _fija, ...patch } = payload
        await actualizar.mutateAsync({ id: editando.id, patch })
      }
      setEditando(null)
      notify({ variant: 'success', title: editando === 'nueva' ? 'Propiedad registrada' : 'Propiedad actualizada', duration: 1500 })
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo guardar', text: mensajeErrorRentas(e, 'Intenta de nuevo.') })
    }
  }

  const borrar = async (p: PropiedadRenta) => {
    const { isConfirmed } = await confirm({
      title: `¿Eliminar «${p.nombre}»?`,
      text: 'Se eliminan también sus contratos, su inventario y las reservas registradas aquí. Las reservas que viven en la pestaña STR de su condominio no se tocan.',
      icon: 'warning', variant: 'danger', confirmText: 'Eliminar',
    })
    if (!isConfirmed) return
    try {
      await eliminar.mutateAsync(p.id)
      notify({ variant: 'success', title: 'Propiedad eliminada', duration: 1500 })
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo eliminar', text: mensajeErrorRentas(e, 'Intenta de nuevo.') })
    }
  }

  const tarifaEtiqueta = form.tipo_renta === 'corto_plazo' ? `Tarifa por noche (${moneda})` : `Renta mensual de referencia (${moneda})`

  return (
    <div>
      <div style={encabezadoTab}>
        <h2 style={{ margin: 0 }}>Propiedades en renta</h2>
        {permisos.crear && <Button onClick={() => abrir('nueva')}>+ Nueva propiedad</Button>}
      </div>

      <div style={barraFiltros}>
        <FilterChips<Filtro>
          ariaLabel="Filtrar por tipo de renta"
          value={filtro}
          onChange={setFiltro}
          options={[
            { value: 'todas', label: 'Todas', count: propiedades.length },
            ...TIPOS_RENTA.map(t => ({ value: t as Filtro, label: TIPO_RENTA_LABEL[t], count: propiedades.filter(p => p.tipo_renta === t).length })),
          ]}
        />
        <input
          type="search" value={buscar} onChange={e => setBuscar(e.target.value)}
          placeholder="Buscar por nombre, código, ciudad o propietario" aria-label="Buscar propiedad"
          style={{ ...campo, maxWidth: '340px' }}
        />
      </div>

      {cargando ? <p style={tenue}>Cargando…</p> : propiedades.length === 0 ? (
        <EmptyState
          icon="🏘️" title="Aún no hay propiedades en renta"
          description="Registra una unidad de uno de tus proyectos o una propiedad independiente que la empresa administre."
          action={permisos.crear ? <Button onClick={() => abrir('nueva')}>+ Nueva propiedad</Button> : undefined}
        />
      ) : visibles.length === 0 ? (
        <p style={{ ...tenue, fontStyle: 'italic' }}>Ninguna propiedad coincide con el filtro.</p>
      ) : (
        <div className="table-scroll-wrapper">
          <table className="table-cards-on-mobile" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={thead}>
                <th scope="col" style={th}>Propiedad</th>
                <th scope="col" style={th}>Tipo</th>
                <th scope="col" style={th}>Pertenece a</th>
                <th scope="col" style={th}>Propietario</th>
                <th scope="col" style={{ ...th, textAlign: 'right' }}>Tarifa base</th>
                <th scope="col" style={th}>Hoy</th>
                <th scope="col" style={{ ...th, textAlign: 'right' }}>Artículos</th>
                {(permisos.editar || permisos.eliminar) && <th scope="col" style={{ ...th, textAlign: 'center' }}>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {visibles.map(p => {
                const o = ocupacionDePropiedad(p, reservas, contratos, hoy)
                const unidad = p.unidad_id ? unidadPorId.get(p.unidad_id) : undefined
                return (
                  <tr key={p.id} style={fila}>
                    <td data-label="Propiedad" style={td}>
                      <div style={{ fontWeight: 600 }}>{p.nombre}</div>
                      <div style={tenue}>{[p.codigo, p.ciudad, p.direccion].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td data-label="Tipo" style={td}>
                      {TIPO_RENTA_ICONO[p.tipo_renta]} {p.tipo_renta === 'otro' && p.tipo_detalle ? p.tipo_detalle : TIPO_RENTA_LABEL[p.tipo_renta]}
                    </td>
                    <td data-label="Pertenece a" style={td}>
                      {p.project_id ? (
                        <>
                          <div>{nombreProyecto.get(p.project_id) ?? 'Proyecto'}</div>
                          {unidad && <div style={tenue}>Unidad {unidad.nombre}</div>}
                        </>
                      ) : <span style={tenue}>Independiente</span>}
                    </td>
                    <td data-label="Propietario" style={td}>
                      {p.propietario_nombre ?? <span style={tenue}>—</span>}
                      {p.propietario_telefono && <div style={tenue}>{p.propietario_telefono}</div>}
                    </td>
                    <td data-label="Tarifa base" style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {p.tarifa_base === null ? '—' : `${formatCurrency(p.tarifa_base, moneda)} / ${p.tipo_renta === 'corto_plazo' ? 'noche' : 'mes'}`}
                      {p.comision_pct !== null && <div style={tenue}>Comisión {p.comision_pct}%</div>}
                    </td>
                    <td data-label="Hoy" style={td}><StatusBadge tone={TONO_OCUPACION[o]}>{OCUPACION_LABEL[o]}</StatusBadge></td>
                    <td data-label="Artículos" style={{ ...td, textAlign: 'right' }}>{articulosPorPropiedad.get(p.id) ?? 0}</td>
                    {(permisos.editar || permisos.eliminar) && (
                      <td style={{ ...td, textAlign: 'center' }}>
                        <div style={accionesFila}>
                          {permisos.editar && <Button size="sm" onClick={() => abrir(p)} aria-label={`Editar ${p.nombre}`}>Editar</Button>}
                          {permisos.eliminar && <Button size="sm" variant="danger" onClick={() => void borrar(p)} aria-label={`Eliminar ${p.nombre}`}>Eliminar</Button>}
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

      {editando && (
        <EditModal
          title={editando === 'nueva' ? 'Nueva propiedad en renta' : `Editar ${editando.nombre}`}
          onClose={cerrar} size="md" fullScreenOnMobile
          closeOnBackdropClick={!guardando} closeOnEscape={!guardando}
          footer={<>
            <Button variant="secondary" onClick={cerrar} disabled={guardando}>Cancelar</Button>
            <Button type="submit" form="rentas-propiedad-form" loading={guardando} loadingText="Guardando...">Guardar</Button>
          </>}
        >
          <form id="rentas-propiedad-form" onSubmit={e => { e.preventDefault(); void guardar() }}
            style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input type="checkbox" checked={form.enlazada}
                onChange={e => setForm(prev => ({ ...prev, enlazada: e.target.checked, ...(e.target.checked ? {} : { project_id: '', unidad_id: '' }) }))} />
              Es una unidad de uno de mis proyectos
            </label>
            {form.enlazada && (
              <div style={rejilla(200)}>
                <div>
                  <label htmlFor="rp-proyecto" style={etiqueta}>Proyecto *</label>
                  <select id="rp-proyecto" value={form.project_id} style={campo}
                    onChange={e => setForm(prev => ({ ...prev, project_id: e.target.value, unidad_id: '' }))}>
                    <option value="">Elige un proyecto…</option>
                    {proyectos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="rp-unidad" style={etiqueta}>Unidad *</label>
                  <select id="rp-unidad" value={form.unidad_id} style={campo} disabled={!form.project_id}
                    onChange={e => elegirUnidad(e.target.value)}>
                    <option value="">{form.project_id ? 'Elige una unidad…' : 'Primero el proyecto'}</option>
                    {unidadesLibres.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                  </select>
                </div>
              </div>
            )}
            {!form.enlazada && (
              <p style={{ ...tenue, margin: 0 }}>
                Una propiedad independiente cuenta como una unidad adicional en el plan y en el límite de unidades de la empresa.
              </p>
            )}
            {form.enlazada && form.tipo_renta === 'corto_plazo' && (
              <p style={{ ...tenue, margin: 0 }}>
                Sus reservas se guardan en la pestaña STR de ese condominio: las que ya existen aparecerán aquí y las que registres aquí aparecerán allá.
              </p>
            )}
            <div style={rejilla(200)}>
              <div>
                <label htmlFor="rp-nombre" style={etiqueta}>Nombre *</label>
                <input id="rp-nombre" type="text" value={form.nombre} onChange={e => set('nombre', e.target.value)} style={campo} maxLength={150} />
              </div>
              <div>
                <label htmlFor="rp-codigo" style={etiqueta}>Código interno</label>
                <input id="rp-codigo" type="text" value={form.codigo} onChange={e => set('codigo', e.target.value)} style={campo} maxLength={40} />
              </div>
            </div>
            <div style={rejilla(200)}>
              <div>
                <label htmlFor="rp-tipo" style={etiqueta}>Tipo de renta *</label>
                <select id="rp-tipo" value={form.tipo_renta} onChange={e => set('tipo_renta', e.target.value as TipoPropiedadRenta)} style={campo}>
                  {TIPOS_RENTA.map(t => <option key={t} value={t}>{TIPO_RENTA_LABEL[t]}</option>)}
                </select>
              </div>
              {form.tipo_renta === 'otro' && (
                <div>
                  <label htmlFor="rp-detalle" style={etiqueta}>¿Qué es?</label>
                  <input id="rp-detalle" type="text" value={form.tipo_detalle} onChange={e => set('tipo_detalle', e.target.value)}
                    placeholder="Bodega, parqueo, salón…" style={campo} maxLength={60} />
                </div>
              )}
              <div>
                <label htmlFor="rp-estado" style={etiqueta}>Estado</label>
                <select id="rp-estado" value={form.estado} onChange={e => set('estado', e.target.value as EstadoPropiedadRenta)} style={campo}>
                  {(Object.keys(ESTADO_PROPIEDAD_LABEL) as EstadoPropiedadRenta[]).map(s => <option key={s} value={s}>{ESTADO_PROPIEDAD_LABEL[s]}</option>)}
                </select>
              </div>
            </div>
            <div style={rejilla(200)}>
              <div>
                <label htmlFor="rp-direccion" style={etiqueta}>Dirección</label>
                <input id="rp-direccion" type="text" value={form.direccion} onChange={e => set('direccion', e.target.value)} style={campo} maxLength={200} />
              </div>
              <div>
                <label htmlFor="rp-ciudad" style={etiqueta}>Ciudad</label>
                <input id="rp-ciudad" type="text" value={form.ciudad} onChange={e => set('ciudad', e.target.value)} style={campo} maxLength={80} />
              </div>
            </div>
            <div style={rejilla(130)}>
              <div>
                <label htmlFor="rp-hab" style={etiqueta}>Habitaciones</label>
                <input id="rp-hab" type="text" inputMode="numeric" value={form.habitaciones} onChange={e => set('habitaciones', e.target.value)} style={campo} />
              </div>
              <div>
                <label htmlFor="rp-banos" style={etiqueta}>Baños</label>
                <input id="rp-banos" type="text" inputMode="decimal" value={form.banos} onChange={e => set('banos', e.target.value)} style={campo} />
              </div>
              <div>
                <label htmlFor="rp-cap" style={etiqueta}>Capacidad</label>
                <input id="rp-cap" type="text" inputMode="numeric" value={form.capacidad} onChange={e => set('capacidad', e.target.value)} style={campo} />
              </div>
              <div>
                <label htmlFor="rp-area" style={etiqueta}>Área (m²)</label>
                <input id="rp-area" type="text" inputMode="decimal" value={form.area_m2} onChange={e => set('area_m2', e.target.value)} style={campo} />
              </div>
            </div>
            <div style={rejilla(200)}>
              <div>
                <label htmlFor="rp-tarifa" style={etiqueta}>{tarifaEtiqueta}</label>
                <input id="rp-tarifa" type="text" inputMode="decimal" value={form.tarifa_base} onChange={e => set('tarifa_base', e.target.value)} style={campo} />
              </div>
              <div>
                <label htmlFor="rp-comision" style={etiqueta}>Comisión de administración (%)</label>
                <input id="rp-comision" type="text" inputMode="decimal" value={form.comision_pct} onChange={e => set('comision_pct', e.target.value)} style={campo} />
              </div>
            </div>
            <div style={rejilla(200)}>
              <div>
                <label htmlFor="rp-prop" style={etiqueta}>Propietario</label>
                <input id="rp-prop" type="text" value={form.propietario_nombre} onChange={e => set('propietario_nombre', e.target.value)} style={campo} maxLength={150} />
              </div>
              <div>
                <label htmlFor="rp-prop-tel" style={etiqueta}>Teléfono del propietario</label>
                <input id="rp-prop-tel" type="tel" value={form.propietario_telefono} onChange={e => set('propietario_telefono', e.target.value)} style={campo} maxLength={30} />
              </div>
              <div>
                <label htmlFor="rp-prop-email" style={etiqueta}>Correo del propietario</label>
                <input id="rp-prop-email" type="email" value={form.propietario_email} onChange={e => set('propietario_email', e.target.value)} style={campo} maxLength={150} />
              </div>
            </div>
            <div>
              <label htmlFor="rp-notas" style={etiqueta}>Notas</label>
              <textarea id="rp-notas" value={form.notas} onChange={e => set('notas', e.target.value)} rows={3} style={campo} maxLength={1000} />
            </div>
          </form>
        </EditModal>
      )}
    </div>
  )
}
