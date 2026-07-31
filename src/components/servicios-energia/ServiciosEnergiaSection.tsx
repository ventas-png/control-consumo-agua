import { useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { type EnergyTab, energiaTabToPath, pathParamToEnergiaTab } from './energiaTabs'
import { useSession } from '../shared/SessionContext'
import { usePermissionsContext } from '../shared/PermissionsContext'
import { TabStrip } from '../shared/TabStrip'
import { useProveedoresEnergiaQuery, useTarifasEnergiaQuery, useFuentesEnergiaQuery, useFacturasEnergiaQuery } from '../../domain/energia/queries'
import { useFuentesAguaQuery, useProyectosQuery } from '../../domain/agua/queries'
import { deriveProyectoConfig } from '../../lib/proyectosAccess'
import ProveedoresTab from './tabs/ProveedoresTab'
import TarifasTab from './tabs/TarifasTab'
import FuentesTab from './tabs/FuentesTab'
import FacturasTab from './tabs/FacturasTab'
import DashboardTab from './tabs/DashboardTab'

// serv:S3/S4/S5 — La sección ya no recibe props de datos ni callbacks.
// Obtiene todo vía TanStack Query (energiaKeys + aguaKeys en caché).
export default function ServiciosEnergiaSection() {
  const currentUser = useSession()
  const companyId = currentUser?.company_id ?? undefined
  const perms = usePermissionsContext()
  const canCreate = perms.canCreate('servicios_energia')
  const canEdit = perms.canEdit('servicios_energia')
  // RBAC granular: eliminar (facturas, tarifas, proveedores, fuentes) requiere
  // el permiso delete del módulo. Crear/editar no cambian.
  const canDelete = perms.canDelete('servicios_energia')

  const { tab: tabParam } = useParams<{ tab?: string }>()
  const activeTab: EnergyTab = pathParamToEnergiaTab(tabParam)
  const navigate = useNavigate()
  const setActiveTab = (next: EnergyTab) => navigate(energiaTabToPath(next))

  const { data: proveedoresEnergia = [] } = useProveedoresEnergiaQuery(companyId)
  const { data: tarifasEnergia = [] } = useTarifasEnergiaQuery(companyId)
  const { data: fuentesEnergia = [] } = useFuentesEnergiaQuery(companyId)
  const { data: facturasEnergia = [] } = useFacturasEnergiaQuery(companyId)
  const { data: fuentesAgua = [] } = useFuentesAguaQuery(companyId)
  const { data: proyectos = [] } = useProyectosQuery(companyId)

  const { moneda } = useMemo(() => deriveProyectoConfig(proyectos), [proyectos])

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

      {/* Mismo sub-menú que Condominios/Contabilidad: una fila con scroll. */}
      <TabStrip
        ariaLabel="Secciones de servicio energético"
        items={tabs}
        value={activeTab}
        onChange={setActiveTab}
        marginBottom="1.5rem"
      />

      <div style={{ minHeight: '400px' }}>
        {activeTab === 'proveedores' && (
          <ProveedoresTab
            proveedoresEnergia={proveedoresEnergia}
            proyectos={proyectos}
            companyId={companyId ?? ''}
            canCreate={canCreate}
            canEdit={canEdit}
            canDelete={canDelete}
          />
        )}

        {activeTab === 'tarifas' && (
          <TarifasTab
            tarifasEnergia={tarifasEnergia}
            proveedoresEnergia={proveedoresEnergia}
            proyectos={proyectos}
            companyId={companyId ?? ''}
            moneda={moneda}
            canCreate={canCreate}
            canEdit={canEdit}
            canDelete={canDelete}
          />
        )}

        {activeTab === 'fuentes' && (
          <FuentesTab
            fuentesEnergia={fuentesEnergia}
            fuentesAgua={fuentesAgua}
            proveedoresEnergia={proveedoresEnergia}
            tarifasEnergia={tarifasEnergia}
            proyectos={proyectos}
            companyId={companyId ?? ''}
            canCreate={canCreate}
            canEdit={canEdit}
            canDelete={canDelete}
          />
        )}

        {activeTab === 'facturas' && (
          <FacturasTab
            facturasEnergia={facturasEnergia}
            fuentesEnergia={fuentesEnergia}
            tarifasEnergia={tarifasEnergia}
            proveedoresEnergia={proveedoresEnergia}
            proyectos={proyectos}
            companyId={companyId ?? ''}
            moneda={moneda}
            canCreate={canCreate}
            canEdit={canEdit}
            canDelete={canDelete}
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
