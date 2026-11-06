import { describe, it, expect, vi } from 'vitest'
import type { ContratoArrendamiento, ContratoProveedor, NotaAdmin, PersonalCondominio, PuntoMinuta, Unidad } from '../../../types'
import type { ProveedorCatalogo } from '../../../types/proveedores'

const dbMock = vi.hoisted(() => ({ from: vi.fn((_tabla: string): unknown => ({})), rpc: vi.fn(async (_fn: string, _args: unknown): Promise<unknown> => ({ data: null, error: null })) }))
vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: dbMock }))

const {
  archivosPorBorrar, borradorDesde, conFirma, estadoFirma, firmasDe, firmasDeParticipantes, fusionarFirmas, leerFirmasMinuta, registrarFirmaMinuta, rutasDelProyecto, resumenFirmas, sinFirma, versionAcuerdos, candidatosEmpleados, candidatosProveedores, candidatosResidentes, depurarBorrador, designarGestor,
  documentosDe, fechaDeMinuta, filtrarCandidatos, fotosDe, iniciales, mismasRutas, rutasQuitadas, MAX_DOCUMENTOS_MINUTA, marcarCumplido, participanteDesdeCandidato, participantesDe, plazoCompromiso, plazoSeguimiento,
  puntosDe, MAX_FOTOS_MINUTA, quitarParticipante, resumenCompromisos, situacionCompromiso, validarPasoMinuta, yaParticipa,
  TIPOS_PARTICIPANTE, TIPO_PARTICIPANTE_INFO, candidatosEquipo, etiquetaRolEquipo, fetchEquipoProyecto, minutaEnCurso, pasoBorradorDe, validarAvanceMinuta,
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

describe('fotos y documentos de la minuta', () => {
  it('fotosDe y documentosDe limpian lo que llega de la base: sin vacíos, sin repetidas y con tope', () => {
    expect(fotosDe(nota({}))).toEqual([])
    expect(fotosDe({ fotos: null })).toEqual([])
    expect(fotosDe({ fotos: 'p/minutas/a.jpg' as never })).toEqual([])
    expect(fotosDe({ fotos: ['p/minutas/a.jpg', ' ', 'p/minutas/a.jpg', 7, ' p/minutas/b.jpg '] as never })).toEqual(['p/minutas/a.jpg', 'p/minutas/b.jpg'])
    const muchas = Array.from({ length: 14 }, (_, i) => `p/minutas/${i}.jpg`)
    expect(fotosDe({ fotos: muchas })).toHaveLength(MAX_FOTOS_MINUTA)
    expect(documentosDe(nota({}))).toEqual([])
    expect(documentosDe({ documentos: ['p/minutas/acta.pdf', 'p/minutas/acta.pdf', ''] })).toEqual(['p/minutas/acta.pdf'])
    expect(documentosDe({ documentos: muchas })).toHaveLength(MAX_DOCUMENTOS_MINUTA)
  })

  it('rutasQuitadas y mismasRutas', () => {
    expect(rutasQuitadas(['a', 'b'], ['b', 'c'])).toEqual(['a'])
    expect(rutasQuitadas([], ['b'])).toEqual([])
    expect(mismasRutas(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(mismasRutas(['a', 'b'], ['b', 'a'])).toBe(false)
    expect(mismasRutas(['a'], ['a', 'b'])).toBe(false)
  })

  describe('archivosPorBorrar — una minuta nunca apunta a un archivo borrado', () => {
    const originales = ['s1.jpg', 's2.pdf']

    it('sin guardar: sólo lo subido en esta edición, aunque ya se haya quitado de la lista', () => {
      const vistas = ['s1.jpg', 's2.pdf', 'n1.jpg', 'n2.pdf']
      expect(archivosPorBorrar(originales, vistas, null)).toEqual(['n1.jpg', 'n2.pdf'])
      // Quitar una guardada y cancelar no la borra: la fila sigue apuntando a ella.
      expect(archivosPorBorrar(originales, ['s2.pdf'], null)).toEqual([])
    })

    it('guardada: lo que estuvo antes o en esta edición y ya no está en la fila', () => {
      const vistas = ['s1.jpg', 's2.pdf', 'n1.jpg', 'n2.pdf']
      expect(archivosPorBorrar(originales, vistas, ['s2.pdf', 'n1.jpg'])).toEqual(['s1.jpg', 'n2.pdf'])
      expect(archivosPorBorrar(originales, vistas, [...vistas])).toEqual([])
    })

    it('una minuta nueva que se guarda sin nada de lo subido lo borra todo; sin subir nada, nada', () => {
      expect(archivosPorBorrar([], ['n1.jpg'], [])).toEqual(['n1.jpg'])
      expect(archivosPorBorrar([], [], null)).toEqual([])
      expect(archivosPorBorrar(originales, [], originales)).toEqual([])
    })
  })

  it('el borrador de una minuta nueva no trae archivos; editar trae los guardados', () => {
    const nueva = borradorDesde(null, 'Admin', '2026-10-26')
    expect(nueva.fotos).toEqual([])
    expect(nueva.documentos).toEqual([])
    const editar = borradorDesde(nota({ fotos: ['p/minutas/a.jpg'], documentos: ['p/minutas/acta.pdf'] }), 'Admin', '2026-10-26')
    expect(editar.fotos).toEqual(['p/minutas/a.jpg'])
    expect(editar.documentos).toEqual(['p/minutas/acta.pdf'])
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

describe('firmas de la minuta', () => {
  const participantes = [
    { id: 'pa', tipo: 'otro' as const, ref_id: null, nombre: 'Admin', detalle: null, gestiona: true },
    { id: 'pb', tipo: 'empleado' as const, ref_id: 'e1', nombre: 'Carlos Guardia', detalle: 'Guardia', gestiona: false },
  ]
  const puntos: PuntoMinuta[] = [
    { id: 'q1', titulo: 'Rondas', descripcion: 'Nocturnas', acuerdos: [
      { id: 'a1', tipo: 'acuerdo', texto: 'Se mantiene el horario', cumplido: false },
      { id: 'c1', tipo: 'compromiso', texto: 'Registrar cada ronda', responsable_id: 'pb', fecha_limite: '2026-11-05', cumplido: false },
    ] },
  ]
  const firma = (o: Partial<{ participante_id: string; path: string; version: string }> = {}) => ({
    participante_id: 'pa', nombre: 'Admin', path: 'p1/minutas-firmas/a.png', firmado_at: '2026-11-02T15:00:00.000Z', version: 'v', ...o,
  })

  it('firmasDe: una por participante (gana la última), sin entradas sin ruta o sin participante', () => {
    expect(firmasDe(nota({}))).toEqual([])
    expect(firmasDe({ firmas: 'x' as never })).toEqual([])
    const lista = [firma(), { participante_id: 'pb' }, { path: 'p1/x.png' }, 7, firma({ path: 'p1/minutas-firmas/b.png' })]
    expect(firmasDe({ firmas: lista as never })).toEqual([firma({ path: 'p1/minutas-firmas/b.png' })])
  })

  it('versionAcuerdos: la misma para lo que se guarda y lo que se lee; cambia con lo acordado, no con «cumplido»', () => {
    const b = { ...borradorDesde(null, '', '2026-11-02'), titulo: 'X', participantes, puntos: [{ ...puntos[0], titulo: '  Rondas ', acuerdos: [...puntos[0].acuerdos, { id: 'v', tipo: 'acuerdo' as const, texto: '  ', cumplido: false }] }] }
    const guardado = depurarBorrador(b)
    const v = versionAcuerdos(guardado.puntos, guardado.participantes)
    // Ida y vuelta por la base.
    expect(versionAcuerdos(puntosDe({ puntos: guardado.puntos }), participantesDe({ participantes: guardado.participantes }))).toBe(v)
    expect(versionAcuerdos(puntos, participantes)).toBe(v)
    // Marcar un compromiso cumplido no la cambia.
    expect(versionAcuerdos(marcarCumplido(puntos, 'c1', true, '2026-11-03T10:00:00Z'), participantes)).toBe(v)
    // Cambiar un texto, el responsable o la fecha, sí.
    const con = (patch: object) => versionAcuerdos([{ ...puntos[0], acuerdos: [puntos[0].acuerdos[0], { ...puntos[0].acuerdos[1], ...patch }] }], participantes)
    expect(con({ texto: 'Registrar cada ronda en la bitácora' })).not.toBe(v)
    expect(con({ responsable_id: 'pa' })).not.toBe(v)
    expect(con({ fecha_limite: '2026-11-06' })).not.toBe(v)
    expect(versionAcuerdos([...puntos, { id: 'q2', titulo: 'Llaves', acuerdos: [] }], participantes)).not.toBe(v)
  })

  it('estado, resumen y edición de la lista de firmas', () => {
    const v = versionAcuerdos(puntos, participantes)
    const vigente = firma({ version: v })
    const anterior = firma({ participante_id: 'pb', path: 'p1/minutas-firmas/b.png', version: 'vieja' })
    const deUnQuitado = firma({ participante_id: 'px', path: 'p1/minutas-firmas/x.png', version: v })
    expect(estadoFirma(vigente, v)).toBe('vigente')
    expect(estadoFirma(anterior, v)).toBe('anterior')
    expect(resumenFirmas(participantes, [vigente, anterior, deUnQuitado], v)).toEqual({ total: 2, vigentes: 1, anteriores: 1, pendientes: 1 })
    expect(firmasDeParticipantes([vigente, deUnQuitado], participantes)).toEqual([vigente])
    const nueva = firma({ path: 'p1/minutas-firmas/a2.png', version: v })
    expect(conFirma([vigente, anterior], nueva)).toEqual([anterior, nueva])
    expect(sinFirma([vigente, anterior], 'pa')).toEqual([anterior])
  })

  it('el paso 4 no exige firmas; el borrador trae las guardadas', () => {
    const b = borradorDesde(nota({ participantes, puntos, firmas: [firma()] }), 'Admin', '2026-11-02')
    expect(b.firmas).toEqual([firma()])
    expect(validarPasoMinuta(b, 4)).toBeNull()
    expect(borradorDesde(null, 'Admin', '2026-11-02').firmas).toEqual([])
  })

  describe('fusionarFirmas — guardar el asistente no pisa lo que se firmó desde el detalle', () => {
    const pa = firma({ participante_id: 'pa', path: 'p1/minutas-firmas/pa.png' })
    const pb = firma({ participante_id: 'pb', path: 'p1/minutas-firmas/pb.png' })

    it('conserva la firma que otro registró mientras tanto y aplica la que esta edición cambió', () => {
      const pa2 = firma({ participante_id: 'pa', path: 'p1/minutas-firmas/pa2.png' })
      // Al abrir: [pa]. En la fila ahora: [pa, pb]. Esta edición volvió a firmar pa.
      expect(fusionarFirmas([pa, pb], [pa], [pa2])).toEqual([pb, pa2])
    })

    it('no revive una firma que el detalle reemplazó si esta edición no la tocó', () => {
      const paDetalle = firma({ participante_id: 'pa', path: 'p1/minutas-firmas/pa-detalle.png' })
      const pbNueva = firma({ participante_id: 'pb', path: 'p1/minutas-firmas/pb.png' })
      // Al abrir: [pa]. El detalle reemplazó pa. Esta edición sólo agregó pb.
      expect(fusionarFirmas([paDetalle], [pa], [pa, pbNueva])).toEqual([paDetalle, pbNueva])
    })

    it('una baja de esta edición se aplica; sin cambios, queda lo que tiene la fila', () => {
      expect(fusionarFirmas([pa, pb], [pa, pb], [pb])).toEqual([pb])
      expect(fusionarFirmas([pa, pb], [pa], [pa])).toEqual([pa, pb])
    })
  })

  it('rutasDelProyecto: sólo las de la carpeta del proyecto', () => {
    expect(rutasDelProyecto(['p1/minutas-firmas/a.png', 'p2/minutas-firmas/b.png', 'p10/x.png', 'p1x/y.png'], 'p1')).toEqual(['p1/minutas-firmas/a.png'])
  })

  describe('registrarFirmaMinuta', () => {
    function base(fila: unknown, afectadas: unknown[] = [{ id: 'n1' }]) {
      const updates: unknown[] = []
      dbMock.from.mockImplementation(() => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: fila, error: null }) }) }),
        update: (patch: unknown) => { updates.push(patch); return { eq: () => ({ select: async () => ({ data: afectadas, error: null }) }) } },
      }))
      return updates
    }

    it('relee las firmas de la fila y agrega la nueva sin pisar las de otros; devuelve la que reemplazó', async () => {
      const deOtro = firma({ participante_id: 'pb', path: 'p1/minutas-firmas/b.png' })
      const vieja = firma({ path: 'p1/minutas-firmas/a-vieja.png' })
      const updates = base({ firmas: [deOtro, vieja] })
      const nueva = firma({ path: 'p1/minutas-firmas/a-nueva.png' })
      expect(await registrarFirmaMinuta('n1', nueva)).toEqual({ error: null, reemplazada: 'p1/minutas-firmas/a-vieja.png' })
      expect(updates).toEqual([{ firmas: [deOtro, nueva] }])
    })

    it('leerFirmasMinuta: las firmas normalizadas de la fila, o null si no se pudo leer', async () => {
      base({ firmas: [firma(), { participante_id: 'x' }] })
      expect(await leerFirmasMinuta('n1')).toEqual([firma()])
      base(null)
      expect(await leerFirmasMinuta('n1')).toBeNull()
    })

    it('sin fila o sin filas afectadas es un error (no se reporta como firmado)', async () => {
      base(null)
      expect((await registrarFirmaMinuta('n1', firma())).error).toMatch(/ya no existe/)
      base({ firmas: [] }, [])
      expect((await registrarFirmaMinuta('n1', firma())).error).toMatch(/no tienes permiso/)
    })
  })
})

describe('equipo del proyecto (20261121000000)', () => {
  it('es la primera lista de participantes y tiene etiqueta, plural e icono', () => {
    expect(TIPOS_PARTICIPANTE[0]).toBe('equipo')
    expect(TIPO_PARTICIPANTE_INFO.equipo).toMatchObject({ label: 'Equipo del proyecto' })
    // Un participante guardado con el tipo nuevo se lee tal cual; uno desconocido sigue cayendo a «otro».
    expect(participantesDe({ participantes: [{ id: 'a', tipo: 'equipo', ref_id: 'u1', nombre: 'Ana', gestiona: true }] as never })[0]).toMatchObject({ tipo: 'equipo', ref_id: 'u1' })
  })

  it('etiquetaRolEquipo: las etiquetas del chip de rol; las dos grafías del superadministrador; desconocido capitalizado; vacío, «Equipo»', () => {
    expect(etiquetaRolEquipo('company_owner')).toBe('Admin Empresa')
    expect(etiquetaRolEquipo('admin')).toBe('Administrador')
    expect(etiquetaRolEquipo('operator')).toBe('Operador')
    expect(etiquetaRolEquipo('super_admin')).toBe('Super Admin')
    expect(etiquetaRolEquipo('superadmin')).toBe('Super Admin')
    expect(etiquetaRolEquipo('auditor_externo')).toBe('Auditor externo')
    expect(etiquetaRolEquipo('')).toBe('Equipo')
    expect(etiquetaRolEquipo(null)).toBe('Equipo')
  })

  it('candidatosEquipo: cada cuenta con su rol como detalle, por nombre, sin nombres vacíos', () => {
    const c = candidatosEquipo([
      { id: 'u2', full_name: 'Zoila Ruiz', role: 'operator' },
      { id: 'u1', full_name: ' Ana López ', role: 'company_owner' },
      { id: 'u3', full_name: '  ', role: 'admin' },
    ])
    expect(c).toEqual([
      { clave: 'equipo:u1', tipo: 'equipo', ref_id: 'u1', nombre: 'Ana López', detalle: 'Admin Empresa' },
      { clave: 'equipo:u2', tipo: 'equipo', ref_id: 'u2', nombre: 'Zoila Ruiz', detalle: 'Operador' },
    ])
    // Ya participa por cuenta (ref_id), aunque el nombre haya cambiado desde que se registró
    expect(yaParticipa([{ id: 'p', tipo: 'equipo', ref_id: 'u1', nombre: 'Ana L.', detalle: null, gestiona: true }], c[0])).toBe(true)
    // Un empleado con el mismo nombre no cuenta como la cuenta del equipo
    expect(yaParticipa([{ id: 'p', tipo: 'empleado', ref_id: 'e1', nombre: 'Ana López', detalle: 'Admin Empresa', gestiona: false }], c[0])).toBe(false)
  })

  it('borradorDesde: con la cuenta de quien crea, entra como equipo con su rol; sin ella, como «otro · Administración»', () => {
    const conCuenta = borradorDesde(null, ' Admin ', '2026-10-26', { id: 'u1', detalle: 'Admin Empresa' })
    expect(conCuenta.participantes).toHaveLength(1)
    expect(conCuenta.participantes[0]).toMatchObject({ tipo: 'equipo', ref_id: 'u1', nombre: 'Admin', detalle: 'Admin Empresa', gestiona: true })
    expect(borradorDesde(null, 'Admin', '2026-10-26', { id: 'u1', detalle: '  ' }).participantes[0]).toMatchObject({ tipo: 'equipo', detalle: 'Administración' })
    expect(borradorDesde(null, 'Admin', '2026-10-26').participantes[0]).toMatchObject({ tipo: 'otro', ref_id: null, detalle: 'Administración' })
    expect(borradorDesde(null, '   ', '2026-10-26', { id: 'u1', detalle: 'x' }).participantes).toEqual([])
  })

  it('fetchEquipoProyecto llama al RPC con el proyecto y devuelve las filas o el error (sin degradar a lista vacía en silencio)', async () => {
    dbMock.rpc.mockResolvedValueOnce({ data: [{ id: 'u1', full_name: 'Ana', role: 'admin' }], error: null })
    expect(await fetchEquipoProyecto('p1')).toEqual({ data: [{ id: 'u1', full_name: 'Ana', role: 'admin' }], error: null })
    expect(dbMock.rpc).toHaveBeenCalledWith('minutas_equipo_proyecto', { p_project_id: 'p1' })
    dbMock.rpc.mockResolvedValueOnce({ data: null, error: { message: 'No autorizado' } })
    expect(await fetchEquipoProyecto('p1')).toEqual({ data: [], error: 'No autorizado' })
  })
})

describe('minuta en curso: guardar el avance de cada paso (20261121000000)', () => {
  it('pasoBorradorDe y minutaEnCurso: 1–4 es el paso donde se retoma; null, otro valor o cerrada no están en curso', () => {
    expect(pasoBorradorDe(nota({ borrador_paso: 2 }))).toBe(2)
    expect(pasoBorradorDe(nota({ borrador_paso: 4 }))).toBe(4)
    expect(pasoBorradorDe(nota({}))).toBeNull()
    expect(pasoBorradorDe(nota({ borrador_paso: null }))).toBeNull()
    expect(pasoBorradorDe(nota({ borrador_paso: 0 }))).toBeNull()
    expect(pasoBorradorDe(nota({ borrador_paso: 5 }))).toBeNull()
    expect(pasoBorradorDe(nota({ borrador_paso: 2.5 }))).toBeNull()
    expect(pasoBorradorDe(null)).toBeNull()
    expect(minutaEnCurso(nota({ borrador_paso: 3 }))).toBe(true)
    expect(minutaEnCurso(nota({ borrador_paso: 3, resuelta: true }))).toBe(false)
    expect(minutaEnCurso(nota({ borrador_paso: null }))).toBe(false)
    expect(minutaEnCurso(null)).toBe(false)
  })

  it('validarAvanceMinuta: exige lo del paso 1 y fechas válidas, no puntos ni acuerdos; dice en qué paso falta', () => {
    const b = borradorDesde(null, 'Admin', '2026-10-26')
    expect(validarAvanceMinuta(b)).toEqual({ paso: 1, falta: 'Ponle un título a la minuta.' })
    b.titulo = 'Reunión'
    expect(validarAvanceMinuta(b)).toBeNull() // sin puntos: se guarda igual
    expect(validarPasoMinuta(b, 2)).not.toBeNull() // pero no se avanza al paso 3
    b.fecha_recordatorio = '2026-13-40'
    expect(validarAvanceMinuta(b)).toEqual({ paso: 3, falta: 'La fecha del próximo seguimiento no es válida.' })
    b.fecha_recordatorio = ''
    b.participantes = []
    expect(validarAvanceMinuta(b)).toEqual({ paso: 1, falta: 'Agrega al menos un participante.' })
  })
})
