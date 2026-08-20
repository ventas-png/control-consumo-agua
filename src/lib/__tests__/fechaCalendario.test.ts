// Fechas de calendario (columnas SQL `date`) — regresión por zona horaria.
//
// El bug original: `new Date('2026-01-01')` se interpreta como medianoche UTC,
// así que en America/Guatemala (GMT-6) la UI mostraba "31 dic 2025" para el
// periodo_inicio de una factura fechada el 1 de enero.
//
// Estas pruebas ejecutan la MISMA batería bajo cuatro husos —UTC, uno negativo
// cercano (GT), uno negativo lejano (LA) y uno positivo (Tokio)— reasignando
// `process.env.TZ`, que Node reevalúa en la siguiente operación de fecha.

import { describe, it, expect, afterAll, beforeEach } from 'vitest'
import {
  parseFechaCalendario,
  esFechaCalendario,
  formatFechaCalendario,
  hoyCalendario,
  diasEntreFechasCalendario,
  diasHastaFechaCalendario,
  esFechaCalendarioVencida,
  sumarDiasCalendario,
  dateLocalISO,
  diaLocalDeInstante,
  parseFecha,
  formatDate,
  formatDateShort,
  setDefaultLocale,
} from '../format'

const TZ_ORIGINAL = process.env.TZ

/** Husos exigidos por el PR: UTC, GMT-6, GMT-8 y GMT+9. */
const ZONAS = ['UTC', 'America/Guatemala', 'America/Los_Angeles', 'Asia/Tokyo'] as const

/**
 * Cadenas que NO son fechas de calendario. El parser debe rechazarlas todas:
 * llevan hora (y a veces zona), así que aplanarlas a un día local perdería el
 * instante y desplazaría la fecha en husos negativos.
 */
const TIMESTAMPS = [
  '2026-01-01T00:00:00',
  '2026-01-01T03:00:00Z',
  '2026-01-01T03:00:00-06:00',
  '2026-01-01T00:00:00.000Z',
  '2026-01-01 00:00:00',
  '2026-01-01 cualquier-cosa',
  '2026-01-01T',
  '2026-01-01 ',
] as const

function conZona(tz: string, fn: () => void): void {
  process.env.TZ = tz
  try {
    fn()
  } finally {
    process.env.TZ = TZ_ORIGINAL
  }
}

afterAll(() => {
  process.env.TZ = TZ_ORIGINAL
})

beforeEach(() => {
  setDefaultLocale('es-GT')
})

describe.each(ZONAS)('fechas de calendario bajo %s', (tz) => {
  it('2026-01-01 es SIEMPRE el 1 de enero de 2026', () => {
    conZona(tz, () => {
      const d = parseFechaCalendario('2026-01-01')!
      expect(d).not.toBeNull()
      expect(d.getFullYear()).toBe(2026)
      expect(d.getMonth()).toBe(0)
      expect(d.getDate()).toBe(1)
    })
  })

  it('2026-01-01 se formatea como 1 de enero de 2026', () => {
    conZona(tz, () => {
      const largo = formatFechaCalendario(
        '2026-01-01',
        { day: 'numeric', month: 'long', year: 'numeric' },
        'es-GT',
      )
      expect(largo).toMatch(/1 de enero de 2026/i)
      expect(formatFechaCalendario('2026-01-01')).toBe('01/01/2026')
    })
  })

  it('formatDate/formatDateShort del módulo comparten la corrección', () => {
    conZona(tz, () => {
      expect(formatDate('2026-01-01')).toMatch(/1 de enero de 2026/i)
      expect(formatDateShort('2026-01-01')).toBe('1/1/2026')
    })
  })

  it('periodo_inicio/periodo_fin de una factura conservan su día', () => {
    conZona(tz, () => {
      // Caso real reportado: FacturasTab mostraba "31 dic – 31 ene" en GT.
      const inicio = formatFechaCalendario('2026-01-01', { month: 'short', day: 'numeric' }, 'es-MX')
      const fin = formatFechaCalendario('2026-01-31', { month: 'short', day: 'numeric', year: 'numeric' }, 'es-MX')
      expect(inicio).toMatch(/^1 /)
      expect(fin).toMatch(/^31 /)
      expect(fin).toMatch(/2026/)
    })
  })

  it('conserva el día en los bordes de mes y de año', () => {
    conZona(tz, () => {
      for (const iso of ['2026-01-31', '2026-02-01', '2026-04-30', '2026-05-01', '2026-12-31', '2027-01-01']) {
        const d = parseFechaCalendario(iso)!
        const [y, m, dd] = iso.split('-').map(Number)
        expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([y, m, dd])
      }
    })
  })

  it('año bisiesto: 2024-02-29 existe y 2026-02-29 no', () => {
    conZona(tz, () => {
      const bisiesto = parseFechaCalendario('2024-02-29')!
      expect(bisiesto.getMonth()).toBe(1)
      expect(bisiesto.getDate()).toBe(29)
      expect(parseFechaCalendario('2026-02-29')).toBeNull()
      expect(parseFechaCalendario('2100-02-29')).toBeNull() // 2100 no es bisiesto
      expect(parseFechaCalendario('2000-02-29')).not.toBeNull() // 2000 sí lo es
    })
  })

  it('la aritmética de días no se desplaza', () => {
    conZona(tz, () => {
      expect(diasEntreFechasCalendario('2026-01-01', '2026-01-31')).toBe(30)
      expect(diasEntreFechasCalendario('2026-02-28', '2026-03-01')).toBe(1)
      expect(diasEntreFechasCalendario('2024-02-28', '2024-03-01')).toBe(2) // bisiesto
      expect(diasEntreFechasCalendario('2026-12-31', '2027-01-01')).toBe(1)
      expect(diasEntreFechasCalendario('2026-01-31', '2026-01-01')).toBe(-30)
      expect(diasEntreFechasCalendario('2026-01-01', '2026-01-01')).toBe(0)
    })
  })

  it('los días restantes se cuentan contra el día LOCAL de la referencia', () => {
    conZona(tz, () => {
      // 23:30 hora local del 1 de enero: en husos negativos el instante ya es
      // 2 de enero UTC, y el patrón viejo restaba un día de más.
      const ref = new Date(2026, 0, 1, 23, 30, 0)
      expect(diasHastaFechaCalendario('2026-01-01', ref)).toBe(0)
      expect(diasHastaFechaCalendario('2026-01-02', ref)).toBe(1)
      expect(diasHastaFechaCalendario('2025-12-31', ref)).toBe(-1)
      expect(esFechaCalendarioVencida('2025-12-31', ref)).toBe(true)
      expect(esFechaCalendarioVencida('2026-01-01', ref)).toBe(false)
      expect(esFechaCalendarioVencida('2026-06-01', ref)).toBe(false)
    })
  })

  it('sumarDiasCalendario cruza meses, años y bisiestos sin desplazarse', () => {
    conZona(tz, () => {
      expect(sumarDiasCalendario('2026-01-01', 30)).toBe('2026-01-31')
      expect(sumarDiasCalendario('2026-01-31', 1)).toBe('2026-02-01')
      expect(sumarDiasCalendario('2026-12-31', 1)).toBe('2027-01-01')
      expect(sumarDiasCalendario('2024-02-28', 1)).toBe('2024-02-29')
      expect(sumarDiasCalendario('2026-02-28', 1)).toBe('2026-03-01')
      expect(sumarDiasCalendario('2026-03-01', -1)).toBe('2026-02-28')
      expect(sumarDiasCalendario('2026-01-01', 0)).toBe('2026-01-01')
    })
  })

  it('hoyCalendario cae en el día LOCAL', () => {
    conZona(tz, () => {
      const ahora = new Date()
      const hoy = hoyCalendario()
      expect(hoy.getFullYear()).toBe(ahora.getFullYear())
      expect(hoy.getMonth()).toBe(ahora.getMonth())
      expect(hoy.getDate()).toBe(ahora.getDate())
      expect(diasHastaFechaCalendario(hoy)).toBe(0)
    })
  })

  it('los timestamps ISO con hora conservan su conversión por zona', () => {
    conZona(tz, () => {
      // 2026-01-01T03:00:00Z es todavía 31/dic en GT y LA, y ya 1/ene en Tokio:
      // ese comportamiento NO debe cambiar.
      const iso = '2026-01-01T03:00:00Z'
      const d = parseFecha(iso)
      expect(d.toISOString()).toBe('2026-01-01T03:00:00.000Z')
      const diaLocalEsperado: Record<string, number> = {
        'UTC': 1,
        'America/Guatemala': 31,
        'America/Los_Angeles': 31,
        'Asia/Tokyo': 1,
      }
      expect(d.getDate()).toBe(diaLocalEsperado[tz])
      // Y un timestamp NO es una fecha de calendario: no debe colarse por el
      // parser de calendario perdiendo su hora.
      expect(parseFecha('2026-05-16T18:00:00Z').toISOString()).toBe('2026-05-16T18:00:00.000Z')
    })
  })
})

describe('valores nulos, vacíos e inválidos', () => {
  const BASURA: unknown[] = [
    null, undefined, '', '   ', 'null', 'undefined', 'no-es-fecha',
    '2026-13-01', '2026-00-10', '2026-01-32', '2026-01-00', '2026-02-30',
    '01/01/2026', '2026/01/01', '26-01-01', '2026-1-1', 'NaN', '2026-01-0a',
    ...TIMESTAMPS,
  ]

  it('parseFechaCalendario devuelve null (nunca Invalid Date)', () => {
    for (const v of BASURA) {
      expect(parseFechaCalendario(v as string)).toBeNull()
    }
    expect(parseFechaCalendario(new Date(NaN))).toBeNull()
  })

  it('esFechaCalendario discrimina correctamente', () => {
    expect(esFechaCalendario('2026-01-01')).toBe(true)
    for (const v of BASURA) expect(esFechaCalendario(v)).toBe(false)
  })

  it('formatFechaCalendario no imprime "Invalid Date"', () => {
    for (const v of BASURA) {
      expect(formatFechaCalendario(v as string)).toBe('')
      expect(formatFechaCalendario(v as string, {}, 'es-GT', '—')).toBe('—')
    }
  })

  it('la aritmética devuelve null en vez de NaN', () => {
    expect(diasEntreFechasCalendario(null, '2026-01-01')).toBeNull()
    expect(diasEntreFechasCalendario('2026-01-01', '')).toBeNull()
    expect(diasHastaFechaCalendario('basura')).toBeNull()
    expect(sumarDiasCalendario(null, 3)).toBeNull()
    expect(sumarDiasCalendario('2026-01-01', NaN)).toBeNull()
    expect(esFechaCalendarioVencida(null)).toBe(false)
    expect(esFechaCalendarioVencida('')).toBe(false)
  })

  it('parseFecha sigue devolviendo Invalid Date para lo no parseable (contrato previo)', () => {
    expect(Number.isNaN(parseFecha(null).getTime())).toBe(true)
    expect(Number.isNaN(parseFecha('').getTime())).toBe(true)
    expect(Number.isNaN(parseFecha('no-es-fecha').getTime())).toBe(true)
  })

  it('rechaza timestamps y sufijos: una fecha de calendario es SOLO YYYY-MM-DD', () => {
    // Un timestamp que se colara aquí perdería hora y zona y se reinterpretaría
    // como día local. '2026-01-01T03:00:00Z' es el 31 de diciembre en GT: darlo
    // por fecha de calendario lo movería al 1 de enero.
    for (const v of TIMESTAMPS) {
      expect(parseFechaCalendario(v)).toBeNull()
      expect(esFechaCalendario(v)).toBe(false)
      expect(formatFechaCalendario(v)).toBe('')
      expect(formatFechaCalendario(v, {}, 'es-GT', '—')).toBe('—')
      expect(diasHastaFechaCalendario(v)).toBeNull()
      expect(sumarDiasCalendario(v, 1)).toBeNull()
    }
  })

  it('rechaza espacios alrededor: no se recorta la entrada', () => {
    expect(parseFechaCalendario(' 2026-01-01')).toBeNull()
    expect(parseFechaCalendario('2026-01-01 ')).toBeNull()
  })
})

describe('separación fecha de calendario / timestamp', () => {
  it('parseFecha conserva EXACTAMENTE el instante de un ISO con hora', () => {
    expect(parseFecha('2026-01-01T03:00:00Z').toISOString()).toBe('2026-01-01T03:00:00.000Z')
    expect(parseFecha('2026-01-01T03:00:00.123Z').toISOString()).toBe('2026-01-01T03:00:00.123Z')
    // Sin 'T' pero con hora: NO es fecha de calendario, va al parser de Date.
    const sinT = parseFecha('2026-01-01 03:00:00')
    expect(Number.isNaN(sinT.getTime())).toBe(false)
    expect(sinT.getHours()).toBe(3)
  })

  it('bajo America/Guatemala, 2026-01-01T03:00:00Z cae el 31 de diciembre', () => {
    conZona('America/Guatemala', () => {
      const d = parseFecha('2026-01-01T03:00:00Z')
      expect(d.getFullYear()).toBe(2025)
      expect(d.getMonth()).toBe(11)
      expect(d.getDate()).toBe(31)
      expect(d.getHours()).toBe(21)
      // Y el parser de calendario NO lo asciende al 1 de enero: lo rechaza.
      expect(parseFechaCalendario('2026-01-01T03:00:00Z')).toBeNull()
    })
  })

  it('sólo el patrón estricto se desvía al parser de calendario', () => {
    conZona('America/Guatemala', () => {
      // date-only → componentes LOCALES (día 1, no 31).
      expect(parseFecha('2026-01-01').getDate()).toBe(1)
      expect(parseFecha('2026-01-01').getHours()).toBe(0)
    })
  })
})

describe('parseFechaCalendario no muta el Date recibido', () => {
  it('devuelve una instancia nueva normalizada al día local', () => {
    const original = new Date(2026, 0, 1, 13, 45, 30, 250)
    const copia = new Date(original.getTime())
    const out = parseFechaCalendario(original)!
    expect(out).not.toBe(original)
    expect(out.getFullYear()).toBe(2026)
    expect(out.getMonth()).toBe(0)
    expect(out.getDate()).toBe(1)
    expect(out.getHours()).toBe(0)
    expect(out.getMinutes()).toBe(0)
    expect(out.getSeconds()).toBe(0)
    expect(out.getMilliseconds()).toBe(0)
    expect(original.getTime()).toBe(copia.getTime())
  })

  it('sumarDiasCalendario(Date, n) suma bien y deja intacto el argumento', () => {
    const original = new Date(2026, 0, 1, 13, 45, 30, 250)
    const antes = original.getTime()
    expect(sumarDiasCalendario(original, 1)).toBe('2026-01-02')
    expect(original.getTime()).toBe(antes)

    const finDeMes = new Date(2026, 0, 31, 23, 59, 59)
    const antesFinDeMes = finDeMes.getTime()
    expect(sumarDiasCalendario(finDeMes, 1)).toBe('2026-02-01')
    expect(finDeMes.getTime()).toBe(antesFinDeMes)

    // Llamadas repetidas sobre el MISMO Date dan siempre el mismo resultado:
    // si mutara, la segunda saldría desplazada.
    const repetido = new Date(2026, 5, 10, 8, 0, 0)
    expect(sumarDiasCalendario(repetido, 5)).toBe('2026-06-15')
    expect(sumarDiasCalendario(repetido, 5)).toBe('2026-06-15')
    expect(sumarDiasCalendario(repetido, 5)).toBe('2026-06-15')
  })

  it('diasHastaFechaCalendario no desplaza la referencia que recibe', () => {
    const ref = new Date(2026, 0, 1, 23, 30, 0)
    const antes = ref.getTime()
    expect(diasHastaFechaCalendario('2026-01-08', ref)).toBe(7)
    expect(diasHastaFechaCalendario('2026-01-08', ref)).toBe(7)
    expect(ref.getTime()).toBe(antes)
  })
})

describe('cambios de horario (DST) en America/Los_Angeles', () => {
  // 2026: adelanto el 8 de marzo, atraso el 1 de noviembre. Un día "corto" de
  // 23 h y uno "largo" de 25 h rompen cualquier aritmética hecha con
  // milisegundos; la de calendario debe contar días exactos.
  it('cruza el adelanto de marzo sin perder un día', () => {
    conZona('America/Los_Angeles', () => {
      expect(sumarDiasCalendario('2026-03-07', 1)).toBe('2026-03-08')
      expect(sumarDiasCalendario('2026-03-08', 1)).toBe('2026-03-09')
      expect(sumarDiasCalendario('2026-03-07', 3)).toBe('2026-03-10')
      expect(diasEntreFechasCalendario('2026-03-07', '2026-03-09')).toBe(2)
      expect(diasEntreFechasCalendario('2026-03-01', '2026-03-31')).toBe(30)
    })
  })

  it('cruza el atraso de noviembre sin duplicar un día', () => {
    conZona('America/Los_Angeles', () => {
      expect(sumarDiasCalendario('2026-10-31', 1)).toBe('2026-11-01')
      expect(sumarDiasCalendario('2026-11-01', 1)).toBe('2026-11-02')
      expect(sumarDiasCalendario('2026-10-31', 3)).toBe('2026-11-03')
      expect(diasEntreFechasCalendario('2026-10-31', '2026-11-02')).toBe(2)
      expect(diasEntreFechasCalendario('2026-11-01', '2026-12-01')).toBe(30)
    })
  })

  it('un año entero día a día conserva la cuenta a través de ambos saltos', () => {
    conZona('America/Los_Angeles', () => {
      let iso = '2026-01-01'
      for (let i = 0; i < 365; i++) iso = sumarDiasCalendario(iso, 1)!
      expect(iso).toBe('2027-01-01')
      expect(diasEntreFechasCalendario('2026-01-01', iso)).toBe(365)
    })
  })
})

// ── Regresiones de los límites de calendario en la UI ──────────────────────
//
// Los cuatro hallazgos de la segunda revisión eran variantes del mismo error:
// un límite de días calculado con `Date.now() ± N * 86400000` o con
// `toISOString().slice(0,10)` en vez de sobre el calendario local. Aquí se
// fija el comportamiento de `sumarDiasCalendario`, que es lo que ahora usan
// AutomatizacionesTab, VistaRecordatorios, CapacitacionPersonalTab,
// ResumenEjecutivoTab y el resto de los límites barridos.

describe('límites de días usados por la UI', () => {
  it('AutomatizacionesTab: el corte de mora es «más de N días», no «N o más»', () => {
    conZona('America/Guatemala', () => {
      const hoy = '2026-06-30'
      const limite = sumarDiasCalendario(hoy, -30)!
      expect(limite).toBe('2026-05-31')
      // Con 31 días de mora entra; con exactamente 30, no («más de 30»).
      expect('2026-05-30' < limite).toBe(true)
      expect('2026-05-31' < limite).toBe(false)
      // Y es la MISMA comparación que ejecuta la acción, así que el conteo
      // mostrado y las filas modificadas no pueden divergir.
      const cuotas = ['2026-05-29', '2026-05-30', '2026-05-31', '2026-06-15']
      expect(cuotas.filter(f => f < limite)).toEqual(['2026-05-29', '2026-05-30'])
    })
  })

  it('VistaRecordatorios: a las 19:00 en Guatemala el límite sigue siendo +2 días', () => {
    conZona('America/Guatemala', () => {
      // 19:00 local del 1 de junio ya es el 2 de junio en UTC: el patrón viejo
      // `new Date(); +2d; toISOString().slice(0,10)` daba 2026-06-04 y colaba
      // un TERCER día de reservas.
      const tarde = new Date(2026, 5, 1, 19, 0, 0)
      expect(tarde.toISOString().slice(0, 10)).toBe('2026-06-02')  // el bug de origen
      const hoy = dateLocalISO(tarde)
      expect(hoy).toBe('2026-06-01')
      expect(sumarDiasCalendario(hoy, 2)).toBe('2026-06-03')
    })
  })

  it('CapacitacionPersonalTab: un certificado a 30 días muestra exactamente 30', () => {
    conZona('America/Guatemala', () => {
      // Referencia a media tarde y también de noche: en ambos casos 30.
      for (const ref of [new Date(2026, 5, 1, 15, 0, 0), new Date(2026, 5, 1, 23, 30, 0)]) {
        expect(diasHastaFechaCalendario('2026-07-01', ref)).toBe(30)
      }
      // El resumen usa el mismo helper, así que badge y KPI coinciden.
      const ref = new Date(2026, 5, 1, 23, 30, 0)
      const dias = diasHastaFechaCalendario('2026-07-01', ref)!
      expect(dias >= 0 && dias <= 30).toBe(true)
    })
  })

  it('ResumenEjecutivoTab: +30 días cruzando el DST de Los Ángeles da 2026-03-08', () => {
    conZona('America/Los_Angeles', () => {
      // Desde el 6 de febrero, +30 días de calendario es el 8 de marzo, sea
      // cual sea la hora del día.
      expect(sumarDiasCalendario('2026-02-06', 30)).toBe('2026-03-08')

      // El patrón viejo, `dateLocalISO(new Date(Date.now() + 30 * 86400000))`,
      // suma 720 HORAS. El 8 de marzo se adelanta el reloj a las 02:00, así
      // que a partir de esa fecha 720 h caen una hora más tarde en el reloj de
      // pared: si la consulta ocurre en la última hora del día, el límite se
      // pasa al 9 y el panel cuela un vencimiento de más.
      const msDesde = (d: Date) => dateLocalISO(new Date(d.getTime() + 30 * 86400000))
      expect(msDesde(new Date(2026, 1, 6, 12, 30))).toBe('2026-03-08')  // aún coincide
      expect(msDesde(new Date(2026, 1, 6, 23, 30))).toBe('2026-03-09')  // el bug de origen

      // `sumarDiasCalendario` no depende de la hora: mismo día en los dos casos.
      for (const h of [0, 12, 23]) {
        const hoy = dateLocalISO(new Date(2026, 1, 6, h, 30))
        expect(sumarDiasCalendario(hoy, 30)).toBe('2026-03-08')
      }
      // Y en sentido inverso, cruzando el atraso de noviembre.
      expect(sumarDiasCalendario('2026-10-11', 30)).toBe('2026-11-10')
      expect(sumarDiasCalendario('2026-12-01', -30)).toBe('2026-11-01')
    })
  })

  it('los límites de +7 / +30 / −30 son estables en los cuatro husos', () => {
    for (const tz of ZONAS) {
      conZona(tz, () => {
        expect(sumarDiasCalendario('2026-02-06', 30)).toBe('2026-03-08')
        expect(sumarDiasCalendario('2026-06-01', 7)).toBe('2026-06-08')
        expect(sumarDiasCalendario('2026-06-30', -30)).toBe('2026-05-31')
        expect(sumarDiasCalendario('2024-02-01', 30)).toBe('2024-03-02')  // bisiesto
      })
    }
  })
})

// ── El otro sentido: un instante y el día local en el que cae ──────────────
//
// `created_at` (pagos) e `inicio` (rondas_seguridad) son timestamptz. No pasan
// por parseFechaCalendario —que rechaza timestamps a propósito— pero a veces
// hay que compararlos contra un límite 'YYYY-MM-DD'. Recortar la cadena ISO
// da el día UTC; lo correcto es convertir el instante a su día LOCAL.

describe('diaLocalDeInstante', () => {
  it('bajo America/Guatemala, 2026-06-02T01:00:00Z pertenece al 2026-06-01', () => {
    conZona('America/Guatemala', () => {
      const iso = '2026-06-02T01:00:00Z'
      expect(iso.split('T')[0]).toBe('2026-06-02')       // el bug de origen
      expect(iso.slice(0, 10)).toBe('2026-06-02')        // ídem
      expect(diaLocalDeInstante(iso)).toBe('2026-06-01') // 19:00 del día 1

      // El filtro «Hoy» de PagosHistorial: con el día UTC el pago se caía.
      const hoy = '2026-06-01'
      expect(diaLocalDeInstante(iso) === hoy).toBe(true)
      expect(iso.split('T')[0] === hoy).toBe(false)
    })
  })

  it('bajo America/Guatemala, 2026-05-25T01:00:00Z cae el 2026-05-24 y queda fuera de un cutoff 2026-05-25', () => {
    conZona('America/Guatemala', () => {
      const iso = '2026-05-25T01:00:00Z'
      expect(diaLocalDeInstante(iso)).toBe('2026-05-24')
      const cutoff = '2026-05-25'
      expect((diaLocalDeInstante(iso) ?? '') >= cutoff).toBe(false)
      // Con el recorte de la cadena entraba indebidamente en el período.
      expect(iso.slice(0, 10) >= cutoff).toBe(true)      // el bug de origen
    })
  })

  it('el mismo instante cae en días distintos según la zona', () => {
    const iso = '2026-06-02T01:00:00Z'
    const esperado: Record<string, string> = {
      'UTC': '2026-06-02',
      'America/Guatemala': '2026-06-01',
      'America/Los_Angeles': '2026-06-01',
      'Asia/Tokyo': '2026-06-02',
    }
    for (const tz of ZONAS) {
      conZona(tz, () => {
        expect(diaLocalDeInstante(iso)).toBe(esperado[tz])
      })
    }
  })

  it('acepta un Date y conserva su instante (no lo trata como fecha de calendario)', () => {
    conZona('America/Guatemala', () => {
      const d = new Date('2026-06-02T01:00:00Z')
      expect(diaLocalDeInstante(d)).toBe('2026-06-01')
      expect(d.toISOString()).toBe('2026-06-02T01:00:00.000Z')  // intacto
      // Y el parser de calendario sigue rechazando la cadena del timestamp.
      expect(parseFechaCalendario('2026-06-02T01:00:00Z')).toBeNull()
    })
  })

  it('RECHAZA una fecha de calendario pelada: no es un instante', () => {
    for (const tz of ZONAS) {
      conZona(tz, () => {
        // `new Date('2026-06-01')` es medianoche UTC, o sea las 18:00 del 31
        // de mayo en Guatemala. Devolver '2026-05-31' para lo que el usuario
        // escribió como 1 de junio sería reintroducir el desplazamiento por la
        // puerta de atrás, así que aquí se rechaza: eso es de
        // parseFechaCalendario.
        expect(diaLocalDeInstante('2026-06-01')).toBeNull()
        expect(diaLocalDeInstante('2026-01-01')).toBeNull()
        expect(diaLocalDeInstante('2024-02-29')).toBeNull()
        // Y el parser que sí le corresponde conserva el día.
        expect(dateLocalISO(parseFechaCalendario('2026-06-01')!)).toBe('2026-06-01')
      })
    }
  })

  it('las dos funciones se reparten el universo sin solaparse', () => {
    conZona('America/Guatemala', () => {
      const calendario = '2026-06-01'
      const instante = '2026-06-01T12:00:00Z'
      // Cada valor lo acepta exactamente una.
      expect(parseFechaCalendario(calendario)).not.toBeNull()
      expect(diaLocalDeInstante(calendario)).toBeNull()
      expect(parseFechaCalendario(instante)).toBeNull()
      expect(diaLocalDeInstante(instante)).not.toBeNull()
    })
  })

  it('acepta timestamps con offset explícito', () => {
    conZona('America/Guatemala', () => {
      // El mismo instante escrito de tres formas → mismo día local.
      expect(diaLocalDeInstante('2026-06-02T01:00:00Z')).toBe('2026-06-01')
      expect(diaLocalDeInstante('2026-06-01T19:00:00-06:00')).toBe('2026-06-01')
      expect(diaLocalDeInstante('2026-06-02T03:00:00+02:00')).toBe('2026-06-01')
      // Un offset que empuja al día siguiente local.
      expect(diaLocalDeInstante('2026-06-02T00:00:00-06:00')).toBe('2026-06-02')
    })
  })

  it('acepta hora sin zona y la lee como LOCAL (semántica de Date)', () => {
    conZona('America/Guatemala', () => {
      expect(diaLocalDeInstante('2026-06-01T23:30:00')).toBe('2026-06-01')
      expect(diaLocalDeInstante('2026-06-01T00:00:00')).toBe('2026-06-01')
    })
  })

  it('no muta el Date que recibe', () => {
    conZona('America/Guatemala', () => {
      const d = new Date('2026-06-02T01:00:00Z')
      const antes = d.getTime()
      expect(diaLocalDeInstante(d)).toBe('2026-06-01')
      expect(diaLocalDeInstante(d)).toBe('2026-06-01')
      expect(diaLocalDeInstante(d)).toBe('2026-06-01')
      expect(d.getTime()).toBe(antes)
      expect(d.toISOString()).toBe('2026-06-02T01:00:00.000Z')
    })
  })

  it('null para vacíos y no parseables', () => {
    // Ojo: '01/06/2026' NO va aquí. V8 lo parsea como 6 de enero (M/D/Y), así
    // que es un instante válido para `Date`; no es date-only estricto y el
    // contrato no lo rechaza. Ninguna columna timestamptz lo produce.
    const BASURA: unknown[] = [
      null, undefined, '', '   ', 'no-es-fecha', 'NaN', 'null', 'undefined',
      '2026-13-01T00:00:00Z', 'T12:00:00',
    ]
    for (const tz of ZONAS) {
      conZona(tz, () => {
        for (const v of BASURA) expect(diaLocalDeInstante(v as string)).toBeNull()
        expect(diaLocalDeInstante(new Date(NaN))).toBeNull()
      })
    }
  })
})
