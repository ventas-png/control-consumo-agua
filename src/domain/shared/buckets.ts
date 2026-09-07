// domain/shared/buckets.ts — Nombres de los buckets de Storage.
//
// Viven aparte de `storage.ts` a propósito: ese módulo importa el cliente de
// Supabase (que exige env vars al cargarse), y un componente que solo necesita
// saber DE QUÉ bucket firmar una imagen no tiene por qué arrastrar el cliente.

/** Media general del condominio. Autoriza por PROYECTO (20260603220000). */
export const BUCKET_MEDIA = 'condominios-media'

/**
 * Evidencias de recepción: fotos del sobre y firmas de acuse. Bucket PRIVADO
 * aparte porque el de arriba autoriza por proyecto, y con esa regla cualquier
 * residente del condominio podía leer, sustituir y borrar la firma de acuse de
 * su vecino. Ruta `<project_id>/<pieza_id>/<archivo>`: las policies de
 * 20260831000000 resuelven el permiso a partir de la pieza.
 */
export const BUCKET_EVIDENCIAS = 'recepcion-evidencias'

/**
 * Fotos del marcaje de turno (entrada y salida). Bucket PRIVADO propio, por la
 * misma razón que el de arriba y con más peso: en `condominios-media` cualquier
 * residente del condominio podría descargar la serie de fotos de la cara y la
 * ubicación de cada trabajador. Ruta `<project_id>/<personal_id>/<archivo>`; las
 * policies de 20260908000000 dejan leer al dueño de la foto y a quien administra
 * la asistencia, y no dejan sustituirla a nadie.
 */
export const BUCKET_PRESENCIA = 'presencia-evidencias'
