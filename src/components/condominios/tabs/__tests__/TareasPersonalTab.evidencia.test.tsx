// El cierre de una tarea deja de ser a ciegas (20260905000400).
//
// Lo que se cubre es lo de la VISTA, que el sandbox SQL no puede ver: que la
// pantalla NO llame a la base cuando falta evidencia (el trigger la rechazaría
// igual, pero el operativo merece saber qué le falta sin esperar el viaje), que
// muestre las instrucciones de seguridad ANTES de empezar, que marcar un paso
// se guarde al instante, y que el error del trigger se traduzca en vez de
// mostrarle a un conserje el texto crudo de Postgres.
//
// El tab no tenía ninguna prueba hasta ahora — que es coherente con que
// `requiere_foto` llevara año y medio sin exigirse.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type {
  AreaCondominio, BloqueTurno, PersonalCondominio, PlantillaTareaCargo, TareaBloque,
} from '../../../../types'

type RowError = { message: string; code?: string } | null

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null as RowError })),
  createCondominioRowReturning: vi.fn(async () => ({ data: null, error: null as RowError })),
  updateCondominioRow: vi.fn(async () => ({ error: null as RowError })),
  deleteCondominioRow: vi.fn(async () => ({ error: null as RowError })),
  openPromptDialog: vi.fn(async () => null as Record<string, string> | null),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({
  supabase: { from: () => ({}) },
  db: { from: () => ({}) },
}))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  createCondominioRowReturning: mocks.createCondominioRowReturning,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
}))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))
vi.mock('../../../shared/PromptDialog', () => ({ openPromptDialog: mocks.openPromptDialog }))
vi.mock('../../../shared/ImageUploader', () => ({
  MultiImageUploader: () => null,
  ImageUploader: () => null,
}))

const { TareasPersonalTab } = await import('../TareasPersonalTab')

// ── Datos ──────────────────────────────────────────────────────────────────

const HOY = new Date().toISOString().slice(0, 10)

const persona: PersonalCondominio = {
  id: 'per1', company_id: 'co1', project_id: 'p1', nombre: 'Ana',
  cargo: 'conserje', turno: 'diurno', estado: 'activo',
  created_at: '2026-01-01T00:00:00.000Z',
} as PersonalCondominio

const bloque: BloqueTurno = {
  id: 'blo1', company_id: 'co1', project_id: 'p1', personal_id: 'per1',
  turno: 'manana', fecha: HOY, estado: 'en_curso', foto_urls: [],
  created_at: '2026-01-01T00:00:00.000Z',
} as unknown as BloqueTurno

function tarea(over: Partial<TareaBloque> = {}): TareaBloque {
  return {
    id: 'tar1', bloque_id: 'blo1', titulo: 'Barrer el borde',
    orden: 0, requiere_foto: false, estado: 'pendiente', foto_urls: [],
    created_at: '2026-01-01T00:00:00.000Z',
    ...over,
  } as TareaBloque
}

/**
 * Monta el tab y ABRE el bloque: los turnos vienen colapsados y sus tareas no
 * se rinden hasta que alguien despliega. El click va sobre el chevron, que
 * burbujea al contenedor que lleva el onClick.
 */
function montar(tareas: TareaBloque[]) {
  const r = render(
    <TareasPersonalTab
      bloques={[bloque]}
      tareas={tareas}
      plantillas={[] as PlantillaTareaCargo[]}
      personal={[persona]}
      areas={[] as AreaCondominio[]}
      proyectoId="p1"
      companyId="co1"
      userId="u1"
      canCreate
      canEdit
      onRefresh={() => {}}
    />,
  )
  fireEvent.click(screen.getByText('▾'))
  return r
}

/** El ✅ de la tarea. Hay uno por tarea pendiente en un turno en curso. */
const botonCompletar = () => screen.getByTitle('Completada')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.updateCondominioRow.mockResolvedValue({ error: null })
})
afterEach(cleanup)

describe('TareasPersonalTab · el cierre exige lo que la tarea declara', () => {
  it('no llama a la base cuando falta la foto exigida', async () => {
    montar([tarea({ requiere_foto: true, foto_urls: [] })])
    fireEvent.click(botonCompletar())

    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    const [args] = mocks.notify.mock.calls[0] as unknown as [{ title: string; text: string }]
    expect(args.title).toBe('Falta evidencia')
    expect(args.text).toMatch(/foto/i)
    // Lo importante: NO se intentó el UPDATE. El trigger lo rechazaría igual,
    // pero gastar el viaje para que la base diga lo que ya sabíamos es peor UX.
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
  })

  it('no cierra con el checklist a medias', async () => {
    montar([tarea({
      requiere_checklist: true,
      checklist: ['Uno', 'Dos', 'Tres'],
      checklist_completado: [0, 1],
    })])
    fireEvent.click(botonCompletar())

    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
  })

  it('no cierra sin el comentario exigido', async () => {
    montar([tarea({ requiere_comentario: true, evidencia_texto: '   ' })])
    fireEvent.click(botonCompletar())

    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
  })

  it('sí cierra cuando la evidencia está', async () => {
    montar([tarea({ requiere_foto: true, foto_urls: ['evidencia/1.jpg'] })])
    fireEvent.click(botonCompletar())

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalled())
    const [tabla, id, patch] = mocks.updateCondominioRow.mock.calls[0] as unknown as
      [string, string, Record<string, unknown>]
    expect(tabla).toBe('tareas_bloque')
    expect(id).toBe('tar1')
    expect(patch.estado).toBe('completada')
  })

  it('la tarea sin exigencias se cierra sin ceremonia', async () => {
    montar([tarea()])
    fireEvent.click(botonCompletar())

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalled())
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('omitir no exige evidencia: reportar que no se hizo no se castiga', async () => {
    montar([tarea({ requiere_foto: true, foto_urls: [] })])
    fireEvent.click(screen.getByTitle('Omitir'))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalled())
    const [, , patch] = mocks.updateCondominioRow.mock.calls[0] as unknown as
      [string, string, Record<string, unknown>]
    expect(patch.estado).toBe('omitida')
  })
})

describe('TareasPersonalTab · el panel muestra lo que la tarea trae', () => {
  it('las instrucciones de seguridad se leen ANTES de empezar', async () => {
    montar([tarea({ instrucciones_seguridad: 'Usar guantes y gafas' })])
    fireEvent.click(screen.getByLabelText('Evidencia de Barrer el borde'))

    const nota = await screen.findByRole('note')
    expect(nota.textContent).toMatch(/Antes de empezar/)
    expect(nota.textContent).toMatch(/Usar guantes y gafas/)
  })

  it('marcar un paso se guarda al instante, no al cerrar', async () => {
    montar([tarea({
      requiere_checklist: true,
      checklist: ['Quitar hojas', 'Enjuagar'],
      checklist_completado: [],
    })])
    fireEvent.click(screen.getByLabelText('Evidencia de Barrer el borde'))
    fireEvent.click(await screen.findByLabelText('Quitar hojas'))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalled())
    const [, , patch] = mocks.updateCondominioRow.mock.calls[0] as unknown as
      [string, string, Record<string, unknown>]
    expect(patch.checklist_completado).toEqual([0])
  })

  it('desmarcar un paso también persiste', async () => {
    montar([tarea({
      requiere_checklist: true,
      checklist: ['Quitar hojas', 'Enjuagar'],
      checklist_completado: [0, 1],
    })])
    fireEvent.click(screen.getByLabelText('Evidencia de Barrer el borde'))
    fireEvent.click(await screen.findByLabelText('Quitar hojas'))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalled())
    const [, , patch] = mocks.updateCondominioRow.mock.calls[0] as unknown as
      [string, string, Record<string, unknown>]
    expect(patch.checklist_completado).toEqual([1])
  })

  it('la tarjeta rinde el avance del checklist y la duración', () => {
    montar([tarea({
      duracion_estimada_min: 25,
      requiere_checklist: true,
      checklist: ['a', 'b', 'c'],
      checklist_completado: [0],
    })])
    expect(screen.getByText(/⏱ 25 min/)).toBeTruthy()
    expect(screen.getByText(/1\/3/)).toBeTruthy()
  })
})

describe('TareasPersonalTab · la salida declarada', () => {
  it('cerrar con motivo lo manda a la base y queda escrito', async () => {
    montar([tarea({ requiere_foto: true, foto_urls: [] })])
    fireEvent.click(screen.getByLabelText('Evidencia de Barrer el borde'))

    fireEvent.change(await screen.findByLabelText('Motivo para cerrar sin evidencia'),
      { target: { value: 'Cámara rota; lo verificó el supervisor' } })
    fireEvent.click(screen.getByText('Cerrar declarando el motivo'))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalled())
    const [, , patch] = mocks.updateCondominioRow.mock.calls[0] as unknown as
      [string, string, Record<string, unknown>]
    expect(patch.estado).toBe('completada')
    expect(patch.motivo_sin_evidencia).toBe('Cámara rota; lo verificó el supervisor')
  })

  it('sin motivo escrito el botón no deja cerrar', async () => {
    montar([tarea({ requiere_foto: true, foto_urls: [] })])
    fireEvent.click(screen.getByLabelText('Evidencia de Barrer el borde'))

    const boton = await screen.findByText('Cerrar declarando el motivo')
    expect((boton as HTMLButtonElement).disabled).toBe(true)
  })

  it('la tarea cerrada con excepción se marca en la tarjeta', () => {
    montar([tarea({
      estado: 'completada',
      requiere_foto: true,
      motivo_sin_evidencia: 'Cámara rota',
    })])
    expect(screen.getByTitle(/Se cerró sin la evidencia exigida: Cámara rota/)).toBeTruthy()
  })
})

describe('TareasPersonalTab · el error del trigger se traduce', () => {
  it('un rechazo de la base se explica en vez de mostrar el texto de Postgres', async () => {
    mocks.updateCondominioRow.mockResolvedValue({
      error: {
        message: 'EVIDENCIA: la tarea "Barrer el borde" exige foto y no tiene ninguna',
        code: '23514',
      },
    })
    // Sin exigencias en el cliente, para que el chequeo local pase y el
    // rechazo venga de la base: es el caso de dos pestañas abiertas, o de una
    // UI desactualizada respecto del trigger.
    montar([tarea()])
    fireEvent.click(botonCompletar())

    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    const [args] = mocks.notify.mock.calls[0] as unknown as [{ title: string; text: string }]
    expect(args.title).toBe('Falta evidencia')
    expect(args.text).not.toMatch(/EVIDENCIA:/)
  })
})
