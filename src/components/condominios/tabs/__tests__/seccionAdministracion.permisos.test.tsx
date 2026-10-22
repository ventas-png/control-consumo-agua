// Sección administración (supabase/rls-acciones/administracion.json): Eliminar
// se ofrece y se ejecuta con canDelete (condominios.tab.<tab>.delete), lo mismo
// que exige la base. Editar no basta, y sin editar sí se borra. Antes lo
// decidía canEdit y la base sólo dejaba borrar a company_owner/admin.
// Seguridad, que también registra y borra novedades del libro, sigue la misma
// regla.
import { vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { Unidad } from '../../../../types'
import { eliminarExigeSuPermiso } from '../../../../test/eliminarExigeSuPermiso'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRow: vi.fn(async () => ({ error: null })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabQueries', () => ({ fetchVisitantesPorDpi: vi.fn(async () => []) }))
vi.mock('../../../../lib/validatedInsert', () => ({ validatedInsert: vi.fn(async () => ({ error: null })) }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
  marcarCuotasMorosas: vi.fn(async () => ({ error: null })),
}))
vi.mock('../../../../lib/storageUrls', () => ({ useSignedUrl: () => null, useSignedUrls: () => ({}) }))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))
vi.mock('../../exportUtils', () => ({ exportarPDFTabla: vi.fn(), exportarExcel: vi.fn() }))

const { PolizasTab } = await import('../PolizasTab')
const { InspeccionesTab } = await import('../InspeccionesTab')
const { PropuestasTab } = await import('../PropuestasTab')
const { default: PlantillasMensajeTab } = await import('../PlantillasMensajeTab')
const { LibroNovedadesTab } = await import('../LibroNovedadesTab')
const { MemoriaTab } = await import('../MemoriaTab')
const { FirmaDigitalTab } = await import('../FirmaDigitalTab')
const { NotificacionesTab } = await import('../NotificacionesTab')
const { default: AutomatizacionesTab } = await import('../AutomatizacionesTab')
const { default: NotasAdminTab } = await import('../NotasAdminTab')
const { DocumentosTab } = await import('../DocumentosTab')
const { SeguridadTab } = await import('../SeguridadTab')

const unidades = [{ id: 'un1', nombre: 'Casa 4', activo: true }] as unknown as Unidad[]
const base = { proyectoId: 'p1', companyId: 'co1', onRefresh: () => {} }
/** Una fila de prueba: sólo los campos que la pestaña lee. */
const fila = (o: Record<string, unknown>) => ({ created_at: '2026-10-10T00:00:00Z', ...o }) as never
const borrar = mocks.deleteCondominioRow

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

eliminarExigeSuPermiso('Pólizas', p => render(
  <PolizasTab {...base} moneda="Q" canCreate {...p}
    polizas={[fila({ id: 'po1', numero_poliza: 'POL-77', aseguradora: 'Seguros GT', tipo: 'incendio', fecha_inicio: '2026-01-01', fecha_vencimiento: '2099-01-01', estado: 'vigente', prima: 1000, cobertura: 50000 })]} />,
), /^Eliminar POL-77$/, borrar, 'polizas_seguro', 'po1')

eliminarExigeSuPermiso('Inspecciones', p => render(
  <InspeccionesTab {...base} canCreate {...p}
    inspecciones={[fila({ id: 'in1', tipo: 'bomberos', fecha: '2026-09-01', resultado: 'aprobado', inspector: 'Ing. Ruiz' })]} />,
), /^Eliminar inspección del 2026-09-01$/, borrar, 'inspecciones_normativas', 'in1')

eliminarExigeSuPermiso('Propuestas', p => render(
  <PropuestasTab {...base} userId="u1" moneda="Q" canCreate {...p}
    propuestas={[fila({ id: 'pr1', titulo: 'Paneles solares', categoria: 'mejora', prioridad: 'media', monto_estimado: 9000, estado: 'propuesta', votos_favor: 0, votos_contra: 0 })]} />,
), /^Eliminar Paneles solares$/, borrar, 'propuestas_inversion', 'pr1')

eliminarExigeSuPermiso('Plantillas de mensaje', p => render(
  <PlantillasMensajeTab {...base} canCreate {...p}
    plantillas={[fila({ id: 'pm1', nombre: 'Aviso general', canal: 'whatsapp', categoria: 'general', cuerpo: 'Hola', variables: [], activa: true })]} />,
), /^Eliminar Aviso general$/, borrar, 'plantillas_mensaje_cond', 'pm1')

eliminarExigeSuPermiso('Libro de novedades', p => render(
  <LibroNovedadesTab {...base} canCreate {...p}
    novedades={[fila({ id: 'ln1', fecha: '2026-10-01', turno: 'mañana', responsable: 'Pedro', novedades: 'Sin novedad', incidentes: [], firmado: false })]} />,
), /^Eliminar entrada del 2026-10-01/, borrar, 'libro_novedades', 'ln1')

eliminarExigeSuPermiso('Memoria de labores', p => render(
  <MemoriaTab {...base} userId="u1" canCreate {...p}
    memorias={[fila({ id: 'me1', titulo: 'Memoria 2025', periodo: '2025', estado: 'borrador', contenido: '…' })]} />,
), /^Eliminar Memoria 2025$/, borrar, 'memoria_labores', 'me1')

eliminarExigeSuPermiso('Firmas', p => render(
  <FirmaDigitalTab {...base} unidades={unidades} canCreate {...p}
    firmas={[fila({ id: 'fi1', documento_titulo: 'Contrato de obra', documento_tipo: 'contrato', firmante_nombre: 'Ana', estado: 'pendiente' })]} />,
), /^Eliminar Contrato de obra$/, borrar, 'firmas_digitales', 'fi1')

eliminarExigeSuPermiso('Notificaciones', p => render(
  <NotificacionesTab {...base} canCreate {...p}
    reglas={[fila({ id: 'rn1', nombre: 'Aviso de mora', evento: 'cuota_vencida', canal: 'email', dias_anticipacion: 3, activo: true })]} />,
), /^Eliminar Aviso de mora$/, borrar, 'reglas_notificacion', 'rn1')

eliminarExigeSuPermiso('Automatizaciones', p => render(
  <AutomatizacionesTab {...base} cuotas={[]} tickets={[]} canCreate {...p}
    automatizaciones={[fila({ id: 'au1', nombre: 'Mora automática', trigger_tipo: 'cuota_vencida_dias', trigger_valor: 5, accion_tipo: 'marcar_moroso', activa: true })]} />,
), /^Eliminar Mora automática$/, borrar, 'automatizaciones_cond', 'au1')

eliminarExigeSuPermiso('Notas', p => {
  render(<NotasAdminTab {...base} autorNombre="Admin" canCreate {...p}
    notas={[fila({ id: 'no1', titulo: 'Llamar al proveedor', contenido: 'Pendiente', categoria: 'general', prioridad: 'media', fijada: false, resuelta: false })]} />)
  fireEvent.click(screen.getByText('Llamar al proveedor'))
}, /Eliminar$/, borrar, 'notas_admin', 'no1')

eliminarExigeSuPermiso('Documentos', p => render(
  <DocumentosTab {...base} userId="u1" canCreate {...p}
    documentos={[fila({ id: 'do1', titulo: 'Reglamento interno', categoria: 'reglamento', visibilidad: 'todos', vigente: true, url: 'docs/r.pdf' })]} />,
), /^Eliminar Reglamento interno$/, borrar, 'documentos_condominio', 'do1')

eliminarExigeSuPermiso('Seguridad (novedades)', p => render(
  <SeguridadTab {...base} userId="u1" unidades={unidades} rondas={[]} rutas={[]} puntosControl={[]} visitasControl={[]} areas={[]} visitantes={[]} reservasSTR={[]} canCreate {...p}
    novedades={[fila({ id: 'ns1', tipo: 'incidente', prioridad: 'alta', descripcion: 'Portón abierto', ubicacion: 'Garita', fotos: [] })]} />,
), /^Eliminar novedad$/, borrar, 'novedades_seguridad', 'ns1')
