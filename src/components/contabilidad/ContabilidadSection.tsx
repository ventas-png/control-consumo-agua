import { useState } from 'react'
import { useSession } from '../shared/SessionContext'
import { useProyectosQuery } from '../../domain/agua/queries'
import { useMonedaBaseQuery } from '../../domain/contabilidad/queries'
import { CatalogoCuentasTab } from './CatalogoCuentasTab'
import { AsientosTab } from './AsientosTab'
import { BalanzaTab } from './BalanzaTab'
import { MapeoCuentasTab } from './MapeoCuentasTab'
import { ProveedoresTab } from './ProveedoresTab'
import { CuentasPorPagarTab } from './CuentasPorPagarTab'

type SubTab = 'polizas' | 'balanza' | 'cxp' | 'proveedores' | 'catalogo' | 'configuracion'

const TABS: { id: SubTab; label: string }[] = [
  { id: 'polizas', label: 'Pólizas' },
  { id: 'balanza', label: 'Balanza' },
  { id: 'cxp', label: 'Cuentas por pagar' },
  { id: 'proveedores', label: 'Proveedores' },
  { id: 'catalogo', label: 'Catálogo de cuentas' },
  { id: 'configuracion', label: 'Configuración' },
]

/**
 * Contabilidad (partida doble) — Fase 1 ERP. Ver ROADMAP_ERP_FINANZAS.md.
 * Toda la contabilidad se lleva en la moneda base de la empresa; los asientos
 * automáticos nacen de pagos/gastos/facturas/cuotas vía triggers de BD.
 */
export function ContabilidadSection() {
  const session = useSession()
  const companyId = session.company_id
  const [tab, setTab] = useState<SubTab>('polizas')

  const { data: proyectos = [] } = useProyectosQuery(companyId)
  const { data: monedaBase = 'GTQ' } = useMonedaBaseQuery(companyId)

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
      <div>
        <h2 style={{ margin: 0, fontSize: 20 }}>Contabilidad</h2>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--at-ink-soft)' }}>
          Partida doble · moneda base <strong>{monedaBase}</strong> · los cobros,
          gastos, facturas y cuotas se contabilizan automáticamente.
        </p>
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
        <AsientosTab companyId={companyId} proyectos={proyectos} monedaBase={monedaBase} />
      )}
      {tab === 'balanza' && (
        <BalanzaTab companyId={companyId} proyectos={proyectos} monedaBase={monedaBase} />
      )}
      {tab === 'cxp' && (
        <CuentasPorPagarTab companyId={companyId} proyectos={proyectos} monedaBase={monedaBase} />
      )}
      {tab === 'proveedores' && (
        <ProveedoresTab companyId={companyId} />
      )}
      {tab === 'catalogo' && (
        <CatalogoCuentasTab companyId={companyId} monedaBase={monedaBase} />
      )}
      {tab === 'configuracion' && (
        <MapeoCuentasTab companyId={companyId} monedaBase={monedaBase} />
      )}
    </div>
  )
}
