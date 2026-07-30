// Captura de foto con la cámara nativa (Capacitor). Devuelve un `File` para poder
// reutilizar EXACTAMENTE el mismo pipeline de ImageUploader (validación de magic
// bytes → compresión canvas → subida a Supabase Storage), sin duplicar lógica.
//
// En web no se usa: el <input type="file" capture="environment"> ya abre la cámara
// dentro del navegador. En nativo, @capacitor/camera da mejor control de permisos
// y una UX de sistema (cámara/galería) más fiable, sobre todo en iOS WKWebView.
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'

/**
 * Abre la cámara (o el selector cámara/galería) y devuelve la foto como File.
 * Devuelve null si el usuario cancela o hay un error recuperable.
 * @param preferCamera true → abre la cámara directo; false → deja elegir origen.
 */
export async function takeNativePhoto(preferCamera: boolean): Promise<File | null> {
  try {
    const photo = await Camera.getPhoto({
      quality: 90,
      resultType: CameraResultType.Uri,
      source: preferCamera ? CameraSource.Camera : CameraSource.Prompt,
      correctOrientation: true,
    })
    if (!photo.webPath) return null
    const res = await fetch(photo.webPath)
    const blob = await res.blob()
    const ext = photo.format || 'jpg'
    return new File([blob], `foto-${Date.now()}.${ext}`, { type: blob.type || 'image/jpeg' })
  } catch {
    // El usuario canceló o denegó el permiso: sin foto, sin ruido.
    return null
  }
}
