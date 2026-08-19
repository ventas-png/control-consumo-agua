// ════════════════════════════════════════════════════════════════════════════
// Pruebas del verificador del harness RLS.
//
// El verificador es lo único que distingue "el job corrió y verificó" de "el
// job salió verde sin hacer nada", así que su lógica necesita pruebas propias:
// si él se equivoca, todo el fail-closed se cae en silencio.
//
// Nace además de un fallo concreto: la primera versión rechazaba el reporte si
// el nombre de alguna prueba contenía "omitido". Como vitest incluye las
// pruebas SKIPPED en el reporte, el `it.skip('omitido — …')` del harness
// aparecía SIEMPRE —también con credenciales— y el job no podía ponerse verde
// nunca. Aquí se fija que un nombre no basta para rechazar y que lo que sí
// rechaza es un skip REAL.
// ════════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest'
import { cargarCobertura as cargarCoberturaReal, evaluarReporte, pruebasDelReporte } from '../assert-rls-ejecutado.mjs'

// Manifiesto mínimo, independiente del real: estas pruebas fijan el
// COMPORTAMIENTO del verificador, no el contenido de coverage.json.
const COBERTURA = {
  minimoPruebas: 5,
  escenariosObligatorios: [
    { clave: 'aislamiento', patron: 'cobertura NO TRIVIAL', porQue: 'comparación con datos reales' },
    { clave: 'negativos', patron: 'negative write', porQue: 'el WITH CHECK debe rechazar' },
  ],
}

/** Manifiesto mínimo con RPC, para los casos de evidencia. */
const CON_RPCS = {
  ...COBERTURA,
  rpcsObligatorias: [
    {
      nombre: 'rpc_tenant', dominio: 'erp', porQue: 'aislamiento por pertenencia',
      garantia: 'tenant', evidencias: ['anon', 'authenticated-cross-tenant'],
    },
    {
      nombre: 'rpc_privilegio', dominio: 'notificaciones', porQue: 'EXECUTE revocado',
      garantia: 'privilegio', evidencias: ['anon', 'authenticated'],
    },
  ],
}

const id = (nombre, garantia, vector) => `[RLS:rpc:${nombre}:${garantia}:${vector}]`

/** Las cuatro evidencias que CON_RPCS exige, como pruebas pasadas. */
const EVIDENCIAS_OK = [
  ['passed', `RLS harness ${id('rpc_tenant', 'tenant', 'anon')} anon NO puede ejecutar rpc_tenant`],
  ['passed', `RLS harness ${id('rpc_tenant', 'tenant', 'authenticated-cross-tenant')} A sobre recurso de B`],
  ['passed', `RLS harness ${id('rpc_privilegio', 'privilegio', 'anon')} anon NO puede ejecutar rpc_privilegio`],
  ['passed', `RLS harness ${id('rpc_privilegio', 'privilegio', 'authenticated')} A NO puede ejecutar rpc_privilegio`],
]

/** Reporte de vitest sintético a partir de `[status, nombre]`. */
function reporte(pruebas, { suitesFallidas = 0 } = {}) {
  return {
    numTotalTests: pruebas.length,
    numFailedTestSuites: suitesFallidas,
    testResults: [
      { assertionResults: pruebas.map(([status, nombre]) => ({ status, fullName: nombre })) },
    ],
  }
}

const PASADAS_OK = [
  ['passed', 'RLS harness cobertura NO TRIVIAL proveedores: A ve al menos una fila PROPIA'],
  ['passed', 'RLS harness cobertura NO TRIVIAL proveedores: B ve al menos una fila PROPIA'],
  ['passed', 'RLS harness negative write cuotas_condominio: INSERT rechazado'],
  ['passed', 'RLS harness negative write documentos_fiscales: INSERT rechazado'],
  ['passed', 'RLS harness anon no puede leer tablas de negocio registros'],
]

describe('pruebasDelReporte', () => {
  it('aplana suites y tolera un reporte vacío', () => {
    expect(pruebasDelReporte(reporte(PASADAS_OK))).toHaveLength(5)
    expect(pruebasDelReporte({})).toEqual([])
    expect(pruebasDelReporte(null)).toEqual([])
  })
})

describe('evaluarReporte — ejecución válida', () => {
  it('acepta un reporte con pruebas pasadas y todos los escenarios', () => {
    const v = evaluarReporte(reporte(PASADAS_OK), COBERTURA)
    expect(v.errores).toEqual([])
    expect(v.ok).toBe(true)
    expect(v.resumen.pasadas).toBe(5)
    expect(v.resumen.escenariosAusentes).toEqual([])
  })

  it('NO rechaza por el mero nombre de una prueba (regresión del marcador)', () => {
    // El texto "omitido" en un nombre no es señal de nada: lo que importa es el
    // status. Con la lógica anterior esto fallaba para siempre.
    const conNombreSospechoso = [
      ...PASADAS_OK,
      ['passed', 'RLS harness documenta por qué el bloque omitido ya no existe'],
    ]
    const v = evaluarReporte(reporte(conNombreSospechoso), COBERTURA)
    expect(v.ok).toBe(true)
  })
})

describe('evaluarReporte — cero pruebas', () => {
  it('rechaza un reporte sin ninguna prueba', () => {
    const v = evaluarReporte(reporte([]), COBERTURA)
    expect(v.ok).toBe(false)
    expect(v.errores.join(' ')).toContain('no se ejecutó NINGUNA prueba')
  })

  it('rechaza un reporte donde todo quedó skipped (harness auto-saltado)', () => {
    const v = evaluarReporte(reporte(PASADAS_OK.map(([, n]) => ['skipped', n])), COBERTURA)
    expect(v.ok).toBe(false)
    expect(v.errores.join(' ')).toContain('no se ejecutó NINGUNA prueba')
  })
})

describe('evaluarReporte — fallos', () => {
  it('rechaza si alguna prueba falló', () => {
    const conFallo = [...PASADAS_OK.slice(1), ['failed', 'RLS harness cobertura NO TRIVIAL proveedores: A ve fila PROPIA']]
    const v = evaluarReporte(reporte(conFallo), COBERTURA)
    expect(v.ok).toBe(false)
    expect(v.errores.join(' ')).toContain('hay fallos')
  })

  it('rechaza si falló una SUITE aunque las pruebas listadas pasen', () => {
    const v = evaluarReporte(reporte(PASADAS_OK, { suitesFallidas: 1 }), COBERTURA)
    expect(v.ok).toBe(false)
    expect(v.errores.join(' ')).toContain('1 suite(s)')
  })
})

describe('evaluarReporte — por debajo del mínimo', () => {
  it('rechaza si se ejecutaron menos pruebas que el piso', () => {
    const v = evaluarReporte(reporte(PASADAS_OK), { ...COBERTURA, minimoPruebas: 50 })
    expect(v.ok).toBe(false)
    expect(v.errores.join(' ')).toContain('por debajo del piso de 50')
  })

  it('el piso por argumento tiene prioridad sobre el del manifiesto', () => {
    const v = evaluarReporte(reporte(PASADAS_OK), { ...COBERTURA, minimoPruebas: 50 }, { minimo: 3 })
    expect(v.ok).toBe(true)
  })
})

describe('evaluarReporte — escenario obligatorio ausente', () => {
  it('rechaza si falta un describe obligatorio aunque el total supere el piso', () => {
    // Se borra el bloque de negative write y se rellena con ruido: 5 pruebas
    // pasadas, por encima del piso, pero un escenario crítico desaparecido.
    const sinNegativos = [
      PASADAS_OK[0], PASADAS_OK[1], PASADAS_OK[4],
      ['passed', 'RLS harness relleno uno'],
      ['passed', 'RLS harness relleno dos'],
    ]
    const v = evaluarReporte(reporte(sinNegativos), COBERTURA)
    expect(v.ok).toBe(false)
    expect(v.resumen.pasadas).toBe(5)
    expect(v.resumen.escenariosAusentes).toEqual(['negativos'])
    expect(v.errores.join(' ')).toContain('negative write')
  })

  it('un escenario presente sólo como prueba FALLIDA no cuenta como cubierto', () => {
    const negativoFallido = [
      PASADAS_OK[0], PASADAS_OK[1], PASADAS_OK[4],
      ['failed', 'RLS harness negative write cuotas_condominio: INSERT rechazado'],
      ['passed', 'RLS harness relleno'],
    ]
    const v = evaluarReporte(reporte(negativoFallido), COBERTURA)
    expect(v.ok).toBe(false)
    expect(v.resumen.escenariosAusentes).toEqual(['negativos'])
  })
})

describe('evaluarReporte — skip/todo inesperado', () => {
  it('rechaza un it.skip que se cuele, aunque todo lo demás pase', () => {
    const conSkip = [...PASADAS_OK, ['skipped', 'RLS harness prueba desactivada a mano']]
    const v = evaluarReporte(reporte(conSkip), COBERTURA)
    expect(v.ok).toBe(false)
    expect(v.resumen.omitidas).toBe(1)
    expect(v.errores.join(' ')).toContain('Cobertura perdida en silencio')
  })

  it('rechaza un it.todo', () => {
    const conTodo = [...PASADAS_OK, ['todo', 'RLS harness pendiente de escribir']]
    const v = evaluarReporte(reporte(conTodo), COBERTURA)
    expect(v.ok).toBe(false)
    expect(v.errores.join(' ')).toContain('skip/todo')
  })

  it("trata 'pending' como omitida (nomenclatura alterna de vitest)", () => {
    const conPending = [...PASADAS_OK, ['pending', 'RLS harness algo pendiente']]
    const v = evaluarReporte(reporte(conPending), COBERTURA)
    expect(v.ok).toBe(false)
    expect(v.resumen.omitidas).toBe(1)
  })
})

describe('evaluarReporte — el manifiesto REAL del repo', () => {
  it('el harness declara suficientes pruebas para el piso configurado', async () => {
    const { cargarCobertura } = await import('../assert-rls-ejecutado.mjs')
    const real = cargarCobertura()
    expect(real.minimoPruebas).toBeGreaterThan(0)
    expect(real.escenariosObligatorios.length).toBeGreaterThan(0)
    for (const e of real.escenariosObligatorios) {
      expect(e.clave, 'cada escenario necesita clave').toBeTruthy()
      expect(e.patron, 'cada escenario necesita patrón').toBeTruthy()
      expect(e.porQue, 'cada escenario necesita justificación').toBeTruthy()
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Eliminación SIMULADA de cada escenario y de cada RPC obligatoria.
// ════════════════════════════════════════════════════════════════════════════
// La granularidad del verificador sólo vale si se demuestra una a una: que
// "faltan escenarios" se detecte en el caso de ejemplo no prueba que se detecte
// para TODOS. Aquí se sintetiza un reporte que cubre el manifiesto REAL del
// repo y se le quita, de uno en uno, cada escenario y cada RPC; en cada
// iteración el verificador debe pasar de ok a NO ok señalando exactamente lo
// que se borró. Así, si alguien añade un escenario o una RPC al manifiesto y el
// verificador no lo comprueba, esta prueba lo delata.
const REAL = cargarCoberturaReal()

/** Reporte sintético que cubre TODO el manifiesto real, con relleno hasta el piso. */
function reporteCompletoReal() {
  const pruebas = [
    ...REAL.escenariosObligatorios.map((e) => ['passed', `RLS harness ${e.patron} — caso sintético`]),
    // Con marcador de evidencia: el nombre desnudo ya no acredita nada.
    ...REAL.rpcsObligatorias.flatMap((r) =>
      r.evidencias.map((v) => ['passed', `RLS harness [RLS:rpc:${r.nombre}:${r.garantia}:${v}] sintético`]),
    ),
  ]
  // Relleno neutro: el piso mínimo no debe ser el motivo del fallo en estas
  // pruebas — el motivo tiene que ser exclusivamente la pieza eliminada.
  while (pruebas.length < REAL.minimoPruebas + 10) {
    pruebas.push(['passed', `RLS harness relleno neutro ${pruebas.length}`])
  }
  return reporte(pruebas)
}

/** Quita del reporte toda prueba cuyo nombre contenga `texto`. */
function sinPruebasQueContengan(rep, texto) {
  const quedan = rep.testResults[0].assertionResults
    .filter((a) => !a.fullName.includes(texto))
    .map((a) => [a.status, a.fullName])
  return reporte(quedan)
}

describe('evaluarReporte — el manifiesto real se verifica pieza por pieza', () => {
  it('el reporte sintético completo es aceptado (control del experimento)', () => {
    const v = evaluarReporte(reporteCompletoReal(), REAL)
    expect(v.errores).toEqual([])
    expect(v.ok).toBe(true)
    expect(v.resumen.escenariosAusentes).toEqual([])
    expect(v.resumen.rpcsAusentes).toEqual([])
  })

  it.each(REAL.escenariosObligatorios.map((e) => [e.clave, e.patron]))(
    'detecta la desaparición del escenario «%s»',
    (clave, patron) => {
      const v = evaluarReporte(sinPruebasQueContengan(reporteCompletoReal(), patron), REAL)
      expect(v.ok, `borrar «${patron}» dejó verde al verificador`).toBe(false)
      expect(v.resumen.escenariosAusentes).toContain(clave)
      expect(v.errores.join(' ')).toContain(patron)
    },
  )

  it.each(REAL.rpcsObligatorias.map((r) => [r.nombre, r.dominio]))(
    'detecta la desaparición COMPLETA de la RPC %s (dominio %s)',
    (nombre) => {
      const v = evaluarReporte(
        sinPruebasQueContengan(reporteCompletoReal(), `[RLS:rpc:${nombre}:`),
        REAL,
      )
      expect(v.ok, `borrar la RPC ${nombre} dejó verde al verificador`).toBe(false)
      expect(v.resumen.rpcsAusentes).toContain(nombre)
      expect(v.errores.join(' ')).toContain(nombre)
    },
  )

  it('borrar una RPC NO se compensa con que sobreviva el resto de su dominio', () => {
    // Es la regresión concreta: antes bastaba con que el bloque del dominio
    // ("RPCs del ERP financiero") existiera para dar por cubiertas sus seis
    // RPC. Aquí se borran las evidencias de UNA sola y el resto del dominio
    // sigue presente. El filtro va por el prefijo del marcador, para no llevarse
    // por delante las de otra RPC cuyo nombre lo contenga.
    const objetivo = REAL.rpcsObligatorias.find((r) => r.nombre === 'banco_ajuste_conciliacion')
    expect(objetivo, 'banco_ajuste_conciliacion debe seguir declarada').toBeTruthy()
    const v = evaluarReporte(
      sinPruebasQueContengan(reporteCompletoReal(), `[RLS:rpc:${objetivo.nombre}:`),
      REAL,
    )
    const hermanas = REAL.rpcsObligatorias.filter((r) => r.dominio === objetivo.dominio)
    expect(hermanas.length).toBeGreaterThan(1)
    expect(v.resumen.rpcsAusentes).toEqual([objetivo.nombre])
    expect(v.ok).toBe(false)
  })

  it('cada RPC declarada trae dominio y justificación, y no hay duplicados', () => {
    const nombres = REAL.rpcsObligatorias.map((r) => r.nombre)
    expect(new Set(nombres).size, 'hay RPC duplicadas en coverage.json').toBe(nombres.length)
    for (const r of REAL.rpcsObligatorias) {
      expect(r.dominio, `${r.nombre} sin dominio`).toBeTruthy()
      expect(r.porQue, `${r.nombre} sin justificación`).toBeTruthy()
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Evidencia por RPC: el nombre no acredita nada.
// ════════════════════════════════════════════════════════════════════════════
// FALSO VERDE REPRODUCIDO antes de corregir: el verificador daba por cubierta
// una RPC en cuanto alguna prueba pasada CONTENÍA su nombre —
//
//     pasadas.some((p) => p.nombre.includes(r.nombre))
//
// — así que un reporte con las 23 RPC probadas SÓLO como anon devolvía
// `ok: true`, `rpcsExigidas: 23`, `rpcsAusentes: []`. Las declaradas como
// aislamiento por tenant quedaban "acreditadas" por una prueba que no ejercita
// pertenencia en absoluto.
describe('evidencia por RPC — una prueba de anon no acredita una autenticada', () => {
  it('acepta un reporte con TODAS las evidencias declaradas', () => {
    const v = evaluarReporte(reporte([...PASADAS_OK, ...EVIDENCIAS_OK]), CON_RPCS)
    expect(v.errores).toEqual([])
    expect(v.ok).toBe(true)
    expect(v.resumen.evidenciasExigidas).toBe(4)
    expect(v.resumen.evidenciasAusentes).toEqual([])
  })

  it('RECHAZA el reporte donde las RPC sólo tienen pruebas de anon', () => {
    // Exactamente el falso verde, en miniatura.
    const soloAnon = [
      ...PASADAS_OK,
      ['passed', `RLS harness ${id('rpc_tenant', 'tenant', 'anon')} anon NO puede ejecutar rpc_tenant`],
      ['passed', `RLS harness ${id('rpc_privilegio', 'privilegio', 'anon')} anon NO puede ejecutar rpc_privilegio`],
    ]
    const v = evaluarReporte(reporte(soloAnon), CON_RPCS)

    expect(v.ok, 'un reporte sólo-anon no puede quedar verde').toBe(false)
    expect(v.resumen.evidenciasAusentes).toEqual([
      'rpc_tenant:authenticated-cross-tenant',
      'rpc_privilegio:authenticated',
    ])
    expect(v.errores.join(' ')).toContain('falta la evidencia')
  })

  it('el NOMBRE de la RPC en una prueba pasada ya no basta', () => {
    // Sin marcador: la prueba nombra la RPC y nada más. Antes bastaba.
    const soloNombre = [
      ...PASADAS_OK,
      ['passed', 'RLS harness algo sobre rpc_tenant y rpc_privilegio'],
    ]
    const v = evaluarReporte(reporte(soloNombre), CON_RPCS)
    expect(v.ok).toBe(false)
    expect(v.resumen.evidenciasAusentes).toHaveLength(4)
  })

  it('un marcador con la GARANTÍA equivocada no acredita', () => {
    // Si alguien reclasifica la RPC en el manifiesto pero no en el harness (o al
    // revés), el id deja de casar y la evidencia se considera ausente.
    const garantiaMal = [
      ...PASADAS_OK,
      ['passed', `RLS harness ${id('rpc_tenant', 'rol', 'anon')} anon`],
      ['passed', `RLS harness ${id('rpc_tenant', 'rol', 'authenticated-cross-tenant')} A sobre B`],
      EVIDENCIAS_OK[2], EVIDENCIAS_OK[3],
    ]
    const v = evaluarReporte(reporte(garantiaMal), CON_RPCS)
    expect(v.ok).toBe(false)
    expect(v.resumen.evidenciasAusentes).toEqual([
      'rpc_tenant:anon',
      'rpc_tenant:authenticated-cross-tenant',
    ])
  })

  it('una evidencia presente sólo como prueba FALLIDA no cuenta', () => {
    const fallida = [
      ...PASADAS_OK,
      EVIDENCIAS_OK[0],
      ['failed', `RLS harness ${id('rpc_tenant', 'tenant', 'authenticated-cross-tenant')} A sobre B`],
      EVIDENCIAS_OK[2], EVIDENCIAS_OK[3],
    ]
    const v = evaluarReporte(reporte(fallida), CON_RPCS)
    expect(v.resumen.evidenciasAusentes).toEqual(['rpc_tenant:authenticated-cross-tenant'])
  })

  it('una RPC sin evidencias declaradas se trata como NO cubierta', () => {
    // Un manifiesto vacío no es "todo vale": es una RPC sin contrato.
    const sinContrato = { ...CON_RPCS, rpcsObligatorias: [{ nombre: 'x', dominio: 'd', porQue: 'p', garantia: 'tenant', evidencias: [] }] }
    const v = evaluarReporte(reporte(PASADAS_OK), sinContrato)
    expect(v.ok).toBe(false)
    expect(v.errores.join(' ')).toContain('no declara ninguna evidencia')
  })

  it.each([
    ['rpc_tenant', 'tenant', 'anon'],
    ['rpc_tenant', 'tenant', 'authenticated-cross-tenant'],
    ['rpc_privilegio', 'privilegio', 'anon'],
    ['rpc_privilegio', 'privilegio', 'authenticated'],
  ])('eliminar la evidencia %s:%s:%s se detecta', (nombre, garantia, vector) => {
    const marcador = id(nombre, garantia, vector)
    const sinEsa = [...PASADAS_OK, ...EVIDENCIAS_OK].filter(([, n]) => !n.includes(marcador))
    const v = evaluarReporte(reporte(sinEsa), CON_RPCS)

    expect(v.ok, `borrar ${marcador} dejó verde al verificador`).toBe(false)
    expect(v.resumen.evidenciasAusentes).toEqual([`${nombre}:${vector}`])
  })
})

// ── Y lo mismo sobre el manifiesto REAL, evidencia por evidencia ────────────
describe('el manifiesto real se acredita evidencia por evidencia', () => {
  /** Reporte sintético que cubre TODAS las evidencias reales, con relleno. */
  function reporteRealCompleto() {
    const pruebas = [
      ...REAL.escenariosObligatorios.map((e) => ['passed', `RLS harness ${e.patron} — sintético`]),
      ...REAL.rpcsObligatorias.flatMap((r) =>
        r.evidencias.map((v) => [
          'passed',
          `RLS harness [RLS:rpc:${r.nombre}:${r.garantia}:${v}] caso sintético`,
        ]),
      ),
    ]
    while (pruebas.length < REAL.minimoPruebas + 10) {
      pruebas.push(['passed', `RLS harness relleno neutro ${pruebas.length}`])
    }
    return reporte(pruebas)
  }

  it('el reporte completo es aceptado (control del experimento)', () => {
    const v = evaluarReporte(reporteRealCompleto(), REAL)
    expect(v.errores).toEqual([])
    expect(v.ok).toBe(true)
    expect(v.resumen.evidenciasAusentes).toEqual([])
  })

  it('RECHAZA el manifiesto real probado SÓLO como anon', () => {
    // La reproducción exacta del hallazgo, a escala real.
    const pruebas = [
      ...REAL.escenariosObligatorios.map((e) => ['passed', `RLS harness ${e.patron} — sintético`]),
      ...REAL.rpcsObligatorias.map((r) => ['passed', `RLS harness anon NO puede ejecutar ${r.nombre}`]),
    ]
    while (pruebas.length < REAL.minimoPruebas + 10) {
      pruebas.push(['passed', `RLS harness relleno ${pruebas.length}`])
    }
    const v = evaluarReporte(reporte(pruebas), REAL)

    expect(v.ok).toBe(false)
    expect(v.resumen.evidenciasAusentes.length).toBe(v.resumen.evidenciasExigidas)
  })

  it.each(
    REAL.rpcsObligatorias.flatMap((r) => r.evidencias.map((v) => [r.nombre, v, r.garantia])),
  )('detecta la desaparición de la evidencia %s:%s', (nombre, vector, garantia) => {
    const marcador = `[RLS:rpc:${nombre}:${garantia}:${vector}]`
    const rep = reporteRealCompleto()
    const quedan = rep.testResults[0].assertionResults
      .filter((a) => !a.fullName.includes(marcador))
      .map((a) => [a.status, a.fullName])

    const v = evaluarReporte(reporte(quedan), REAL)
    expect(v.ok, `borrar ${marcador} dejó verde al verificador`).toBe(false)
    expect(v.resumen.evidenciasAusentes).toContain(`${nombre}:${vector}`)
  })

  it('cada RPC real declara al menos una evidencia y todas son vectores válidos', () => {
    const VECTORES = ['anon', 'authenticated', 'authenticated-cross-tenant']
    for (const r of REAL.rpcsObligatorias) {
      expect(r.evidencias?.length, `${r.nombre} sin evidencias`).toBeGreaterThan(0)
      for (const v of r.evidencias) {
        expect(VECTORES, `${r.nombre} declara el vector "${v}"`).toContain(v)
      }
    }
  })

  it('toda RPC de garantía tenant o rol exige una evidencia AUTENTICADA', () => {
    // Es el corazón del hallazgo: anon no ejercita ni pertenencia ni rol.
    for (const r of REAL.rpcsObligatorias.filter((x) => ['tenant', 'rol'].includes(x.garantia))) {
      const autenticadas = r.evidencias.filter((v) => v.startsWith('authenticated'))
      expect(autenticadas.length, `${r.nombre} (${r.garantia}) sólo exige anon`).toBeGreaterThan(0)
    }
  })

  it('toda RPC de garantía tenant exige la evidencia CROSS-TENANT', () => {
    for (const r of REAL.rpcsObligatorias.filter((x) => x.garantia === 'tenant')) {
      expect(r.evidencias, `${r.nombre} declara tenant sin cross-tenant`)
        .toContain('authenticated-cross-tenant')
    }
  })

  it('conta_cierre_anual NO se cuenta como aislamiento demostrado', () => {
    // Se excluía del bucle authenticated y sólo se probaba como anon, pero se
    // declaraba `tenant`. Ahora es `estructural` y su motivo está escrito.
    const r = REAL.rpcsObligatorias.find((x) => x.nombre === 'conta_cierre_anual')
    expect(r.garantia).toBe('estructural')
    expect(r.evidencias).toEqual(['anon'])
    expect(REAL.motivoRpcEstructural).toContain('p_project_id')
  })
})
