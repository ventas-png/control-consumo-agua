import { useMemo, useState } from 'react'
import type { ArticuloInventarioRenta, EstadoArticuloRenta, PropiedadRenta } from '../../../types'
import {
  CATEGORIA_INVENTARIO_LABEL, ESTADO_ARTICULO_LABEL, ESTADOS_ARTICULO, mensajeErrorRentas, resumenInventario,
} from '../../../domain/rentas/logica'
import { retirarFotosInventario, useInventarioRentaMutations } from '../../../domain/rentas/mutations'
import { BUCKET_RENTAS_INVENTARIO } from '../../../domain/shared/buckets'
import { formatCurrency, formatFechaCalendario } from '../../../lib/format'
import { confirm, notify } from '../../shared/Dialog'
import { Button } from '../../shared/Button'
import { EmptyState } from '../../shared/EmptyState'
import { FilterChips } from '../../shared/FilterChips'
import { ImageGallery } from '../../shared/ImageGallery'
import { StatTile } from '../../shared/StatTile'
import { StatusBadge } from '../../shared/StatusBadge'
import type { PermisosModulo } from '../RentasSection'
import { TONO_ARTICULO, accionesFila, barraFiltros, campo, encabezadoTab, fila, rejillaTiles, td, tenue, th, thead } from '../ui'
import { ArticuloInventarioModal } from './ArticuloInventarioModal'

interface Props {
  propiedades: PropiedadRenta[]
  inventario: ArticuloInventarioRenta[]
  companyId: string
  moneda: string
  hoy: string
  permisos: PermisosModulo
}

type Filtro = 'todos' | EstadoArticuloRenta

export default function InventarioTab({ propiedades, inventario, companyId, moneda, hoy, permisos }: Props) {
  const [propiedadId, setPropiedadId] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [buscar, setBuscar] = useState('')
  const [editando, setEditando] = useState<ArticuloInventarioRenta | 'nuevo' | null>(null)
  const { actualizar, eliminar } = useInventarioRentaMutations(companyId)

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
      // Sin la fila, sus fotos ya no las nombra nadie: ahora sí se pueden retirar.
      retirarFotosInventario(a.fotos)
      notify({ variant: 'success', title: 'Artículo eliminado', duration: 1500 })
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo eliminar', text: mensajeErrorRentas(e, 'Intenta de nuevo.') })
    }
  }

  return (
    <div>
      <div style={encabezadoTab}>
        <h2 style={{ margin: 0 }}>Inventario por propiedad</h2>
        {permisos.crear && propiedades.length > 0 && <Button onClick={() => setEditando('nuevo')}>+ Nuevo artículo</Button>}
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
              action={permisos.crear ? <Button onClick={() => setEditando('nuevo')}>+ Nuevo artículo</Button> : undefined} />
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
                        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
                          {a.fotos.length > 0 && <ImageGallery urls={a.fotos} maxVisible={1} bucket={BUCKET_RENTAS_INVENTARIO} />}
                          <div>
                            <div style={{ fontWeight: 600 }}>{a.nombre}</div>
                            <div style={tenue}>{[a.ambiente, a.numero_serie ? `Serie ${a.numero_serie}` : null].filter(Boolean).join(' · ')}</div>
                          </div>
                        </div>
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
                            {permisos.editar && <Button size="sm" onClick={() => setEditando(a)} aria-label={`Editar ${a.nombre}`}>Editar</Button>}
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
        <ArticuloInventarioModal
          articulo={editando === 'nuevo' ? null : editando}
          propiedades={propiedades} propiedadInicial={propiedadId}
          companyId={companyId} moneda={moneda} hoy={hoy}
          onClose={() => setEditando(null)} />
      )}
    </div>
  )
}
