// Informe PDF de un servicio de housekeeping: estado de la unidad al ingresar,
// eventualidades, cómo quedó y quién lo hizo. Pensado para mandarse por WhatsApp
// (Web Share con archivo) o descargarse.
//
// Peso: las fotos ya están a 1280 px en el bucket; para el PDF se bajan a 900 px
// y calidad 0.7. Con 40 fotos queda alrededor de 4–6 MB, por debajo del límite de
// documentos de WhatsApp. jsPDF se importa al generar, no al abrir la pestaña.
import { supabase } from '../../../lib/supabase'
import { BUCKET_HOUSEKEEPING } from '../../../domain/shared/buckets'
import type { FotoHousekeeping, ServicioHousekeeping } from '../../../types'

const MAX_LADO_PDF = 900
const CALIDAD_PDF = 0.7

export interface DatosInformeHK {
  servicio: ServicioHousekeeping
  fotos: FotoHousekeeping[]
  tipoLabel: string
  estadoLabel: string
  /** Nombres ya resueltos (la BD guarda uuids). */
  iniciadoPor?: string
  completadoPor?: string
  empresa?: string
}

/** Baja una foto del bucket y la reduce a data-URI JPEG liviano. */
async function fotoADataUri(path: string): Promise<{ uri: string; w: number; h: number } | null> {
  const { data, error } = await supabase.storage.from(BUCKET_HOUSEKEEPING).download(path)
  if (error || !data) return null
  const url = URL.createObjectURL(data)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('img')); i.src = url
    })
    const r = Math.min(1, MAX_LADO_PDF / Math.max(img.width, img.height))
    const w = Math.round(img.width * r), h = Math.round(img.height * r)
    const c = document.createElement('canvas'); c.width = w; c.height = h
    c.getContext('2d')!.drawImage(img, 0, 0, w, h)
    return { uri: c.toDataURL('image/jpeg', CALIDAD_PDF), w, h }
  } catch { return null } finally { URL.revokeObjectURL(url) }
}

const fmtFechaHora = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' }) : '—'

export async function generarInformeHousekeepingPdf(d: DatosInformeHK): Promise<Blob> {
  const { default: jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const PW = 210, M = 14, CW = PW - M * 2
  let y = M

  const salto = (alto: number) => { if (y + alto > 285) { doc.addPage(); y = M } }
  const texto = (t: string, size = 10, bold = false) => {
    doc.setFontSize(size); doc.setFont('helvetica', bold ? 'bold' : 'normal')
    const lineas = doc.splitTextToSize(t, CW) as string[]
    for (const l of lineas) { salto(size * 0.5); doc.text(l, M, y); y += size * 0.45 }
    y += 1.5
  }

  const s = d.servicio
  texto(d.empresa ?? 'Informe de housekeeping', 15, true)
  texto(`${d.tipoLabel} — ${s.unidad_nombre ?? 'Sin unidad específica'}`, 12, true)
  texto(`Fecha: ${s.fecha}    Horario: ${s.hora_inicio ?? '?'} – ${s.hora_fin ?? '?'}    Estado: ${d.estadoLabel}`)
  if (s.responsable) texto(`Responsable: ${s.responsable}`)
  texto(`Iniciado por: ${d.iniciadoPor ?? '—'} (${fmtFechaHora(s.iniciado_en)})`)
  texto(`Completado por: ${d.completadoPor ?? '—'} (${fmtFechaHora(s.completado_en)})`)
  y += 3

  const bloque = async (titulo: string, textoLibre: string | null | undefined, fase: 'ingreso' | 'cierre') => {
    salto(20)
    doc.setDrawColor(180); doc.line(M, y, PW - M, y); y += 5
    texto(titulo, 12, true)
    texto(textoLibre?.trim() ? textoLibre : 'Sin observaciones registradas.')
    const delFase = d.fotos.filter(f => f.fase === fase)
    const vivas = delFase.filter(f => f.path)
    const depuradas = delFase.length - vivas.length
    const COLS = 3, GAP = 3, CELL_W = (CW - GAP * (COLS - 1)) / COLS, CELL_H = CELL_W * 0.75
    for (let i = 0; i < vivas.length; i++) {
      const col = i % COLS
      if (col === 0) salto(CELL_H + GAP)
      const img = await fotoADataUri(vivas[i].path!)
      const x = M + col * (CELL_W + GAP)
      if (img) {
        const k = Math.min(CELL_W / img.w, CELL_H / img.h)
        const w = img.w * k, h = img.h * k
        doc.addImage(img.uri, 'JPEG', x + (CELL_W - w) / 2, y + (CELL_H - h) / 2, w, h)
      } else {
        doc.setFontSize(8); doc.text('Foto no disponible', x + 2, y + CELL_H / 2)
      }
      if (col === COLS - 1 || i === vivas.length - 1) y += CELL_H + GAP
    }
    if (depuradas > 0) texto(`${depuradas} foto(s) depurada(s) por política de retención (90 días).`, 8)
    y += 2
  }

  await bloque('Estado al ingresar y eventualidades', s.hallazgos_ingreso, 'ingreso')
  await bloque('Resultado del servicio', s.observaciones_cierre, 'cierre')

  const n = doc.getNumberOfPages()
  for (let p = 1; p <= n; p++) {
    doc.setPage(p); doc.setFontSize(8); doc.setFont('helvetica', 'normal')
    doc.text(`Generado ${fmtFechaHora(new Date().toISOString())} · Página ${p}/${n}`, M, 292)
  }
  return doc.output('blob')
}

/**
 * Comparte el PDF por el selector del sistema (WhatsApp incluido) cuando el
 * navegador admite compartir archivos; si no, lo descarga. `true` = compartido.
 */
export async function compartirOdescargarPdf(blob: Blob, nombre: string): Promise<boolean> {
  const file = new File([blob], nombre, { type: 'application/pdf' })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title: nombre }); return true }
    catch (e) { if (e instanceof DOMException && e.name === 'AbortError') return true }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = nombre
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return false
}
