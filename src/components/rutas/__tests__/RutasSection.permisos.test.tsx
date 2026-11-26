// Botones de Rutas según permisos. El «Admin Agua» se crea con rol de
// plataforma `operator` y recibe agua.* por RBAC (EmpresaUsuariosSection):
// la sección antes excluía a `operator` por rol y le ocultaba «+ Nueva Ruta»
// aunque tuviera agua.rutas.create. Cada botón sigue su permiso, el mismo que
// aplica el servidor: las policies de `rutas` (20261221000000) para crear,
// editar y eliminar, y route-reminders (agua.rutas.edit) para «Recordar».
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { Cliente, Contador, Proyecto, Ruta, Unidad, UserRole } from '../../../types'

vi.mock('../../../lib/supabase', () => ({
  supabase: { from: () => ({}), rpc: () => ({}), storage: { from: () => ({}) } },
  db: { from: () => ({}), rpc: () => ({}) },
}))
vi.mock('../../../domain/usuarios/queries', () => ({ fetchOperadoresAsignablesRuta: vi.fn(async () => []) }))
vi.mock('../../../domain/rutas/mutations', () => ({ createRuta: vi.fn(), updateRuta: vi.fn(), deleteRuta: vi.fn() }))
vi.mock('../../shared/Dialog', () => ({ confirm: vi.fn(), notify: vi.fn() }))

const { RutasSection } = await import('../RutasSection')

const PROYECTOS = [{ id: 'p1', nombre: '21B+' }] as Proyecto[]
const RUTAS = [
  { id: 'r1', nombre: 'Lectura Mensual 21B+ N7', project_id: 'p1', tipo_ruta: 'clientes', cliente_ids: [] },
] as unknown as Ruta[]

function renderRutas(userRole: UserRole, perms: { canCreate?: boolean; canEdit?: boolean; canDelete?: boolean } = {}) {
  return render(
    <RutasSection
      clientes={[] as Cliente[]}
      contadores={[] as Contador[]}
      unidades={[] as Unidad[]}
      proyectos={PROYECTOS}
      rutas={RUTAS}
      userRole={userRole}
      companyId="emp-1"
      onRutaAdded={() => {}}
      onRutaUpdated={() => {}}
      onRutaDeleted={() => {}}
      onEjecutarRuta={() => {}}
      canCreate={perms.canCreate ?? true}
      canEdit={perms.canEdit ?? true}
      canDelete={perms.canDelete ?? true}
    />,
  )
}

const boton = (nombre: string | RegExp) => screen.queryByRole('button', { name: nombre })

afterEach(cleanup)

describe('RutasSection — permisos', () => {
  it('Admin Agua (rol base operator con agua.rutas.*) ve todos los botones', () => {
    renderRutas('operator')
    expect(boton('+ Nueva Ruta')).not.toBeNull()
    expect(boton('Editar')).not.toBeNull()
    expect(boton(/Recordar/)).not.toBeNull()
    expect(boton('Eliminar')).not.toBeNull()
    expect(boton('▶ Ejecutar')).not.toBeNull()
  })

  it('sin agua.rutas.create no hay «+ Nueva Ruta»; sin agua.rutas.edit no hay «Editar» ni «Recordar»', () => {
    renderRutas('operator', { canCreate: false, canEdit: false })
    expect(boton('+ Nueva Ruta')).toBeNull()
    expect(boton('Editar')).toBeNull()
    expect(boton(/Recordar/)).toBeNull()
    expect(boton('Eliminar')).not.toBeNull()
    expect(boton('▶ Ejecutar')).not.toBeNull()
  })

  it('sin agua.rutas.delete no hay «Eliminar», aunque pueda editar', () => {
    renderRutas('operator', { canDelete: false })
    expect(boton('Eliminar')).toBeNull()
    expect(boton('Editar')).not.toBeNull()
  })

  it('el visor no crea, edita, recuerda ni elimina aunque el permiso venga marcado', () => {
    renderRutas('viewer')
    expect(boton('+ Nueva Ruta')).toBeNull()
    expect(boton('Editar')).toBeNull()
    expect(boton(/Recordar/)).toBeNull()
    expect(boton('Eliminar')).toBeNull()
    expect(boton('▶ Ejecutar')).not.toBeNull()
  })

  it('admin y dueño conservan todos los botones', () => {
    for (const rol of ['admin', 'company_owner'] as const) {
      renderRutas(rol)
      expect(boton('+ Nueva Ruta')).not.toBeNull()
      expect(boton('Editar')).not.toBeNull()
      expect(boton(/Recordar/)).not.toBeNull()
      expect(boton('Eliminar')).not.toBeNull()
      cleanup()
    }
  })
})
