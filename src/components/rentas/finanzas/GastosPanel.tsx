import { useState } from 'react'
import type { CargoGastoRenta, CategoriaGastoRenta, GastoRenta, PropiedadRenta } from '../../../types'
import { CARGO_GASTO_LABEL, CATEGORIA_GASTO_LABEL, CATEGORIAS_GASTO, primerDia, ultimoDia } from '../../../domain/rentas/finanzas'
import { mensajeErrorRentas, numeroONulo } from '../../../domain/rentas/logica'
import { useGastosRentaMutations } from '../../../domain/rentas/mutations'
import { formatCurrency, formatFechaCalendario } from '../../../lib/format'
import { confirm, notify } from '../../shared/Dialog'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import type { PermisosModulo } from '../RentasSection'
import { accionesFila, campo, etiqueta, fila, rejilla, td, tenue, th, thead } from '../ui'

interface Props {
  propiedad: PropiedadRenta
  /** Gastos de la propiedad en el mes. */
  gastos: GastoRenta[]
  mes: string
  hoy: string
  companyId: string
  moneda: string
  permisos: PermisosModulo
}

interface Form {
  fecha: string; categoria: CategoriaGastoRenta; descripcion: string; proveedor: string
  monto: string; a_cargo_de: CargoGastoRenta; notas: string
}
const nulo = (v: string) => (v.trim() === '' ? null : v.trim())

export function GastosPanel({ propiedad, gastos, mes, hoy, companyId, moneda, permisos }: Props) {
  const { crear, actualizar, eliminar } = useGastosRentaMutations(companyId)
  const [editando, setEditando] = useState<GastoRenta | 'nuevo' | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const guardando = crear.isPending || actualizar.isPending
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(prev => (prev ? { ...prev, [k]: v } : prev))

  const abrir = (g: GastoRenta | 'nuevo') => {
    // Un gasto nuevo nace en el mes que se está viendo (hoy, si es el mes en curso).
    const fechaNueva = hoy.slice(0, 7) === mes ? hoy : hoy < primerDia(mes) ? primerDia(mes) : ultimoDia(mes)
    setForm(g === 'nuevo'
      ? { fecha: fechaNueva, categoria: 'limpieza', descripcion: '', proveedor: '', monto: '', a_cargo_de: 'propietario', notas: '' }
      : { fecha: g.fecha, categoria: g.categoria, descripcion: g.descripcion, proveedor: g.proveedor ?? '', monto: String(g.monto), a_cargo_de: g.a_cargo_de, notas: g.notas ?? '' })
    setEditando(g)
  }
  const cerrar = () => { if (!guardando) setEditando(null) }

  const guardar = async () => {
    if (!form || !editando || guardando) return
    if (!form.fecha) { notify({ variant: 'error', title: 'Falta la fecha' }); return }
    if (!form.descripcion.trim()) { notify({ variant: 'error', title: 'Describe el gasto' }); return }
    const monto = numeroONulo(form.monto)
    if (typeof monto !== 'number' || monto <= 0) { notify({ variant: 'error', title: 'El monto debe ser mayor que cero' }); return }
    const datos = {
      fecha: form.fecha, categoria: form.categoria, descripcion: form.descripcion.trim(), proveedor: nulo(form.proveedor),
      monto, a_cargo_de: form.a_cargo_de, notas: nulo(form.notas),
    }
    try {
      if (editando === 'nuevo') await crear.mutateAsync({ company_id: companyId, propiedad_id: propiedad.id, ...datos })
      else await actualizar.mutateAsync({ id: editando.id, patch: datos })
      setEditando(null)
      notify({ variant: 'success', title: editando === 'nuevo' ? 'Gasto registrado' : 'Gasto actualizado', duration: 1500 })
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo guardar', text: mensajeErrorRentas(e, 'Intenta de nuevo.') })
    }
  }

  const borrar = async (g: GastoRenta) => {
    const { isConfirmed } = await confirm({
      title: '¿Eliminar el gasto?', text: `${g.descripcion} — ${formatCurrency(g.monto, moneda)}.`,
      icon: 'warning', variant: 'danger', confirmText: 'Eliminar',
    })
    if (!isConfirmed) return
    try {
      await eliminar.mutateAsync(g.id)
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo eliminar', text: mensajeErrorRentas(e, 'Intenta de nuevo.') })
    }
  }

  return (
    <section aria-label="Gastos del mes">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
        <h3 style={{ margin: 0, fontSize: '16px' }}>Gastos del mes</h3>
        {permisos.crear && <Button size="sm" onClick={() => abrir('nuevo')}>+ Registrar gasto</Button>}
      </div>
      {gastos.length === 0 ? (
        <p style={{ ...tenue, fontStyle: 'italic', margin: 0 }}>Sin gastos registrados este mes.</p>
      ) : (
        <div className="table-scroll-wrapper">
          <table className="table-cards-on-mobile" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={thead}>
                <th scope="col" style={th}>Fecha</th>
                <th scope="col" style={th}>Gasto</th>
                <th scope="col" style={th}>A cargo de</th>
                <th scope="col" style={{ ...th, textAlign: 'right' }}>Monto</th>
                {(permisos.editar || permisos.eliminar) && <th scope="col" style={{ ...th, textAlign: 'center' }}>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {gastos.map(g => (
                <tr key={g.id} style={fila}>
                  <td data-label="Fecha" style={td}>{formatFechaCalendario(g.fecha)}</td>
                  <td data-label="Gasto" style={td}>
                    <div>{g.descripcion}</div>
                    <div style={tenue}>{[CATEGORIA_GASTO_LABEL[g.categoria], g.proveedor].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td data-label="A cargo de" style={td}>{CARGO_GASTO_LABEL[g.a_cargo_de]}</td>
                  <td data-label="Monto" style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(g.monto, moneda)}</td>
                  {(permisos.editar || permisos.eliminar) && (
                    <td style={{ ...td, textAlign: 'center' }}>
                      <div style={accionesFila}>
                        {permisos.editar && <Button size="sm" onClick={() => abrir(g)} aria-label={`Editar el gasto ${g.descripcion}`}>Editar</Button>}
                        {permisos.eliminar && <Button size="sm" variant="danger" onClick={() => void borrar(g)} aria-label={`Eliminar el gasto ${g.descripcion}`}>Eliminar</Button>}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editando && form && (
        <EditModal title={editando === 'nuevo' ? `Nuevo gasto — ${propiedad.nombre}` : 'Editar gasto'} onClose={cerrar} size="md" fullScreenOnMobile
          closeOnBackdropClick={!guardando} closeOnEscape={!guardando}
          footer={<>
            <Button variant="secondary" onClick={cerrar} disabled={guardando}>Cancelar</Button>
            <Button type="submit" form="rentas-gasto-form" loading={guardando} loadingText="Guardando...">Guardar</Button>
          </>}>
          <form id="rentas-gasto-form" onSubmit={e => { e.preventDefault(); void guardar() }} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
            <div>
              <label htmlFor="rg-descripcion" style={etiqueta}>Descripción *</label>
              <input id="rg-descripcion" type="text" value={form.descripcion} onChange={e => set('descripcion', e.target.value)} style={campo} maxLength={200} />
            </div>
            <div style={rejilla(150)}>
              <div>
                <label htmlFor="rg-fecha" style={etiqueta}>Fecha *</label>
                <input id="rg-fecha" type="date" value={form.fecha} onChange={e => set('fecha', e.target.value)} style={campo} />
              </div>
              <div>
                <label htmlFor="rg-monto" style={etiqueta}>Monto ({moneda}) *</label>
                <input id="rg-monto" type="text" inputMode="decimal" value={form.monto} onChange={e => set('monto', e.target.value)} style={campo} />
              </div>
              <div>
                <label htmlFor="rg-categoria" style={etiqueta}>Categoría</label>
                <select id="rg-categoria" value={form.categoria} onChange={e => set('categoria', e.target.value as CategoriaGastoRenta)} style={campo}>
                  {CATEGORIAS_GASTO.map(c => <option key={c} value={c}>{CATEGORIA_GASTO_LABEL[c]}</option>)}
                </select>
              </div>
            </div>
            <div style={rejilla(200)}>
              <div>
                <label htmlFor="rg-cargo" style={etiqueta}>A cargo de</label>
                <select id="rg-cargo" value={form.a_cargo_de} onChange={e => set('a_cargo_de', e.target.value as CargoGastoRenta)} style={campo}>
                  <option value="propietario">Propietario (se descuenta de su pago)</option>
                  <option value="administradora">Administradora (lo absorbe la empresa)</option>
                </select>
              </div>
              <div>
                <label htmlFor="rg-proveedor" style={etiqueta}>Proveedor</label>
                <input id="rg-proveedor" type="text" value={form.proveedor} onChange={e => set('proveedor', e.target.value)} style={campo} maxLength={120} />
              </div>
            </div>
            <div>
              <label htmlFor="rg-notas" style={etiqueta}>Notas</label>
              <textarea id="rg-notas" value={form.notas} onChange={e => set('notas', e.target.value)} rows={2} style={campo} maxLength={500} />
            </div>
          </form>
        </EditModal>
      )}
    </section>
  )
}
