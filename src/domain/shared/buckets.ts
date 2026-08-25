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
