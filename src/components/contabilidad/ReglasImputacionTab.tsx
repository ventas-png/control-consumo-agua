// Reglas de imputación contable — pantalla del LEDGER activo.
//
// Dos bloques, y el orden en pantalla es el orden de la PRIORIDAD real, para
// que la pantalla enseñe la regla del sistema en vez de pedir que se aprenda
// de un manual:
//   1. Cuenta predeterminada por proveedor.
//   2. Previsualización: dada una combinación, qué cuenta sale y POR QUÉ.
//
// Lo que esta pantalla NO hace: decidir. Toda la resolución vive en
// `conta_resolver_imputacion`, y la previsualización la LLAMA en vez de
// reimplementarla. Si la UI calculara su propia respuesta, mostraría una
// predicción que podría no coincidir con lo que el documento va a hacer, que
// es exactamente el problema que estas reglas vienen a resolver.
//
// Lo que esta pantalla NO OFRECE, y por qué: las reglas por cliente y unidad
// (`conta_reglas_cargo`) existen en la base, con sus triggers, su RLS y su
// escalón en el resolutor, y el arnés las cubre. Pero NINGÚN documento las
// consulta todavía: `cargos_adicionales_unidad` no está cableado al motor.
// Un formulario para guardarlas sería un control que promete cambiar un
// asiento y no cambia ninguno, así que no se ofrece hasta que el cableado
// exista. Lo mismo con los destinos distintos de `gasto`: ver
// `DESTINOS_CABLEADOS`.
import { useMemo, useState } from 'react'
import {
  useCuentasQuery,
  useReglasProveedorQuery,
  useResolucionImputacionQuery,
} from '../../domain/contabilidad/queries'
import {
  useGuardarReglaProveedorMutation,
  useEliminarReglaProveedorMutation,
} from '../../domain/contabilidad/mutations'
import { useProveedoresQuery } from '../../domain/cxp/queries'
import {
  DESTINOS_IMPUTACION,
  DESTINOS_CABLEADOS,
  ETIQUETA_ORIGEN,
  type DestinoImputacion,
} from '../../types/contabilidad'

interface Props {
  companyId?: string
  projectId?: string | null
  puedeEditar?: boolean
}

/**
 * Los destinos que la pantalla ofrece, con su etiqueta. Es el catálogo
 * completo filtrado por lo que un documento consulta de verdad.
 */
const DESTINOS_OFRECIDOS = DESTINOS_IMPUTACION.filter((d) =>
  DESTINOS_CABLEADOS.includes(d.destino),
)

const card: React.CSSProperties = {
  border: '1px solid var(--at-line)',
  borderRadius: 12,
  padding: 16,
  background: 'var(--at-surface)',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
}

const inputStyle: React.CSSProperties = {
  padding: '6px 8px',
  border: '1px solid var(--at-line)',
  borderRadius: 6,
  background: 'var(--at-surface)',
  color: 'inherit',
  minWidth: 140,
}

export function ReglasImputacionTab({ companyId, projectId, puedeEditar = true }: Props) {
  const cuentas = useCuentasQuery(companyId, projectId)
  const proveedores = useProveedoresQuery(companyId)
  const reglasProv = useReglasProveedorQuery(companyId, projectId)

  const guardarProv = useGuardarReglaProveedorMutation(companyId, projectId)
  const borrarProv = useEliminarReglaProveedorMutation(companyId)

  // Sólo cuentas IMPUTABLES: de detalle y activas. Ofrecer una agrupadora
  // sería ofrecer algo que el trigger de BD va a rechazar.
  const cuentasImputables = useMemo(
    () => (cuentas.data ?? []).filter((c) => c.es_detalle && c.activa),
    [cuentas.data],
  )
  const nombreCuenta = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of cuentas.data ?? []) m.set(c.id, `${c.codigo} · ${c.nombre}`)
    return m
  }, [cuentas.data])
  const nombreProveedor = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of proveedores.data ?? []) m.set(p.id, p.nombre)
    return m
  }, [proveedores.data])

  // ── Formulario: regla de proveedor ────────────────────────────────────────
  const [provId, setProvId] = useState('')
  const [provDestino, setProvDestino] = useState<DestinoImputacion>('gasto')
  const [provCuenta, setProvCuenta] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function agregarReglaProveedor() {
    setError(null)
    if (!provId || !provCuenta) { setError('Elige proveedor y cuenta.'); return }
    try {
      await guardarProv.mutateAsync({
        proveedor_id: provId, destino: provDestino, cuenta_id: provCuenta,
      })
      setProvId(''); setProvCuenta('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la regla.')
    }
  }

  // ── Previsualización ──────────────────────────────────────────────────────
  const [vistaProv, setVistaProv] = useState('')
  const [vistaDestino, setVistaDestino] = useState<DestinoImputacion>('gasto')
  const vista = useResolucionImputacionQuery({
    companyId,
    projectId,
    destino: vistaDestino,
    proveedorId: vistaProv || null,
    categoria: null,
  })

  const sinResolver = vista.data?.origen_resolucion === 'sin_resolver'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--at-space-3)' }}>
      {/* El aviso NO bloquea nada: señala configuración incompleta y deja
          operar. Bloquear la pantalla por una regla faltante impediría
          justamente configurarla. */}
      <p style={{ margin: 0, color: 'var(--at-ink-soft)', fontSize: 13 }}>
        La cuenta se elige en este orden: <strong>la del documento</strong>, luego{' '}
        <strong>la regla del proveedor</strong>, y por último{' '}
        <strong>el mapeo general del evento</strong>. Si ninguna aplica, el documento queda
        pendiente de configuración y no se le inventa una cuenta.
      </p>
      <p style={{ margin: 0, color: 'var(--at-ink-soft)', fontSize: 13 }}>
        Por ahora las reglas se aplican a las <strong>facturas de proveedor</strong> y al destino{' '}
        <strong>gasto</strong>. Los cargos por cliente o unidad, y los destinos de inventario y
        activo fijo, todavía no consultan estas reglas, así que no se pueden configurar desde acá.
      </p>

      {error && (
        <div role="alert" style={{ ...card, borderColor: 'var(--at-danger)', padding: 12 }}>
          {error}
        </div>
      )}

      {/* ── 1. Reglas por proveedor ── */}
      <section style={card} aria-labelledby="reglas-prov-titulo">
        <h3 id="reglas-prov-titulo" style={{ margin: 0, fontSize: 15 }}>
          Cuenta predeterminada por proveedor
        </h3>

        {puedeEditar && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select aria-label="Proveedor" value={provId} onChange={(e) => setProvId(e.target.value)} style={inputStyle}>
              <option value="">Proveedor…</option>
              {(proveedores.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>
            <select aria-label="Destino" value={provDestino}
              onChange={(e) => setProvDestino(e.target.value as DestinoImputacion)} style={inputStyle}>
              {DESTINOS_OFRECIDOS.map((d) => (
                <option key={d.destino} value={d.destino}>{d.etiqueta}</option>
              ))}
            </select>
            <select aria-label="Cuenta" value={provCuenta} onChange={(e) => setProvCuenta(e.target.value)} style={inputStyle}>
              <option value="">Cuenta…</option>
              {cuentasImputables.map((c) => (
                <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>
              ))}
            </select>
            <button type="button" onClick={() => void agregarReglaProveedor()} disabled={guardarProv.isPending}>
              Agregar regla
            </button>
          </div>
        )}

        {(reglasProv.data ?? []).length === 0 ? (
          <p style={{ margin: 0, color: 'var(--at-ink-soft)', fontSize: 13 }}>
            Sin reglas por proveedor. Las facturas usan el mapeo general del evento.
          </p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {(reglasProv.data ?? []).map((r) => (
              <li key={r.id} style={{ marginBottom: 4 }}>
                <strong>{nombreProveedor.get(r.proveedor_id) ?? r.proveedor_id}</strong>
                {' → '}
                {DESTINOS_IMPUTACION.find((d) => d.destino === r.destino)?.etiqueta ?? r.destino}
                {': '}
                {nombreCuenta.get(r.cuenta_id) ?? r.cuenta_id}
                {puedeEditar && (
                  <button type="button" style={{ marginLeft: 8 }}
                    onClick={() => void borrarProv.mutateAsync(r.id)}>Quitar</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── 2. Previsualización ── */}
      <section style={card} aria-labelledby="vista-previa-titulo">
        <h3 id="vista-previa-titulo" style={{ margin: 0, fontSize: 15 }}>
          ¿Qué cuenta se usaría?
        </h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select aria-label="Proveedor a previsualizar" value={vistaProv}
            onChange={(e) => setVistaProv(e.target.value)} style={inputStyle}>
            <option value="">Sin proveedor</option>
            {(proveedores.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.nombre}</option>
            ))}
          </select>
          <select aria-label="Destino a previsualizar" value={vistaDestino}
            onChange={(e) => setVistaDestino(e.target.value as DestinoImputacion)} style={inputStyle}>
            {DESTINOS_OFRECIDOS.map((d) => (
              <option key={d.destino} value={d.destino}>{d.etiqueta}</option>
            ))}
          </select>
        </div>

        {vista.isLoading ? (
          <p style={{ margin: 0 }}>Resolviendo…</p>
        ) : vista.data ? (
          <div role="status" style={{
            padding: 12,
            borderRadius: 8,
            border: `1px solid ${sinResolver ? 'var(--at-warning, #b45309)' : 'var(--at-line)'}`,
          }}>
            <div style={{ fontWeight: 600 }}>
              {sinResolver
                ? 'Sin resolver — falta configuración'
                : nombreCuenta.get(vista.data.cuenta_id ?? '') ?? vista.data.cuenta_id}
            </div>
            <div style={{ fontSize: 13, color: 'var(--at-ink-soft)', marginTop: 4 }}>
              {ETIQUETA_ORIGEN[vista.data.origen_resolucion]}
              {vista.data.evento_usado ? ` · evento «${vista.data.evento_usado}»` : ''}
            </div>
            {vista.data.motivo && (
              <div style={{ fontSize: 13, marginTop: 6 }}>{vista.data.motivo}</div>
            )}
          </div>
        ) : null}
      </section>
    </div>
  )
}
