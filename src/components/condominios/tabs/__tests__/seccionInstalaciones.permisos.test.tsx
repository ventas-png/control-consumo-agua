// Sección instalaciones (supabase/rls-acciones/instalaciones.json): cada
// pestaña ofrece una acción sólo con el permiso que la base exige para ella.
//
//   · Eliminar exige canDelete (condominios.tab.<tab>.delete): editar no
//     basta, y sin editar sí se borra. Antes lo decidía canEdit —o nada, en
//     Consumo de energía— y la base sólo dejaba borrar a company_owner/admin.
//   · El recordatorio de una reserva abre WhatsApp para cualquiera que vea el
//     tab, pero marcarla como recordada es editarla: sólo con canEdit (el
//     UPDATE de reservas pasa a exigir amenidades.edit).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type {
  Amenidad, BloqueoAmenidad, BodegaCondominio, ConsumoEnergiaArea, LlaveCondominio, ParqueoCondominio, ReservaAmenidad, Unidad,
} from '../../../../types'
import { eliminarExigeSuPermiso } from '../../../../test/eliminarExigeSuPermiso'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRow: vi.fn(async () => ({ error: null })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  createCondominioRowReturning: vi.fn(async () => ({ data: null, error: null })),
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
}))
vi.mock('../../../../domain/contabilidad/ajustes', () => ({
  solicitarAjuste: vi.fn(), cancelarReservaConTarifa: vi.fn(), avisoCancelacionReserva: vi.fn(() => ''),
}))
vi.mock('../../../../lib/storageUrls', () => ({ useSignedUrls: () => ({}), useSignedUrl: () => null }))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))

const { I18nProvider } = await import('../../../../lib/i18n')
const { AmenidadesTab } = await import('../AmenidadesTab')
const { ParqueosTab } = await import('../ParqueosTab')
const { BodegasTab } = await import('../BodegasTab')
const { LlavesTab } = await import('../LlavesTab')
const { ConsumoEnergiaAreasTab } = await import('../ConsumoEnergiaAreasTab')

const conI18n = (ui: ReactNode) => render(<I18nProvider>{ui}</I18nProvider>)
const unidades = [{ id: 'un1', nombre: 'Casa 4', activo: true, propietario_nombre: 'Ana', propietario_telefono: '55551234' }] as unknown as Unidad[]
const base = { proyectoId: 'p1', companyId: 'co1', onRefresh: () => {} }
const como = <T,>(o: Record<string, unknown>) => o as unknown as T
const creado = { created_at: '2026-10-10T00:00:00Z' }

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

const amenidad = como<Amenidad>({ id: 'am1', nombre: 'Piscina', tipo: 'piscina', capacidad: 20, activo: true, requiere_aprobacion: false, ...creado })
const montarAmenidades = (p: { canEdit: boolean; canDelete: boolean }, extra: Record<string, unknown> = {}) => render(
  <AmenidadesTab {...base} userId="u1" moneda="Q" unidades={unidades} amenidades={[amenidad]} reservas={[]} bloqueos={[]} canCreate {...p} {...extra} />,
)

eliminarExigeSuPermiso('Amenidades', p => montarAmenidades(p), /^Eliminar Piscina$/, mocks.deleteCondominioRow, 'amenidades', 'am1')

eliminarExigeSuPermiso('Amenidades (bloqueos)', p => {
  montarAmenidades(p, { bloqueos: [como<BloqueoAmenidad>({ id: 'bl1', amenidad_id: 'am1', amenidad_nombre: 'Piscina', fecha_inicio: '2099-01-01', fecha_fin: '2099-01-02', motivo: 'mantenimiento', ...creado })] })
  fireEvent.click(screen.getByRole('button', { name: '🚫 Bloqueos' }))
}, /^Eliminar bloqueo de Piscina$/, mocks.deleteCondominioRow, 'amenidades_bloqueos', 'bl1')

eliminarExigeSuPermiso('Parqueos', p => render(
  <ParqueosTab {...base} unidades={unidades} canCreate {...p}
    parqueos={[como<ParqueoCondominio>({ id: 'pq1', numero: 'P-12', tipo: 'asignado', activo: true, ...creado })]} />,
), /^Eliminar parqueo P-12$/, mocks.deleteCondominioRow, 'parqueos_condominio', 'pq1')

eliminarExigeSuPermiso('Bodegas', p => conI18n(
  <BodegasTab {...base} moneda="Q" unidades={unidades} canCreate {...p}
    bodegas={[como<BodegaCondominio>({ id: 'bo1', numero: 'B-3', estado: 'disponible', ...creado })]} />,
), /^(Eliminar|Delete)$/, mocks.deleteCondominioRow, 'bodegas_condominio', 'bo1')

eliminarExigeSuPermiso('Llaves', p => conI18n(
  <LlavesTab {...base} moneda="Q" unidades={unidades} canCreate {...p}
    llaves={[como<LlaveCondominio>({ id: 'll1', codigo: 'L-7', tipo: 'fisica', estado: 'activa', cantidad: 1, descripcion: 'Portón principal', fecha_entrega: '2026-10-01', deposito_pagado: false, monto_deposito: 0, ...creado })]} />,
), /^(Eliminar|Delete)$/, mocks.deleteCondominioRow, 'llaves_condominio', 'll1')

eliminarExigeSuPermiso('Consumo de energía', p => render(
  <ConsumoEnergiaAreasTab {...base} moneda="Q" canCreate {...p}
    consumos={[como<ConsumoEnergiaArea>({ id: 'ce1', area: 'Lobby', tipo: 'electricidad', periodo: '2026-09', lectura_anterior: 100, lectura_actual: 220, unidad: 'kWh', costo_unitario: 2.5, total_costo: 300, fecha_lectura: '2026-09-30', ...creado })]} />,
), /^Eliminar registro$/, mocks.deleteCondominioRow, 'consumo_energia_areas', 'ce1')

describe('Amenidades — marcar el recordatorio exige canEdit', () => {
  // La vista de recordatorios lista las reservas de hoy a dos días.
  const d = new Date()
  const hoy = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const reserva = como<ReservaAmenidad>({
    id: 'rv1', amenidad_id: 'am1', amenidad_nombre: 'Piscina', unidad_id: 'un1', unidad_nombre: 'Casa 4',
    fecha: hoy, hora_inicio: '08:00', hora_fin: '09:00', estado: 'confirmada', recordatorio_enviado: false, ...creado,
  })
  const enviar = (canEdit: boolean) => {
    vi.spyOn(window, 'open').mockImplementation(() => null)
    montarAmenidades({ canEdit, canDelete: false }, { reservas: [reserva] })
    fireEvent.click(screen.getByRole('button', { name: '📨 Recordatorios' }))
    fireEvent.click(screen.getByRole('button', { name: /Enviar WhatsApp/ }))
  }
  it('sin canEdit abre WhatsApp pero no marca la reserva', async () => {
    enviar(false)
    await waitFor(() => expect(window.open).toHaveBeenCalled())
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
  })
  it('con canEdit marca la reserva como recordada', async () => {
    enviar(true)
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('reservas_amenidades', 'rv1', expect.objectContaining({ recordatorio_enviado: true })))
  })
})
