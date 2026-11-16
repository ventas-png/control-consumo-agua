import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../shared/SessionContext'
import { usePermissionsContext } from '../shared/PermissionsContext'
import { TabStrip } from '../shared/TabStrip'
import { useProyectosQuery, useUnidadesQuery } from '../../domain/agua/queries'
import {
  useContratosRentaQuery, useInventarioRentaQuery, usePropiedadesRentaQuery,
  useReservasRentaQuery, useReservasStrEnlazadasQuery,
} from '../../domain/rentas/queries'
import { unificarReservas } from '../../domain/rentas/logica'
import { deriveProyectoConfig } from '../../lib/proyectosAccess'
import { hoyLocalISO } from '../../lib/format'
import { RENTAS_TABS, rentasTabToPath, type RentasTab } from './rentasTabs'
import PanelRentasTab from './tabs/PanelRentasTab'
import PropiedadesTab from './tabs/PropiedadesTab'
import ReservasTab from './tabs/ReservasTab'
import ContratosTab from './tabs/ContratosTab'
import InventarioTab from './tabs/InventarioTab'

export interface PermisosModulo { ver: boolean; crear: boolean; editar: boolean; eliminar: boolean }

/**
 * Manejo de Rentas: la cartera de propiedades en renta de la EMPRESA (las
 * enlazadas a unidades de sus condominios y las independientes), con sus
 * reservas, contratos e inventario. La pestaña activa viene de la ruta.
 */
export default function RentasSection({ tab }: { tab: RentasTab }) {
  const currentUser = useSession()
  const companyId = currentUser?.company_id ?? undefined
  const perms = usePermissionsContext()
  const navigate = useNavigate()

  const permisos = useMemo(() => {
    const de = (modulo: string): PermisosModulo => ({
      ver: perms.canViewModule(modulo), crear: perms.canCreate(modulo),
      editar: perms.canEdit(modulo), eliminar: perms.canDelete(modulo),
    })
    return {
      propiedades: de('rentas_propiedades'), reservas: de('rentas_reservas'),
      contratos: de('rentas_contratos'), inventario: de('rentas_inventario'),
    }
  }, [perms])

  // El catálogo de propiedades lo lee cualquiera que vea algún módulo de Rentas.
  const propiedadesQ = usePropiedadesRentaQuery(companyId)
  const propiedades = useMemo(() => propiedadesQ.data ?? [], [propiedadesQ.data])
  const { data: reservasRentas = [] } = useReservasRentaQuery(companyId, permisos.reservas.ver)
  const unidadesEnlazadas = useMemo(
    () => propiedades.filter(p => p.unidad_id && p.tipo_renta === 'corto_plazo').map(p => p.unidad_id as string),
    [propiedades])
  const { data: reservasStr = [] } = useReservasStrEnlazadasQuery(companyId, unidadesEnlazadas, permisos.reservas.ver)
  const { data: contratos = [] } = useContratosRentaQuery(companyId, permisos.contratos.ver)
  const { data: inventario = [] } = useInventarioRentaQuery(companyId, permisos.inventario.ver)
  const { data: proyectos = [] } = useProyectosQuery(companyId)
  const { data: unidades = [] } = useUnidadesQuery(companyId)

  const reservas = useMemo(
    () => unificarReservas(propiedades, reservasRentas, reservasStr),
    [propiedades, reservasRentas, reservasStr])
  const { moneda } = useMemo(() => deriveProyectoConfig(proyectos), [proyectos])
  const hoy = hoyLocalISO()

  const tabsVisibles = RENTAS_TABS.filter(t => perms.canViewModule(t.modulo))
  const ir = (t: RentasTab) => navigate(rentasTabToPath(t))

  return (
    <div style={{ padding: '1rem' }}>
      <h1 style={{ marginBottom: '0.35rem' }}>🏘️ Manejo de Rentas</h1>
      <p style={{ margin: '0 0 1.25rem', color: 'var(--at-ink-3)', fontSize: '14px' }}>
        Toda la cartera de la empresa: las propiedades de sus condominios y las que administra por fuera.
      </p>

      <TabStrip
        ariaLabel="Secciones de Manejo de Rentas"
        items={tabsVisibles.map(t => ({ id: t.id, label: t.label, icon: t.icon }))}
        value={tab}
        onChange={ir}
        marginBottom="1.5rem"
      />

      {propiedadesQ.isError && (
        <p role="alert" style={{ color: 'var(--at-danger)', marginBottom: '1rem' }}>
          No se pudo cargar el catálogo de propiedades. Revisa tu conexión y vuelve a intentar.
        </p>
      )}

      <div style={{ minHeight: '400px' }}>
        {tab === 'panel' && (
          <PanelRentasTab
            propiedades={propiedades} reservas={reservas} contratos={contratos} inventario={inventario}
            proyectos={proyectos} moneda={moneda} hoy={hoy} permisos={permisos} onIr={ir}
            cargando={propiedadesQ.isLoading}
          />
        )}
        {tab === 'propiedades' && (
          <PropiedadesTab
            propiedades={propiedades} reservas={reservas} contratos={contratos} inventario={inventario}
            proyectos={proyectos} unidades={unidades} companyId={companyId ?? ''} moneda={moneda} hoy={hoy}
            permisos={permisos.propiedades} cargando={propiedadesQ.isLoading}
          />
        )}
        {tab === 'reservas' && (
          <ReservasTab
            propiedades={propiedades} reservas={reservas} proyectos={proyectos}
            companyId={companyId ?? ''} moneda={moneda} hoy={hoy} permisos={permisos.reservas}
          />
        )}
        {tab === 'contratos' && (
          <ContratosTab
            propiedades={propiedades} contratos={contratos}
            companyId={companyId ?? ''} moneda={moneda} hoy={hoy} permisos={permisos.contratos}
          />
        )}
        {tab === 'inventario' && (
          <InventarioTab
            propiedades={propiedades} inventario={inventario}
            companyId={companyId ?? ''} moneda={moneda} hoy={hoy} permisos={permisos.inventario}
          />
        )}
      </div>
    </div>
  )
}
