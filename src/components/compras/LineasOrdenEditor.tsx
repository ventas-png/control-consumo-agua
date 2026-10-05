// Renglones de una orden de compra — el mismo editor en Contabilidad (Compras › Nueva orden) y en Operaciones
// (Órdenes compra › Nueva OC), para que las dos puertas capturen lo mismo y lo envíen igual a la operación
// transaccional del servidor (`compras_orden_crear`). Solo captura: la validación autoritativa (insumo del proyecto,
// unidad, cuenta, destino) es de los triggers de la base.
import { SugerenciaCuentaLinea } from '../proveedores/SugerenciaCuentaLinea'
import { totalesOrden } from '../../domain/compras/schemas'
import { formatCurrency, hoyLocalISO } from '../../lib/format'
import { CATEGORIAS_GASTO_CXP } from '../../types/cxp'
import { DESTINO_LINEA_LABELS, type DestinoLinea } from '../../types/compras'
import { btnLink, input } from '../contabilidad/ui'

export interface LineaForm {
  descripcion: string
  destino_tipo: DestinoLinea
  /** Insumo del almacén; solo con destino «inventario». */
  suministro_id: string
  categoria: string
  cantidad: string
  unidad: string
  precio_unitario: string
  iva_monto: string
}

export const LINEA_VACIA: LineaForm = {
  descripcion: '', destino_tipo: 'gasto', suministro_id: '', categoria: 'otros',
  cantidad: '1', unidad: 'unidad', precio_unitario: '0', iva_monto: '0',
}

/** Insumo del almacén que se puede elegir en un renglón de inventario. */
export interface InsumoOpcion {
  id: string
  nombre: string
  unidad_medida: string
  stock_actual: number | string
}

/**
 * Lo que la operación del servidor recibe por renglón. La cuenta NO viaja desde aquí: la resuelve y valida el
 * servidor al guardar (la misma entrada da la misma cuenta, sin depender de que una consulta previa haya terminado
 * o fallado). El insumo solo viaja con destino «inventario».
 */
export function lineasParaServidor(lineas: LineaForm[]) {
  return lineas.map((l) => ({
    descripcion: l.descripcion,
    destino_tipo: l.destino_tipo,
    suministro_id: l.destino_tipo === 'inventario' ? (l.suministro_id || null) : null,
    cuenta_id: null,
    categoria: l.categoria,
    cantidad: parseFloat(l.cantidad) || 0,
    unidad: l.unidad,
    precio_unitario: parseFloat(l.precio_unitario) || 0,
    iva_monto: parseFloat(l.iva_monto) || 0,
  }))
}

interface Props {
  lineas: LineaForm[]
  onChange: (lineas: LineaForm[]) => void
  projectId: string | null
  proveedorId: string | null
  monedaBase: string
  insumos: InsumoOpcion[]
  cargandoInsumos: boolean
  /** Menos renglones de los que hay no se puede quitar (Contabilidad exige al menos uno; Operaciones admite ninguno). */
  minimo?: number
  /** Texto del encabezado (por defecto «Renglones»). */
  titulo?: string
}

export function LineasOrdenEditor({
  lineas, onChange, projectId, proveedorId, monedaBase, insumos, cargandoInsumos, minimo = 1, titulo = 'Renglones',
}: Props) {
  // Solo un proyecto tiene bodega: en la contabilidad de la empresa no hay insumos.
  const hayBodega = !!projectId

  const totales = totalesOrden(lineas.map((l) => ({
    cantidad: parseFloat(l.cantidad) || 0,
    precio_unitario: parseFloat(l.precio_unitario) || 0,
    iva_monto: parseFloat(l.iva_monto) || 0,
  })))

  function actualizar(i: number, campo: keyof LineaForm, valor: string) {
    onChange(lineas.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)))
  }

  // El insumo manda en la unidad: un renglón de inventario se pide en la unidad con la que se
  // lleva el insumo (el servidor lo exige igual). Cambiar el destino suelta el insumo.
  function cambiarDestino(i: number, destino: DestinoLinea) {
    onChange(lineas.map((l, j) => (j === i ? { ...l, destino_tipo: destino, suministro_id: destino === 'inventario' ? l.suministro_id : '' } : l)))
  }
  function elegirInsumo(i: number, id: string) {
    const ins = insumos.find((x) => x.id === id)
    onChange(lineas.map((l, j) => (j === i
      ? { ...l, suministro_id: id, descripcion: l.descripcion || ins?.nombre || '', unidad: ins?.unidad_medida ?? l.unidad }
      : l)))
  }

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <strong style={{ fontSize: 12 }}>{titulo}</strong>
        <button type="button" style={btnLink} onClick={() => onChange([...lineas, { ...LINEA_VACIA }])}>+ Agregar renglón</button>
      </div>
      {lineas.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 640 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--at-ink-soft)' }}>
                <th style={{ padding: 4 }}>Descripción</th>
                <th style={{ padding: 4, width: 120 }}>Destino</th>
                <th style={{ padding: 4, width: 130 }}>Categoría</th>
                <th style={{ padding: 4, width: 80 }}>Cant.</th>
                <th style={{ padding: 4, width: 90 }}>Unidad</th>
                <th style={{ padding: 4, width: 100 }}>Precio</th>
                <th style={{ padding: 4, width: 90 }}>IVA</th>
                <th style={{ padding: 4, width: 30 }} />
              </tr>
            </thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={i}>
                  <td style={{ padding: 2 }}>
                    <input value={l.descripcion} onChange={(e) => actualizar(i, 'descripcion', e.target.value)}
                           style={{ ...input, width: '100%' }} aria-label={`Descripción del renglón ${i + 1}`} />
                    {l.destino_tipo === 'inventario' && (
                      <select value={l.suministro_id} onChange={(e) => elegirInsumo(i, e.target.value)}
                              style={{ ...input, width: '100%', marginTop: 4 }} aria-label={`Insumo del renglón ${i + 1}`}>
                        <option value="">{cargandoInsumos ? 'Cargando insumos…' : insumos.length === 0 ? 'No hay insumos activos en este proyecto' : 'Elige el insumo del almacén…'}</option>
                        {insumos.map((x) => (
                          <option key={x.id} value={x.id}>{x.nombre} · {x.unidad_medida} · stock {x.stock_actual}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td style={{ padding: 2 }}>
                    <select value={l.destino_tipo} onChange={(e) => cambiarDestino(i, e.target.value as DestinoLinea)}
                            style={{ ...input, width: '100%' }} aria-label={`Destino del renglón ${i + 1}`}>
                      {(Object.keys(DESTINO_LINEA_LABELS) as DestinoLinea[])
                        .filter((d) => d !== 'inventario' || hayBodega)
                        .map((d) => <option key={d} value={d}>{DESTINO_LINEA_LABELS[d]}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: 2 }}>
                    <select value={l.categoria} onChange={(e) => actualizar(i, 'categoria', e.target.value)}
                            style={{ ...input, width: '100%' }} aria-label={`Categoría del renglón ${i + 1}`}>
                      {CATEGORIAS_GASTO_CXP.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: 2 }}>
                    <input type="number" min="0" step="0.01" value={l.cantidad}
                           onChange={(e) => actualizar(i, 'cantidad', e.target.value)}
                           style={{ ...input, width: '100%' }} aria-label={`Cantidad del renglón ${i + 1}`} />
                  </td>
                  <td style={{ padding: 2 }}>
                    <input value={l.unidad} onChange={(e) => actualizar(i, 'unidad', e.target.value)}
                           readOnly={l.destino_tipo === 'inventario' && !!l.suministro_id}
                           title={l.destino_tipo === 'inventario' && l.suministro_id ? 'La unidad la fija el insumo del almacén' : undefined}
                           style={{ ...input, width: '100%' }} aria-label={`Unidad del renglón ${i + 1}`} />
                  </td>
                  <td style={{ padding: 2 }}>
                    <input type="number" min="0" step="0.01" value={l.precio_unitario}
                           onChange={(e) => actualizar(i, 'precio_unitario', e.target.value)}
                           style={{ ...input, width: '100%' }} aria-label={`Precio del renglón ${i + 1}`} />
                  </td>
                  <td style={{ padding: 2 }}>
                    <input type="number" min="0" step="0.01" value={l.iva_monto}
                           onChange={(e) => actualizar(i, 'iva_monto', e.target.value)}
                           style={{ ...input, width: '100%' }} aria-label={`IVA del renglón ${i + 1}`} />
                  </td>
                  <td style={{ padding: 2, textAlign: 'right' }}>
                    {lineas.length > minimo && (
                      <button type="button" style={btnLink} aria-label={`Quitar renglón ${i + 1}`}
                              onClick={() => onChange(lineas.filter((_, j) => j !== i))}>✕</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {lineas.length > 0 && (
        <>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {lineas.map((l, i) => (
              <SugerenciaCuentaLinea
                key={i} indice={i} projectId={projectId} proveedorId={proveedorId}
                destino={l.destino_tipo === 'activo_fijo' ? 'activo_fijo' : l.destino_tipo === 'inventario' ? 'inventario' : 'gasto'}
                categoria={l.categoria} suministroId={l.suministro_id || null}
                fecha={hoyLocalISO()}
              />
            ))}
          </div>
          <p style={{ margin: '10px 0 0', textAlign: 'right', fontSize: 13 }}>
            Subtotal {formatCurrency(totales.subtotal, monedaBase)} · IVA {formatCurrency(totales.iva, monedaBase)} ·{' '}
            <strong>Total {formatCurrency(totales.total, monedaBase)}</strong>
          </p>
        </>
      )}
    </div>
  )
}
