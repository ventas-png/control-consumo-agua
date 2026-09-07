// Compresión de imágenes en el navegador (canvas), compartida por todo lo que
// sube fotos: los uploaders genéricos (`shared/ImageUploader`) y la captura del
// marcaje de turno (`condominios/tabs/presencia`).
//
// Vive aparte porque la captura de asistencia NO usa ImageUploader: no hay
// galería ni arrastrar-y-soltar en un fichaje —la foto se toma en el momento o
// no vale— pero el pipeline posterior (redimensionar a 1280 px y re-codificar a
// JPEG) tiene que ser exactamente el mismo. Duplicarlo era arriesgarse a que un
// bucket recibiera originales de 8 MB desde una cámara moderna.

/** Lado máximo (px) de la imagen resultante. */
export const MAX_DIMENSION = 1280
/** Calidad JPEG del re-encodeado. */
export const QUALITY = 0.82

/**
 * Redimensiona a `MAX_DIMENSION` (si hace falta) y re-codifica a JPEG. Siempre
 * devuelve `image/jpeg`, sea cual sea el formato de entrada: por eso quien la
 * usa puede forzar la extensión `.jpg` y el content-type sin comprobar nada.
 */
export async function compressImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width, height } = img
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Compresión fallida')), 'image/jpeg', QUALITY)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')) }
    img.src = url
  })
}
