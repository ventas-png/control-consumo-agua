// El traductor de errores de la pantalla clasifica CADA rechazo COMPRAS_* que levantan las migraciones, y lo que traduce lo traduce bien.
//
// Lee las migraciones (no copia sus textos). Tres comprobaciones:
//  1. TODO código `COMPRAS_*` que alguna migración levanta está clasificado: o la pantalla lo traduce (permiso, alcance, separación
//     solicitante/aprobador, estado) o está declarado aquí como «se muestra tal cual, con su código». Un código nuevo —de la migración 0900 o
//     de una posterior— que no esté en ninguna de las dos listas pone esta prueba en rojo hasta que alguien decida: traducirlo en
//     `errores.ts` (y fijar su texto final en `src/test/erroresFinalesCompras.ts`) o añadirlo a MOSTRADOS_TAL_CUAL.
//  2. Cada rechazo de los códigos que SE TRADUCEN se arma como llega de PostgREST (`QueryError` con el SQLSTATE en la causa) y el traductor
//     lo clasifica en su familia y muestra el texto del servidor sin el código; y los declarados «tal cual» siguen llegando con su código.
//  3. Cada texto FINAL fijado en `erroresFinalesCompras.ts` sigue siendo un `RAISE EXCEPTION` real de la migración de la que viene (mismo
//     código, mismo SQLSTATE y mismo texto salvo los `%`). Si esa migración aún no está en la carpeta que se lee, la fila se omite (visible).
// `MIGRACIONES_DIR` apunta a otra carpeta de migraciones (p. ej. una con la 0900 aún sin integrar al repositorio).
import { describe, expect, it } from 'vitest'
import type { PostgrestError } from '@supabase/supabase-js'
import { QueryError } from '../../queryFetch'
import { clasificarErrorCompras, mensajeAccionCompras, type FamiliaErrorCompras } from '../errores'
import { FINALES } from '../../../test/erroresFinalesCompras'
import { leerMigraciones, rechazosCompras, type RechazoSql } from '../../../test/sqlMigraciones'

// ── Qué se traduce y qué llega tal cual ─────────────────────────────────────

/** Los códigos que el traductor reconoce, con la familia que DEBE dar (escrito aquí a propósito, no leído de `errores.ts`). */
const TRADUCIDOS: Record<string, FamiliaErrorCompras | 'segun_sqlstate'> = {
  COMPRAS_PERMISO_ACCION: 'permiso',
  COMPRAS_EXCEPCION_PERMISO: 'permiso',
  COMPRAS_NO_AUTORIZADO: 'permiso',
  COMPRAS_ALCANCE_EMPRESA: 'alcance_empresa',
  COMPRAS_ALCANCE_PROYECTO: 'segun_sqlstate',   // dos usos: 42501 (la persona) y 23514 (dato inconsistente del documento)
  COMPRAS_OC_AUTOAPROBACION: 'separacion',
  COMPRAS_EXCEPCION_AUTOAUTORIZACION: 'separacion',
  COMPRAS_ESTADO_INICIAL: 'estado',
  COMPRAS_ESTADO_SOLO_SISTEMA: 'estado',
}
const INTERRUPTOR_DE_SEPARACION = /^COMPRAS_(?:CONFIG_)?SEPARACION_[A-Z0-9_]+$/

/**
 * Los códigos que la pantalla NO traduce a propósito: son comprobaciones de datos y de reglas del documento (el contrato no está vigente,
 * el pago excede el saldo, el número de factura está repetido…), no algo que la persona arregle pidiendo un permiso. Llegan como los escribe
 * el servidor, con su código, que le sirve a quien los revise. Códigos EXACTOS: uno parecido (COMPRAS_PROVEEDOR_NO_AUTORIZADO,
 * COMPRAS_PAGO_ESTADO_INICIAL, COMPRAS_RESPALDO_PERMISO…) es otra comprobación y también está aquí por su nombre completo.
 */
const MOSTRADOS_TAL_CUAL = new Set(`
  COMPRAS_ACUMULACION_INCONSISTENTE
  COMPRAS_ACUMULADO_SOLO_SISTEMA
  COMPRAS_ALCANCE_OBRA COMPRAS_ALCANCE_PARTIDA COMPRAS_ALCANCE_PROVEEDOR COMPRAS_ALCANCE_RENGLON
  COMPRAS_CONFORMIDAD_RESPONSABLE COMPRAS_CONFORMIDAD_SOLO_SERVICIOS
  COMPRAS_CONTRASENA_CABECERA_FIJA COMPRAS_CONTRASENA_CERRADA COMPRAS_CONTRASENA_CON_ORDEN COMPRAS_CONTRASENA_EXCEDE_SALDO
  COMPRAS_CONTRASENA_INMUTABLE COMPRAS_CONTRASENA_OTRA_CONTABILIDAD COMPRAS_CONTRASENA_OTRO_PROVEEDOR COMPRAS_CONTRASENA_PAGADA
  COMPRAS_CONTRASENA_PARTIDA_FIJA COMPRAS_CONTRASENA_TOTAL_DERIVADO COMPRAS_CONTRASENA_TRANSICION COMPRAS_CONTRASENA_YA_TIENE_ORDEN
  COMPRAS_CONTRATO_AJENO COMPRAS_CONTRATO_FUERA_DE_VIGENCIA COMPRAS_CONTRATO_MONEDA COMPRAS_CONTRATO_NO_ACTIVO COMPRAS_CONTRATO_NO_VIGENTE
  COMPRAS_CONTRATO_PROVEEDOR COMPRAS_CONTRATO_PROYECTO
  COMPRAS_CUENTA_EMPRESA
  COMPRAS_DOCUMENTO_NO_SE_BORRA
  COMPRAS_EXCEPCION_ESTADO COMPRAS_EXCEPCION_ETAPA COMPRAS_EXCEPCION_INMUTABLE COMPRAS_EXCEPCION_INNECESARIA COMPRAS_EXCEPCION_MOTIVO
  COMPRAS_EXCEPCION_ORDEN COMPRAS_EXCEPCION_SESION COMPRAS_EXCEPCION_SIN_CONTRATO
  COMPRAS_FACTURA_CLAVE_CONFLICTO COMPRAS_FACTURA_CLAVE_EN_USO COMPRAS_FACTURA_CLAVE_INMUTABLE COMPRAS_FACTURA_CLAVE_REQUERIDA
  COMPRAS_FACTURA_CLAVE_SIN_HUELLA COMPRAS_FACTURA_CONCEPTO COMPRAS_FACTURA_EMPRESA COMPRAS_FACTURA_IDENTIDAD COMPRAS_FACTURA_INMUTABLE
  COMPRAS_FACTURA_LINEA_AJENA COMPRAS_FACTURA_LINEA_INVALIDA COMPRAS_FACTURA_LINEA_REPETIDA COMPRAS_FACTURA_MONEDA_ORDEN COMPRAS_FACTURA_MONTO
  COMPRAS_FACTURA_NO_PAGABLE COMPRAS_FACTURA_NUMERO_DUPLICADO COMPRAS_FACTURA_ORDEN COMPRAS_FACTURA_ORDEN_AJENA COMPRAS_FACTURA_ORDEN_ESTADO
  COMPRAS_FACTURA_ORDEN_PROVEEDOR COMPRAS_FACTURA_ORDEN_PROYECTO COMPRAS_FACTURA_PROVEEDOR COMPRAS_FACTURA_PROYECTO
  COMPRAS_FACTURA_RENGLONES_SIN_ORDEN COMPRAS_FACTURA_SIN_RENGLONES COMPRAS_FACTURA_TOTAL_DESCUADRADO COMPRAS_FACTURA_TRANSICION
  COMPRAS_IMPORT_CON_ERRORES COMPRAS_IMPORT_DUPLICADO COMPRAS_IMPORT_LIMITE COMPRAS_IMPORT_LOTE COMPRAS_IMPORT_ORDEN COMPRAS_IMPORT_ORDEN_NO_BORRADOR
  COMPRAS_IMPORT_PERMISO COMPRAS_IMPORT_SOLO_RPC COMPRAS_IMPORT_VACIA
  COMPRAS_INVENTARIO_INDICE
  COMPRAS_LINEA_CUENTA_AGRUPADORA COMPRAS_LINEA_CUENTA_INACTIVA COMPRAS_LINEA_CUENTA_INVALIDA COMPRAS_LINEA_CUENTA_LEDGER
  COMPRAS_LINEA_DESTINO_INCOMPATIBLE COMPRAS_LINEA_INSUMO_ALCANCE COMPRAS_LINEA_INSUMO_DESTINO COMPRAS_LINEA_INSUMO_INACTIVO
  COMPRAS_LINEA_INSUMO_UNIDAD COMPRAS_LINEA_ORDEN_CERRADA COMPRAS_LINEA_REGLA_ROTA
  COMPRAS_MIGRACION_POSTVUELO COMPRAS_MIGRACION_REQUISITOS
  COMPRAS_NUMERO_SOLO_SISTEMA
  COMPRAS_OC_APROBADA_CAMBIO COMPRAS_OC_CANCELAR_CON_RECEPCION COMPRAS_OC_DEVOLUCION_MOTIVO COMPRAS_OC_EMITIDA_CAMBIO COMPRAS_OC_IMPORTES_INMUTABLES
  COMPRAS_OC_INMUTABLE COMPRAS_OC_MOTIVO_INMUTABLE COMPRAS_OC_NO_RECIBIBLE COMPRAS_OC_NUMERO_INMUTABLE COMPRAS_OC_RECIBIDA_MANUAL
  COMPRAS_OC_REVISION_SISTEMA COMPRAS_OC_SOLICITANTE_INMUTABLE COMPRAS_OC_TRANSICION_INVALIDA
  COMPRAS_ORDEN_CABECERA COMPRAS_ORDEN_CLAVE_CONFLICTO COMPRAS_ORDEN_CLAVE_EN_USO COMPRAS_ORDEN_CLAVE_INMUTABLE COMPRAS_ORDEN_CLAVE_REQUERIDA
  COMPRAS_ORDEN_CLAVE_SIN_HUELLA COMPRAS_ORDEN_CONCEPTO COMPRAS_ORDEN_EMPRESA COMPRAS_ORDEN_INVENTARIO_SIN_INSUMO COMPRAS_ORDEN_LINEA_INVALIDA
  COMPRAS_ORDEN_LINEA_LIMITE COMPRAS_ORDEN_MONTO_DISTINTO COMPRAS_ORDEN_PROVEEDOR COMPRAS_ORDEN_PROYECTO
  COMPRAS_PAGO_CLAVE_INMUTABLE COMPRAS_PAGO_CONTRASENA_AJENA COMPRAS_PAGO_ESTADO_INICIAL COMPRAS_PAGO_EXCEDE_SALDO COMPRAS_PAGO_FACTURA_AJENA
  COMPRAS_PAGO_INMUTABLE COMPRAS_PAGO_PAGADA_INMUTABLE COMPRAS_PAGO_PARTIDAS_DISTINTAS COMPRAS_PAGO_REVERSO_FALLIDO COMPRAS_PAGO_SIN_ASIENTO
  COMPRAS_PAGO_TRANSICION_INVALIDA
  COMPRAS_PROVEEDOR_NO_AUTORIZADO COMPRAS_PROVEEDOR_PROYECTO_NO_HABILITADO COMPRAS_PROVEEDOR_REQUERIDO
  COMPRAS_RECEPCION_CLAVE_CONFLICTO COMPRAS_RECEPCION_CLAVE_EN_USO COMPRAS_RECEPCION_CLAVE_REQUERIDA COMPRAS_RECEPCION_CLAVE_SIN_HUELLA
  COMPRAS_RECEPCION_EMPRESA COMPRAS_RECEPCION_FACTURADA COMPRAS_RECEPCION_IDENTIDAD COMPRAS_RECEPCION_INMUTABLE COMPRAS_RECEPCION_LINEA_AJENA
  COMPRAS_RECEPCION_ORDEN COMPRAS_RECEPCION_ORDEN_AJENA COMPRAS_RECEPCION_REGISTRADA_INMUTABLE COMPRAS_RECEPCION_RESPALDO_CONGELADO
  COMPRAS_RECEPCION_TRANSICION COMPRAS_RECEPCION_VACIA
  COMPRAS_RESPALDO_CONFLICTO COMPRAS_RESPALDO_INMUTABLE COMPRAS_RESPALDO_METADATOS COMPRAS_RESPALDO_OBJETO COMPRAS_RESPALDO_PERMISO
  COMPRAS_RESPALDO_RECEPCION COMPRAS_RESPALDO_REFERENCIA COMPRAS_RESPALDO_RUTA COMPRAS_RESPALDO_TAMANO COMPRAS_RESPALDO_TIPO
  COMPRAS_SELLO_FIJO
  COMPRAS_SERVICIO_SIN_CONFORMIDAD
  COMPRAS_SOBRE_RECEPCION
`.trim().split(/\s+/))

/** La familia que el traductor DEBE dar para ese código y SQLSTATE, o null si no lo traduce. */
function familiaEsperada(r: { codigo: string; sqlstate: string }): FamiliaErrorCompras | null {
  if (INTERRUPTOR_DE_SEPARACION.test(r.codigo)) return 'separacion'
  const f = TRADUCIDOS[r.codigo]
  if (f === undefined) return null
  if (f !== 'segun_sqlstate') return f
  // COMPRAS_ALCANCE_PROYECTO: el de la persona (42501) y el del dato inconsistente del documento (23514)
  if (r.sqlstate === '42501') return 'alcance_proyecto'
  if (r.sqlstate === '23514') return 'proyecto_de_otra_empresa'
  throw new Error(`COMPRAS_ALCANCE_PROYECTO con SQLSTATE ${r.sqlstate}: la pantalla solo distingue 42501 (asignación) y 23514 (proyecto de otra empresa)`)
}

/** Los códigos que no están ni traducidos ni declarados «tal cual». */
function sinClasificar(codigos: Iterable<string>): string[] {
  return [...new Set(codigos)].filter((c) => !INTERRUPTOR_DE_SEPARACION.test(c) && !(c in TRADUCIDOS) && !MOSTRADOS_TAL_CUAL.has(c)).sort()
}

// ── Lo que levantan las migraciones ─────────────────────────────────────────

interface Levantado extends RechazoSql { migracion: string }
const migraciones = leerMigraciones()
const levantados: Levantado[] = migraciones.flatMap(({ nombre, sql }) => rechazosCompras(sql).map((r) => ({ ...r, migracion: nombre })))
const traducidos = levantados.filter((r) => familiaEsperada(r) !== null)
const talCual = levantados.filter((r) => familiaEsperada(r) === null)

/** El texto tal como lo arma el servidor: los `%` de `RAISE` sustituidos por valores de ejemplo. */
const conValores = (texto: string) => { let n = 0; return texto.replace(/%/g, () => ['OC-000001', 'mover', 'DELETE'][n++ % 3]) }

const pg = (message: string, code: string): PostgrestError => {
  const datos = { name: 'PostgrestError', message, details: '', hint: '', code }
  return { ...datos, toJSON: () => datos }
}
const primeraEnMayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

describe('cada código COMPRAS_* que levantan las migraciones está clasificado: se traduce o se muestra tal cual a propósito', () => {
  it('el lector encuentra los rechazos (si no, dejó de leer y esta prueba no dice nada)', () => {
    expect(levantados.length).toBeGreaterThan(100)
    expect(new Set(levantados.map((r) => r.codigo)).size).toBeGreaterThan(100)
    // 20261027000000: el proyecto no es de la empresa del documento (23514) · 20261027000300: falta el permiso genérico (42501)
    expect(levantados.some((r) => r.codigo === 'COMPRAS_ALCANCE_PROYECTO' && r.sqlstate === '23514')).toBe(true)
    expect(levantados.some((r) => r.codigo === 'COMPRAS_PERMISO_ACCION' && r.sqlstate === '42501')).toBe(true)
    // los que provocan los botones sin ser de `compras_exigir_permiso`
    for (const codigo of ['COMPRAS_OC_AUTOAPROBACION', 'COMPRAS_EXCEPCION_AUTOAUTORIZACION', 'COMPRAS_EXCEPCION_PERMISO', 'COMPRAS_NO_AUTORIZADO', 'COMPRAS_ESTADO_INICIAL', 'COMPRAS_ESTADO_SOLO_SISTEMA']) {
      expect(levantados.some((r) => r.codigo === codigo), codigo).toBe(true)
    }
  })

  it('NINGÚN código queda sin clasificar (uno nuevo hay que traducirlo en errores.ts o declararlo «tal cual» en esta prueba)', () => {
    const pendientes = sinClasificar(levantados.map((r) => r.codigo))
    expect(pendientes, `Sin clasificar: ${pendientes.join(', ')}. Decide si la persona debe leerlo sin el código (errores.ts + erroresFinalesCompras.ts + TRADUCIDOS) o si llega tal cual (MOSTRADOS_TAL_CUAL).`).toEqual([])
  })

  it('la comprobación se da cuenta de un código nuevo (control: sin él la anterior no probaría nada)', () => {
    expect(sinClasificar(['COMPRAS_PERMISO_NUEVO', 'COMPRAS_PERMISO_ACCION', 'COMPRAS_SEPARACION_NUEVA', 'COMPRAS_CONTRATO_NO_VIGENTE'])).toEqual(['COMPRAS_PERMISO_NUEVO'])
    // un nombre que solo se PARECE a uno traducido o declarado tampoco pasa
    expect(sinClasificar(['COMPRAS_NO_AUTORIZADOS', 'COMPRAS_ESTADO_INICIAL_X', 'COMPRAS_PAGO_ESTADO_FINAL'])).toEqual(['COMPRAS_ESTADO_INICIAL_X', 'COMPRAS_NO_AUTORIZADOS', 'COMPRAS_PAGO_ESTADO_FINAL'])
  })

  it('un código no puede estar a la vez traducido y declarado «tal cual»', () => {
    const ambos = [...MOSTRADOS_TAL_CUAL].filter((c) => c in TRADUCIDOS || INTERRUPTOR_DE_SEPARACION.test(c))
    expect(ambos).toEqual([])
  })
})

describe('el traductor cubre cada rechazo COMPRAS_* de permiso, alcance, separación y estado que levantan las migraciones', () => {
  it.each(traducidos.map((r) => ({ ...r, nombre: `${r.migracion.slice(0, 14)} ${r.sqlstate} ${r.texto.slice(0, 95)}` })))('$nombre', (r) => {
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

  it('los códigos declarados «tal cual» siguen llegando con su código, aunque otro de nombre parecido se traduzca', () => {
    expect(talCual.length).toBeGreaterThan(100)
    const mal = talCual
      .filter((r) => {
        const texto = conValores(r.texto)
        const comoLlega = new QueryError(texto, pg(texto, r.sqlstate))
        return clasificarErrorCompras(comoLlega).familia !== 'otro' || mensajeAccionCompras(comoLlega) !== texto
      })
      .map((r) => `${r.codigo} (${r.migracion.slice(0, 14)})`)
    expect(mal).toEqual([])
  })
})

describe('los textos FINALES fijados en erroresFinalesCompras.ts siguen siendo RAISE reales de la migración de la que vienen', () => {
  const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  /** El texto de un RAISE como patrón: cada `%` es un valor que se sustituyó al levantarlo. */
  const comoPatron = (raise: string) => new RegExp(`^${raise.split('%').map(escapar).join('[\\s\\S]*?')}$`)
  const rechazosDe = (origen: string) => {
    const m = migraciones.find((x) => x.nombre.startsWith(origen))
    return m ? rechazosCompras(m.sql) : null
  }

  it.for(FINALES.map((f) => ({ ...f, nombre: `${f.origen} ${f.sqlstate} ${f.texto.slice(0, 90)}` })))('$nombre', (f, { skip }) => {
    const rechazos = rechazosDe(f.origen)
    if (!rechazos) skip(`la migración ${f.origen} no está en la carpeta que se lee (MIGRACIONES_DIR / supabase/migrations)`)
    const reales = (rechazos ?? []).filter((r) => r.codigo === f.codigo)
    expect(reales.length, `${f.origen} no levanta ningún ${f.codigo}`).toBeGreaterThan(0)
    const igual = reales.find((r) => comoPatron(r.texto).test(f.texto))
    expect(igual, `ningún RAISE de ${f.codigo} en ${f.origen} dice «${f.texto}» (¿cambió el texto del servidor?)`).toBeDefined()
    expect(igual?.sqlstate, `SQLSTATE de ${f.codigo} en ${f.origen}`).toBe(f.sqlstate)
  })
})
