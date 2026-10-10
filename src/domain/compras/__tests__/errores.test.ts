// Texto de error de las acciones de compras y pagos: la pantalla muestra el texto del SERVIDOR.
import { describe, expect, it } from 'vitest'
import type { PostgrestError } from '@supabase/supabase-js'
import { QueryError, SinFilasAfectadasError } from '../../queryFetch'
import { clasificarErrorCompras, mensajeAccionCompras } from '../errores'
import { FINALES } from '../../../test/erroresFinalesCompras'

const PERMISO = 'COMPRAS_PERMISO_ACCION: para aprobar (contabilizar) una factura de proveedor tu perfil necesita el permiso «Compras y pagos — Aprobar una factura de proveedor».'

// Los DOS usos de COMPRAS_ALCANCE_PROYECTO que existen en el servidor:
//  · el de la persona (SQLSTATE 42501, compras_exigir_permiso): no está asignada al proyecto del documento;
//  · el de la migración 20261027000000 (SQLSTATE 23514, compras_alcance_verificar): el proyecto no es de la empresa.
const ASIGNACION = 'COMPRAS_ALCANCE_PROYECTO: para anular una orden de pago tu perfil necesita estar asignado al proyecto del documento.'
const OTRA_EMPRESA = 'COMPRAS_ALCANCE_PROYECTO: el proyecto OC-000012 no pertenece a la empresa del documento.'

const pg = (message: string, code: string): PostgrestError => {
  const datos = { name: 'PostgrestError', message, details: '', hint: '', code }
  return { ...datos, toJSON: () => datos }
}

describe('mensajeAccionCompras · permiso, alcance y separación: el texto del servidor sin el código', () => {
  it('COMPRAS_PERMISO_ACCION: dice qué acción y qué permiso falta', () => {
    expect(mensajeAccionCompras(new Error(PERMISO))).toBe(
      'Para aprobar (contabilizar) una factura de proveedor tu perfil necesita el permiso «Compras y pagos — Aprobar una factura de proveedor».',
    )
  })

  it('COMPRAS_ALCANCE_PROYECTO de la persona: dice que hace falta estar asignado al proyecto del documento', () => {
    expect(mensajeAccionCompras(new Error(ASIGNACION)))
      .toBe('Para anular una orden de pago tu perfil necesita estar asignado al proyecto del documento.')
  })

  it('COMPRAS_ALCANCE_EMPRESA: dice que el documento tiene que ser de la empresa de la sesión', () => {
    expect(mensajeAccionCompras(new Error('COMPRAS_ALCANCE_EMPRESA: para registrar una recepción el documento tiene que ser de la empresa de tu sesión.')))
      .toBe('Para registrar una recepción el documento tiene que ser de la empresa de tu sesión.')
  })

  it.each([
    'COMPRAS_CONFIG_SEPARACION_VIA_RPC',
    'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN',
    'COMPRAS_CONFIG_SEPARACION_TRUNCATE',
    // los de la RPC compras_separacion_configurar(p_company_id, p_activa, p_motivo) y de la bitácora
    'COMPRAS_SEPARACION_SESION',
    'COMPRAS_SEPARACION_PARAMETROS',
    'COMPRAS_SEPARACION_EMPRESA_INEXISTENTE',
    'COMPRAS_SEPARACION_MOTIVO',
    'COMPRAS_SEPARACION_SIN_CAMBIO',
    'COMPRAS_SEPARACION_NO_APLICADA',
    'COMPRAS_SEPARACION_SIN_BITACORA',
    'COMPRAS_SEPARACION_BITACORA_INMUTABLE',
  ])('%s: el texto del servidor, sin el código', (codigo) => {
    expect(mensajeAccionCompras(new Error(`${codigo}: el interruptor se cambia solo desde compras_separacion_configurar.`)))
      .toBe('El interruptor se cambia solo desde compras_separacion_configurar.')
    expect(clasificarErrorCompras(new Error(`${codigo}: texto.`))).toMatchObject({ familia: 'separacion', codigo, texto: 'texto.' })
  })

  it('el rechazo de la RPC de separación por falta de motivo llega tal cual lo escribe el servidor', () => {
    const t = 'COMPRAS_SEPARACION_MOTIVO: cambiar la separación solicitante/aprobador exige un motivo de al menos 10 caracteres (sin contar los espacios de los extremos).'
    expect(mensajeAccionCompras(pg(t, '23514')))
      .toBe('Cambiar la separación solicitante/aprobador exige un motivo de al menos 10 caracteres (sin contar los espacios de los extremos).')
  })

  it('acepta el error tal como llega de PostgREST (QueryError), de un objeto con message y de un texto', () => {
    expect(mensajeAccionCompras(new QueryError(PERMISO, null))).toMatch(/^Para aprobar \(contabilizar\)/)
    expect(mensajeAccionCompras({ message: PERMISO, code: '42501' })).toMatch(/^Para aprobar \(contabilizar\)/)
    expect(mensajeAccionCompras(PERMISO)).toMatch(/^Para aprobar \(contabilizar\)/)
  })

  it('un mensaje de varias líneas conserva todo el texto', () => {
    expect(mensajeAccionCompras(new Error('COMPRAS_PERMISO_ACCION: primera línea.\nSegunda línea.'))).toBe('Primera línea.\nSegunda línea.')
  })
})

describe('COMPRAS_ALCANCE_PROYECTO · las dos comprobaciones del servidor se distinguen, no basta el prefijo', () => {
  it('SQLSTATE 42501 (la persona no está asignada al proyecto): familia alcance_proyecto y texto sin código', () => {
    const e = new QueryError(ASIGNACION, pg(ASIGNACION, '42501'))
    expect(clasificarErrorCompras(e).familia).toBe('alcance_proyecto')
    expect(mensajeAccionCompras(e)).toBe('Para anular una orden de pago tu perfil necesita estar asignado al proyecto del documento.')
  })

  it('SQLSTATE 23514 (el proyecto no es de la empresa del documento): NO es un problema de asignación; se muestra como llegó', () => {
    const e = new QueryError(OTRA_EMPRESA, pg(OTRA_EMPRESA, '23514'))
    expect(clasificarErrorCompras(e).familia).toBe('proyecto_de_otra_empresa')
    expect(mensajeAccionCompras(e)).toBe(OTRA_EMPRESA)
  })

  it('el SQLSTATE manda sobre el texto: con 23514 un mensaje que habla de asignación no se presenta como falta de asignación', () => {
    expect(clasificarErrorCompras(pg(ASIGNACION, '23514')).familia).toBe('proyecto_de_otra_empresa')
    expect(clasificarErrorCompras(pg(OTRA_EMPRESA, '42501')).familia).toBe('alcance_proyecto')
  })

  it('sin SQLSTATE (el error se reenvió como Error(message)) se distingue por el texto', () => {
    expect(clasificarErrorCompras(new Error(ASIGNACION)).familia).toBe('alcance_proyecto')
    expect(clasificarErrorCompras(new Error(OTRA_EMPRESA)).familia).toBe('proyecto_de_otra_empresa')
    expect(mensajeAccionCompras(new Error(OTRA_EMPRESA))).toBe(OTRA_EMPRESA)
  })

  it('el SQLSTATE se lee del propio error, de un objeto de PostgREST y de la causa de un QueryError', () => {
    expect(clasificarErrorCompras(Object.assign(new Error(ASIGNACION), { code: '42501' })).familia).toBe('alcance_proyecto')
    expect(clasificarErrorCompras({ message: OTRA_EMPRESA, code: '23514' }).familia).toBe('proyecto_de_otra_empresa')
    expect(clasificarErrorCompras(new QueryError(OTRA_EMPRESA, pg(OTRA_EMPRESA, '23514'))).familia).toBe('proyecto_de_otra_empresa')
  })

  // El camino REAL de las acciones (runQuery / runAfectando → new QueryError(message, postgrestError)): el SQLSTATE solo viaja en
  // `cause.code`, no en el propio error. Las pruebas con texto y SQLSTATE concordantes no distinguen si se lee o no; estas contradicen
  // el texto a propósito para que solo el SQLSTATE de la causa decida.
  it('QueryError cuya causa trae 23514 pero cuyo texto habla de asignación: manda el SQLSTATE → proyecto_de_otra_empresa, tal como llegó', () => {
    const e = new QueryError(ASIGNACION, pg(ASIGNACION, '23514'))
    expect(clasificarErrorCompras(e).familia).toBe('proyecto_de_otra_empresa')
    expect(mensajeAccionCompras(e)).toBe(ASIGNACION)
  })

  it('QueryError cuya causa trae 42501 pero cuyo texto habla de otra empresa: manda el SQLSTATE → alcance_proyecto, sin el código', () => {
    const e = new QueryError(OTRA_EMPRESA, pg(OTRA_EMPRESA, '42501'))
    expect(clasificarErrorCompras(e).familia).toBe('alcance_proyecto')
    expect(mensajeAccionCompras(e)).toBe('El proyecto OC-000012 no pertenece a la empresa del documento.')
  })

  it('si no se puede decidir (otro texto, sin SQLSTATE conocido) se muestra tal cual, con su código', () => {
    const t = 'COMPRAS_ALCANCE_PROYECTO: algo que el servidor todavía no dice.'
    expect(clasificarErrorCompras(new Error(t)).familia).toBe('otro')
    expect(mensajeAccionCompras(new Error(t))).toBe(t)
    expect(mensajeAccionCompras(pg(t, '40001'))).toBe(t)
  })

  it('el resto de la familia COMPRAS_ALCANCE_* (proveedor, renglón, partida, obra) no es de la persona: no se toca', () => {
    for (const c of ['PROVEEDOR', 'RENGLON', 'PARTIDA', 'OBRA']) {
      const t = `COMPRAS_ALCANCE_${c}: el dato no pertenece a la empresa del documento.`
      expect(clasificarErrorCompras(new Error(t)).familia).toBe('otro')
      expect(mensajeAccionCompras(new Error(t))).toBe(t)
    }
  })
})

// Los textos y SQLSTATE FINALES de los rechazos que la pantalla traduce están en `src/test/erroresFinalesCompras.ts` (tal como los escribe el
// servidor, con los `%` ya sustituidos). Se fijan ahí, y no se leen de las migraciones, para que el traductor no dependa de que la migración
// esté ya en el repositorio; `erroresMigraciones.test.ts` exige que cada fila siga siendo un `RAISE EXCEPTION` real de la migración de origen.
describe('los textos y SQLSTATE FINALES que el servidor levanta', () => {
  it.each(FINALES.map(({ codigo, sqlstate, familia, texto }) => ({ codigo, sqlstate, familia, texto, nombre: `${sqlstate} ${texto.slice(0, 90)}` })))('$nombre', ({ codigo, sqlstate, familia, texto }) => {
    const cuerpo = texto.slice(texto.indexOf(':') + 1).trim()
    const comoLlega = new QueryError(texto, pg(texto, sqlstate))          // runQuery / runAfectando: el SQLSTATE solo viaja en la causa
    expect(clasificarErrorCompras(comoLlega)).toMatchObject({ familia, codigo, texto: cuerpo })
    expect(mensajeAccionCompras(comoLlega)).toBe(familia === 'proyecto_de_otra_empresa' ? texto : cuerpo.charAt(0).toUpperCase() + cuerpo.slice(1))
    // reenviado como Error(message) sin SQLSTATE, y como objeto de PostgREST con `code` propio: la misma familia
    expect(clasificarErrorCompras(new Error(texto)).familia).toBe(familia)
    expect(clasificarErrorCompras({ message: texto, code: sqlstate }).familia).toBe(familia)
  })

  it('el mismo prefijo COMPRAS_ALCANCE_PROYECTO con 42501 y con 23514 da dos familias distintas (el SQLSTATE manda)', () => {
    const delTexto = (sqlstate: string) => clasificarErrorCompras({ message: 'COMPRAS_ALCANCE_PROYECTO: texto que no dice cuál de los dos es.', code: sqlstate }).familia
    expect(delTexto('42501')).toBe('alcance_proyecto')
    expect(delTexto('23514')).toBe('proyecto_de_otra_empresa')
  })
})

// Los rechazos que SÍ provocan los botones de las seis acciones aunque no sean de `compras_exigir_permiso`: quien solicita una orden y la
// aprueba (cuando la empresa enciende la separación solicitante/aprobador), la excepción de contrato, autorizar a un proveedor y los
// estados que un documento no puede traer de nacimiento. La persona lee el texto del servidor, sin el código técnico.
describe('mensajeAccionCompras · lo que ve quien aprueba su propia orden y los demás rechazos de los botones', () => {
  const comoLlega = (texto: string, sqlstate: string) => new QueryError(texto, pg(texto, sqlstate))

  it('COMPRAS_OC_AUTOAPROBACION (aprobar): «la empresa exige que la apruebe otra persona», sin el código', () => {
    const t = 'COMPRAS_OC_AUTOAPROBACION: quien solicita la orden no la aprueba; la empresa exige que la apruebe otra persona.'
    expect(clasificarErrorCompras(comoLlega(t, '23514'))).toMatchObject({ familia: 'separacion', codigo: 'COMPRAS_OC_AUTOAPROBACION' })
    expect(mensajeAccionCompras(comoLlega(t, '23514'))).toBe('Quien solicita la orden no la aprueba; la empresa exige que la apruebe otra persona.')
  })

  it('COMPRAS_OC_AUTOAPROBACION (la orden nace ya aprobada): el texto largo del servidor, entero y sin el código', () => {
    const t = 'COMPRAS_OC_AUTOAPROBACION: la empresa exige que la orden la apruebe una persona distinta de quien la solicita, y una orden que nace «aprobada» la solicita y la aprueba la misma persona. Captúrala en borrador para que otra persona con «Autorizar / Denegar» la apruebe.'
    expect(mensajeAccionCompras(comoLlega(t, '23514')))
      .toBe('La empresa exige que la orden la apruebe una persona distinta de quien la solicita, y una orden que nace «aprobada» la solicita y la aprueba la misma persona. Captúrala en borrador para que otra persona con «Autorizar / Denegar» la apruebe.')
  })

  it('COMPRAS_EXCEPCION_AUTOAUTORIZACION: quien solicita la orden no autoriza su excepción', () => {
    const t = 'COMPRAS_EXCEPCION_AUTOAUTORIZACION: quien solicita la orden no autoriza su excepción; la empresa exige otra persona.'
    expect(clasificarErrorCompras(comoLlega(t, '23514')).familia).toBe('separacion')
    expect(mensajeAccionCompras(comoLlega(t, '23514'))).toBe('Quien solicita la orden no autoriza su excepción; la empresa exige otra persona.')
  })

  it.each([
    ['COMPRAS_EXCEPCION_PERMISO', 'autorizar una excepción exige el permiso de cambio de estado de Contabilidad.'],
    ['COMPRAS_NO_AUTORIZADO', 'autorizar un proveedor requiere el permiso de cambio de estado en Contabilidad.'],
    ['COMPRAS_NO_AUTORIZADO', 'cambiar la habilitación de un proveedor en un proyecto requiere el permiso de cambio de estado en Contabilidad.'],
  ])('%s: falta una llave; se dice cuál, sin el código', (codigo, cuerpo) => {
    const t = `${codigo}: ${cuerpo}`
    expect(clasificarErrorCompras(comoLlega(t, '42501'))).toMatchObject({ familia: 'permiso', codigo, texto: cuerpo })
    expect(mensajeAccionCompras(comoLlega(t, '42501'))).toBe(cuerpo.charAt(0).toUpperCase() + cuerpo.slice(1))
  })

  it.each([
    ['COMPRAS_ESTADO_INICIAL', 'una orden de compra nace en borrador (o, con permiso, aprobada o emitida); no se crea ya «aprobada».'],
    ['COMPRAS_ESTADO_SOLO_SISTEMA', 'una contraseña queda «pagada» cuando se paga la orden de pago que la liquida; no se marca a mano.'],
  ])('%s: el estado no es de nacimiento o lo deja el sistema; se muestra el texto del servidor sin el código', (codigo, cuerpo) => {
    const t = `${codigo}: ${cuerpo}`
    expect(clasificarErrorCompras(comoLlega(t, '23514'))).toMatchObject({ familia: 'estado', codigo, texto: cuerpo })
    expect(mensajeAccionCompras(comoLlega(t, '23514'))).toBe(cuerpo.charAt(0).toUpperCase() + cuerpo.slice(1))
  })

  it('códigos de nombre parecido que son OTRAS comprobaciones no se traducen (siguen llegando con su código)', () => {
    for (const codigo of [
      'COMPRAS_PROVEEDOR_NO_AUTORIZADO', 'COMPRAS_PAGO_ESTADO_INICIAL', 'COMPRAS_EXCEPCION_ESTADO', 'COMPRAS_EXCEPCION_ETAPA',
      'COMPRAS_OC_APROBADA_CAMBIO', 'COMPRAS_RESPALDO_PERMISO', 'COMPRAS_IMPORT_PERMISO', 'COMPRAS_NO_AUTORIZADOS', 'COMPRAS_ESTADO_INICIAL_X',
    ]) {
      const t = `${codigo}: un texto del servidor.`
      expect(clasificarErrorCompras(comoLlega(t, '42501'))).toMatchObject({ familia: 'otro', codigo })
      expect(mensajeAccionCompras(comoLlega(t, '42501'))).toBe(t)
    }
  })
})

describe('mensajeAccionCompras · lo demás no cambia', () => {
  it('«sin filas» conserva su propio texto: no se disfraza ni se reescribe', () => {
    const e = new SinFilasAfectadasError()
    expect(mensajeAccionCompras(e)).toBe(e.message)
    expect(mensajeAccionCompras(e)).toMatch(/El servidor no aplicó el cambio/)
    expect(clasificarErrorCompras(e).familia).toBe('sin_filas')
  })

  it('«sin filas» que llega como objeto de updateCondominioRowAfectando (code SIN_FILAS) también', () => {
    const e = { message: new SinFilasAfectadasError().message, code: 'SIN_FILAS' }
    expect(clasificarErrorCompras(e).familia).toBe('sin_filas')
    expect(mensajeAccionCompras(e)).toMatch(/El servidor no aplicó el cambio/)
  })

  it('otros rechazos del servidor se muestran como llegaron (con su código, como hasta ahora)', () => {
    const t = 'COMPRAS_CONTRATO_NO_VIGENTE: no se puede aprobar la orden al amparo de su contrato'
    expect(mensajeAccionCompras(new Error(t))).toBe(t)
    const u = 'COMPRAS_PAGO_EXCEDE_SALDO: la factura tiene un saldo de 100'
    expect(mensajeAccionCompras(new Error(u))).toBe(u)
    expect(clasificarErrorCompras(new Error(u))).toMatchObject({ familia: 'otro', codigo: 'COMPRAS_PAGO_EXCEDE_SALDO' })
  })

  it('un código parecido pero de otra familia (COMPRAS_PERMISO_OTRO, COMPRAS_ALCANCE_X, COMPRAS_SEPARACION sin guion) no se toca', () => {
    expect(mensajeAccionCompras(new Error('COMPRAS_PERMISO_OTRO: algo'))).toBe('COMPRAS_PERMISO_OTRO: algo')
    expect(mensajeAccionCompras(new Error('COMPRAS_ALCANCE_LINEA: algo'))).toBe('COMPRAS_ALCANCE_LINEA: algo')
    expect(mensajeAccionCompras(new Error('COMPRAS_SEPARACION: algo'))).toBe('COMPRAS_SEPARACION: algo')
  })

  it('un error con el código pero sin texto no deja el aviso vacío', () => {
    expect(mensajeAccionCompras(new Error('COMPRAS_PERMISO_ACCION:'))).toBe('COMPRAS_PERMISO_ACCION:')
  })

  it('sin mensaje usa el respaldo (el que pasa quien llama, o uno por omisión)', () => {
    expect(mensajeAccionCompras(undefined)).toBe('No se pudo completar la acción.')
    expect(mensajeAccionCompras(null, 'Error inesperado.')).toBe('Error inesperado.')
    expect(mensajeAccionCompras(new Error(''), 'Error inesperado.')).toBe('Error inesperado.')
  })
})
