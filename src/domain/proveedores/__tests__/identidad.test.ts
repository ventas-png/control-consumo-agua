// Estas pruebas usan los MISMOS vectores que supabase/tests/proveedores_pr_a:
// si el servidor cambia una regla y esto no (o al revés), se nota aquí.
import { describe, expect, it } from 'vitest'
import {
  buscarDuplicadoFiscal,
  buscarProveedores,
  etiquetaProveedor,
  identificacionDe,
  motivoNoHabilitado,
  nombreBase,
  normalizarIdentificacion,
  normalizarNombre,
  proveedorHabilitadoEn,
} from '../identidad'
import type { ProveedorCatalogo, ProveedorProyecto } from '../../../types/proveedores'

const HOY = '2026-10-01'

function prov(over: Partial<ProveedorCatalogo> & { id: string }): ProveedorCatalogo {
  return {
    company_id: 'emp-1', nombre: 'Proveedor', nit: null, rfc: null, email: null, telefono: null,
    direccion: null, contacto_nombre: null, dias_credito: 0, categoria_default: null, activo: true,
    notas: null, created_at: '', updated_at: '', estado: 'autorizado', alcance: 'empresa', ...over,
  } as ProveedorCatalogo
}

function vinculo(over: Partial<ProveedorProyecto> & { proveedor_id: string; project_id: string }): ProveedorProyecto {
  return {
    id: `${over.proveedor_id}-${over.project_id}`, company_id: 'emp-1', estado: 'habilitado',
    motivo_estado: null, habilitado_por: null, habilitado_at: null, vigente_hasta: null,
    dias_credito: null, condiciones_pago: null, notas: null, ...over,
  }
}

describe('normalizarIdentificacion (espejo de proveedor_normalizar_identificacion)', () => {
  it.each([
    ['1234567-8', '12345678'],
    [' 1234567 8 ', '12345678'],
    ['abc-123', 'ABC123'],
    ['LEG-001', 'LEG001'],
    ['0123', '0123'], // NO quita ceros: «0123» y «123» pueden ser distintos
  ])('%s → %s', (entrada, esperado) => {
    expect(normalizarIdentificacion(entrada)).toBe(esperado)
  })

  it.each(['C/F', 'CF', 'c.f.', 'N/A', 'Consumidor Final', '', '   ', null, undefined, 'pendiente'])(
    '«%s» no identifica a nadie', (entrada) => {
      expect(normalizarIdentificacion(entrada as string | null | undefined)).toBeNull()
    },
  )

  it('usa el NIT y, si no hay, el RFC', () => {
    expect(identificacionDe({ nit: '1234567-8', rfc: 'XXX' })).toBe('12345678')
    expect(identificacionDe({ nit: '  ', rfc: 'ABC-1' })).toBe('ABC1')
    expect(identificacionDe({ nit: null, rfc: null })).toBeNull()
  })
})

describe('nombres: solo para proponer, nunca para unir', () => {
  it('normaliza acentos, mayúsculas y puntuación', () => {
    expect(normalizarNombre('FERRETERÍA LA UNIÓN')).toBe('ferreteria la union')
    expect(normalizarNombre('  Eléctricos del Norte, S.A.  ')).toBe('electricos del norte s a')
  })
  it('nombreBase quita la forma societaria final', () => {
    expect(nombreBase('Ferretería La Unión, S.A.')).toBe('ferreteria la union')
    expect(nombreBase('Limpieza Total Ltda.')).toBe('limpieza total')
    expect(nombreBase('Limpieza Total')).toBe('limpieza total')
  })
})

describe('buscarDuplicadoFiscal (espejo de la guarda del servidor)', () => {
  const existentes = [
    prov({ id: 'a', nombre: 'La Unión', nit: '1234567-8', pais: 'GT' }),
    prov({ id: 'b', nombre: 'Legado', nit: 'ABC-123', pais: null }),
  ]
  it('mismo NIT con otro formato y mismo país: duplicado', () => {
    expect(buscarDuplicadoFiscal({ nit: '12345678', pais: 'gt' }, existentes)?.id).toBe('a')
  })
  it('el mismo número en OTRO país conocido: no es duplicado', () => {
    expect(buscarDuplicadoFiscal({ nit: '1234567-8', pais: 'MX' }, existentes)).toBeNull()
  })
  it('contra un legado sin país, el país es comodín', () => {
    expect(buscarDuplicadoFiscal({ nit: 'abc123', pais: 'GT' }, existentes)?.id).toBe('b')
  })
  it('sin identificación no hay duplicado posible; y al editar se ignora a sí mismo', () => {
    expect(buscarDuplicadoFiscal({ nit: 'C/F' }, existentes)).toBeNull()
    expect(buscarDuplicadoFiscal({ nit: '1234567-8', pais: 'GT' }, existentes, 'a')).toBeNull()
  })
})

describe('proveedorHabilitadoEn (espejo de proveedor_habilitado_en)', () => {
  const p = prov({ id: 'p1', alcance: 'proyectos' })

  it('alcance proyectos: solo con vínculo habilitado y vigente', () => {
    expect(proveedorHabilitadoEn(p, [vinculo({ proveedor_id: 'p1', project_id: 'A1' })], 'A1', HOY)).toBe(true)
    expect(proveedorHabilitadoEn(p, [vinculo({ proveedor_id: 'p1', project_id: 'A1', estado: 'pendiente' })], 'A1', HOY)).toBe(false)
    expect(proveedorHabilitadoEn(p, [], 'A1', HOY)).toBe(false)
    expect(proveedorHabilitadoEn(p, [vinculo({ proveedor_id: 'p1', project_id: 'A1' })], 'A2', HOY)).toBe(false)
    expect(proveedorHabilitadoEn(p, [vinculo({ proveedor_id: 'p1', project_id: 'A1', vigente_hasta: '2026-09-30' })], 'A1', HOY)).toBe(false)
    expect(proveedorHabilitadoEn(p, [vinculo({ proveedor_id: 'p1', project_id: 'A1', vigente_hasta: HOY })], 'A1', HOY)).toBe(true)
  })

  it('alcance proyectos no sirve a la contabilidad de la empresa (sin proyecto)', () => {
    expect(proveedorHabilitadoEn(p, [vinculo({ proveedor_id: 'p1', project_id: 'A1' })], null, HOY)).toBe(false)
  })

  it('alcance empresa: sirve a todo, salvo veto del proyecto', () => {
    const e = prov({ id: 'p2', alcance: 'empresa' })
    expect(proveedorHabilitadoEn(e, [], 'A1', HOY)).toBe(true)
    expect(proveedorHabilitadoEn(e, [], null, HOY)).toBe(true)
    expect(proveedorHabilitadoEn(e, [vinculo({ proveedor_id: 'p2', project_id: 'A1', estado: 'pendiente' })], 'A1', HOY)).toBe(true)
    expect(proveedorHabilitadoEn(e, [vinculo({ proveedor_id: 'p2', project_id: 'A1', estado: 'suspendido' })], 'A1', HOY)).toBe(false)
    expect(proveedorHabilitadoEn(e, [vinculo({ proveedor_id: 'p2', project_id: 'A1', estado: 'retirado' })], 'A1', HOY)).toBe(false)
  })

  it('la autorización general manda primero', () => {
    expect(proveedorHabilitadoEn(prov({ id: 'p3', estado: 'suspendido' }), [], 'A1', HOY)).toBe(false)
    expect(proveedorHabilitadoEn(prov({ id: 'p4', autorizacion_vence: '2026-01-01' }), [], 'A1', HOY)).toBe(false)
  })

  it('un proveedor sin alcance (entorno sin la migración) se trata como de empresa', () => {
    const legado = prov({ id: 'p5' })
    delete (legado as { alcance?: string }).alcance
    expect(proveedorHabilitadoEn(legado, [], 'A1', HOY)).toBe(true)
  })

  it('explica POR QUÉ no se le puede comprar', () => {
    expect(motivoNoHabilitado(p, [], 'A1', HOY)).toBe('No está vinculado a este proyecto')
    expect(motivoNoHabilitado(p, [vinculo({ proveedor_id: 'p1', project_id: 'A1', estado: 'pendiente' })], 'A1', HOY))
      .toBe('Habilitación pendiente en este proyecto')
    expect(motivoNoHabilitado(p, [], null, HOY)).toMatch(/no en la contabilidad de la empresa/)
    expect(motivoNoHabilitado(prov({ id: 'x', estado: 'suspendido' }), [], 'A1', HOY)).toMatch(/No autorizado/)
    expect(motivoNoHabilitado(prov({ id: 'y', autorizacion_vence: '2026-01-01' }), [], 'A1', HOY)).toBe('Su autorización venció')
    expect(motivoNoHabilitado(prov({ id: 'z' }), [vinculo({ proveedor_id: 'z', project_id: 'A1', estado: 'suspendido' })], 'A1', HOY))
      .toBe('Suspendido en este proyecto')
    expect(motivoNoHabilitado(prov({ id: 'ok' }), [], 'A1', HOY)).toBeNull()
  })
})

describe('buscarProveedores: por nombre, código o identificación', () => {
  const lista = [
    prov({ id: '1', nombre: 'Ferretería La Unión', codigo: 'PRV-00001', nit: '1234567-8' }),
    prov({ id: '2', nombre: 'Limpieza Total', codigo: 'PRV-00002', nit: '9999999-9' }),
    prov({ id: '3', nombre: 'Sin código', codigo: null }),
  ]
  it('por nombre sin acentos ni mayúsculas', () => {
    expect(buscarProveedores(lista, 'ferreteria').map((p) => p.id)).toEqual(['1'])
    expect(buscarProveedores(lista, 'UNIÓN').map((p) => p.id)).toEqual(['1'])
  })
  it('por código', () => {
    expect(buscarProveedores(lista, 'prv-00002').map((p) => p.id)).toEqual(['2'])
  })
  it('por identificación con cualquier formato', () => {
    expect(buscarProveedores(lista, '1234567 8').map((p) => p.id)).toEqual(['1'])
    expect(buscarProveedores(lista, '12345678').map((p) => p.id)).toEqual(['1'])
  })
  it('texto vacío devuelve todo y sin coincidencias, nada', () => {
    expect(buscarProveedores(lista, '  ')).toHaveLength(3)
    expect(buscarProveedores(lista, 'zzz')).toHaveLength(0)
  })
  it('la etiqueta es la misma en toda la aplicación', () => {
    expect(etiquetaProveedor(lista[0])).toBe('PRV-00001 · Ferretería La Unión')
    expect(etiquetaProveedor(lista[2])).toBe('Sin código')
  })
})
