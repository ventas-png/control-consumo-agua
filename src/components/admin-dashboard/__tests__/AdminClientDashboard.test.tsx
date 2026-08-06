// Auto-encuadre del período del dashboard admin (fix "KPIs en 0 con histórico
// cargado"): si la ventana por defecto no contiene lecturas, se corre sola al
// ciclo más reciente; si el usuario fijó fechas a mano, se le avisa con un
// banner + botón en lugar de moverle el rango.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { Cliente, Proyecto, Registro, Unidad, UserSession } from '../../../types'

// El barrel `../shared` arrastra SecureImage → storageUrls → lib/supabase, que
// exige env vars al importarse. Ningún test toca red.
vi.mock('../../../lib/supabase', () => ({ supabase: {} }))
// Stats de conversaciones: van a Supabase en el componente real.
vi.mock('../../../domain/admin-dashboard/queries', () => ({
  fetchConvCountsForProject: vi.fn().mockResolvedValue({ sinAsignar: 0, cerradasHoy: 0, criticas: 0, urgentes: 0, enProceso: 0 }),
  fetchConvRowsAllProjects: vi.fn().mockResolvedValue([]),
}))
// LecturasSection arrastra mutations de Supabase y contexto de permisos; solo
// se renderiza en el tab "Nueva Lectura", que estos tests no visitan.
vi.mock('../../lecturas/LecturasSection', () => ({ LecturasSection: () => null }))
// chart.js no funciona sobre el canvas de jsdom.
vi.mock('../../../lib/chartjs', () => ({ Chart: class { destroy() {} } }))

import { AdminClientDashboard } from '../AdminClientDashboard'

const hoyStr = () => new Date().toISOString().slice(0, 10)

/** YYYY-MM-DD de hace `n` días (misma aritmética que los defaults del componente). */
function diasAtras(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

/** Resta 30 días a un YYYY-MM-DD en UTC (espeja periodoUltimaLectura). */
function menos30(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 30)
  return d.toISOString().slice(0, 10)
}

const currentUser = {
  user_id: 'u1', email: 'admin@test.com', name: 'Admin', role: 'admin',
  company_id: 'co1', login_time: '', expires_at: '',
} as UserSession

const proyecto = { id: 'p1', nombre: 'Cascadas de Vista Hermosa', company_id: 'co1', estado: 'activo', moneda: 'Q' } as Proyecto
const cliente = { id: 'c1', nombre: 'SERGIO ESTRADA', codigo: 'CLI-066' } as Cliente
const unidad = { id: 'un1', project_id: 'p1', company_id: 'co1', nombre: 'Casa 1', cliente_id: 'c1', activo: true } as Unidad

function registro(fechaYmd: string): Registro {
  return {
    id: `r-${fechaYmd}`, cliente_id: 'c1', cliente_nombre: 'SERGIO ESTRADA', project_id: 'p1',
    fecha: `${fechaYmd}T18:00:00+00:00`, lectura_anterior: 0, lectura_actual: 45, consumo: 45,
    tarifa_aplicada: 25, canon_aplicado: 0, monto_calculado: 1125, tipo_cobro: 'lectura', estado: 'pagado',
  } as Registro
}

function renderDashboard(registros: Registro[]) {
  return render(
    <AdminClientDashboard
      currentUser={currentUser}
      data={{
        clientes: [cliente], registros, proyectos: [proyecto], contadores: [],
        fuentesAgua: [], registrosCalidad: [], rutas: [], tarifas: [], unidades: [unidad],
      }}
      moneda="Q"
      onDataRefresh={async () => {}}
    />,
  )
}

const getDateInputs = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLInputElement>('input[type="date"]'))

beforeEach(() => { cleanup() })

describe('AdminClientDashboard — período vs. lecturas', () => {
  it('auto-encuadra el período cuando todas las lecturas quedan fuera de la ventana por defecto', async () => {
    const fechaLectura = diasAtras(45) // fuera de "últimos 30 días"
    const { container } = renderDashboard([registro(fechaLectura)])

    // Tras el auto-encuadre los KPIs computan la lectura (consumo 45.00).
    expect(await screen.findByText('45.00')).toBeTruthy()
    const [desde, hasta] = getDateInputs(container)
    expect(desde.value).toBe(menos30(fechaLectura))
    expect(hasta.value).toBe(hoyStr())
    // Sin fechas manuales no hay banner: el ajuste fue silencioso.
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('no mueve el período cuando la ventana por defecto sí contiene lecturas', async () => {
    const { container } = renderDashboard([registro(diasAtras(10))])

    expect(await screen.findByText('45.00')).toBeTruthy()
    const [desde, hasta] = getDateInputs(container)
    expect(desde.value).toBe(diasAtras(30))
    expect(hasta.value).toBe(hoyStr())
  })

  it('con fechas manuales sin lecturas muestra el banner y el botón reencuadra', async () => {
    const fechaLectura = diasAtras(45)
    const { container } = renderDashboard([registro(fechaLectura)])
    expect(await screen.findByText('45.00')).toBeTruthy()

    // El usuario fija un rango sin lecturas → banner en lugar de auto-ajuste.
    const [desde] = getDateInputs(container)
    fireEvent.change(desde, { target: { value: diasAtras(5) } })
    const banner = await screen.findByRole('status')
    expect(banner.textContent).toContain('Ninguna de las')
    expect(banner.textContent).toContain('1')

    fireEvent.click(screen.getByRole('button', { name: 'Ver período con lecturas' }))
    expect(await screen.findByText('45.00')).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    expect(getDateInputs(container)[0].value).toBe(menos30(fechaLectura))
  })

  it('el selector de período solo aparece en el tab Dashboard', async () => {
    const { container } = renderDashboard([registro(diasAtras(10))])
    expect(await screen.findByText('45.00')).toBeTruthy()
    expect(getDateInputs(container).length).toBe(2)

    // Las pestañas son <TabStrip> (role="tab", patrón Tab de WAI-ARIA), no
    // botones sueltos: la tira se extrajo a un componente compartido después
    // de abrirse este PR.
    fireEvent.click(screen.getByRole('tab', { name: /Historial/ }))
    expect(getDateInputs(container).length).toBe(0)

    fireEvent.click(screen.getByRole('tab', { name: /Dashboard/ }))
    expect(getDateInputs(container).length).toBe(2)
  })
})
