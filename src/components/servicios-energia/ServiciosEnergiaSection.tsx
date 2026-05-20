import { useState } from 'react'
import type {
  FuenteAgua,
  ProveedorEnergia,
  TarifaEnergia,
  FuenteEnergia,
  FacturaEnergia,
  Proyecto,
  UserSession,
} from '../../types'
import ProveedoresTab from './tabs/ProveedoresTab'
import TarifasTab from './tabs/TarifasTab'
import FuentesTab from './tabs/FuentesTab'
import FacturasTab from './tabs/FacturasTab'
import DashboardTab from './tabs/DashboardTab'

interface ServiciosEnergiaSectionProps {
  fuentesAgua: FuenteAgua[]
  proveedoresEnergia: ProveedorEnergia[]
  tarifasEnergia: TarifaEnergia[]
  fuentesEnergia: FuenteEnergia[]
  facturasEnergia: FacturaEnergia[]
  proyectos: Proyecto[]
  currentUser: UserSession | null
  moneda: string
  canCreate: boolean
  canEdit: boolean
  // CRUD callbacks
  onProveedorAdded: (p: ProveedorEnergia) => void
  onProveedorUpdated: (id: string, p: Partial<ProveedorEnergia>) => void
  onProveedorDeleted: (id: string) => void
  onTarifaAdded: (t: TarifaEnergia) => void
  onTarifaUpdated: (id: string, t: Partial<TarifaEnergia>) => void
  onTarifaDeleted: (id: string) => void
  onFuenteAdded: (f: FuenteEnergia) => void
  onFuenteUpdated: (id: string, f: Partial<FuenteEnergia>) => void
  onFuenteDeleted: (id: string) => void
  onFacturaAdded: (f: FacturaEnergia) => void
  onFacturaUpdated: (id: string, f: Partial<FacturaEnergia>) => void
  onFacturaDeleted: (id: string) => void
}

type EnergyTab = 'proveedores' | 'tarifas' | 'fuentes' | 'facturas' | 'dashboard'

export default function ServiciosEnergiaSection({
  fuentesAgua,
  proveedoresEnergia,
  tarifasEnergia,
  fuentesEnergia,
  facturasEnergia,
  proyectos,
  currentUser,
  moneda,
  canCreate,
  canEdit,
  onProveedorAdded,
  onProveedorUpdated,
  onProveedorDeleted,
  onTarifaAdded,
  onTarifaUpdated,
  onTarifaDeleted,
  onFuenteAdded,
  onFuenteUpdated,
  onFuenteDeleted,
  onFacturaAdded,
  onFacturaUpdated,
  onFacturaDeleted,
}: ServiciosEnergiaSectionProps) {
  const [activeTab, setActiveTab] = useState<EnergyTab>('proveedores')

  const tabs: { id: EnergyTab; label: string; icon: string }[] = [
    { id: 'proveedores', label: 'Proveedores', icon: '🏢' },
    { id: 'tarifas', label: 'Tarifas', icon: '💰' },
    { id: 'fuentes', label: 'Fuentes', icon: '⚡' },
    { id: 'facturas', label: 'Facturas', icon: '📄' },
    { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  ]

  return (
    <div style={{ padding: '1rem' }}>
      <h1 style={{ marginBottom: '1.5rem' }}>⚡ Servicio Energético</h1>

      {/* Tabs Navigation */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          marginBottom: '1.5rem',
          flexWrap: 'wrap',
          borderBottom: '2px solid var(--at-line)',
        }}
      >
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '0.75rem 1rem',
              border: 'none',
              background: activeTab === tab.id ? 'var(--at-primary)' : 'var(--at-surface-2)',
              color: activeTab === tab.id ? 'white' : 'var(--at-ink)',
              cursor: 'pointer',
              borderRadius: '4px 4px 0 0',
              fontWeight: activeTab === tab.id ? 'bold' : 'normal',
            }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div style={{ minHeight: '400px' }}>
        {activeTab === 'proveedores' && (
          <ProveedoresTab
            proveedoresEnergia={proveedoresEnergia}
            proyectos={proyectos}
            currentUser={currentUser}
            canCreate={canCreate}
            canEdit={canEdit}
            onProveedorAdded={onProveedorAdded}
            onProveedorUpdated={onProveedorUpdated}
            onProveedorDeleted={onProveedorDeleted}
          />
        )}

        {activeTab === 'tarifas' && (
          <TarifasTab
            tarifasEnergia={tarifasEnergia}
            proveedoresEnergia={proveedoresEnergia}
            proyectos={proyectos}
            currentUser={currentUser}
            moneda={moneda}
            canCreate={canCreate}
            canEdit={canEdit}
            onTarifaAdded={onTarifaAdded}
            onTarifaUpdated={onTarifaUpdated}
            onTarifaDeleted={onTarifaDeleted}
          />
        )}

        {activeTab === 'fuentes' && (
          <FuentesTab
            fuentesEnergia={fuentesEnergia}
            fuentesAgua={fuentesAgua}
            proveedoresEnergia={proveedoresEnergia}
            tarifasEnergia={tarifasEnergia}
            proyectos={proyectos}
            currentUser={currentUser}
            canCreate={canCreate}
            canEdit={canEdit}
            onFuenteAdded={onFuenteAdded}
            onFuenteUpdated={onFuenteUpdated}
            onFuenteDeleted={onFuenteDeleted}
          />
        )}

        {activeTab === 'facturas' && (
          <FacturasTab
            facturasEnergia={facturasEnergia}
            fuentesEnergia={fuentesEnergia}
            tarifasEnergia={tarifasEnergia}
            proveedoresEnergia={proveedoresEnergia}
            proyectos={proyectos}
            currentUser={currentUser}
            moneda={moneda}
            canCreate={canCreate}
            canEdit={canEdit}
            onFacturaAdded={onFacturaAdded}
            onFacturaUpdated={onFacturaUpdated}
            onFacturaDeleted={onFacturaDeleted}
          />
        )}

        {activeTab === 'dashboard' && (
          <DashboardTab
            facturasEnergia={facturasEnergia}
            fuentesEnergia={fuentesEnergia}
            moneda={moneda}
          />
        )}
      </div>
    </div>
  )
}
