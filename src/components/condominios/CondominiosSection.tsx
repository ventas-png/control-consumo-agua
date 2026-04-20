import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import type {
  UserSession, Proyecto, Unidad,
  CuotaCondominio, Visitante, Amenidad, ReservaAmenidad, TicketMantenimiento, AnuncioComunidad,
  ParqueoCondominio, Mascota, PaqueteRecibido, InfraccionCondominio,
  RondaSeguridad, NovedadSeguridad, ContratoArrendamiento,
  Asamblea, ContratoProveedor, ObjetoPerdido, AgendaItem,
  ItemInventario, PolizaSeguro, InspeccionNormativa, PersonalCondominio,
  ContactoEmergencia, Mudanza, DocumentoCondominio, RegistroResiduo,
  BodegaCondominio, OnboardingResidente, PropuestaInversion, MemoriaLabores,
  ReservaSTR, LocalComercial, ServicioHousekeeping,
} from '../../types'
import { PanelGeneralTab } from './tabs/PanelGeneralTab'
import { CuotasTab } from './tabs/CuotasTab'
import { VisitantesTab } from './tabs/VisitantesTab'
import { AmenidadesTab } from './tabs/AmenidadesTab'
import { MantenimientoTab } from './tabs/MantenimientoTab'
import { ComunidadTab } from './tabs/ComunidadTab'
import { ParqueosTab } from './tabs/ParqueosTab'
import { MascotasTab } from './tabs/MascotasTab'
import { PaqueteriaTab } from './tabs/PaqueteriaTab'
import { InfraccionesTab } from './tabs/InfraccionesTab'
import { SeguridadTab } from './tabs/SeguridadTab'
import { ArrendamientosTab } from './tabs/ArrendamientosTab'
import { AsambleasTab } from './tabs/AsambleasTab'
import { ProveedoresTab } from './tabs/ProveedoresTab'
import { ObjetosTab } from './tabs/ObjetosTab'
import { AgendaTab } from './tabs/AgendaTab'
import { InventarioTab } from './tabs/InventarioTab'
import { PolizasTab } from './tabs/PolizasTab'
import { InspeccionesTab } from './tabs/InspeccionesTab'
import { PersonalTab } from './tabs/PersonalTab'
import { EmergenciasTab } from './tabs/EmergenciasTab'
import { MudanzasTab } from './tabs/MudanzasTab'
import { DocumentosTab } from './tabs/DocumentosTab'
import { ResiduosTab } from './tabs/ResiduosTab'
import { BodegasTab } from './tabs/BodegasTab'
import { OnboardingTab } from './tabs/OnboardingTab'
import { PropuestasTab } from './tabs/PropuestasTab'
import { MemoriaTab } from './tabs/MemoriaTab'
import { STRTab } from './tabs/STRTab'
import { LocalesTab } from './tabs/LocalesTab'
import { SostenibilidadTab } from './tabs/SostenibilidadTab'
import { HousekeepingTab } from './tabs/HousekeepingTab'

type CondominioTab =
  | 'panel' | 'cuotas' | 'visitantes' | 'amenidades' | 'mantenimiento' | 'comunidad'
  | 'parqueos' | 'mascotas' | 'paqueteria' | 'infracciones' | 'seguridad' | 'arrendamientos'
  | 'asambleas' | 'proveedores' | 'objetos' | 'agenda'
  | 'inventario' | 'polizas' | 'inspecciones' | 'personal'
  | 'emergencias' | 'mudanzas' | 'documentos' | 'residuos'
  | 'bodegas' | 'onboarding' | 'propuestas' | 'memoria'
  | 'str' | 'locales' | 'sostenibilidad' | 'housekeeping'

const TABS: { id: CondominioTab; label: string; icon: string }[] = [
  { id: 'panel',          label: 'Panel',          icon: '📊' },
  { id: 'cuotas',         label: 'Cuotas',         icon: '💳' },
  { id: 'visitantes',     label: 'Visitantes',     icon: '🚪' },
  { id: 'amenidades',     label: 'Amenidades',     icon: '🏊' },
  { id: 'mantenimiento',  label: 'Mantenimiento',  icon: '🔧' },
  { id: 'comunidad',      label: 'Comunidad',      icon: '📢' },
  { id: 'parqueos',       label: 'Parqueos',       icon: '🅿️' },
  { id: 'mascotas',       label: 'Mascotas',       icon: '🐾' },
  { id: 'paqueteria',     label: 'Paquetería',     icon: '📦' },
  { id: 'infracciones',   label: 'Infracciones',   icon: '⚖️' },
  { id: 'seguridad',      label: 'Seguridad',      icon: '🛡️' },
  { id: 'arrendamientos', label: 'Arrendamientos', icon: '📄' },
  { id: 'asambleas',      label: 'Asambleas',      icon: '🗳️' },
  { id: 'proveedores',    label: 'Proveedores',    icon: '🤝' },
  { id: 'objetos',        label: 'Obj. Perdidos',  icon: '🔍' },
  { id: 'agenda',         label: 'Agenda',         icon: '📅' },
  { id: 'inventario',    label: 'Inventario',     icon: '🗃️' },
  { id: 'polizas',       label: 'Pólizas',        icon: '🛡️' },
  { id: 'inspecciones',  label: 'Inspecciones',   icon: '🏛️' },
  { id: 'personal',      label: 'Personal',       icon: '👥' },
  { id: 'emergencias',   label: 'Emergencias',    icon: '🆘' },
  { id: 'mudanzas',      label: 'Mudanzas',       icon: '🚚' },
  { id: 'documentos',    label: 'Documentos',     icon: '📁' },
  { id: 'residuos',      label: 'Residuos',       icon: '♻️' },
  { id: 'bodegas',       label: 'Bodegas',        icon: '🗄️' },
  { id: 'onboarding',    label: 'Onboarding',     icon: '🎯' },
  { id: 'propuestas',    label: 'Propuestas',     icon: '💡' },
  { id: 'memoria',        label: 'Memoria',        icon: '📋' },
  { id: 'str',           label: 'STR',            icon: '🏨' },
  { id: 'locales',       label: 'Locales',        icon: '🏪' },
  { id: 'sostenibilidad',label: 'Sostenibilidad', icon: '🌱' },
  { id: 'housekeeping',  label: 'Housekeeping',   icon: '🧹' },
]

interface Props {
  proyectos: Proyecto[]
  unidades: Unidad[]
  currentUser: UserSession
  canCreate: (section: string) => boolean
  canEdit: (section: string) => boolean
}

export function CondominiosSection({ proyectos, unidades, currentUser, canCreate, canEdit }: Props) {
  const [activeTab, setActiveTab] = useState<CondominioTab>('panel')
  const [selectedProyectoId, setSelectedProyectoId] = useState<string>('')
  const [loading, setLoading] = useState(false)

  // Fase 1
  const [cuotas, setCuotas] = useState<CuotaCondominio[]>([])
  const [visitantes, setVisitantes] = useState<Visitante[]>([])
  const [amenidades, setAmenidades] = useState<Amenidad[]>([])
  const [reservas, setReservas] = useState<ReservaAmenidad[]>([])
  const [tickets, setTickets] = useState<TicketMantenimiento[]>([])
  const [anuncios, setAnuncios] = useState<AnuncioComunidad[]>([])
  // Fase 2
  const [parqueos, setParqueos] = useState<ParqueoCondominio[]>([])
  const [mascotas, setMascotas] = useState<Mascota[]>([])
  const [paquetes, setPaquetes] = useState<PaqueteRecibido[]>([])
  const [infracciones, setInfracciones] = useState<InfraccionCondominio[]>([])
  const [rondas, setRondas] = useState<RondaSeguridad[]>([])
  const [novedades, setNovedades] = useState<NovedadSeguridad[]>([])
  const [contratos, setContratos] = useState<ContratoArrendamiento[]>([])
  // Fase 3
  const [asambleas, setAsambleas] = useState<Asamblea[]>([])
  const [contratosProveedores, setContratosProveedores] = useState<ContratoProveedor[]>([])
  const [objetos, setObjetos] = useState<ObjetoPerdido[]>([])
  const [agenda, setAgenda] = useState<AgendaItem[]>([])
  // Fase 4
  const [inventario, setInventario] = useState<ItemInventario[]>([])
  const [polizas, setPolizas] = useState<PolizaSeguro[]>([])
  const [inspecciones, setInspecciones] = useState<InspeccionNormativa[]>([])
  const [personal, setPersonal] = useState<PersonalCondominio[]>([])
  // Fase 5
  const [contactosEmergencia, setContactosEmergencia] = useState<ContactoEmergencia[]>([])
  const [mudanzas, setMudanzas] = useState<Mudanza[]>([])
  const [documentos, setDocumentos] = useState<DocumentoCondominio[]>([])
  const [residuos, setResiduos] = useState<RegistroResiduo[]>([])
  // Fase 6
  const [bodegas, setBodegas] = useState<BodegaCondominio[]>([])
  const [onboardings, setOnboardings] = useState<OnboardingResidente[]>([])
  const [propuestas, setPropuestas] = useState<PropuestaInversion[]>([])
  const [memorias, setMemorias] = useState<MemoriaLabores[]>([])
  // Fase 7
  const [reservasSTR, setReservasSTR] = useState<ReservaSTR[]>([])
  const [locales, setLocales] = useState<LocalComercial[]>([])
  const [serviciosHK, setServiciosHK] = useState<ServicioHousekeeping[]>([])

  const proyectosActivos = proyectos.filter(p => p.estado === 'activo')

  useEffect(() => {
    if (proyectosActivos.length > 0 && !selectedProyectoId) {
      setSelectedProyectoId(proyectosActivos[0].id)
    }
  }, [proyectosActivos.length])

  const cargarDatos = useCallback(async () => {
    if (!selectedProyectoId || !currentUser.company_id) return
    setLoading(true)

    const pid = selectedProyectoId
    const cid = currentUser.company_id

    const [
      cuotasRes, visitantesRes, amenidadesRes, reservasRes, ticketsRes, anunciosRes,
      parqueosRes, mascotasRes, paquetesRes, infraccionesRes, rondasRes, novedadesRes, contratosRes,
      asambleasRes, contratosProvRes, objetosRes, agendaRes,
      inventarioRes, polizasRes, inspeccionesRes, personalRes,
      contactosEmergRes, mudanzasRes, documentosRes, residuosRes,
      bodegasRes, onboardingsRes, propuestasRes, memoriasRes,
      strRes, localesRes, hkRes,
    ] = await Promise.all([
      supabase.from('cuotas_condominio').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
      supabase.from('visitantes').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('hora_entrada', { ascending: false }).limit(200),
      supabase.from('amenidades').select('*').eq('project_id', pid).eq('company_id', cid).order('nombre'),
      supabase.from('reservas_amenidades').select('*, amenidades(nombre), unidades(nombre)').eq('company_id', cid).order('fecha', { ascending: false }).limit(200),
      supabase.from('tickets_mantenimiento').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
      supabase.from('anuncios_comunidad').select('*, app_users(nombre_completo)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
      supabase.from('parqueos_condominio').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('numero'),
      supabase.from('mascotas').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('nombre'),
      supabase.from('paquetes_recibidos').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('hora_recepcion', { ascending: false }).limit(200),
      supabase.from('infracciones_condominio').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
      supabase.from('rondas_seguridad').select('*').eq('project_id', pid).eq('company_id', cid).order('inicio', { ascending: false }).limit(100),
      supabase.from('novedades_seguridad').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }).limit(200),
      supabase.from('contratos_arrendamiento').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
      supabase.from('asambleas').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
      supabase.from('contratos_proveedores').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
      supabase.from('objetos_perdidos').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_encontrado', { ascending: false }),
      supabase.from('agenda_operativa').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha').order('hora_inicio'),
      supabase.from('inventario_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('categoria').order('nombre'),
      supabase.from('polizas_seguro').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_vencimiento'),
      supabase.from('inspecciones_normativas').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
      supabase.from('personal_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('cargo').order('nombre'),
      supabase.from('contactos_emergencia').select('*').eq('project_id', pid).eq('company_id', cid).order('orden').order('nombre'),
      supabase.from('mudanzas').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
      supabase.from('documentos_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('categoria').order('titulo'),
      supabase.from('registros_residuos').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
      supabase.from('bodegas_condominio').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('numero'),
      supabase.from('onboarding_residentes').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha_ingreso', { ascending: false }),
      supabase.from('propuestas_inversion').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
      supabase.from('memoria_labores').select('*').eq('project_id', pid).eq('company_id', cid).order('periodo', { ascending: false }),
      supabase.from('reservas_str').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha_entrada', { ascending: false }),
      supabase.from('locales_comerciales').select('*').eq('project_id', pid).eq('company_id', cid).order('numero_local'),
      supabase.from('servicios_housekeeping').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    ])

    const mapUnidad = <T extends object>(data: Record<string, unknown>[]): T[] =>
      data.map(r => ({ ...r, unidad_nombre: (r.unidades as { nombre: string } | null)?.nombre } as T))

    setCuotas(mapUnidad<CuotaCondominio>(cuotasRes.data ?? []))
    setVisitantes(mapUnidad<Visitante>(visitantesRes.data ?? []))
    setAmenidades((amenidadesRes.data ?? []) as Amenidad[])
    setReservas((reservasRes.data ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      amenidad_nombre: (r.amenidades as { nombre: string } | null)?.nombre,
      unidad_nombre: (r.unidades as { nombre: string } | null)?.nombre,
    } as ReservaAmenidad)))
    setTickets(mapUnidad<TicketMantenimiento>(ticketsRes.data ?? []))
    setAnuncios((anunciosRes.data ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      publicado_por_nombre: (r.app_users as { nombre_completo: string } | null)?.nombre_completo,
    } as AnuncioComunidad)))
    setParqueos(mapUnidad<ParqueoCondominio>(parqueosRes.data ?? []))
    setMascotas(mapUnidad<Mascota>(mascotasRes.data ?? []))
    setPaquetes(mapUnidad<PaqueteRecibido>(paquetesRes.data ?? []))
    setInfracciones(mapUnidad<InfraccionCondominio>(infraccionesRes.data ?? []))
    setRondas((rondasRes.data ?? []) as RondaSeguridad[])
    setNovedades((novedadesRes.data ?? []) as NovedadSeguridad[])
    setContratos(mapUnidad<ContratoArrendamiento>(contratosRes.data ?? []))
    setAsambleas((asambleasRes.data ?? []) as Asamblea[])
    setContratosProveedores((contratosProvRes.data ?? []) as ContratoProveedor[])
    setObjetos((objetosRes.data ?? []) as ObjetoPerdido[])
    setAgenda((agendaRes.data ?? []) as AgendaItem[])
    setInventario((inventarioRes.data ?? []) as ItemInventario[])
    setPolizas((polizasRes.data ?? []) as PolizaSeguro[])
    setInspecciones((inspeccionesRes.data ?? []) as InspeccionNormativa[])
    setPersonal((personalRes.data ?? []) as PersonalCondominio[])
    setContactosEmergencia((contactosEmergRes.data ?? []) as ContactoEmergencia[])
    setMudanzas((mudanzasRes.data ?? []).map((r: Record<string, unknown>) => ({
      ...r, unidad_nombre: (r.unidades as { nombre: string } | null)?.nombre,
    } as Mudanza)))
    setDocumentos((documentosRes.data ?? []) as DocumentoCondominio[])
    setResiduos((residuosRes.data ?? []) as RegistroResiduo[])
    setBodegas(mapUnidad<BodegaCondominio>(bodegasRes.data ?? []))
    setOnboardings(mapUnidad<OnboardingResidente>(onboardingsRes.data ?? []))
    setPropuestas((propuestasRes.data ?? []) as PropuestaInversion[])
    setMemorias((memoriasRes.data ?? []) as MemoriaLabores[])
    setReservasSTR(mapUnidad<ReservaSTR>(strRes.data ?? []))
    setLocales((localesRes.data ?? []) as LocalComercial[])
    setServiciosHK(mapUnidad<ServicioHousekeeping>(hkRes.data ?? []))

    setLoading(false)
  }, [selectedProyectoId, currentUser.company_id])

  useEffect(() => { cargarDatos() }, [cargarDatos])

  const unidadesProyecto = unidades.filter(u => u.project_id === selectedProyectoId)
  const proyectoActual = proyectos.find(p => p.id === selectedProyectoId)
  const moneda = proyectoActual?.moneda ?? 'Q'
  const cid = currentUser.company_id ?? ''
  const uid = currentUser.user_id

  if (proyectosActivos.length === 0) {
    return (
      <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🏢</div>
        <p style={{ fontSize: '16px', fontWeight: 600, color: '#64748b' }}>No hay proyectos activos</p>
        <p style={{ fontSize: '13px' }}>Crea un proyecto en "Mis Proyectos" para comenzar a usar el módulo Condominios.</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Header */}
      <div style={{ padding: '16px 24px 0', borderBottom: '1px solid #e2e8f0', background: 'white', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '20px' }}>🏢</span>
            <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>Condominios</h1>
          </div>
          {proyectosActivos.length > 1 && (
            <select value={selectedProyectoId} onChange={e => setSelectedProyectoId(e.target.value)}
              style={{ padding: '6px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc', color: '#374151', fontWeight: 500 }}>
              {proyectosActivos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          )}
          {proyectosActivos.length === 1 && (
            <span style={{ fontSize: '14px', color: '#64748b', fontWeight: 500 }}>{proyectoActual?.nombre}</span>
          )}
          {loading && <span style={{ fontSize: '12px', color: '#94a3b8' }}>Cargando...</span>}
        </div>

        {/* Sub-tabs scrollable */}
        <div style={{ display: 'flex', gap: '2px', overflowX: 'auto', paddingBottom: '1px' }}>
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '8px 14px', borderRadius: '8px 8px 0 0', border: 'none', cursor: 'pointer',
                fontSize: '13px', fontWeight: activeTab === tab.id ? 700 : 500,
                background: activeTab === tab.id ? '#f8fafc' : 'transparent',
                color: activeTab === tab.id ? '#0ea5e9' : '#64748b',
                borderBottom: activeTab === tab.id ? '2px solid #0ea5e9' : '2px solid transparent',
                whiteSpace: 'nowrap',
              }}>
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {activeTab === 'panel' && <PanelGeneralTab cuotas={cuotas} tickets={tickets} visitantes={visitantes} amenidades={amenidades} moneda={moneda} />}

        {activeTab === 'cuotas' && <CuotasTab cuotas={cuotas} unidades={unidadesProyecto} proyectos={proyectosActivos} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'visitantes' && <VisitantesTab visitantes={visitantes} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} userId={uid} canCreate={canCreate('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'amenidades' && <AmenidadesTab amenidades={amenidades} reservas={reservas} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} userId={uid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'mantenimiento' && <MantenimientoTab tickets={tickets} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} userId={uid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'comunidad' && <ComunidadTab anuncios={anuncios} proyectoId={selectedProyectoId} companyId={cid} userId={uid} canCreate={canCreate('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'parqueos' && <ParqueosTab parqueos={parqueos} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'mascotas' && <MascotasTab mascotas={mascotas} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'paqueteria' && <PaqueteriaTab paquetes={paquetes} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} userId={uid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'infracciones' && <InfraccionesTab infracciones={infracciones} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} userId={uid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'seguridad' && <SeguridadTab rondas={rondas} novedades={novedades} proyectoId={selectedProyectoId} companyId={cid} userId={uid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'arrendamientos' && <ArrendamientosTab contratos={contratos} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'asambleas' && <AsambleasTab asambleas={asambleas} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} userId={uid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'proveedores' && <ProveedoresTab contratos={contratosProveedores} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'objetos' && <ObjetosTab objetos={objetos} proyectoId={selectedProyectoId} companyId={cid} userId={uid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'agenda' && <AgendaTab agenda={agenda} proyectoId={selectedProyectoId} companyId={cid} userId={uid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'inventario' && <InventarioTab inventario={inventario} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'polizas' && <PolizasTab polizas={polizas} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'inspecciones' && <InspeccionesTab inspecciones={inspecciones} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'personal' && <PersonalTab personal={personal} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'emergencias' && <EmergenciasTab contactos={contactosEmergencia} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'mudanzas' && <MudanzasTab mudanzas={mudanzas} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'documentos' && <DocumentosTab documentos={documentos} proyectoId={selectedProyectoId} companyId={cid} userId={uid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'residuos' && <ResiduosTab residuos={residuos} proyectoId={selectedProyectoId} companyId={cid} userId={uid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'bodegas' && <BodegasTab bodegas={bodegas} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'onboarding' && <OnboardingTab onboardings={onboardings} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'propuestas' && <PropuestasTab propuestas={propuestas} proyectoId={selectedProyectoId} companyId={cid} userId={uid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'memoria' && <MemoriaTab memorias={memorias} proyectoId={selectedProyectoId} companyId={cid} userId={uid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'str' && <STRTab reservasSTR={reservasSTR} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'locales' && <LocalesTab locales={locales} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'sostenibilidad' && <SostenibilidadTab residuos={residuos} proyectoId={selectedProyectoId} companyId={cid} />}

        {activeTab === 'housekeeping' && <HousekeepingTab servicios={serviciosHK} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
      </div>
    </div>
  )
}
