// El traductor de errores de la pantalla cubre CADA rechazo de permiso, alcance y separación que las migraciones levantan.
//
// Lee las migraciones (no copia sus textos): cada `RAISE EXCEPTION 'COMPRAS_…'` de las familias que la pantalla traduce se arma como llega
// de PostgREST (`QueryError` con el SQLSTATE en la causa) y se exige que el traductor la clasifique bien y muestre el texto del servidor
// sin el código. Si una migración nueva (p. ej. la 20261027000900) añade un código de esas familias, o cambia su SQLSTATE o su texto de
// modo que el traductor ya no lo reconozca, esta prueba falla. `MIGRACIONES_DIR` apunta a otra carpeta de migraciones (p. ej. una con
// la 0900 aún sin integrar al repositorio).
import { describe, expect, it } from 'vitest'
import type { PostgrestError } from '@supabase/supabase-js'
import { QueryError } from '../../queryFetch'
import { clasificarErrorCompras, mensajeAccionCompras, type FamiliaErrorCompras } from '../errores'
import { leerMigraciones, rechazosCompras, type RechazoSql } from '../../../test/sqlMigraciones'

const FAMILIAS_QUE_TRADUCE_LA_PANTALLA = /^COMPRAS_(PERMISO_ACCION|ALCANCE_EMPRESA|ALCANCE_PROYECTO|(?:CONFIG_)?SEPARACION_[A-Z0-9_]+)$/

interface Levantado extends RechazoSql { migracion: string }
const levantados: Levantado[] = leerMigraciones()
  .flatMap(({ nombre, sql }) => rechazosCompras(sql).map((r) => ({ ...r, migracion: nombre })))
  .filter((r) => FAMILIAS_QUE_TRADUCE_LA_PANTALLA.test(r.codigo))

/** La familia que el traductor DEBE reconocer para ese código y SQLSTATE. */
function familiaEsperada(r: RechazoSql): FamiliaErrorCompras {
  if (r.codigo === 'COMPRAS_PERMISO_ACCION') return 'permiso'
  if (r.codigo === 'COMPRAS_ALCANCE_EMPRESA') return 'alcance_empresa'
  if (r.codigo === 'COMPRAS_ALCANCE_PROYECTO') {
    // dos usos distintos: el de la persona (42501) y el del dato inconsistente del documento (23514)
    if (r.sqlstate === '42501') return 'alcance_proyecto'
    if (r.sqlstate === '23514') return 'proyecto_de_otra_empresa'
    throw new Error(`COMPRAS_ALCANCE_PROYECTO con SQLSTATE ${r.sqlstate}: la pantalla solo distingue 42501 (asignación) y 23514 (proyecto de otra empresa)`)
  }
  return 'separacion'
}

/** El texto tal como lo arma el servidor: los `%` de `RAISE` sustituidos por valores de ejemplo. */
const conValores = (texto: string) => { let n = 0; return texto.replace(/%/g, () => ['OC-000001', 'mover', 'DELETE'][n++ % 3]) }

const pg = (message: string, code: string): PostgrestError => {
  const datos = { name: 'PostgrestError', message, details: '', hint: '', code }
  return { ...datos, toJSON: () => datos }
}
const primeraEnMayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

describe('el traductor cubre cada rechazo COMPRAS_* de permiso, alcance y separación que levantan las migraciones', () => {
  it('el lector encuentra rechazos de esas familias (si no, dejó de leer y esta prueba no dice nada)', () => {
    expect(levantados.length).toBeGreaterThanOrEqual(2)
    // 20261027000000: el proyecto no es de la empresa del documento (23514) · 20261027000300: falta el permiso genérico (42501)
    expect(levantados.some((r) => r.codigo === 'COMPRAS_ALCANCE_PROYECTO' && r.sqlstate === '23514')).toBe(true)
    expect(levantados.some((r) => r.codigo === 'COMPRAS_PERMISO_ACCION' && r.sqlstate === '42501')).toBe(true)
  })

  it.each(levantados.map((r) => ({ ...r, nombre: `${r.migracion.slice(0, 14)} ${r.sqlstate} ${r.texto.slice(0, 95)}` })))('$nombre', (r) => {
    const texto = conValores(r.texto)
    const esperada = familiaEsperada(r)
    const cuerpo = texto.slice(texto.indexOf(':') + 1).trim()

    // como llega de runQuery / runAfectando: el SQLSTATE solo viaja en la causa del QueryError
    const comoLlega = new QueryError(texto, pg(texto, r.sqlstate))
    expect(clasificarErrorCompras(comoLlega)).toMatchObject({ familia: esperada, codigo: r.codigo, texto: cuerpo })
    // …y la persona ve el texto del servidor sin el código técnico (salvo el dato inconsistente del documento, que llega tal cual)
    expect(mensajeAccionCompras(comoLlega)).toBe(esperada === 'proyecto_de_otra_empresa' ? texto : primeraEnMayuscula(cuerpo))

    // reenviado como Error(message) sin SQLSTATE (el texto solo decide): la misma familia
    expect(clasificarErrorCompras(new Error(texto)).familia).toBe(esperada)
    // como objeto de PostgREST con `code` propio (updateCondominioRowAfectando)
    expect(clasificarErrorCompras({ message: texto, code: r.sqlstate }).familia).toBe(esperada)
  })
})
