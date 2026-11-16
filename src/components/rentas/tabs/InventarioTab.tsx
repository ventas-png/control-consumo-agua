import { useMemo, useState } from 'react'
import type { ArticuloInventarioRenta, CategoriaInventarioRenta, EstadoArticuloRenta, PropiedadRenta } from '../../../types'
import {
  CATEGORIA_INVENTARIO_LABEL, CATEGORIAS_INVENTARIO, ESTADO_ARTICULO_LABEL, ESTADOS_ARTICULO,
  mensajeErrorRentas, numeroONulo, resumenInventario,
} from '../../../domain/rentas/logica'
import { useInventarioRentaMutations } from '../../../domain/rentas/mutations'
import { formatCurrency, formatFechaCalendario } from '../../../lib/format'
import { confirm, notify } from '../../shared/Dialog'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { EmptyState } from '../../shared/EmptyState'
import { FilterChips } from '../../shared/FilterChips'
import { StatTile } from '../../shared/StatTile'
import { StatusBadge } from '../../shared/StatusBadge'
import type { PermisosModulo } from '../RentasSection'
import { TONO_ARTICULO, accionesFila, barraFiltros, campo, encabezadoTab, etiqueta, fila, rejilla, rejillaTiles, td, tenue, th, thead } from '../ui'

interface Props {
  propiedades: PropiedadRenta[]
  inventario: ArticuloInventarioRenta[]
  companyId: string
  moneda: string
  hoy: string
  permisos: PermisosModulo
}

interface Form {
  propiedad_id: string; nombre: string; categoria: CategoriaInventarioRenta; ambiente: string
  cantidad: string; estado: EstadoArticuloRenta; valor_unitario: string; numero_serie: string
  fecha_revision: string; notas: string
}

const txt = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v))
const nulo = (v: string) => (v.trim() === '' ? null : v.trim())

function formDe(a: ArticuloInventarioRenta | undefined, propiedadId: string, hoy: string): Form {
  return {
    propiedad_id: a?.propiedad_id ?? propiedadId, nombre: a?.nombre ?? '', categoria: a?.categoria ?? 'mobiliario',
    ambiente: txt(a?.ambiente), cantidad: txt(a?.cantidad ?? 1), estado: a?.estado ?? 'bueno',
    valor_unitario: txt(a?.valor_unitario), numero_serie: txt(a?.numero_serie),
    fecha_revision: a ? txt(a.fecha_revision) : hoy, notas: txt(a?.notas),
  }
}

type Filtro = 'todos' | EstadoArticuloRenta

export default function InventarioTab({ propiedades, inventario, companyId, moneda, hoy, permisos }: Props) {
  const [propiedadId, setPropiedadId] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [buscar, setBuscar] = useState('')
  const [editando, setEditando] = useState<ArticuloInventarioRenta | 'nuevo' | null>(null)
  const [form, setForm] = useState<Form>(formDe(undefined, '', hoy))
  const { crear, actualizar, eliminar } = useInventarioRentaMutations(companyId)
  const guardando = crear.isPending || actualizar.isPending

  const nombrePropiedad = useMemo(() => new Map(propiedades.map(p => [p.id, p.nombre])), [propiedades])
  const dePropiedad = useMemo(
    () => inventario.filter(a => propiedadId === '' || a.propiedad_id === propiedadId), [inventario, propiedadId])
  const resumen = useMemo(() => resumenInventario(dePropiedad), [dePropiedad])
  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    return dePropiedad.filter(a =>
      (filtro === 'todos' || a.estado === filtro)
      && (q === '' || [a.nombre, a.ambiente, a.numero_serie].some(v => (v ?? '').toLowerCase().includes(q))))
  }, [dePropiedad, filtro, buscar])

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(prev => ({ ...prev, [k]: v }))
  const abrir = (a: ArticuloInventarioRenta | 'nuevo') => { setForm(formDe(a === 'nuevo' ? undefined : a, propiedadId, hoy)); setEditando(a) }
  const cerrar = () => { if (!guardando) setEditando(null) }

  const guardar = async () => {
    if (guardando || !editando) return
    if (!form.propiedad_id) { notify({ variant: 'error', title: 'Elige la propiedad' }); return }
    if (!form.nombre.trim()) { notify({ variant: 'error', title: 'Falta el nombre del artículo' }); return }
    const cantidad = Number(form.cantidad)
    if (!Number.isInteger(cantidad) || cantidad < 0) { notify({ variant: 'error', title: 'La cantidad debe ser un número entero' }); return }
    const valor = numeroONulo(form.valor_unitario)
    if (valor === undefined) { notify({ variant: 'error', title: 'El valor debe ser un número positivo' }); return }
    const payload = {
      company_id: companyId, propiedad_id: form.propiedad_id, nombre: form.nombre.trim(), categoria: form.categoria,
      ambiente: nulo(form.ambiente), cantidad, estado: form.estado, valor_unitario: valor,
      numero_serie: nulo(form.numero_serie), fecha_revision: nulo(form.fecha_revision), notas: nulo(form.notas),
    }
    try {
      if (editando === 'nuevo') await crear.mutateAsync(payload)
      else {
        const { company_id: _fija, ...patch } = payload
        await actualizar.mutateAsync({ id: editando.id, patch })
      }
      setEditando(null)
      notify({ variant: 'success', title: editando === 'nuevo' ? 'Artículo registrado' : 'Artículo actualizado', duration: 1500 })
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo guardar', text: mensajeErrorRentas(e, 'Intenta de nuevo.') })
    }
  }

  // Revisión rápida desde la fila: cambia el estado y sella la fecha de revisión.
  const marcar = async (a: ArticuloInventarioRenta, estado: EstadoArticuloRenta) => {
    if (estado === a.estado) return
    try {
      await actualizar.mutateAsync({ id: a.id, patch: { estado, fecha_revision: hoy } })
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo cambiar el estado', text: mensajeErrorRentas(e, 'Intenta de nuevo.') })
    }
  }

  const borrar = async (a: ArticuloInventarioRenta) => {
    const { isConfirmed } = await confirm({
      title: `¿Eliminar «${a.nombre}»?`, text: 'Si el artículo se perdió o se rompió, mejor márcalo como faltante o dañado para conservar el registro.',
      icon: 'warning', variant: 'danger', confirmText: 'Eliminar',
    })
    if (!isConfirmed) return
    try {
      await eliminar.mutateAsync(a.id)
      notify({ variant: 'success', title: 'Artículo eliminado', duration: 1500 })
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo eliminar', text: mensajeErrorRentas(e, 'Intenta de nuevo.') })
    }
  }

  return (
    <div>
      <div style={encabezadoTab}>
        <h2 style={{ margin: 0 }}>Inventario por propiedad</h2>
        {permisos.crear && propiedades.length > 0 && <Button onClick={() => abrir('nuevo')}>+ Nuevo artículo</Button>}
      </div>

      {propiedades.length === 0 ? (
        <EmptyState icon="🛋️" title="Aún no hay propiedades"
          description="El inventario se lleva por propiedad: registra primero una en la pestaña Propiedades." />
      ) : (
        <>
          <div style={barraFiltros}>
            <select value={propiedadId} onChange={e => setPropiedadId(e.target.value)} aria-label="Propiedad" style={{ ...campo, maxWidth: '300px' }}>
              <option value="">Todas las propiedades</option>
              {propiedades.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
            <input type="search" value={buscar} onChange={e => setBuscar(e.target.value)} aria-label="Buscar artículo"
              placeholder="Buscar artículo, ambiente o serie" style={{ ...campo, maxWidth: '280px' }} />
          </div>

          <div style={rejillaTiles}>
            <StatTile label="Artículos" value={resumen.articulos} hint={`${resumen.unidades} unidades`} icon="🛋️" />
            <StatTile label="Valor del inventario" value={formatCurrency(resumen.valor, moneda)} hint="Sin contar lo faltante" icon="💰" />
            <StatTile label="Dañados" value={resumen.danados} tone={resumen.danados > 0 ? 'warning' : undefined} icon="🛠️" />
            <StatTile label="Faltantes" value={resumen.faltantes} tone={resumen.faltantes > 0 ? 'danger' : undefined} icon="❓" />
          </div>

          <div style={barraFiltros}>
            <FilterChips<Filtro>
              ariaLabel="Filtrar por estado"
              value={filtro} onChange={setFiltro}
              options={[
                { value: 'todos', label: 'Todos', count: dePropiedad.length },
                ...ESTADOS_ARTICULO.map(e => ({ value: e as Filtro, label: ESTADO_ARTICULO_LABEL[e], count: dePropiedad.filter(a => a.estado === e).length })),
              ]}
            />
          </div>

          {dePropiedad.length === 0 ? (
            <EmptyState icon="🛋️" title="Sin artículos registrados"
              description="Registra lo que hay en la propiedad: muebles, electrodomésticos, blancos, menaje. Así sabes qué falta o se dañó después de cada estancia."
              action={permisos.crear ? <Button onClick={() => abrir('nuevo')}>+ Nuevo artículo</Button> : undefined} />
          ) : visibles.length === 0 ? (
            <p style={{ ...tenue, fontStyle: 'italic' }}>Ningún artículo coincide con el filtro.</p>
          ) : (
            <div className="table-scroll-wrapper">
              <table className="table-cards-on-mobile" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={thead}>
                    <th scope="col" style={th}>Artículo</th>
                    {propiedadId === '' && <th scope="col" style={th}>Propiedad</th>}
                    <th scope="col" style={th}>Categoría</th>
                    <th scope="col" style={{ ...th, textAlign: 'right' }}>Cantidad</th>
                    <th scope="col" style={{ ...th, textAlign: 'right' }}>Valor</th>
                    <th scope="col" style={th}>Estado</th>
                    {(permisos.editar || permisos.eliminar) && <th scope="col" style={{ ...th, textAlign: 'center' }}>Acciones</th>}
                  </tr>
                </thead>
                <tbody>
                  {visibles.map(a => (
                    <tr key={a.id} style={fila}>
                      <td data-label="Artículo" style={td}>
                        <div style={{ fontWeight: 600 }}>{a.nombre}</div>
                        <div style={tenue}>{[a.ambiente, a.numero_serie ? `Serie ${a.numero_serie}` : null].filter(Boolean).join(' · ')}</div>
                      </td>
                      {propiedadId === '' && <td data-label="Propiedad" style={td}>{nombrePropiedad.get(a.propiedad_id) ?? 'Propiedad'}</td>}
                      <td data-label="Categoría" style={td}>{CATEGORIA_INVENTARIO_LABEL[a.categoria]}</td>
                      <td data-label="Cantidad" style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{a.cantidad}</td>
                      <td data-label="Valor" style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {a.valor_unitario === null ? '—' : formatCurrency(a.valor_unitario * a.cantidad, moneda)}
                        {a.valor_unitario !== null && a.cantidad > 1 && <div style={tenue}>{formatCurrency(a.valor_unitario, moneda)} c/u</div>}
                      </td>
                      <td data-label="Estado" style={td}>
                        {permisos.editar ? (
                          <select value={a.estado} aria-label={`Estado de ${a.nombre}`}
                            onChange={e => void marcar(a, e.target.value as EstadoArticuloRenta)}
                            style={{ ...campo, width: 'auto', padding: '0.3rem 0.4rem' }}>
                            {ESTADOS_ARTICULO.map(e => <option key={e} value={e}>{ESTADO_ARTICULO_LABEL[e]}</option>)}
                          </select>
                        ) : <StatusBadge tone={TONO_ARTICULO[a.estado]}>{ESTADO_ARTICULO_LABEL[a.estado]}</StatusBadge>}
                        {a.fecha_revision && <div style={tenue}>Revisado {formatFechaCalendario(a.fecha_revision)}</div>}
                      </td>
                      {(permisos.editar || permisos.eliminar) && (
                        <td style={{ ...td, textAlign: 'center' }}>
                          <div style={accionesFila}>
                            {permisos.editar && <Button size="sm" onClick={() => abrir(a)} aria-label={`Editar ${a.nombre}`}>Editar</Button>}
                            {permisos.eliminar && <Button size="sm" variant="danger" onClick={() => void borrar(a)} aria-label={`Eliminar ${a.nombre}`}>Eliminar</Button>}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {editando && (
        <EditModal
          title={editando === 'nuevo' ? 'Nuevo artículo' : `Editar ${editando.nombre}`}
          onClose={cerrar} size="md" fullScreenOnMobile
          closeOnBackdropClick={!guardando} closeOnEscape={!guardando}
          footer={<>
            <Button variant="secondary" onClick={cerrar} disabled={guardando}>Cancelar</Button>
            <Button type="submit" form="rentas-articulo-form" loading={guardando} loadingText="Guardando...">Guardar</Button>
          </>}
        >
          <form id="rentas-articulo-form" onSubmit={e => { e.preventDefault(); void guardar() }}
            style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
            <div>
              <label htmlFor="ri-propiedad" style={etiqueta}>Propiedad *</label>
              <select id="ri-propiedad" value={form.propiedad_id} onChange={e => set('propiedad_id', e.target.value)} style={campo}>
                <option value="">Elige una propiedad…</option>
                {propiedades.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
            <div style={rejilla(200)}>
              <div>
                <label htmlFor="ri-nombre" style={etiqueta}>Artículo *</label>
                <input id="ri-nombre" type="text" value={form.nombre} onChange={e => set('nombre', e.target.value)} placeholder="Sofá 3 plazas" style={campo} maxLength={150} />
              </div>
              <div>
                <label htmlFor="ri-categoria" style={etiqueta}>Categoría</label>
                <select id="ri-categoria" value={form.categoria} onChange={e => set('categoria', e.target.value as CategoriaInventarioRenta)} style={campo}>
                  {CATEGORIAS_INVENTARIO.map(c => <option key={c} value={c}>{CATEGORIA_INVENTARIO_LABEL[c]}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="ri-ambiente" style={etiqueta}>Ambiente</label>
                <input id="ri-ambiente" type="text" value={form.ambiente} onChange={e => set('ambiente', e.target.value)} placeholder="Sala, cocina, habitación 1…" style={campo} maxLength={80} />
              </div>
            </div>
            <div style={rejilla(140)}>
              <div>
                <label htmlFor="ri-cantidad" style={etiqueta}>Cantidad *</label>
                <input id="ri-cantidad" type="text" inputMode="numeric" value={form.cantidad} onChange={e => set('cantidad', e.target.value)} style={campo} />
              </div>
              <div>
                <label htmlFor="ri-valor" style={etiqueta}>Valor unitario ({moneda})</label>
                <input id="ri-valor" type="text" inputMode="decimal" value={form.valor_unitario} onChange={e => set('valor_unitario', e.target.value)} style={campo} />
              </div>
              <div>
                <label htmlFor="ri-estado" style={etiqueta}>Estado</label>
                <select id="ri-estado" value={form.estado} onChange={e => set('estado', e.target.value as EstadoArticuloRenta)} style={campo}>
                  {ESTADOS_ARTICULO.map(e => <option key={e} value={e}>{ESTADO_ARTICULO_LABEL[e]}</option>)}
                </select>
              </div>
            </div>
            <div style={rejilla(180)}>
              <div>
                <label htmlFor="ri-serie" style={etiqueta}>Número de serie</label>
                <input id="ri-serie" type="text" value={form.numero_serie} onChange={e => set('numero_serie', e.target.value)} style={campo} maxLength={80} />
              </div>
              <div>
                <label htmlFor="ri-revision" style={etiqueta}>Última revisión</label>
                <input id="ri-revision" type="date" value={form.fecha_revision} onChange={e => set('fecha_revision', e.target.value)} style={campo} />
              </div>
            </div>
            <div>
              <label htmlFor="ri-notas" style={etiqueta}>Notas</label>
              <textarea id="ri-notas" value={form.notas} onChange={e => set('notas', e.target.value)} rows={3} style={campo} maxLength={1000} />
            </div>
          </form>
        </EditModal>
      )}
    </div>
  )
}
