// Sección comunidad (supabase/rls-acciones/comunidad.json): cada pestaña ofrece
// una acción sólo con el permiso que la base exige para ella.
//
//   · Eliminar exige canDelete (condominios.tab.<tab>.delete): editar no
//     basta, y sin editar sí se borra. Antes lo decidía canEdit —o nada, en
//     Comunidad e Infracciones— y la base sólo dejaba borrar a company_owner/admin.
//   · Lo que antes se ofrecía a quien sólo consulta pide ahora su acción:
//     activar un anuncio (editar), registrar una respuesta de encuesta (crear),
//     completar un recordatorio y guardar el acta de una asamblea digital (editar).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type {
  ActaReunion, AgendaItem, AnuncioComunidad, ComunicadoCondominio, Encuesta, EventoCalendario,
  EventoComunidad, InfraccionCondominio, MiembroJunta, RecordatorioCondominio, SeguimientoAcuerdo, Unidad,
} from '../../../../types'
import { eliminarExigeSuPermiso } from '../../../../test/eliminarExigeSuPermiso'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  upsertCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRowBy: vi.fn(async () => ({ error: null })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  upsertCondominioRow: mocks.upsertCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
  deleteCondominioRowBy: mocks.deleteCondominioRowBy,
}))
vi.mock('../../../../domain/portal/queries', () => ({ fetchAnuncioLecturas: vi.fn(async () => ({})) }))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))

const { I18nProvider } = await import('../../../../lib/i18n')
const { ComunidadTab } = await import('../ComunidadTab')
const { ActasTab } = await import('../ActasTab')
const { AgendaTab } = await import('../AgendaTab')
const { ComunicadosTab } = await import('../ComunicadosTab')
const { EncuestasTab } = await import('../EncuestasTab')
const { CalendarioTab } = await import('../CalendarioTab')
const { EventosComunidadTab } = await import('../EventosComunidadTab')
const { InfraccionesTab } = await import('../InfraccionesTab')
const { JuntaTab } = await import('../JuntaTab')
const { default: RecordatoriosTab } = await import('../RecordatoriosTab')
const { SeguimientoAcuerdosTab } = await import('../SeguimientoAcuerdosTab')

const conI18n = (ui: ReactNode) => render(<I18nProvider>{ui}</I18nProvider>)
const unidades = [{ id: 'un1', nombre: 'Casa 4', activo: true }] as unknown as Unidad[]
const base = { proyectoId: 'p1', companyId: 'co1', onRefresh: () => {} }
const como = <T,>(o: Record<string, unknown>) => o as unknown as T
const creado = { created_at: '2026-10-10T00:00:00Z' }

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

const anuncio = como<AnuncioComunidad>({ id: 'an1', titulo: 'Corte programado', contenido: 'Sin agua de 8 a 12', tipo: 'aviso', activo: true, fecha_evento: null, foto_url: null, ...creado })
eliminarExigeSuPermiso('Comunidad', p => render(
  <ComunidadTab {...base} userId="u1" anuncios={[anuncio]} canCreate {...p} />,
), /^Eliminar Corte programado$/, mocks.deleteCondominioRow, 'anuncios_comunidad', 'an1')

eliminarExigeSuPermiso('Actas', p => render(
  <ActasTab {...base} canCreate {...p}
    actas={[como<ActaReunion>({ id: 'ac1', titulo: 'Asamblea Q1', tipo: 'ordinaria', fecha: '2026-03-15', asistentes: [], orden_del_dia: [], aprobada: false, ...creado })]} />,
), /^Eliminar Asamblea Q1$/, mocks.deleteCondominioRow, 'actas_reunion', 'ac1')

eliminarExigeSuPermiso('Agenda', p => render(
  <AgendaTab {...base} userId="u1" canCreate {...p}
    agenda={[como<AgendaItem>({ id: 'ag1', titulo: 'Revisar bombas', tipo: 'tarea', fecha: '2099-01-10', estado: 'pendiente', prioridad: 'media', ...creado })]} />,
), /^Eliminar Revisar bombas$/, mocks.deleteCondominioRow, 'agenda_operativa', 'ag1')

eliminarExigeSuPermiso('Comunicados', p => render(
  <ComunicadosTab {...base} userId="u1" unidades={[]} canCreate canDelete={p.canDelete}
    comunicados={[como<ComunicadoCondominio>({ id: 'c1', titulo: 'Corte de agua', contenido: 'Mañana', tipo: 'aviso', destinatario: 'todos', fecha_envio: '2026-10-20', firmado: false })]} />,
), /^Eliminar Corte de agua$/, mocks.deleteCondominioRow, 'comunicados_condominio', 'c1')

const encuesta = como<Encuesta>({ id: 'en1', titulo: 'Satisfacción', preguntas: [], estado: 'activa', fecha_inicio: null, fecha_fin: null, ...creado })
eliminarExigeSuPermiso('Encuestas', p => render(
  <EncuestasTab {...base} unidades={unidades} respuestas={[]} encuestas={[encuesta]} canCreate {...p} />,
), /^Eliminar Satisfacción$/, mocks.deleteCondominioRow, 'encuestas', 'en1')

// El calendario abre en el mes de hoy: el evento cae el día 15 de este mes.
const hoy = new Date()
const dia15 = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-15`
eliminarExigeSuPermiso('Calendario', p => {
  render(<CalendarioTab {...base} asambleas={[]} agenda={[]} canCreate canDelete={p.canDelete}
    eventos={[como<EventoCalendario>({ id: 'ca1', titulo: 'Fumigación', tipo: 'mantenimiento', fecha_inicio: dia15, color: 'var(--at-warning)', todo_el_dia: true, ...creado })]} />)
  fireEvent.click(screen.getByRole('button', { name: /15 de .*1 evento/ }))
}, /^Eliminar Fumigación$/, mocks.deleteCondominioRow, 'eventos_calendario', 'ca1')

eliminarExigeSuPermiso('Eventos de la comunidad', p => render(
  <EventosComunidadTab {...base} unidades={unidades} asistentes={[]} canCreate {...p}
    eventos={[como<EventoComunidad>({ id: 'ev1', titulo: 'Kermés', tipo: 'social', fecha: '2099-03-01', estado: 'programado', ...creado })]} />,
), /^Eliminar Kermés$/, mocks.deleteCondominioRow, 'eventos_comunidad', 'ev1')

eliminarExigeSuPermiso('Infracciones', p => conI18n(
  <InfraccionesTab {...base} userId="u1" moneda="Q" unidades={unidades} canCreate {...p}
    infracciones={[como<InfraccionCondominio>({ id: 'in1', unidad_id: 'un1', unidad_nombre: 'Casa 4', tipo: 'ruido', descripcion: 'Música alta', fecha: '2026-10-01', estado: 'emitida', monto_multa: 0, ...creado })]} />,
), /^(Eliminar|Delete)$/, mocks.deleteCondominioRow, 'infracciones_condominio', 'in1')

eliminarExigeSuPermiso('Junta', p => render(
  <JuntaTab {...base} unidades={unidades} canCreate {...p}
    junta={[como<MiembroJunta>({ id: 'j1', nombre: 'Ana Pérez', cargo: 'presidente', activo: true, periodo_inicio: '2026-01-01', ...creado })]} />,
), /^Eliminar Ana Pérez$/, mocks.deleteCondominioRow, 'junta_directiva', 'j1')

const recordatorio = como<RecordatorioCondominio>({ id: 'r1', titulo: 'Renovar póliza', fecha_limite: '2099-05-01', prioridad: 'alta', completado: false, ...creado })
eliminarExigeSuPermiso('Recordatorios', p => render(
  <RecordatoriosTab {...base} userId="u1" autorNombre="Admin" recordatorios={[recordatorio]} canCreate {...p} />,
), /^Eliminar Renovar póliza$/, mocks.deleteCondominioRow, 'recordatorios_condominio', 'r1')

eliminarExigeSuPermiso('Seguimiento de acuerdos', p => render(
  <SeguimientoAcuerdosTab {...base} actas={[]} canCreate {...p}
    acuerdos={[como<SeguimientoAcuerdo>({ id: 'sa1', titulo: 'Pintar fachada', estado: 'pendiente', fecha_limite: '2099-06-01', ...creado })]} />,
), /^Eliminar Pintar fachada$/, mocks.deleteCondominioRow, 'seguimiento_acuerdos', 'sa1')

describe('Comunidad — activar o desactivar un anuncio exige canEdit', () => {
  const montar = (canEdit: boolean) => render(
    <ComunidadTab {...base} userId="u1" anuncios={[anuncio]} canCreate canEdit={canEdit} canDelete={false} />,
  )
  it('sin canEdit no se ofrece', () => {
    montar(false)
    expect(screen.queryByRole('button', { name: /Activo|Inactivo/ })).toBeNull()
  })
  it('con canEdit lo desactiva', async () => {
    montar(true)
    fireEvent.click(screen.getByRole('button', { name: /Activo/ }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('anuncios_comunidad', 'an1', { activo: false }))
  })
})

describe('Encuestas — registrar una respuesta exige canCreate', () => {
  const abrir = (canCreate: boolean) => {
    render(<EncuestasTab {...base} unidades={unidades} respuestas={[]} encuestas={[encuesta]} canCreate={canCreate} canEdit={false} canDelete={false} />)
    fireEvent.click(screen.getByRole('button', { name: /^Satisfacción/ }))
    return screen.getByRole('dialog')
  }
  it('sin canCreate no hay «+ Respuesta»', () => {
    expect(within(abrir(false)).queryByRole('button', { name: '+ Respuesta' })).toBeNull()
  })
  it('con canCreate se registra la respuesta', async () => {
    const dialog = abrir(true)
    fireEvent.click(within(dialog).getByRole('button', { name: '+ Respuesta' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar Respuesta' }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('respuestas_encuesta', expect.objectContaining({ encuesta_id: 'en1' })))
  })
})

describe('Recordatorios — completar exige canEdit', () => {
  const montar = (canEdit: boolean) => render(
    <RecordatoriosTab {...base} userId="u1" autorNombre="Admin" recordatorios={[recordatorio]} canCreate={false} canEdit={canEdit} canDelete={false} />,
  )
  it('sin canEdit la casilla sólo muestra el estado', () => {
    montar(false)
    const casilla = screen.getByRole('checkbox', { name: 'Completado: Renovar póliza' }) as HTMLInputElement
    expect(casilla.disabled).toBe(true)
    fireEvent.click(casilla)
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
  })
  it('con canEdit lo marca completado', async () => {
    montar(true)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Completado: Renovar póliza' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('recordatorios_condominio', 'r1', expect.objectContaining({ completado: true })))
  })
})

