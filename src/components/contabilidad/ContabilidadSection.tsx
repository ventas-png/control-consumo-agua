import { useEffect, useState } from 'react'
import { useSession } from '../shared/SessionContext'
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

const TABS: { id: SubTab; label: string }[] = [
  { id: 'polizas', label: 'Pólizas' },
  { id: 'balanza', label: 'Balanza' },
  { id: 'eeff', label: 'Estados financieros' },
  { id: 'bancos', label: 'Bancos' },
  { id: 'cxp', label: 'Cuentas por pagar' },
  { id: 'proveedores', label: 'Proveedores' },
  { id: 'presupuesto', label: 'Presupuesto' },
  { id: 'catalogo', label: 'Catálogo de cuentas' },
  { id: 'configuracion', label: 'Configuración' },
]

/**
 * Contabilidad por ENTIDAD CONTABLE (ledger) — ver ROADMAP_ERP_FINANZAS.md.
 * La empresa lleva su contabilidad y cada proyecto la suya, cada una en su
 * moneda predominante. El selector de contabilidad fija el ledger activo
 * (catálogo, pólizas, folios, reportes, bancos, presupuesto y cierres
 * propios); los asientos automáticos nacen de los triggers de BD en el
 * ledger del documento.
 */
export function ContabilidadSection() {
  const session = useSession()
  const companyId = session.company_id
  const [tab, setTab] = useState<SubTab>('polizas')

  const { data: proyectos = [] } = useProyectosQuery(companyId)

  // Ledger activo: null = contabilidad de la EMPRESA; uuid = la del proyecto.
  // Persistido por empresa para volver donde el admin trabajaba.
  const ledgerKey = `conta-ledger:${companyId ?? ''}`
  const [ledgerProjectId, setLedgerProjectId] = useState<string | null>(() => {
    const stored = localStorage.getItem(`conta-ledger:${companyId ?? ''}`)
    return stored || null
  })
  useEffect(() => {
    if (ledgerProjectId) localStorage.setItem(ledgerKey, ledgerProjectId)
    else localStorage.removeItem(ledgerKey)
  }, [ledgerKey, ledgerProjectId])
  // Si el proyecto persistido ya no existe/accesible, volver a la empresa.
  useEffect(() => {
    if (ledgerProjectId && proyectos.length > 0 && !proyectos.some((p) => p.id === ledgerProjectId)) {
      setLedgerProjectId(null)
    }
  }, [ledgerProjectId, proyectos])

  const { data: monedaBase = 'GTQ' } = useMonedaBaseQuery(companyId, ledgerProjectId)
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
            onChange={(e) => setLedgerProjectId(e.target.value || null)}
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

      <div role="tablist" aria-label="Secciones de contabilidad" style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--at-line)', flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '8px 14px',
              border: 'none',
              borderBottom: tab === t.id ? '2px solid var(--at-accent)' : '2px solid transparent',
              background: 'transparent',
              color: tab === t.id ? 'var(--at-ink)' : 'var(--at-ink-soft)',
              fontWeight: tab === t.id ? 700 : 500,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'polizas' && (
        <AsientosTab companyId={companyId} projectId={ledgerProjectId} monedaBase={monedaBase} />
      )}
      {tab === 'balanza' && (
        <BalanzaTab companyId={companyId} projectId={ledgerProjectId} monedaBase={monedaBase} />
      )}
      {tab === 'eeff' && (
        <EstadosFinancierosTab companyId={companyId} projectId={ledgerProjectId} ledgerNombre={ledgerNombre} monedaBase={monedaBase} />
      )}
      {tab === 'bancos' && (
        <BancosTab companyId={companyId} projectId={ledgerProjectId} monedaBase={monedaBase} />
      )}
      {tab === 'cxp' && (
        <CuentasPorPagarTab companyId={companyId} projectId={ledgerProjectId} monedaBase={monedaBase} />
      )}
      {tab === 'proveedores' && (
        <ProveedoresTab companyId={companyId} />
      )}
      {tab === 'presupuesto' && (
        <PresupuestoTab companyId={companyId} projectId={ledgerProjectId} proyectos={proyectos} monedaBase={monedaBase} />
      )}
      {tab === 'catalogo' && (
        <CatalogoCuentasTab companyId={companyId} projectId={ledgerProjectId} monedaBase={monedaBase} />
      )}
      {tab === 'configuracion' && (
        <MapeoCuentasTab companyId={companyId} projectId={ledgerProjectId} monedaBase={monedaBase} />
      )}
    </div>
  )
}
