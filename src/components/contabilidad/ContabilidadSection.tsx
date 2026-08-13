import { useCallback, useEffect, useState } from 'react'
import { useSession } from '../shared/SessionContext'
import { TabStrip } from '../shared/TabStrip'
import { useProyectosQuery } from '../../domain/agua/queries'
import { useMonedaBaseQuery } from '../../domain/contabilidad/queries'
import { CatalogoCuentasTab } from './CatalogoCuentasTab'
import { AsientosTab } from './AsientosTab'
import { BalanzaTab } from './BalanzaTab'
import { MapeoCuentasTab } from './MapeoCuentasTab'
import { ProveedoresTab } from './ProveedoresTab'
import { CuentasPorPagarTab } from './CuentasPorPagarTab'
import { PresupuestoTab } from './PresupuestoTab'
import { BancosTab } from './BancosTab'
import { EstadosFinancierosTab } from './EstadosFinancierosTab'

type SubTab = 'polizas' | 'balanza' | 'eeff' | 'bancos' | 'cxp' | 'proveedores' | 'presupuesto' | 'catalogo' | 'configuracion'

const TABS: { id: SubTab; label: string; icon: string }[] = [
  { id: 'polizas', label: 'Pólizas', icon: '📒' },
  { id: 'balanza', label: 'Balanza', icon: '⚖️' },
  { id: 'eeff', label: 'Estados financieros', icon: '📊' },
  { id: 'bancos', label: 'Bancos', icon: '🏦' },
  { id: 'cxp', label: 'Cuentas por pagar', icon: '🧾' },
  { id: 'proveedores', label: 'Proveedores', icon: '🚚' },
  { id: 'presupuesto', label: 'Presupuesto', icon: '🎯' },
  { id: 'catalogo', label: 'Catálogo de cuentas', icon: '📚' },
  { id: 'configuracion', label: 'Configuración', icon: '⚙️' },
]

/**
 * Contabilidad por ENTIDAD CONTABLE (ledger) — ver ROADMAP_ERP_FINANZAS.md.
 * La empresa lleva su contabilidad y cada proyecto la suya, cada una en su
 * moneda predominante. El selector de contabilidad fija el ledger activo
 * (catálogo, pólizas, folios, reportes, bancos, presupuesto y cierres
 * propios); los asientos automáticos nacen de los triggers de BD en el
 * ledger del documento.
 */
/** Contabilidad recordada de una empresa (null = la de la empresa). */
function leerLedgerGuardado(companyId?: string | null): string | null {
  if (!companyId) return null
  return localStorage.getItem(`conta-ledger:${companyId}`) || null
}

export function ContabilidadSection() {
  const session = useSession()
  const companyId = session.company_id
  const [tab, setTab] = useState<SubTab>('polizas')

  const { data: proyectos = [], isSuccess: proyectosCargados } = useProyectosQuery(companyId)

  // Ledger activo: null = contabilidad de la EMPRESA; uuid = la del proyecto.
  // Persistido por empresa para volver donde el admin trabajaba. El estado
  // guarda TAMBIÉN la empresa dueña de la selección: sin eso, el proyecto de
  // una empresa se arrastraba (y se re-persistía) bajo la llave de otra cuando
  // la sesión cambiaba de empresa o cuando aún no había resuelto al montar.
  const [ledger, setLedger] = useState<{ empresa: string | null; proyecto: string | null }>(() => ({
    empresa: companyId ?? null,
    proyecto: leerLedgerGuardado(companyId),
  }))
  const ledgerProjectId = ledger.empresa === (companyId ?? null) ? ledger.proyecto : null
  const elegirLedger = useCallback(
    (proyecto: string | null) => setLedger({ empresa: companyId ?? null, proyecto }),
    [companyId],
  )
  // Cambió la empresa: la contabilidad activa se relee de ESA empresa.
  useEffect(() => {
    if (ledger.empresa === (companyId ?? null)) return
    setLedger({ empresa: companyId ?? null, proyecto: leerLedgerGuardado(companyId) })
  }, [companyId, ledger.empresa])
  useEffect(() => {
    if (!companyId || ledger.empresa !== companyId) return
    const key = `conta-ledger:${companyId}`
    if (ledger.proyecto) localStorage.setItem(key, ledger.proyecto)
    else localStorage.removeItem(key)
  }, [companyId, ledger])
  // Si el proyecto persistido no es de esta empresa (o ya no existe/accesible),
  // volver a la empresa. La guarda corre en cuanto la lista resuelve, incluso
  // vacía: una empresa SIN proyectos conservaba el proyecto de la anterior.
  useEffect(() => {
    if (proyectosCargados && ledgerProjectId && !proyectos.some((p) => p.id === ledgerProjectId)) {
      elegirLedger(null)
    }
  }, [ledgerProjectId, proyectos, proyectosCargados, elegirLedger])

  const { data: monedaBase = 'GTQ' } = useMonedaBaseQuery(companyId, ledgerProjectId)
  // Identidad de la contabilidad activa (empresa + proyecto) para remontar las
  // pestañas al cambiarla.
  const ledgerKeyUI = `${companyId ?? ''}:${ledgerProjectId ?? 'empresa'}`
  const ledgerNombre = ledgerProjectId
    ? proyectos.find((p) => p.id === ledgerProjectId)?.nombre ?? 'Proyecto'
    : 'Empresa'

  if (!companyId) {
    return (
      <div style={{ padding: 'var(--at-space-5)' }}>
        <p style={{ color: 'var(--at-ink-soft)' }}>
          La contabilidad requiere una empresa activa.
        </p>
      </div>
    )
  }

  return (
    <div style={{ padding: 'var(--at-space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--at-space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>Contabilidad — {ledgerNombre}</h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--at-ink-soft)' }}>
            Partida doble · moneda base <strong>{monedaBase}</strong> · cada
            contabilidad (empresa y proyectos) lleva catálogo, folios y cierres propios.
          </p>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--at-ink-soft)', fontWeight: 600 }}>
          Contabilidad
          <select
            value={ledgerProjectId ?? ''}
            onChange={(e) => elegirLedger(e.target.value || null)}
            aria-label="Seleccionar contabilidad"
            style={{ padding: '8px 12px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 13, fontWeight: 600, minWidth: 220, background: 'var(--at-surface)' }}
          >
            <option value="">🏢 Empresa</option>
            {proyectos.map((p) => (
              <option key={p.id} value={p.id}>📍 {p.nombre}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Sub-menú con el mismo patrón que Condominios: una sola fila con scroll
          horizontal. Con `flex-wrap` estas 9 pestañas ocupaban cuatro líneas en
          un teléfono antes de llegar al contenido. */}
      <TabStrip
        ariaLabel="Secciones de contabilidad"
        items={TABS}
        value={tab}
        onChange={setTab}
      />

      {/* `key` por ledger: cambiar de contabilidad REMONTA la pestaña, así el
          estado local de cada una (cuenta bancaria elegida, filtros, periodo,
          formularios a medio llenar) nunca se arrastra de una contabilidad a
          otra ni se aplica sobre la que no le toca. */}
      {tab === 'polizas' && (
        <AsientosTab key={ledgerKeyUI} companyId={companyId} projectId={ledgerProjectId} monedaBase={monedaBase} />
      )}
      {tab === 'balanza' && (
        <BalanzaTab key={ledgerKeyUI} companyId={companyId} projectId={ledgerProjectId} monedaBase={monedaBase} />
      )}
      {tab === 'eeff' && (
        <EstadosFinancierosTab key={ledgerKeyUI} companyId={companyId} projectId={ledgerProjectId} ledgerNombre={ledgerNombre} monedaBase={monedaBase} />
      )}
      {tab === 'bancos' && (
        <BancosTab key={ledgerKeyUI} companyId={companyId} projectId={ledgerProjectId} monedaBase={monedaBase} />
      )}
      {tab === 'cxp' && (
        <CuentasPorPagarTab key={ledgerKeyUI} companyId={companyId} projectId={ledgerProjectId} monedaBase={monedaBase} />
      )}
      {tab === 'proveedores' && (
        <ProveedoresTab key={companyId} companyId={companyId} />
      )}
      {tab === 'presupuesto' && (
        <PresupuestoTab key={ledgerKeyUI} companyId={companyId} projectId={ledgerProjectId} proyectos={proyectos} monedaBase={monedaBase} />
      )}
      {tab === 'catalogo' && (
        <CatalogoCuentasTab key={ledgerKeyUI} companyId={companyId} projectId={ledgerProjectId} monedaBase={monedaBase} />
      )}
      {tab === 'configuracion' && (
        <MapeoCuentasTab key={ledgerKeyUI} companyId={companyId} projectId={ledgerProjectId} monedaBase={monedaBase} />
      )}
    </div>
  )
}
