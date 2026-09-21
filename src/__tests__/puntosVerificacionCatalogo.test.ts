import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  areasSinPuntos, parsearAltaMasiva, puntoDuplicado,
} from '../domain/condominios/puntosVerificacion'
import { puntoExigeFoto } from '../types'
import type { AreaCondominio, PuntoControlRuta, PuntoVerificacion } from '../types'

// ════════════════════════════════════════════════════════════════════════════
// Catálogo de puntos de verificación (20260921000100)
//
// Un punto de control dejó de existir SOLO dentro de una ruta: ahora se da de
// alta una vez en el catálogo —de a uno, en lote, o generado desde las áreas— y
// las rutas lo ASIGNAN. Lo que se vigila aquí es lo que hace que esa promesa se
// sostenga:
//
//   1. Que la carga masiva no fabrique duplicados. Es el modo de uso principal
//      (pegar una lista) y también el más fácil de repetir por error.
//   2. Que la herencia de `requiere_foto` resuelva igual en cliente y en BD: si
//      la UI dice "no pide foto" donde el trigger sí la exige, la persona choca
//      contra un rechazo que no puede explicarse.
//   3. Que la BD respalde lo que la UI promete: FK compuesta, índice único,
//      trigger de evidencia y guard de tenant.
// ════════════════════════════════════════════════════════════════════════════

const area = (id: string, nombre: string, extra: Partial<AreaCondominio> = {}): AreaCondominio => ({
  id, company_id: 'c1', project_id: 'p1', nombre, icono: '📍',
  orden: 0, activo: true, created_at: '2026-09-21T00:00:00Z', ...extra,
})

const punto = (id: string, areaId: string, nombre: string, extra: Partial<PuntoVerificacion> = {}): PuntoVerificacion => ({
  id, company_id: 'c1', project_id: 'p1', area_id: areaId, nombre,
  requiere_foto: false, orden: 0, activo: true,
  created_at: '2026-09-21T00:00:00Z', ...extra,
})

describe('alta masiva: una línea = un punto', () => {
  it('recorta, descarta vacías y conserva el orden escrito', () => {
    const { nuevos, repetidos } = parsearAltaMasiva(
      '  Puerta peatonal \n\n Portón vehicular\n\n\nTablero eléctrico\n   \n', 'a1', [])
    expect(nuevos).toEqual(['Puerta peatonal', 'Portón vehicular', 'Tablero eléctrico'])
    expect(repetidos).toEqual([])
  })

  it('omite lo que ya existe en el área, aunque venga escrito distinto', () => {
    // Misma normalización que el índice único de la BD: sin acentos, sin
    // espacios, sin mayúsculas. Si esto no coincidiera, el lote entero rebotaría
    // con 23505 en vez de omitir la línea repetida.
    const existentes = [punto('pv1', 'a1', 'Tablero eléctrico')]
    const { nuevos, repetidos } = parsearAltaMasiva('TABLERO ELECTRICO\nRampa', 'a1', existentes)
    expect(nuevos).toEqual(['Rampa'])
    expect(repetidos).toEqual(['TABLERO ELECTRICO'])
  })

  it('omite lo que el propio pegado trae dos veces', () => {
    const { nuevos, repetidos } = parsearAltaMasiva('Rampa\nrampa\nRAMPA', 'a1', [])
    expect(nuevos).toEqual(['Rampa'])
    expect(repetidos).toEqual(['rampa', 'RAMPA'])
  })

  it('un punto homónimo en OTRA área no estorba', () => {
    // "Puerta" existe en casi toda área; el único por área lo permite y el
    // parser no debe confundirlos.
    const existentes = [punto('pv1', 'a2', 'Puerta')]
    expect(parsearAltaMasiva('Puerta', 'a1', existentes).nuevos).toEqual(['Puerta'])
  })

  it('una línea sin nada comparable (solo signos) no crea un punto vacío', () => {
    // El CHECK `puntos_verif_nombre_check` rechaza el nombre en blanco; aquí se
    // descarta antes de llegar.
    expect(parsearAltaMasiva('---\n***\nRampa', 'a1', []).nuevos).toEqual(['Rampa'])
  })
})

describe('puntoDuplicado', () => {
  const puntos = [punto('pv1', 'a1', 'Rampa'), punto('pv2', 'a1', 'Portón', { activo: false })]

  it('encuentra el choque dentro del área', () => {
    expect(puntoDuplicado('rampa', 'a1', puntos)?.id).toBe('pv1')
  })

  it('cuenta también los inactivos: la BD no los exceptúa del único', () => {
    expect(puntoDuplicado('PORTON', 'a1', puntos)?.id).toBe('pv2')
  })

  it('no choca consigo mismo al renombrar', () => {
    expect(puntoDuplicado('Rampa norte', 'a1', puntos, 'pv1')).toBeNull()
  })
})

describe('areasSinPuntos (el atajo "generar desde áreas")', () => {
  const areas = [area('a1', 'Lobby'), area('a2', 'Piscina', { orden: 1 }), area('a3', 'Bodega', { activo: false })]

  it('propone solo las activas que no tienen NINGÚN punto', () => {
    const r = areasSinPuntos(areas, [punto('pv1', 'a1', 'Puerta')])
    expect(r.map(a => a.id)).toEqual(['a2'])
  })

  it('un área ya trabajada a mano no se regenera', () => {
    // Regenerarla metería "Piscina" junto a "Bomba de la piscina": un duplicado
    // semántico que el único por nombre no detecta.
    expect(areasSinPuntos(areas, [punto('pv1', 'a1', 'x'), punto('pv2', 'a2', 'y')])).toEqual([])
  })

  it('no propone áreas inactivas', () => {
    expect(areasSinPuntos(areas, []).map(a => a.id)).toEqual(['a1', 'a2'])
  })
})

describe('herencia de requiere_foto (espejo de public.punto_ruta_requiere_foto)', () => {
  const parada = (extra: Partial<PuntoControlRuta>): PuntoControlRuta => ({
    id: 'pcr1', ruta_id: 'r1', area_id: 'a1', orden: 0,
    created_at: '2026-09-21T00:00:00Z', ...extra,
  })

  it('sin override, hereda el del catálogo', () => {
    expect(puntoExigeFoto(parada({ punto_requiere_foto: true }))).toBe(true)
    expect(puntoExigeFoto(parada({ punto_requiere_foto: false }))).toBe(false)
  })

  it('la ruta puede EXIGIR donde el catálogo no pide', () => {
    expect(puntoExigeFoto(parada({ requiere_foto: true, punto_requiere_foto: false }))).toBe(true)
  })

  it('la ruta puede NO pedir donde el catálogo sí', () => {
    // El override va en los dos sentidos, igual que el COALESCE de la BD. Si
    // esto se leyera como "solo se puede apretar", la UI mostraría un 📷 que el
    // trigger no exige.
    expect(puntoExigeFoto(parada({ requiere_foto: false, punto_requiere_foto: true }))).toBe(false)
  })

  it('una parada legada (sin punto del catálogo) no exige nada', () => {
    expect(puntoExigeFoto(parada({}))).toBe(false)
  })
})

// ── Lo que la BD tiene que respaldar ───────────────────────────────────────
describe('migración 20260921000100', () => {
  const sql = readFileSync(
    resolve('supabase/migrations/20260921000100_puntos_verificacion_catalogo.sql'), 'utf8')
  // Sin comentarios: el encabezado documenta la REVERSA con DROPs que no se
  // ejecutan, y confundirlos con código haría pasar (o fallar) por lo que no es.
  const codigo = sql.replace(/^[ \t]*--.*$/gm, '')

  it('el harness ejecutable está cableado en CI (si no, no corre nunca)', () => {
    // La conducta —qué rechaza y qué no— se verifica EJECUTANDO la migración
    // contra un Postgres desechable en supabase/tests/puntos_verificacion/. Las
    // aserciones de texto de abajo son el complemento barato, no el sustituto.
    const ci = readFileSync(resolve('.github/workflows/coverage.yml'), 'utf8')
    expect(ci).toContain('supabase/tests/puntos_verificacion/run.sh')
  })

  it('el catálogo cuelga del área y no la borra por debajo', () => {
    expect(codigo).toMatch(/CREATE TABLE IF NOT EXISTS public\.puntos_verificacion/)
    expect(codigo).toMatch(/area_id\s+uuid\s+NOT NULL REFERENCES public\.areas_condominio\(id\) ON DELETE RESTRICT/)
  })

  it('el único por nombre normalizado usa la MISMA función que el cliente', () => {
    // `normalizarNombreArea` (domain/condominios/areas.ts) es su espejo. Si aquí
    // se usara otra cosa, los "repetidos" que la UI omite no serían los que la
    // BD rechaza.
    expect(codigo).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_puntos_verif_nombre_normalizado/)
    expect(codigo).toMatch(/\(area_id, public\.areas_normalizar_nombre\(nombre\)\)/)
  })

  it('la asignación es una FK COMPUESTA (punto, área), no una simple', () => {
    // Es lo que impide que la parada se separe del área de su punto — y el área
    // es el ÚNICO filtro de proyecto que tiene puntos_control_ruta.
    expect(codigo).toMatch(/FOREIGN KEY \(punto_id, area_id\)\s*REFERENCES public\.puntos_verificacion \(id, area_id\)/)
    expect(codigo).toMatch(/CONSTRAINT puntos_verif_id_area_uq UNIQUE \(id, area_id\)/)
  })

  it('punto_id es NULLABLE: las paradas legadas no se convierten a la fuerza', () => {
    expect(codigo).toMatch(/ADD COLUMN IF NOT EXISTS punto_id\s+uuid,/)
    expect(codigo).not.toMatch(/ADD COLUMN IF NOT EXISTS punto_id\s+uuid\s+NOT NULL/)
  })

  it('el trigger de evidencia exige foto en ok y novedad, no en omitido', () => {
    // 'omitido' es justamente el estado de NO haber pasado: exigirle foto lo
    // volvería inalcanzable y dejaría rondas sin poder cerrarse.
    expect(codigo).toMatch(/NEW\.estado NOT IN \('ok', 'novedad'\)\s*THEN\s*RETURN NEW;/)
    expect(codigo).toMatch(/CREATE TRIGGER trg_visitas_control_evidencia/)
  })

  it('la exigencia efectiva en BD es el mismo COALESCE que puntoExigeFoto', () => {
    expect(codigo).toMatch(/COALESCE\(pcr\.requiere_foto, pv\.requiere_foto, false\)/)
  })

  it('el guard de tenant no tropieza al reordenar una parada', () => {
    // `UPDATE OF ruta_id, area_id, punto_id` no dispara con `SET orden = …`, y
    // aun disparando, la guardia de cambio real deja pasar. Sin las dos, una
    // parada legada que ya viole la regla quedaría inmovible.
    expect(codigo).toMatch(/BEFORE INSERT OR UPDATE OF ruta_id, area_id, punto_id ON public\.puntos_control_ruta/)
    expect(codigo).toMatch(/NEW\.ruta_id\s+IS NOT DISTINCT FROM OLD\.ruta_id/)
  })

  it('es idempotente en todo lo que crea', () => {
    const creates = codigo.match(/CREATE (TABLE|INDEX|UNIQUE INDEX)\s+(IF NOT EXISTS)?/g) ?? []
    expect(creates.length).toBeGreaterThan(0)
    for (const c of creates) expect(c, c).toContain('IF NOT EXISTS')
    // Policies y triggers: DROP IF EXISTS antes de cada CREATE.
    expect((codigo.match(/CREATE POLICY/g) ?? []).length)
      .toBe((codigo.match(/DROP POLICY IF EXISTS/g) ?? []).length)
    expect((codigo.match(/CREATE TRIGGER/g) ?? []).length)
      .toBe((codigo.match(/DROP TRIGGER IF EXISTS/g) ?? []).length)
  })

  it('la escritura del catálogo la gatea rutas_ronda, no seguridad', () => {
    // Ejecutar la ronda no da derecho a redefinir qué se vigila. El SELECT sí
    // acepta ambas: el guardia necesita leer `requiere_foto`.
    const insert = codigo.slice(codigo.indexOf('CREATE POLICY "puntos_verificacion_insert"'))
      .slice(0, codigo.slice(codigo.indexOf('CREATE POLICY "puntos_verificacion_insert"')).indexOf(';'))
    expect(insert).toContain("condominios.tab.rutas_ronda")
    expect(insert).not.toContain("condominios.tab.seguridad")

    const select = codigo.slice(codigo.indexOf('CREATE POLICY "puntos_verificacion_select"'))
      .slice(0, codigo.slice(codigo.indexOf('CREATE POLICY "puntos_verificacion_select"')).indexOf(';'))
    expect(select).toContain("condominios.tab.rutas_ronda")
    expect(select).toContain("condominios.tab.seguridad")
  })
})

// ── El vocabulario de `estado` (20260920000000) ────────────────────────────
describe('migración 20260920000000 — vocabulario de visitas_control.estado', () => {
  const sql = readFileSync(
    resolve('supabase/migrations/20260920000000_visitas_control_vocabulario_estado.sql'), 'utf8')
  const codigo = sql.replace(/^[ \t]*--.*$/gm, '')

  it('deja el CHECK con el vocabulario que la aplicación escribe', () => {
    // `EstadoVisitaControl` es la fuente: si alguien le agrega un estado y no
    // toca la BD, la app vuelve a escribir algo que el CHECK rechaza.
    expect(codigo).toMatch(/CHECK \(estado IN \('pendiente', 'ok', 'novedad', 'omitido'\)\)/)
  })

  it('traduce el vocabulario viejo ANTES de cambiar la constraint', () => {
    // Al revés dejaría filas que el CHECK nuevo rechaza y el ALTER fallaría.
    const posUpdate = codigo.indexOf("SET estado = 'ok'      WHERE estado = 'visitado'")
    const posAlter = codigo.indexOf('ADD CONSTRAINT visitas_control_estado_check')
    expect(posUpdate).toBeGreaterThan(-1)
    expect(posAlter).toBeGreaterThan(posUpdate)
    expect(codigo).toMatch(/SET estado = 'novedad' WHERE estado = 'con_novedad'/)
  })

  it('es idempotente: no rehace el swap si el CHECK ya dice lo nuevo', () => {
    expect(codigo).toMatch(/v_definicion LIKE '%''ok''%' AND v_definicion LIKE '%''novedad''%'/)
  })

  it('falla si la constraint que viene a arreglar no existe', () => {
    expect(codigo).toMatch(/RAISE EXCEPTION[\s\S]{0,160}no existe visitas_control_estado_check/)
  })

  it('el arnés ejecutable aplica AMBAS migraciones, en orden', () => {
    // Sin la del vocabulario, el fixture (que nace con el CHECK viejo, como lo
    // deja la convergencia) no dejaría cerrar ni un punto con 'ok' y las trece
    // invariantes medirían otra cosa.
    const run = readFileSync(resolve('supabase/tests/puntos_verificacion/run.sh'), 'utf8')
    expect(run).toContain('20260920000000_visitas_control_vocabulario_estado.sql')
    expect(run).toContain('20260921000100_puntos_verificacion_catalogo.sql')
    expect(run).toMatch(/for m in "\$MIG_VOCAB" "\$MIG"/)
  })

  it('el fixture parte del CHECK VIEJO (si no, no se prueba el arreglo)', () => {
    const fixture = readFileSync(resolve('supabase/tests/puntos_verificacion/fixture.sql'), 'utf8')
    expect(fixture).toMatch(/CHECK \(estado IN \('pendiente', 'visitado', 'con_novedad', 'omitido'\)\)/)
  })
})
