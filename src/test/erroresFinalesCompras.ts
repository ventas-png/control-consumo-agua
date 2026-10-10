// Los textos y SQLSTATE FINALES de los rechazos COMPRAS_* que la pantalla traduce, tal como los escribe el servidor (con los `%` de
// `RAISE` ya sustituidos por valores de ejemplo).
//
// Los usan dos pruebas:
//  · `errores.test.ts` exige que el traductor clasifique cada fila en su familia y muestre el texto del servidor sin el código;
//  · `erroresMigraciones.test.ts` exige que cada fila SIGA siendo un `RAISE EXCEPTION` real (mismo código, mismo SQLSTATE, mismo texto
//    salvo los `%`) en la migración de la que viene. Así el texto «final» no es un texto inventado ni se queda atrás si el servidor lo cambia.
import type { FamiliaErrorCompras } from '../domain/compras/errores'

export interface TextoFinal {
  codigo: string
  sqlstate: string
  familia: FamiliaErrorCompras
  texto: string
  /** Prefijo (14 cifras) de la migración que levanta VIGENTE este texto. Si esa migración no está en la carpeta que se lee, la fila queda pendiente. */
  origen: string
}

const M0 = '20261027000900'
const fila = (codigo: string, sqlstate: string, familia: FamiliaErrorCompras, texto: string, origen = M0): TextoFinal => ({ codigo, sqlstate, familia, texto, origen })

export const FINALES: TextoFinal[] = [
  // compras_exigir_permiso: permiso, empresa y proyecto (42501)
  fila('COMPRAS_PERMISO_ACCION', '42501', 'permiso', 'COMPRAS_PERMISO_ACCION: para marcar pagada una orden de pago (contabiliza el pago) tu perfil necesita el permiso «Compras y pagos — Ejecutar un pago».'),
  fila('COMPRAS_PERMISO_ACCION', '42501', 'permiso', 'COMPRAS_PERMISO_ACCION: para aprobar una orden de compra tu perfil necesita el permiso «Autorizar / Denegar — Órdenes compra».'),
  fila('COMPRAS_ALCANCE_EMPRESA', '42501', 'alcance_empresa', 'COMPRAS_ALCANCE_EMPRESA: para registrar una recepción (mueve existencias y contabiliza) el documento tiene que ser de la empresa de tu sesión.'),
  fila('COMPRAS_ALCANCE_PROYECTO', '42501', 'alcance_proyecto', 'COMPRAS_ALCANCE_PROYECTO: para anular una orden de pago tu perfil necesita estar asignado al proyecto del documento.'),
  // mover un documento de compras a otro proyecto o empresa (trigger de alcance)
  fila('COMPRAS_ALCANCE_PROYECTO', '42501', 'alcance_proyecto', 'COMPRAS_ALCANCE_PROYECTO: para mover un documento de compras tu perfil necesita estar asignado al proyecto en que está hoy.'),
  fila('COMPRAS_ALCANCE_PROYECTO', '42501', 'alcance_proyecto', 'COMPRAS_ALCANCE_PROYECTO: para mover un documento de compras tu perfil necesita estar asignado al proyecto de destino.'),
  fila('COMPRAS_ALCANCE_EMPRESA', '42501', 'alcance_empresa', 'COMPRAS_ALCANCE_EMPRESA: para mover un documento de compras el documento tiene que ser de la empresa de tu sesión, y seguir en ella.'),
  // el que NO cambia: dato inconsistente del documento (migración 0000, 23514); no es falta de asignación de la persona
  fila('COMPRAS_ALCANCE_PROYECTO', '23514', 'proyecto_de_otra_empresa', 'COMPRAS_ALCANCE_PROYECTO: el proyecto OC-000012 no pertenece a la empresa del documento.', '20261027000000'),

  // separación solicitante/aprobador en los botones: quien solicita no aprueba su propia orden ni autoriza su propia excepción (23514)
  fila('COMPRAS_OC_AUTOAPROBACION', '23514', 'separacion', 'COMPRAS_OC_AUTOAPROBACION: quien solicita la orden no la aprueba; la empresa exige que la apruebe otra persona.', '20261021000600'),
  fila('COMPRAS_OC_AUTOAPROBACION', '23514', 'separacion', 'COMPRAS_OC_AUTOAPROBACION: la empresa exige que la orden la apruebe una persona distinta de quien la solicita, y una orden que nace «aprobada» la solicita y la aprueba la misma persona. Captúrala en borrador para que otra persona con «Autorizar / Denegar» la apruebe.', '20261027000800'),
  fila('COMPRAS_EXCEPCION_AUTOAUTORIZACION', '23514', 'separacion', 'COMPRAS_EXCEPCION_AUTOAUTORIZACION: quien solicita la orden no autoriza su excepción; la empresa exige otra persona.', '20261025000000'),
  // la excepción de contrato y el proveedor piden la llave genérica de cambio de estado (42501)
  fila('COMPRAS_EXCEPCION_PERMISO', '42501', 'permiso', 'COMPRAS_EXCEPCION_PERMISO: autorizar una excepción exige el permiso de cambio de estado de Contabilidad.', '20261025000000'),
  fila('COMPRAS_NO_AUTORIZADO', '42501', 'permiso', 'COMPRAS_NO_AUTORIZADO: autorizar un proveedor requiere el permiso de cambio de estado en Contabilidad.', '20260821000000'),
  fila('COMPRAS_NO_AUTORIZADO', '42501', 'permiso', 'COMPRAS_NO_AUTORIZADO: cambiar la habilitación de un proveedor en un proyecto requiere el permiso de cambio de estado en Contabilidad.', '20261020000000'),
  // el documento nace en su estado inicial y los estados que deja el sistema no se escriben a mano (23514)
  fila('COMPRAS_ESTADO_INICIAL', '23514', 'estado', 'COMPRAS_ESTADO_INICIAL: una orden de compra nace en borrador (o, con permiso, aprobada o emitida); no se crea ya «aprobada».'),
  fila('COMPRAS_ESTADO_INICIAL', '23514', 'estado', 'COMPRAS_ESTADO_INICIAL: una recepción nace en borrador y se registra después (eso mueve existencias y contabiliza); no se crea ya «registrada».'),
  fila('COMPRAS_ESTADO_INICIAL', '23514', 'estado', 'COMPRAS_ESTADO_INICIAL: una factura nace «registrada» y sin pagos; se aprueba (se cuadra y se contabiliza) y se paga después. No se crea ya «pagada» con 100 pagado.'),
  fila('COMPRAS_ESTADO_INICIAL', '23514', 'estado', 'COMPRAS_ESTADO_INICIAL: una contraseña de pago nace «emitida»; se paga con su orden de pago y se anula con motivo. No se crea ya «pagada».'),
  fila('COMPRAS_ESTADO_SOLO_SISTEMA', '23514', 'estado', 'COMPRAS_ESTADO_SOLO_SISTEMA: lo pagado de una factura y su estado «pagada» los deja una orden de pago al pagarse; no se escriben a mano.'),
  fila('COMPRAS_ESTADO_SOLO_SISTEMA', '23514', 'estado', 'COMPRAS_ESTADO_SOLO_SISTEMA: una contraseña queda «pagada» cuando se paga la orden de pago que la liquida; no se marca a mano.'),

  // interruptor de la separación solicitante/aprobador: escritura directa de compras_config (42501)
  fila('COMPRAS_CONFIG_SEPARACION_VIA_RPC', '42501', 'separacion', 'COMPRAS_CONFIG_SEPARACION_VIA_RPC: el interruptor de la separación solicitante/aprobador no se cambia escribiendo en compras_config (UPDATE rechazado, ni siquiera para el administrador): usa compras_separacion_configurar(empresa, activa, motivo), que valida el alcance, exige el motivo y deja la bitácora.'),
  fila('COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '42501', 'separacion', 'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN: encender o apagar la separación solicitante/aprobador (o borrar, vaciar, reemplazar o mover la configuración que la tiene encendida: DELETE rechazado) lo hace únicamente el administrador de la empresa, con un motivo, desde compras_separacion_configurar.'),
  fila('COMPRAS_CONFIG_SEPARACION_TRUNCATE', '42501', 'separacion', 'COMPRAS_CONFIG_SEPARACION_TRUNCATE: la configuración de compras no se vacía desde una sesión de usuario: apagaría la separación solicitante/aprobador de todas las empresas.'),
  // la RPC compras_separacion_configurar y la bitácora
  fila('COMPRAS_SEPARACION_SESION', '42501', 'separacion', 'COMPRAS_SEPARACION_SESION: cambiar la separación solicitante/aprobador exige una sesión de usuario: el actor lo toma el servidor de la sesión.'),
  fila('COMPRAS_SEPARACION_PARAMETROS', '22023', 'separacion', 'COMPRAS_SEPARACION_PARAMETROS: indica la empresa y si la separación queda activa (true) o desactivada (false).'),
  fila('COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '42501', 'separacion', 'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN: encender o apagar la separación solicitante/aprobador lo hace únicamente el administrador de la empresa (o el super administrador).'),
  fila('COMPRAS_ALCANCE_EMPRESA', '42501', 'alcance_empresa', 'COMPRAS_ALCANCE_EMPRESA: la separación solicitante/aprobador solo la cambia el administrador DE ESA empresa.'),
  fila('COMPRAS_SEPARACION_PERFIL', '42501', 'separacion', 'COMPRAS_SEPARACION_PERFIL: tu usuario no tiene un perfil activo en la aplicación; la separación solicitante/aprobador solo la cambia un administrador activo.'),
  fila('COMPRAS_SEPARACION_EMPRESA_INEXISTENTE', 'P0002', 'separacion', 'COMPRAS_SEPARACION_EMPRESA_INEXISTENTE: la empresa 9c1d no existe; no se cambió nada.'),
  fila('COMPRAS_SEPARACION_MOTIVO', '23514', 'separacion', 'COMPRAS_SEPARACION_MOTIVO: cambiar la separación exige un motivo real: al menos 10 letras o cifras (sin contar espacios, signos ni caracteres invisibles) y al menos una letra.'),
  fila('COMPRAS_SEPARACION_MOTIVO', '23514', 'separacion', 'COMPRAS_SEPARACION_MOTIVO: el motivo no puede pasar de 1000 caracteres (tiene 1204).'),
  fila('COMPRAS_SEPARACION_SIN_CAMBIO', '23514', 'separacion', 'COMPRAS_SEPARACION_SIN_CAMBIO: la separación solicitante/aprobador de la empresa ya está activa; no se cambió nada.'),
  fila('COMPRAS_SEPARACION_NO_APLICADA', '40001', 'separacion', 'COMPRAS_SEPARACION_NO_APLICADA: la configuración de la empresa cambió mientras se aplicaba el cambio; no se cambió nada. Reintenta.'),
  fila('COMPRAS_SEPARACION_SIN_BITACORA', 'XX000', 'separacion', 'COMPRAS_SEPARACION_SIN_BITACORA: el cambio no dejó rastro en la bitácora; se revierte.'),
  fila('COMPRAS_SEPARACION_BITACORA_INMUTABLE', '42501', 'separacion', 'COMPRAS_SEPARACION_BITACORA_INMUTABLE: la bitácora de la separación solicitante/aprobador solo se escribe; no se modifica, no se borra ni se vacía (UPDATE rechazado).'),
]
