import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { SECTION_TO_PATH, sectionToPath, pathToSection } from '../routes'
import type { AppSection } from '../../types'

// ════════════════════════════════════════════════════════════════════════════
// Navegación URL↔sección (auditoría 2026-07-28, Bloque G · PR-32).
//
// POR QUÉ ESTE ARCHIVO EXISTE AHORA
// Al subir react-router 6→7 (major, obligado: el open redirect
// GHSA-wrjc-x8rr-h8h6 no tiene arreglo en ninguna 6.x) la suite entera pasó en
// verde… sin significar nada. Sólo UN test tocaba el router
// (`AppPublicRoutes.test.tsx`) y está escrito a propósito para pasar con o sin
// el shell montado; y `lib/routes.ts` —la tabla por la que navega TODA la app—
// no tenía ningún test. Es decir: el "2720 tests en verde" no cubría lo único
// que el upgrade podía romper.
//
// Estos tests ejercitan el router DE VERDAD: montan rutas, navegan con
// `useNavigate` y comprueban qué se renderizó y en qué URL se quedó. Fijan el
// contrato de navegación de la app, no la versión de la librería.
//
// Lo que hace que sean relevantes para v7 en concreto:
//   · `v7_startTransition` — en v7 las actualizaciones de estado de navegación
//     van dentro de `React.startTransition`. De ahí el `act()` explícito al
//     navegar: sin él la aserción correría antes de que React aplique la
//     transición y el test sería un falso verde.
//   · `v7_relativeSplatPath` — la app tiene una ruta comodín `*`; se comprueba
//     que sigue cayendo en el destino absoluto esperado.
// ════════════════════════════════════════════════════════════════════════════

/** Muestra la ruta actual y expone un botón que navega a `destino`. */
function Sonda({ destino }: { destino?: string }) {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <div>
      <span data-testid="url">{location.pathname}</span>
      <span data-testid="seccion">{String(pathToSection(location.pathname))}</span>
      {destino && (
        <button data-testid="ir" onClick={() => navigate(destino)}>ir</button>
      )}
    </div>
  )
}

function montar(inicial: string, destino?: string) {
  return render(
    <MemoryRouter initialEntries={[inicial]}>
      <Routes>
        {Object.values(SECTION_TO_PATH).map((p) => (
          <Route key={p} path={p} element={<Sonda destino={destino} />} />
        ))}
        <Route path="/condominios/:tab" element={<Sonda destino={destino} />} />
        <Route path="/" element={<Sonda destino={destino} />} />
        <Route path="*" element={<Navigate to={sectionToPath('clientes')} replace />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('routes — tabla sección↔URL', () => {
  it('sectionToPath y pathToSection son inversas para TODA sección', () => {
    // Recorre el mapa entero: si alguien añade una sección con una URL que
    // colisiona o que el parser no sabe deshacer, sale aquí y no en producción.
    const secciones = Object.keys(SECTION_TO_PATH) as AppSection[]
    expect(secciones.length).toBeGreaterThan(20)
    for (const s of secciones) {
      expect(pathToSection(sectionToPath(s)), `ida y vuelta de ${s}`).toBe(s)
    }
  })

  it('tolera la barra final', () => {
    expect(pathToSection('/cobros/')).toBe('cobros')
    expect(pathToSection('/')).toBeNull()
  })

  it('prefijo más largo gana en las rutas anidadas de condominios', () => {
    // `/condominios/cuotas` NO debe resolver a `condominios` sólo por ser
    // prefijo: el sidebar marcaría la sección equivocada.
    expect(pathToSection('/condominios/cuotas')).toBe('condominios_cuotas')
    expect(pathToSection('/condominios/cuotas/123')).toBe('condominios_cuotas')
    expect(pathToSection('/condominios')).toBe('condominios')
  })

  it('devuelve null en rutas que no son de sección', () => {
    expect(pathToSection('/dev/components')).toBeNull()
    expect(pathToSection('/politica-privacidad')).toBeNull()
  })
})

describe('routes — navegación real con el router', () => {
  it('renderiza la sección correspondiente a la URL inicial', () => {
    montar('/cobros')
    expect(screen.getByTestId('url').textContent).toBe('/cobros')
    expect(screen.getByTestId('seccion').textContent).toBe('cobros')
  })

  it('useNavigate cambia URL y sección', async () => {
    // `act()` explícito: en v7 la navegación va dentro de startTransition.
    montar('/clientes', '/contabilidad')
    expect(screen.getByTestId('seccion').textContent).toBe('clientes')

    await act(async () => { screen.getByTestId('ir').click() })

    expect(screen.getByTestId('url').textContent).toBe('/contabilidad')
    expect(screen.getByTestId('seccion').textContent).toBe('contabilidad')
  })

  it('una ruta desconocida cae en el comodín y redirige a /clientes', async () => {
    montar('/no-existe-esta-ruta')
    expect(screen.getByTestId('url').textContent).toBe('/clientes')
  })

  it('las rutas anidadas de condominios resuelven con su :tab', () => {
    montar('/condominios/visitantes')
    expect(screen.getByTestId('url').textContent).toBe('/condominios/visitantes')
    expect(screen.getByTestId('seccion').textContent).toBe('condominios_visitantes')
  })
})
