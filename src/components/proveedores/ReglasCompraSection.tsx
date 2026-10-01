// Cuentas SUGERIDAS para compras: por categoría o por producto, con proveedor
// opcional. Se configuran por empresa/proyecto y se CONSUMEN al capturar una
// línea de la orden de compra (Contabilidad → Compras).
//
// Precedencia, de mayor a menor (la resuelve el servidor, esto solo la enseña):
//   1. la cuenta elegida EXPLÍCITAMENTE en la línea;
//   2. regla de compra: producto+proveedor › producto › categoría+proveedor › categoría;
//   3. regla de cuenta por proveedor (pestaña de arriba);
//   4. mapeo general del evento;
//   5. sin resolver: se avisa, no se inventa una cuenta.
// Cambiar un predeterminado NO reescribe lo ya capturado: cierra la regla
// vigente y abre otra desde una fecha futura.
import { useMemo, useState } from 'react'
import { useCuentasQuery } from '../../domain/contabilidad/queries'
import { useProveedoresQuery } from '../../domain/cxp/queries'
import {
  useConfigCompraQuery,
  useReglasCompraQuery,
  useSuministrosProyectoQuery,
} from '../../domain/proveedores/queries'
import {
  useActualizarReglaCompraMutation,
  useGuardarReglaCompraMutation,
  useReemplazarReglaCompraMutation,
} from '../../domain/proveedores/mutations'
import { reglaCompraFormSchema } from '../../domain/proveedores/schemas'
import { hoyLocalISO } from '../../lib/format'
import { CATEGORIAS_GASTO_CXP } from '../../types/cxp'
import { DESTINOS_COMPRA, ORIGEN_CUENTA_LABELS, TIPO_CUENTA_POR_DESTINO, type DestinoCompra } from '../../types/proveedores'
import { StatusBadge } from '../shared/StatusBadge'
import { notify } from '../shared/Dialog'
import { openPromptDialog } from '../shared/PromptDialog'
import { btnLink, btnPrimario, input } from '../contabilidad/ui'

interface Props {
  companyId?: string
  projectId?: string | null
  puedeEditar: boolean
}

export function ReglasCompraSection({ companyId, projectId = null, puedeEditar }: Props) {
  const cuentas = useCuentasQuery(companyId, projectId)
  const proveedores = useProveedoresQuery(companyId)
  const suministros = useSuministrosProyectoQuery(projectId)
  const reglas = useReglasCompraQuery(companyId, projectId)
  const config = useConfigCompraQuery(companyId, projectId)
  const guardar = useGuardarReglaCompraMutation(companyId, projectId)
  const reemplazar = useReemplazarReglaCompraMutation()
  const actualizar = useActualizarReglaCompraMutation()

  const [destino, setDestino] = useState<DestinoCompra>('gasto')
  const [clasificaPor, setClasificaPor] = useState<'categoria' | 'producto'>('categoria')
  const [categoria, setCategoria] = useState('')
  const [suministroId, setSuministroId] = useState('')
  const [proveedorId, setProveedorId] = useState('')
  const [cuentaId, setCuentaId] = useState('')
  const [desde, setDesde] = useState(hoyLocalISO())

  // Solo cuentas de detalle, activas y del tipo que el destino admite: lo demás lo rechazaría el servidor.
  const aptas = useMemo(
    () => (cuentas.data ?? []).filter((c) => c.es_detalle && c.activa && c.tipo === TIPO_CUENTA_POR_DESTINO[destino]),
    [cuentas.data, destino],
  )
  const cuenta = useMemo(() => new Map((cuentas.data ?? []).map((c) => [c.id, `${c.codigo} · ${c.nombre}`])), [cuentas.data])
  const prov = useMemo(() => new Map((proveedores.data ?? []).map((p) => [p.id, p.nombre])), [proveedores.data])
  const prod = useMemo(() => new Map((suministros.data ?? []).map((p) => [p.id, p.nombre])), [suministros.data])
  const hoy = hoyLocalISO()
  const incompletas = (config.data ?? []).filter((f) => !f.completa)

  async function agregar() {
    const parsed = reglaCompraFormSchema.safeParse({
      destino, clasifica_por: clasificaPor,
      categoria: clasificaPor === 'categoria' ? categoria || null : null,
      suministro_id: clasificaPor === 'producto' ? suministroId || null : null,
      proveedor_id: proveedorId || null, cuenta_id: cuentaId, vigente_desde: desde, notas: null,
    })
    if (!parsed.success) { notify({ variant: 'warning', title: 'Atención', text: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }); return }
    try { await guardar.mutateAsync(parsed.data); setCuentaId('') }
    catch (e) { notify({ variant: 'error', title: 'No se pudo guardar', text: (e as Error).message }) }
  }

  async function cambiarCuenta(id: string, dest: DestinoCompra) {
    const opciones = (cuentas.data ?? [])
      .filter((c) => c.es_detalle && c.activa && c.tipo === TIPO_CUENTA_POR_DESTINO[dest])
      .map((c) => ({ value: c.id, label: `${c.codigo} · ${c.nombre}` }))
    const manana = new Date(); manana.setDate(manana.getDate() + 1)
    const r = await openPromptDialog({
      title: 'Cambiar la cuenta predeterminada',
      description: 'La regla actual se cierra el día anterior y la nueva rige desde la fecha elegida. Lo ya capturado conserva su cuenta.',
      fields: [
        { name: 'cuenta', label: 'Cuenta nueva', control: 'select', options: [{ value: '', label: 'Elegir…' }, ...opciones] },
        { name: 'desde', label: 'Rige desde (AAAA-MM-DD)', initialValue: manana.toISOString().slice(0, 10) },
      ],
      submitText: 'Cambiar',
      validate: (d) => (d.cuenta ? null : 'Elige la cuenta'),
    })
    if (!r) return
    try { await reemplazar.mutateAsync({ reglaId: id, cuentaId: r.cuenta, vigenteDesde: r.desde }) }
    catch (e) { notify({ variant: 'error', title: 'No se pudo cambiar', text: (e as Error).message }) }
  }

  return (
    <section aria-labelledby="reglas-compra-titulo" style={{ border: '1px solid var(--at-line)', borderRadius: 12, padding: 16, background: 'var(--at-surface)', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3 id="reglas-compra-titulo" style={{ margin: 0, fontSize: 15 }}>Cuentas sugeridas para compras</h3>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--at-ink-soft)' }}>
        Orden de prioridad: <strong>1)</strong> la cuenta elegida en la línea · <strong>2)</strong> regla de compra
        (producto+proveedor, producto, categoría+proveedor, categoría) · <strong>3)</strong> regla del proveedor ·{' '}
        <strong>4)</strong> mapeo general del evento · <strong>5)</strong> sin resolver (se avisa, no se inventa). Los
        proveedores y sus condiciones no fijan la cuenta: lo que se compra, sí. Aquí solo se sugiere; la cuenta por
        pagar es otra configuración.
      </p>

      {incompletas.length > 0 && (
        <div role="alert" style={{ padding: 10, borderRadius: 8, border: '1px solid var(--at-warning)', fontSize: 12 }}>
          <strong>Configuración incompleta:</strong>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {incompletas.map((f, i) => <li key={i}>{f.concepto === 'cuenta_por_pagar' ? 'Cuenta por pagar' : `Destino ${f.destino}`}: {f.motivo ?? 'sin cuenta'}</li>)}
          </ul>
        </div>
      )}

      {puedeEditar && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select aria-label="Destino de la compra" value={destino} onChange={(e) => { setDestino(e.target.value as DestinoCompra); setCuentaId('') }} style={input}>
            {DESTINOS_COMPRA.map((d) => <option key={d.destino} value={d.destino}>{d.etiqueta}</option>)}
          </select>
          <select aria-label="Clasifica por" value={clasificaPor} onChange={(e) => setClasificaPor(e.target.value as 'categoria' | 'producto')} style={input}>
            <option value="categoria">Por categoría</option>
            <option value="producto" disabled={!projectId}>Por producto{projectId ? '' : ' (elige un proyecto)'}</option>
          </select>
          {clasificaPor === 'categoria' ? (
            <select aria-label="Categoría" value={categoria} onChange={(e) => setCategoria(e.target.value)} style={input}>
              <option value="">Categoría…</option>
              {CATEGORIAS_GASTO_CXP.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          ) : (
            <select aria-label="Producto" value={suministroId} onChange={(e) => setSuministroId(e.target.value)} style={input}>
              <option value="">Producto…</option>
              {(suministros.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          )}
          <select aria-label="Proveedor de la regla" value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} style={input}>
            <option value="">Cualquier proveedor</option>
            {(proveedores.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
          <select aria-label="Cuenta de la regla" value={cuentaId} onChange={(e) => setCuentaId(e.target.value)} style={input}>
            <option value="">Cuenta…</option>
            {aptas.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
          </select>
          <input aria-label="Rige desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} style={input} />
          <button type="button" style={btnPrimario} disabled={guardar.isPending} onClick={() => void agregar()}>Agregar regla</button>
        </div>
      )}

      {(reglas.data ?? []).length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--at-ink-soft)' }}>Sin reglas de compra: las líneas usan la regla del proveedor o el mapeo general.</p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
          {(reglas.data ?? []).map((r) => {
            const vigente = r.activa && r.vigente_desde <= hoy && (!r.vigente_hasta || r.vigente_hasta >= hoy)
            return (
              <li key={r.id} style={{ marginBottom: 4 }}>
                <strong>{DESTINOS_COMPRA.find((d) => d.destino === r.destino)?.etiqueta}</strong>
                {' · '}{r.suministro_id ? `producto ${prod.get(r.suministro_id) ?? r.suministro_id}` : `categoría ${r.categoria}`}
                {r.proveedor_id ? ` · ${prov.get(r.proveedor_id) ?? r.proveedor_id}` : ''}
                {' → '}{cuenta.get(r.cuenta_id) ?? r.cuenta_id}{' '}
                <StatusBadge tone={vigente ? 'success' : 'neutral'}>
                  {!r.activa ? 'Inactiva' : r.vigente_desde > hoy ? `Desde ${r.vigente_desde}` : r.vigente_hasta && r.vigente_hasta < hoy ? 'Cerrada' : 'Vigente'}
                </StatusBadge>
                {puedeEditar && r.activa && !(r.vigente_hasta && r.vigente_hasta < hoy) && (
                  <button type="button" style={{ ...btnLink, marginLeft: 8 }} onClick={() => void cambiarCuenta(r.id, r.destino)}>Cambiar cuenta</button>
                )}
                {puedeEditar && r.activa && !r.vigente_hasta && (
                  <button type="button" style={{ ...btnLink, marginLeft: 8 }}
                    onClick={() => void actualizar.mutateAsync({ id: r.id, cambios: { vigente_hasta: hoy } }).catch((e: Error) => notify({ variant: 'error', title: 'No se pudo cerrar', text: e.message }))}>Cerrar hoy</button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <p style={{ margin: 0, fontSize: 11, color: 'var(--at-ink-soft)' }}>
        {ORIGEN_CUENTA_LABELS.regla_compra}: se guarda en la línea de la orden al capturarla. Las demás se resuelven al contabilizar, como hasta ahora.
      </p>
    </section>
  )
}
