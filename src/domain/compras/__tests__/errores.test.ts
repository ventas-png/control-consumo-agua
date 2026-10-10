// Texto de error de las acciones de compras y pagos: la pantalla muestra el texto del SERVIDOR.
import { describe, expect, it } from 'vitest'
import type { PostgrestError } from '@supabase/supabase-js'
import { QueryError, SinFilasAfectadasError } from '../../queryFetch'
import { clasificarErrorCompras, mensajeAccionCompras } from '../errores'

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

// Los textos y SQLSTATE FINALES que levanta la migración 20261027000900 (permisos por acción y separación solicitante/aprobador), tal
// como los escribe el servidor (con los `%` ya sustituidos). Se fijan aquí para que el traductor no dependa de que la migración esté ya
// en el repositorio; `erroresMigraciones.test.ts` contrasta lo mismo contra las migraciones reales en cuanto existan.
const FINALES: Array<[codigo: string, sqlstate: string, familia: string, texto: string]> = [
  // compras_exigir_permiso: permiso, empresa y proyecto (42501)
  ['COMPRAS_PERMISO_ACCION', '42501', 'permiso', 'COMPRAS_PERMISO_ACCION: para marcar pagada una orden de pago (contabiliza el pago) tu perfil necesita el permiso «Compras y pagos — Ejecutar un pago».'],
  ['COMPRAS_PERMISO_ACCION', '42501', 'permiso', 'COMPRAS_PERMISO_ACCION: para aprobar una orden de compra tu perfil necesita el permiso «Autorizar / Denegar — Órdenes compra».'],
  ['COMPRAS_ALCANCE_EMPRESA', '42501', 'alcance_empresa', 'COMPRAS_ALCANCE_EMPRESA: para registrar una recepción (mueve existencias y contabiliza) el documento tiene que ser de la empresa de tu sesión.'],
  ['COMPRAS_ALCANCE_PROYECTO', '42501', 'alcance_proyecto', 'COMPRAS_ALCANCE_PROYECTO: para anular una orden de pago tu perfil necesita estar asignado al proyecto del documento.'],
  // mover un documento de compras a otro proyecto o empresa (trigger de alcance)
  ['COMPRAS_ALCANCE_PROYECTO', '42501', 'alcance_proyecto', 'COMPRAS_ALCANCE_PROYECTO: para mover un documento de compras tu perfil necesita estar asignado al proyecto en que está hoy.'],
  ['COMPRAS_ALCANCE_PROYECTO', '42501', 'alcance_proyecto', 'COMPRAS_ALCANCE_PROYECTO: para mover un documento de compras tu perfil necesita estar asignado al proyecto de destino.'],
  ['COMPRAS_ALCANCE_EMPRESA', '42501', 'alcance_empresa', 'COMPRAS_ALCANCE_EMPRESA: para mover un documento de compras el documento tiene que ser de la empresa de tu sesión, y seguir en ella.'],
  // el que NO cambia: dato inconsistente del documento (migración 0000, 23514); no es falta de asignación de la persona
  ['COMPRAS_ALCANCE_PROYECTO', '23514', 'proyecto_de_otra_empresa', 'COMPRAS_ALCANCE_PROYECTO: el proyecto OC-000012 no pertenece a la empresa del documento.'],
  // interruptor de la separación solicitante/aprobador: escritura directa de compras_config (42501)
  ['COMPRAS_CONFIG_SEPARACION_VIA_RPC', '42501', 'separacion', 'COMPRAS_CONFIG_SEPARACION_VIA_RPC: el interruptor de la separación solicitante/aprobador no se cambia escribiendo en compras_config (UPDATE rechazado, ni siquiera para el administrador): usa compras_separacion_configurar(empresa, activa, motivo), que valida el alcance, exige el motivo y deja la bitácora.'],
  ['COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '42501', 'separacion', 'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN: encender o apagar la separación solicitante/aprobador (o borrar, vaciar, reemplazar o mover la configuración que la tiene encendida: DELETE rechazado) lo hace únicamente el administrador de la empresa, con un motivo, desde compras_separacion_configurar.'],
  ['COMPRAS_CONFIG_SEPARACION_TRUNCATE', '42501', 'separacion', 'COMPRAS_CONFIG_SEPARACION_TRUNCATE: la configuración de compras no se vacía desde una sesión de usuario: apagaría la separación solicitante/aprobador de todas las empresas.'],
  // la RPC compras_separacion_configurar y la bitácora
  ['COMPRAS_SEPARACION_SESION', '42501', 'separacion', 'COMPRAS_SEPARACION_SESION: cambiar la separación solicitante/aprobador exige una sesión de usuario: el actor lo toma el servidor de la sesión.'],
  ['COMPRAS_SEPARACION_PARAMETROS', '22023', 'separacion', 'COMPRAS_SEPARACION_PARAMETROS: indica la empresa y si la separación queda activa (true) o desactivada (false).'],
  ['COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '42501', 'separacion', 'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN: encender o apagar la separación solicitante/aprobador lo hace únicamente el administrador de la empresa (o el super administrador).'],
  ['COMPRAS_ALCANCE_EMPRESA', '42501', 'alcance_empresa', 'COMPRAS_ALCANCE_EMPRESA: la separación solicitante/aprobador solo la cambia el administrador DE ESA empresa.'],
  ['COMPRAS_SEPARACION_PERFIL', '42501', 'separacion', 'COMPRAS_SEPARACION_PERFIL: tu usuario no tiene un perfil activo en la aplicación; la separación solicitante/aprobador solo la cambia un administrador activo.'],
  ['COMPRAS_SEPARACION_EMPRESA_INEXISTENTE', 'P0002', 'separacion', 'COMPRAS_SEPARACION_EMPRESA_INEXISTENTE: la empresa 9c1d no existe; no se cambió nada.'],
  ['COMPRAS_SEPARACION_MOTIVO', '23514', 'separacion', 'COMPRAS_SEPARACION_MOTIVO: cambiar la separación exige un motivo real: al menos 10 letras o cifras (sin contar espacios, signos ni caracteres invisibles) y al menos una letra.'],
  ['COMPRAS_SEPARACION_MOTIVO', '23514', 'separacion', 'COMPRAS_SEPARACION_MOTIVO: el motivo no puede pasar de 1000 caracteres (tiene 1204).'],
  ['COMPRAS_SEPARACION_SIN_CAMBIO', '23514', 'separacion', 'COMPRAS_SEPARACION_SIN_CAMBIO: la separación solicitante/aprobador de la empresa ya está activa; no se cambió nada.'],
  ['COMPRAS_SEPARACION_NO_APLICADA', '40001', 'separacion', 'COMPRAS_SEPARACION_NO_APLICADA: la configuración de la empresa cambió mientras se aplicaba el cambio; no se cambió nada. Reintenta.'],
  ['COMPRAS_SEPARACION_SIN_BITACORA', 'XX000', 'separacion', 'COMPRAS_SEPARACION_SIN_BITACORA: el cambio no dejó rastro en la bitácora; se revierte.'],
  ['COMPRAS_SEPARACION_BITACORA_INMUTABLE', '42501', 'separacion', 'COMPRAS_SEPARACION_BITACORA_INMUTABLE: la bitácora de la separación solicitante/aprobador solo se escribe; no se modifica, no se borra ni se vacía (UPDATE rechazado).'],
]

describe('los textos y SQLSTATE FINALES de la migración 20261027000900', () => {
  it.each(FINALES.map(([codigo, sqlstate, familia, texto]) => ({ codigo, sqlstate, familia, texto, nombre: `${sqlstate} ${texto.slice(0, 90)}` })))('$nombre', ({ codigo, sqlstate, familia, texto }) => {
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
