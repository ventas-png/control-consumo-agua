import { describe, it, expect, vi } from 'vitest'
import type { ContratoArrendamiento, ContratoProveedor, NotaAdmin, PersonalCondominio, PuntoMinuta, Unidad } from '../../../types'
import type { ProveedorCatalogo } from '../../../types/proveedores'

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))

const {
  borradorDesde, candidatosEmpleados, candidatosProveedores, candidatosResidentes, depurarBorrador, designarGestor,
  fechaDeMinuta, filtrarCandidatos, iniciales, marcarCumplido, participanteDesdeCandidato, participantesDe, plazoCompromiso, plazoSeguimiento,
  puntosDe, quitarParticipante, resumenCompromisos, situacionCompromiso, validarPasoMinuta, yaParticipa,
} = await import('../minutas')

const HOY = new Date(2026, 9, 26, 15, 0) // 26 oct 2026, 3 de la tarde (local)

const nota = (o: Partial<NotaAdmin>): NotaAdmin => ({
  id: 'n1', company_id: 'co1', project_id: 'p1', titulo: 'Reunión', contenido: '', categoria: 'reunion', prioridad: 'normal',
  fijada: false, resuelta: false, created_at: '2026-10-20T23:30:00Z', ...o,
})

describe('participantesDe / puntosDe — lo que llega de la base se normaliza', () => {
  it('sin columna, null o un valor que no es lista → vacío', () => {
    expect(participantesDe(nota({}))).toEqual([])
    expect(participantesDe(nota({ participantes: null }))).toEqual([])
    expect(participantesDe({ participantes: { nombre: 'x' } as never })).toEqual([])
    expect(puntosDe(nota({ puntos: 'texto' as never }))).toEqual([])
  })

  it('descarta entradas sin nombre o sin título y completa lo que falta', () => {
    const ps = participantesDe({ participantes: [
      { id: 'a', tipo: 'empleado', nombre: 'Ana', gestiona: true },
      { nombre: '   ' }, null, 'basura',
      { nombre: 'Luis', tipo: 'inventado', detalle: '' },
    ] as never })
    expect(ps).toHaveLength(2)
    expect(ps[0]).toMatchObject({ id: 'a', tipo: 'empleado', nombre: 'Ana', gestiona: true, ref_id: null, detalle: null })
    expect(ps[1]).toMatchObject({ tipo: 'otro', nombre: 'Luis', gestiona: false, detalle: null })
    expect(ps[1].id).toBeTruthy()

    const puntos = puntosDe({ puntos: [
      { id: 'p', titulo: 'Fuga en cisterna', acuerdos: [
        { id: 'c', tipo: 'compromiso', texto: 'Cotizar', responsable_id: 'a', fecha_limite: '2026-11-02', cumplido: true, cumplido_at: '2026-10-27T10:00:00Z' },
        { tipo: 'raro', texto: 'Se revisará', fecha_limite: 'ayer' },
        { texto: '' },
      ] },
      { titulo: '' },
      { titulo: 'Sin acuerdos', acuerdos: 'no' },
    ] as never })
    expect(puntos).toHaveLength(2)
    expect(puntos[0].acuerdos).toHaveLength(2)
    expect(puntos[0].acuerdos[0]).toMatchObject({ tipo: 'compromiso', responsable_id: 'a', fecha_limite: '2026-11-02', cumplido: true })
    expect(puntos[0].acuerdos[1]).toMatchObject({ tipo: 'acuerdo', fecha_limite: null, cumplido: false })
    expect(puntos[1]).toMatchObject({ titulo: 'Sin acuerdos', acuerdos: [] })
  })

  it('la fecha de una nota anterior a la migración es el día local en que se escribió', () => {
    expect(fechaDeMinuta(nota({ fecha_reunion: '2026-10-25' }))).toBe('2026-10-25')
    const sinFecha = nota({ created_at: '2026-10-21T03:30:00Z' })
    const esperado = new Date('2026-10-21T03:30:00Z')
    const local = `${esperado.getFullYear()}-${String(esperado.getMonth() + 1).padStart(2, '0')}-${String(esperado.getDate()).padStart(2, '0')}`
    expect(fechaDeMinuta(sinFecha)).toBe(local)
  })
})

describe('compromisos — situación y resumen', () => {
  const puntos: PuntoMinuta[] = [
    { id: 'p1', titulo: 'A', acuerdos: [
      { id: 'a1', tipo: 'acuerdo', texto: 'Se aprueba', cumplido: false },
      { id: 'c1', tipo: 'compromiso', texto: 'Cotizar', fecha_limite: '2026-10-20', cumplido: false },
      { id: 'c2', tipo: 'compromiso', texto: 'Pagar', fecha_limite: '2026-10-26', cumplido: false },
      { id: 'c3', tipo: 'compromiso', texto: 'Enviar', fecha_limite: '2026-10-30', cumplido: true },
    ] },
    { id: 'p2', titulo: 'B', acuerdos: [
      { id: 'c4', tipo: 'compromiso', texto: 'Llamar', cumplido: false },
    ] },
  ]

  it('vencido, hoy, pendiente, cumplido y sin fecha', () => {
    expect(situacionCompromiso(puntos[0].acuerdos[1], HOY)).toBe('vencido')
    expect(situacionCompromiso(puntos[0].acuerdos[2], HOY)).toBe('hoy')
    expect(situacionCompromiso({ cumplido: false, fecha_limite: '2026-10-28' }, HOY)).toBe('pendiente')
    expect(situacionCompromiso(puntos[0].acuerdos[3], HOY)).toBe('cumplido')
    expect(situacionCompromiso(puntos[1].acuerdos[0], HOY)).toBe('sin_fecha')
  })

  it('el resumen cuenta solo compromisos; los acuerdos van aparte', () => {
    expect(resumenCompromisos(puntos, HOY)).toEqual({ total: 4, cumplidos: 1, pendientes: 3, vencidos: 1, acuerdos: 1 })
  })

  it('marcarCumplido sella la fecha y desmarcar la borra, sin tocar el resto', () => {
    const marcados = marcarCumplido(puntos, 'c1', true, '2026-10-26T15:00:00Z')
    expect(marcados[0].acuerdos[1]).toMatchObject({ cumplido: true, cumplido_at: '2026-10-26T15:00:00Z' })
    expect(marcados[0].acuerdos[2].cumplido).toBe(false)
    expect(puntos[0].acuerdos[1].cumplido).toBe(false) // no muta
    const desmarcado = marcarCumplido(marcados, 'c1', false, '2026-10-27T15:00:00Z')
    expect(desmarcado[0].acuerdos[1]).toMatchObject({ cumplido: false, cumplido_at: null })
  })

  it('plazo en palabras', () => {
    expect(plazoCompromiso(-1)).toBe('venció hace 1 día')
    expect(plazoCompromiso(-3)).toBe('venció hace 3 días')
    expect(plazoCompromiso(0)).toBe('vence hoy')
    expect(plazoCompromiso(1)).toBe('vence en 1 día')
    expect(plazoCompromiso(5)).toBe('vence en 5 días')
  })
})

describe('plazoSeguimiento', () => {
  it('en palabras, para el próximo seguimiento de la minuta', () => {
    expect(plazoSeguimiento(-2)).toBe('vencido hace 2 días')
    expect(plazoSeguimiento(-1)).toBe('vencido hace 1 día')
    expect(plazoSeguimiento(0)).toBe('hoy')
    expect(plazoSeguimiento(1)).toBe('en 1 día')
    expect(plazoSeguimiento(4)).toBe('en 4 días')
  })
})

describe('borrador del asistente', () => {
  it('una minuta nueva arranca con quien la crea como gestor; sin nombre, sin participantes', () => {
    const b = borradorDesde(null, 'Prestadora', '2026-10-26')
    expect(b.fecha_reunion).toBe('2026-10-26')
    expect(b.categoria).toBe('reunion')
    expect(b.participantes).toHaveLength(1)
    expect(b.participantes[0]).toMatchObject({ nombre: 'Prestadora', gestiona: true, tipo: 'otro' })
    expect(borradorDesde(null, '  ', '2026-10-26').participantes).toEqual([])
  })

  it('editar carga lo guardado normalizado', () => {
    const b = borradorDesde(nota({
      titulo: 'Con proveedor', fecha_reunion: '2026-10-25', fecha_recordatorio: '2026-11-01', fijada: true,
      participantes: [{ id: 'x', tipo: 'proveedor', nombre: 'Limpiezas SA', gestiona: false }],
      puntos: [{ id: 'p', titulo: 'Horario', acuerdos: [] }],
    }), 'Admin', '2026-10-26')
    expect(b).toMatchObject({ titulo: 'Con proveedor', fecha_reunion: '2026-10-25', fecha_recordatorio: '2026-11-01', fijada: true })
    expect(b.participantes[0].nombre).toBe('Limpiezas SA')
    expect(b.puntos[0].titulo).toBe('Horario')
  })

  it('validación por paso: título, fecha, participantes y gestor; luego puntos; luego fechas de compromisos', () => {
    const base = borradorDesde(null, 'Admin', '2026-10-26')
    expect(validarPasoMinuta(base, 1)).toMatch(/título/)
    const conTitulo = { ...base, titulo: 'Reunión' }
    expect(validarPasoMinuta({ ...conTitulo, fecha_reunion: '2026-13-40' }, 1)).toMatch(/fecha/)
    expect(validarPasoMinuta({ ...conTitulo, participantes: [] }, 1)).toMatch(/participante/)
    expect(validarPasoMinuta({ ...conTitulo, participantes: [{ ...base.participantes[0], gestiona: false }] }, 1)).toMatch(/gestiona/)
    expect(validarPasoMinuta(conTitulo, 1)).toBeNull()

    expect(validarPasoMinuta(conTitulo, 2)).toMatch(/punto/)
    const conPunto = { ...conTitulo, puntos: [{ id: 'p', titulo: 'Fuga', acuerdos: [] as PuntoMinuta['acuerdos'] }] }
    expect(validarPasoMinuta(conPunto, 2)).toBeNull()

    const malaFecha = { ...conPunto, puntos: [{ ...conPunto.puntos[0], acuerdos: [{ id: 'c', tipo: 'compromiso' as const, texto: 'Cotizar', fecha_limite: 'pronto', cumplido: false }] }] }
    expect(validarPasoMinuta(malaFecha, 3)).toMatch(/Fuga/)
    expect(validarPasoMinuta({ ...conPunto, fecha_recordatorio: 'x' }, 3)).toMatch(/seguimiento/)
    expect(validarPasoMinuta(conPunto, 3)).toBeNull()
  })

  it('depurar: recorta, descarta vacíos y suelta responsables que ya no participan', () => {
    const b = borradorDesde(null, 'Admin', '2026-10-26')
    const gestorId = b.participantes[0].id
    const limpio = depurarBorrador({
      ...b,
      participantes: [...b.participantes, { id: 'z', tipo: 'otro', nombre: '   ', gestiona: false }],
      puntos: [
        { id: 'p1', titulo: '  Fuga  ', descripcion: '  ', acuerdos: [
          { id: 'a', tipo: 'acuerdo', texto: ' Se aprueba ', responsable_id: gestorId, fecha_limite: '2026-11-01', cumplido: true },
          { id: 'c', tipo: 'compromiso', texto: 'Cotizar', responsable_id: 'nadie', fecha_limite: '2026-11-01', cumplido: false },
          { id: 'c2', tipo: 'compromiso', texto: 'Pagar', responsable_id: gestorId, fecha_limite: 'x', cumplido: true, cumplido_at: '2026-10-26T00:00:00Z' },
          { id: 'v', tipo: 'acuerdo', texto: '   ', cumplido: false },
        ] },
        { id: 'p2', titulo: '', acuerdos: [] },
      ],
    })
    expect(limpio.participantes).toHaveLength(1)
    expect(limpio.puntos).toHaveLength(1)
    expect(limpio.puntos[0].titulo).toBe('Fuga')
    expect(limpio.puntos[0].descripcion).toBeNull()
    expect(limpio.puntos[0].acuerdos.map(a => a.texto)).toEqual(['Se aprueba', 'Cotizar', 'Pagar'])
    // un acuerdo no lleva responsable, fecha ni cumplido
    expect(limpio.puntos[0].acuerdos[0]).toMatchObject({ responsable_id: null, fecha_limite: null, cumplido: false, cumplido_at: null })
    expect(limpio.puntos[0].acuerdos[1].responsable_id).toBeNull()
    expect(limpio.puntos[0].acuerdos[2]).toMatchObject({ responsable_id: gestorId, fecha_limite: null, cumplido: true, cumplido_at: '2026-10-26T00:00:00Z' })
  })

  it('gestor: designar deja uno solo y quitar al gestor pasa el relevo al primero', () => {
    const ps = [
      { id: 'a', tipo: 'otro' as const, nombre: 'Ana', gestiona: true },
      { id: 'b', tipo: 'empleado' as const, nombre: 'Beto', gestiona: false },
    ]
    expect(designarGestor(ps, 'b').map(p => p.gestiona)).toEqual([false, true])
    expect(quitarParticipante(ps, 'a')).toEqual([{ ...ps[1], gestiona: true }])
    expect(quitarParticipante(ps, 'b')).toEqual([ps[0]])
    expect(quitarParticipante([ps[0]], 'a')).toEqual([])
  })
})

describe('candidatos a participante', () => {
  const personal = [
    { id: 'e1', nombre: 'Carlos Guardia', cargo: 'guardia', estado: 'activo' },
    { id: 'e2', nombre: 'Ana Limpieza', cargo: 'limpieza', estado: 'vacaciones' },
    { id: 'e3', nombre: 'Ex Empleado', cargo: 'guardia', estado: 'inactivo' },
  ] as PersonalCondominio[]
  const unidades = [
    { id: 'u1', nombre: 'Casa 1', propietario_nombre: 'Dueño Uno', activo: true },
    { id: 'u2', nombre: 'Casa 2', propietario_nombre: 'Dueño Dos', activo: true },
    { id: 'u3', nombre: 'Casa 3', propietario_nombre: 'Dueño Tres', activo: false },
  ] as Unidad[]
  const contratos = [
    { id: 'k1', unidad_id: 'u1', arrendatario_nombre: 'Inquilino Uno', estado: 'activo' },
    { id: 'k2', unidad_id: 'u2', arrendatario_nombre: 'Inquilino Dos', estado: 'activo' },
    { id: 'k3', unidad_id: 'u2', arrendatario_nombre: 'Inquilino Viejo', estado: 'terminado' },
  ] as ContratoArrendamiento[]
  const residentes = [
    { id: 'r1', unidad_id: 'u2', cliente_id: 'c1', tipo: 'propietario' as const, nombre: 'María Pérez', unidad_nombre: 'Casa 2' },
    { id: 'r2', unidad_id: 'u2', cliente_id: 'c2', tipo: 'arrendatario' as const, nombre: 'José López', unidad_nombre: 'Casa 2' },
  ]

  it('empleados: activos (y de vacaciones), con el nombre del cargo del catálogo si lo hay', () => {
    const lista = candidatosEmpleados(personal, c => (c === 'guardia' ? 'Guardia de seguridad' : undefined))
    expect(lista.map(c => c.nombre)).toEqual(['Ana Limpieza', 'Carlos Guardia'])
    expect(lista[1]).toMatchObject({ tipo: 'empleado', ref_id: 'e1', detalle: 'Guardia de seguridad' })
    expect(lista[0].detalle).toBe('Limpieza')
  })

  it('residentes: unidad_residentes manda; el dueño y el inquilino de contrato completan la unidad que no los tiene', () => {
    const lista = candidatosResidentes(residentes, unidades, contratos)
    expect(lista.map(c => `${c.nombre} · ${c.detalle}`)).toEqual([
      'Dueño Uno · Casa 1 · Propietario',
      'Inquilino Uno · Casa 1 · Inquilino',
      'José López · Casa 2 · Inquilino',
      'María Pérez · Casa 2 · Propietario',
    ])
    expect(lista.find(c => c.nombre === 'María Pérez')).toMatchObject({ tipo: 'residente', ref_id: 'r1' })
    expect(lista.find(c => c.nombre === 'Dueño Uno')).toMatchObject({ ref_id: null })
  })

  it('proveedores: catálogo activo y no vetado, más contratos vigentes cuyo nombre no está en él', () => {
    const catalogo = [
      { id: 'v1', nombre: 'Limpiezas SA', activo: true, contacto_nombre: 'Rosa' },
      { id: 'v2', nombre: 'Vetado SA', activo: true, estado: 'vetado' },
      { id: 'v3', nombre: 'Inactivo SA', activo: false },
    ] as ProveedorCatalogo[]
    const contratosProv = [
      { id: 'cp1', proveedor_nombre: 'limpiezas sa', servicio: 'limpieza', estado: 'activo' },
      { id: 'cp2', proveedor_nombre: 'Jardines GT', servicio: 'jardineria', estado: 'activo', proveedor_contacto: 'Pedro' },
      { id: 'cp3', proveedor_nombre: 'Viejo', servicio: 'otro', estado: 'terminado' },
    ] as ContratoProveedor[]
    const lista = candidatosProveedores(catalogo, contratosProv)
    expect(lista.map(c => c.nombre)).toEqual(['Jardines GT', 'Limpiezas SA'])
    expect(lista[1]).toMatchObject({ ref_id: 'v1', detalle: 'Rosa' })
    expect(lista[0]).toMatchObject({ ref_id: null, detalle: 'Pedro' })
  })

  it('filtrar ignora acentos y mayúsculas, y busca también en el detalle', () => {
    const lista = candidatosResidentes(residentes, unidades, contratos)
    expect(filtrarCandidatos(lista, 'jose').map(c => c.nombre)).toEqual(['José López'])
    expect(filtrarCandidatos(lista, 'CASA 1').map(c => c.nombre)).toEqual(['Dueño Uno', 'Inquilino Uno'])
    expect(filtrarCandidatos(lista, '  ')).toHaveLength(4)
  })

  it('yaParticipa: por fila de origen o, sin ella, por nombre y detalle', () => {
    const c = candidatosEmpleados(personal)[1]
    const p = participanteDesdeCandidato(c)
    expect(p).toMatchObject({ tipo: 'empleado', ref_id: 'e1', nombre: 'Carlos Guardia', gestiona: false })
    expect(yaParticipa([p], c)).toBe(true)
    expect(yaParticipa([p], { ...c, clave: 'x', ref_id: null })).toBe(true)
    expect(yaParticipa([p], { ...c, clave: 'x', ref_id: null, detalle: 'Otro cargo' })).toBe(false)
    expect(yaParticipa([{ ...p, tipo: 'otro' }], c)).toBe(false)
  })

  it('iniciales', () => {
    expect(iniciales('María José Pérez')).toBe('MP')
    expect(iniciales('Prestadora')).toBe('PR')
    expect(iniciales('   ')).toBe('?')
  })
})
