// Botones de Rutas según permisos. El «Admin Agua» se crea con rol de
// plataforma `operator` y recibe agua.* por RBAC (EmpresaUsuariosSection):
// la sección antes excluía a `operator` por rol y le ocultaba «+ Nueva Ruta»
// aunque tuviera agua.rutas.create. Crear/editar siguen el permiso; eliminar y
// «Recordar» siguen además atados a admin/company_owner/super_admin porque así
// lo exigen la policy rutas_delete y la función route-reminders.
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
  it('Admin Agua (rol base operator con agua.rutas.*) ve «+ Nueva Ruta» y «Editar»', () => {
    renderRutas('operator')
    expect(boton('+ Nueva Ruta')).not.toBeNull()
    expect(boton('Editar')).not.toBeNull()
    expect(boton('▶ Ejecutar')).not.toBeNull()
  })

  it('a un operator no le ofrece Eliminar ni Recordar: el servidor se los rechaza', () => {
    renderRutas('operator')
    expect(boton('Eliminar')).toBeNull()
    expect(boton(/Recordar/)).toBeNull()
  })

  it('sin agua.rutas.create no hay «+ Nueva Ruta»; sin agua.rutas.edit no hay «Editar»', () => {
    renderRutas('operator', { canCreate: false, canEdit: false })
    expect(boton('+ Nueva Ruta')).toBeNull()
    expect(boton('Editar')).toBeNull()
    expect(boton('▶ Ejecutar')).not.toBeNull()
  })

  it('el visor no crea ni edita aunque el permiso venga marcado', () => {
    renderRutas('viewer')
    expect(boton('+ Nueva Ruta')).toBeNull()
    expect(boton('Editar')).toBeNull()
    expect(boton('Eliminar')).toBeNull()
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

  it('Eliminar exige además agua.rutas.delete', () => {
    renderRutas('admin', { canDelete: false })
    expect(boton('Eliminar')).toBeNull()
  })
})
