import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import type { AppUser } from '../../../domain/usuarios/queries'

// Trazabilidad (20260731000000). UsuarioChip traduce el uuid de las columnas
// selladas a un nombre. Lo que se prueba aquí es la DISTINCIÓN entre los tres
// estados que se ven igual si uno se descuida —"Sistema", usuario borrado y
// fila sin sellar— porque confundirlos hace que la trazabilidad mienta.

// `lib/supabase` lanza sin env vars y la cadena de imports lo arrastra.
vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) } }))

// Se mockea el HOOK, no el fetch: `useUsuariosMap` referencia
// `fetchDirectorioUsuarios` desde el scope del módulo, así que reemplazar solo
// ese export no cambiaría lo que el hook llama de verdad.
let directorio: AppUser[] = []
vi.mock('../../../domain/usuarios/queries', () => ({
  useUsuariosMap: () => ({
    mapa: new Map(directorio.map((u) => [u.id, u])),
    isLoading: false,
  }),
}))

import { UsuarioChip } from '../UsuarioChip'

function renderChip(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  cleanup()
  directorio = [
    { id: 'u-1', full_name: 'Ana María López', role: 'operador', activo: true },
    { id: 'u-2', full_name: 'Carlos Pérez', role: 'guardia', activo: false },
  ]
})

describe('UsuarioChip', () => {
  it('sin userId muestra "Sistema" — la escritura vino de un proceso automático', () => {
    renderChip(<UsuarioChip userId={null} />)
    expect(screen.getByText('Sistema')).toBeTruthy()
  })

  it('sin userId y con historico muestra "—" — la fila es anterior al sellado', () => {
    // Distinguirlo de "Sistema" importa: una lectura de hace un año no la
    // escribió un cron, simplemente nadie registraba quién la capturaba.
    renderChip(<UsuarioChip userId={null} historico />)
    expect(screen.getByText('—')).toBeTruthy()
    expect(screen.queryByText('Sistema')).toBeNull()
  })

  it('resuelve el nombre del usuario', () => {
    renderChip(<UsuarioChip userId="u-1" />)
    expect(screen.getByText('Ana María López')).toBeTruthy()
  })

  it('resuelve también a usuarios INACTIVOS', () => {
    // El que capturó la lectura pudo darse de baja después. Si el directorio
    // filtrara por activo, el histórico se volvería anónimo justo cuando más
    // importa saber quién fue.
    renderChip(<UsuarioChip userId="u-2" />)
    expect(screen.getByText('Carlos Pérez')).toBeTruthy()
  })

  it('con id desconocido muestra los primeros 8 chars, no "Sistema"', () => {
    renderChip(<UsuarioChip userId="ffffffff-1111-2222-3333-444444444444" />)
    expect(screen.getByText('Usuario ffffffff')).toBeTruthy()
    expect(screen.queryByText('Sistema')).toBeNull()
  })

  it('muestra el rol cuando se pide', () => {
    renderChip(<UsuarioChip userId="u-1" mostrarRol />)
    expect(screen.getByText('· operador')).toBeTruthy()
  })

  it('deriva las iniciales del primer y último nombre', () => {
    renderChip(<UsuarioChip userId="u-1" />)
    expect(screen.getByText('AL')).toBeTruthy()
  })
})
