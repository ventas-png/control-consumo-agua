// Registro declarativo de rutas de la app autenticada (P1 #4, extraído de
// App.tsx). Cada entrada declara sus guards (módulo y/o roles) y el nombre de
// sección para el ErrorBoundary; `renderAppRoute` compone los wrappers en el
// mismo orden que tenía el JSX original:
//   ErrorBoundary(sectionName) > RoleGuard(allowedRoles) > (módulo ? render : AccessDenied)
// El JSX de cada sección se movió intacto; los datos vienen de `ctx.agua`
// (useAguaData) y los permisos/navegación del resto del contexto.
import type { ReactNode } from 'react'
import type { AppSection, Ruta, UserRole, UserSession } from '../../types'
import { ErrorBoundary } from '../ErrorBoundary'
import { RoleGuard, AccessDenied } from '../shared/AccessDenied'
import { SinProyectoAsignado } from '../condominios/SinProyectoAsignado'
import type { AguaData } from '../../hooks/useAguaData'
import {
  AdminClientDashboard, CalidadSection, ClientesSection, CobrosSection,
  ComunicacionSection, CondominiosDashboard, CondominiosSection,
  ContabilidadSection, ContadoresSection, ConfiguracionSection,
  DashboardSection, EmpresaSection, HistorialSection, LecturasSection,
  MapaSection, PerfilSection, RutasSection, ServiciosEnergiaSection,
  SuperAdminSection, TarifasSection, UnidadesSection,
} from './lazySections'

export interface AppRoutesCtx {
  currentUser: UserSession
  canViewModule: (moduleKey: string) => boolean
  canCreate: (moduleKey: string) => boolean
  canEdit: (moduleKey: string) => boolean
  canChangeStatus: (moduleKey: string) => boolean
  canApprove: (moduleKey: string) => boolean
  canDelete: (moduleKey: string) => boolean
  agua: AguaData
  condominiosSinProyecto: boolean
  navigateSection: (section: AppSection) => void
  handleLogout: () => void
  updateProfile: (newName: string) => Promise<string | null>
  rutaActivaParaLecturas: Ruta | null
  clearRutaActiva: () => void
  onEjecutarRuta: (ruta: Ruta) => void
}

export interface AppRouteDef {
  path: string
  /** Nombre de sección para el ErrorBoundary (sin él, la ruta no se envuelve). */
  sectionName?: string
  /** Guard de rol: envuelve en <RoleGuard allowedRoles>. */
  allowedRoles?: UserRole[]
  /** Guard de módulo: si canViewModule(module) es falso renderiza <AccessDenied>. */
  module?: string
  render: (ctx: AppRoutesCtx) => ReactNode
}

/** Compone los guards declarados sobre el render de la ruta. */
export function renderAppRoute(def: AppRouteDef, ctx: AppRoutesCtx): ReactNode {
  let element: ReactNode = (def.module && !ctx.canViewModule(def.module))
    ? <AccessDenied />
    : def.render(ctx)
  if (def.allowedRoles) element = <RoleGuard allowedRoles={def.allowedRoles}>{element}</RoleGuard>
  if (def.sectionName) element = <ErrorBoundary sectionName={def.sectionName}>{element}</ErrorBoundary>
  return element
}

// serv:S1/S3 — Energía 1er nivel; la sección se auto-gestiona via queries propias.
// `/energia` (tab por defecto) + `/energia/:tab` deep-linkable comparten elemento.
const renderEnergia = () => <ServiciosEnergiaSection />

export const APP_ROUTES: AppRouteDef[] = [
  {
    path: '/clientes', sectionName: 'clientes', module: 'clientes',
    render: ({ currentUser, agua }) => (
      <ClientesSection
        clientes={agua.clientes}
        unidades={agua.unidades}
        userId={currentUser.user_id}
        companyId={currentUser.company_id}
        onClienteAdded={agua.addCliente}
        onClienteUpdated={agua.updateCliente}
        onClienteDeleted={agua.deleteCliente}
      />
    ),
  },
  {
    path: '/lecturas', sectionName: 'lecturas', module: 'lecturas',
    render: ({ agua, rutaActivaParaLecturas, clearRutaActiva }) => (
      <LecturasSection
        clientes={agua.clientes}
        unidades={agua.unidades}
        contadores={agua.contadores}
        registros={agua.registros}
        tarifas={agua.tarifas}
        proyectos={agua.proyectos}
        moneda={agua.moneda}
        onRegistroAdded={agua.addRegistro}
        rutaActiva={rutaActivaParaLecturas}
        onClearRuta={clearRutaActiva}
        onRutaCompletada={id => {
          // Las rutas recurrentes no se marcan como completadas: cada
          // ocurrencia se completa por separado y la ruta sigue activa.
          const r = agua.rutas.find(x => x.id === id)
          if (!r || (r.frecuencia ?? 'unica') === 'unica') agua.updateRuta(id, { completada: true })
        }}
      />
    ),
  },
  {
    path: '/historial', sectionName: 'historial', module: 'tabla',
    render: ({ currentUser, agua, canEdit, canChangeStatus, canDelete }) => (
      <HistorialSection
        registros={agua.registros}
        clientes={agua.clientes}
        proyectos={agua.proyectos}
        unidades={agua.unidades}
        contadores={agua.contadores}
        userRole={currentUser.role}
        moneda={agua.moneda}
        onEstadoUpdated={agua.updateRegistroEstado}
        onRegistroDeleted={agua.deleteRegistro}
        canEdit={canEdit('tabla')}
        canChangeStatus={canChangeStatus('tabla')}
        canDelete={canDelete('tabla')}
      />
    ),
  },
  {
    path: '/cobros', sectionName: 'cobros',
    allowedRoles: ['collector', 'admin', 'super_admin', 'company_owner'],
    render: ({ agua }) => (
      <CobrosSection
        registros={agua.registros}
        clientes={agua.clientes}
        moneda={agua.moneda}
        proyectos={agua.proyectos}
        onEstadoUpdated={agua.updateRegistroEstado}
        onRegistroUpdated={(id, partial) => {
          if (partial.monto_pagado !== undefined) {
            agua.updateRegistroEstado(id, partial.estado ?? 'pendiente')
          }
        }}
      />
    ),
  },
  {
    path: '/dashboard', sectionName: 'dashboard', module: 'dashboard',
    render: ({ agua, currentUser }) => (
      <DashboardSection registros={agua.registros} moneda={agua.moneda} isLoading={agua.dataLoading} companyId={currentUser.company_id ?? undefined} />
    ),
  },
  {
    path: '/contabilidad', sectionName: 'contabilidad',
    allowedRoles: ['admin', 'super_admin', 'company_owner'], module: 'contabilidad',
    render: () => <ContabilidadSection />,
  },
  {
    path: '/admin-dashboard', sectionName: 'admin_dashboard',
    allowedRoles: ['company_owner'],
    render: ({ currentUser, agua, navigateSection }) => (
      <AdminClientDashboard
        currentUser={currentUser}
        data={{
          clientes: agua.clientes,
          registros: agua.registros,
          proyectos: agua.proyectos,
          contadores: agua.contadores,
          fuentesAgua: agua.fuentesAgua,
          registrosCalidad: agua.registrosCalidad,
          rutas: agua.rutas,
          tarifas: agua.tarifas,
          unidades: agua.unidades,
        }}
        moneda={agua.moneda}
        isLoading={agua.dataLoading}
        onDataRefresh={agua.refrescarDatos}
        onNavigateSection={navigateSection}
      />
    ),
  },
  {
    path: '/mapa', sectionName: 'mapa', module: 'mapa',
    render: ({ currentUser, agua }) => (
      <MapaSection
        clientes={agua.clientes}
        registros={agua.registros}
        companyId={currentUser.company_id}
        canConfigurar={currentUser.role === 'company_owner' || currentUser.role === 'super_admin'}
      />
    ),
  },
  {
    path: '/rutas', sectionName: 'rutas', module: 'rutas',
    render: ({ currentUser, agua, canCreate, canEdit, canDelete, onEjecutarRuta }) => (
      <RutasSection
        clientes={agua.clientes}
        contadores={agua.contadores}
        unidades={agua.unidades}
        proyectos={agua.proyectos}
        rutas={agua.rutas}
        userRole={currentUser.role}
        companyId={currentUser.company_id}
        onRutaAdded={agua.addRuta}
        onRutaUpdated={agua.updateRuta}
        onRutaDeleted={agua.deleteRuta}
        onEjecutarRuta={onEjecutarRuta}
        canCreate={canCreate('rutas')}
        canEdit={canEdit('rutas')}
        canDelete={canDelete('rutas')}
      />
    ),
  },
  {
    path: '/calidad', sectionName: 'calidad', module: 'calidad',
    render: ({ currentUser, agua, canCreate, canEdit }) => (
      <CalidadSection
        fuentesAgua={agua.fuentesAgua}
        registrosCalidad={agua.registrosCalidad}
        empresa={agua.empresa}
        userId={currentUser.user_id}
        onFuentesUpdated={agua.setFuentesAgua}
        onRegistrosCalidadUpdated={agua.setRegistrosCalidad}
        canCreate={canCreate('calidad')}
        canEdit={canEdit('calidad')}
      />
    ),
  },
  {
    path: '/configuracion', sectionName: 'configuracion',
    allowedRoles: ['admin', 'super_admin', 'company_owner'],
    render: ({ handleLogout }) => <ConfiguracionSection onLogout={handleLogout} />,
  },
  {
    path: '/perfil', sectionName: 'perfil',
    render: ({ currentUser, updateProfile }) => (
      <PerfilSection currentUser={currentUser} onUpdateProfile={updateProfile} />
    ),
  },
  {
    path: '/empresa', sectionName: 'empresa',
    allowedRoles: ['company_owner'],
    render: ({ currentUser }) => <EmpresaSection currentUser={currentUser} />,
  },
  {
    path: '/tarifas', sectionName: 'tarifas', module: 'tarifas',
    render: ({ agua }) => (
      <TarifasSection
        tarifas={agua.tarifas}
        proyectos={agua.proyectos}
        moneda={agua.moneda}
        onTarifaAdded={agua.addTarifa}
        onTarifaUpdated={agua.updateTarifa}
        onTarifaDeleted={agua.deleteTarifa}
      />
    ),
  },
  {
    path: '/unidades', sectionName: 'unidades', module: 'unidades',
    render: ({ agua }) => (
      <UnidadesSection
        unidades={agua.unidades}
        contadores={agua.contadores}
        clientes={agua.clientes}
        proyectos={agua.proyectos}
        maxUnidadesPorTipo={agua.maxUnidadesPorTipo}
        onUnidadAdded={agua.addUnidad}
        onUnidadUpdated={agua.updateUnidad}
        onUnidadDeleted={agua.deleteUnidad}
        onContadorUpdated={agua.updateContador}
      />
    ),
  },
  {
    path: '/contadores', sectionName: 'contadores', module: 'contadores',
    render: ({ agua, canDelete }) => (
      <ContadoresSection
        contadores={agua.contadores}
        tarifas={agua.tarifas}
        unidades={agua.unidades}
        moneda={agua.moneda}
        onContadorAdded={agua.addContador}
        onContadorUpdated={agua.updateContador}
        onContadorDeleted={agua.deleteContador}
        canDelete={canDelete('contadores')}
      />
    ),
  },
  {
    path: '/superadmin', sectionName: 'superadmin',
    allowedRoles: ['super_admin'],
    render: () => <SuperAdminSection />,
  },
  {
    path: '/comunicacion', sectionName: 'comunicacion',
    render: ({ currentUser, agua, canCreate, canEdit }) => (
      <ComunicacionSection
        currentUser={currentUser}
        clientes={agua.clientes}
        proyectos={agua.proyectos}
        unidades={agua.unidades}
        registros={agua.registros}
        scope={agua.projectScope}
        canCreate={canCreate('comunicacion')}
        canEdit={canEdit('comunicacion')}
      />
    ),
  },
  { path: '/energia', sectionName: 'servicios_energia', module: 'servicios_energia', render: renderEnergia },
  { path: '/energia/:tab', sectionName: 'servicios_energia', module: 'servicios_energia', render: renderEnergia },
  // cond:A1 sub-rutas: `/condominios/panel` es el selector de proyecto
  // (CondominiosDashboard). Cualquier otro segmento se interpreta como un tab
  // del registry; tabs desconocidos caen a 'panel'. `/condominios` (sin
  // segmento) entra al tab por defecto del registry. El guard de "sin proyecto
  // asignado" es propio de estas rutas, por eso va dentro del render.
  {
    path: '/condominios/panel',
    render: ({ currentUser, agua, navigateSection, condominiosSinProyecto }) => (
      condominiosSinProyecto ? <SinProyectoAsignado /> : (
        <CondominiosDashboard
          currentUser={currentUser}
          proyectos={agua.proyectos}
          unidades={agua.unidades}
          onNavigateSection={navigateSection}
        />
      )
    ),
  },
  {
    path: '/condominios/:tab',
    render: ({ currentUser, agua, condominiosSinProyecto }) => (
      condominiosSinProyecto ? <SinProyectoAsignado /> : (
        <ErrorBoundary sectionName="condominios">
          <CondominiosSection proyectos={agua.proyectos} unidades={agua.unidades} currentUser={currentUser} />
        </ErrorBoundary>
      )
    ),
  },
  {
    path: '/condominios',
    render: ({ currentUser, agua, condominiosSinProyecto }) => (
      condominiosSinProyecto ? <SinProyectoAsignado /> : (
        <ErrorBoundary sectionName="condominios">
          <CondominiosSection
            proyectos={agua.proyectos}
            unidades={agua.unidades}
            currentUser={currentUser}
          />
        </ErrorBoundary>
      )
    ),
  },
]
