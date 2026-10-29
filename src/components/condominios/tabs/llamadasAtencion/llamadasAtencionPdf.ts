// PDF de una llamada de atención / sanción: la carta tal cual se emitió y el
// bloque de firmas (quien la emitió, quien la recibió, con fecha y hora de
// cada una). Se arma en el cliente con la fila y las dos firmas del bucket;
// no se guarda: con los mismos datos sale siempre el mismo documento.
// jsPDF se importa al generar, no al abrir la pestaña (como housekeepingPdf).
import { descargarFirmaLlamada, tipoLlamadaLabel, tipoLlamadaTitulo } from '../../../../domain/condominios/llamadasAtencion'
import { formatDateTime, formatFechaCalendario } from '../../../../lib/format'
import type { LlamadaAtencionMia } from '../../../../types'

/** Lo que la carta necesita de la fila: el tab y Mi perfil traen formas distintas. */
export type CartaParaPdf = Pick<LlamadaAtencionMia,
  'tipo' | 'fecha_hechos' | 'motivo' | 'descripcion' | 'fundamento' | 'dias_suspension' | 'estado'
  | 'empleado_nombre' | 'empleado_cargo' | 'emitido_por_nombre' | 'emitido_en' | 'firma_emisor_path'
  | 'acuse_en' | 'acuse_nombre' | 'acuse_modo' | 'firma_acuse_path' | 'anulada_en' | 'motivo_anulacion'>

export interface DatosCartaPdf {
  carta: CartaParaPdf
  proyectoNombre?: string | null
  empresa?: string | null
}

const fechaLarga = (iso: string) => formatFechaCalendario(iso, { day: 'numeric', month: 'long', year: 'numeric' }, 'es', iso)

/** Líneas de cabecera y cuerpo (puras, para probarlas sin jsPDF). */
export function lineasCartaPdf(d: DatosCartaPdf): { cabecera: string[]; cuerpo: string[]; firmas: string[] } {
  const c = d.carta
  const cabecera = [
    tipoLlamadaTitulo(c.tipo),
    `Para: ${c.empleado_nombre}${c.empleado_cargo ? ` — ${c.empleado_cargo}` : ''}`,
    `Fecha de los hechos: ${fechaLarga(c.fecha_hechos)}`,
    `Asunto: ${c.motivo}`,
  ]
  const cuerpo = [c.descripcion]
  if (c.tipo === 'suspension' && c.dias_suspension) {
    cuerpo.push(`Se aplica una suspensión sin goce de salario de ${c.dias_suspension} día${c.dias_suspension === 1 ? '' : 's'}.`)
  }
  if (c.fundamento) cuerpo.push(`Fundamento: ${c.fundamento}`)
  const firmas = [
    `Emitida por: ${c.emitido_por_nombre || 'La administración'} · ${formatDateTime(c.emitido_en, 'es')}`,
    c.estado === 'acusada' || c.acuse_en
      ? `Recibí: ${c.acuse_nombre ?? ''} · ${formatDateTime(c.acuse_en, 'es')}`
        + (c.acuse_modo === 'presencial' ? ' · firmado en persona' : c.acuse_modo === 'usuario' ? ' · firmado desde su cuenta' : '')
      : 'Pendiente de firma de recibido',
  ]
  if (c.estado === 'anulada') {
    firmas.push(`ANULADA el ${formatDateTime(c.anulada_en, 'es')}${c.motivo_anulacion ? `: ${c.motivo_anulacion}` : ''}`)
  }
  return { cabecera, cuerpo, firmas }
}

/** Baja una firma del bucket y la convierte en data-URI PNG (null si no está). */
async function firmaADataUri(path: string | null | undefined): Promise<{ uri: string; w: number; h: number } | null> {
  if (!path) return null
  const data = await descargarFirmaLlamada(path)
  if (!data) return null
  const url = URL.createObjectURL(data)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('img')); i.src = url
    })
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
    c.getContext('2d')!.drawImage(img, 0, 0)
    return { uri: c.toDataURL('image/png'), w: img.width, h: img.height }
  } catch { return null } finally { URL.revokeObjectURL(url) }
}

export async function generarCartaLlamadaPdf(d: DatosCartaPdf): Promise<Blob> {
  const { default: jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const PW = 210, M = 18, CW = PW - M * 2
  let y = M

  const salto = (alto: number) => { if (y + alto > 280) { doc.addPage(); y = M } }
  const texto = (t: string, size = 11, bold = false, align: 'left' | 'center' = 'left') => {
    doc.setFontSize(size); doc.setFont('helvetica', bold ? 'bold' : 'normal')
    const lineas = doc.splitTextToSize(t, CW) as string[]
    for (const l of lineas) {
      salto(size * 0.5)
      doc.text(l, align === 'center' ? PW / 2 : M, y, { align })
      y += size * 0.48
    }
    y += 1.5
  }

  const { cabecera, cuerpo, firmas } = lineasCartaPdf(d)
  if (d.empresa) texto(d.empresa, 10, true)
  if (d.proyectoNombre) texto(d.proyectoNombre, 10)
  y += 4
  const [titulo, ...datos] = cabecera
  texto(titulo, 15, true, 'center')
  y += 2
  for (const l of datos) texto(l, 10.5)
  y += 3
  doc.setDrawColor(180); doc.line(M, y, PW - M, y); y += 6
  for (const l of cuerpo) texto(l, 11)
  y += 6

  // Bloque de firmas: dos columnas, la imagen sobre la línea y el texto debajo.
  const COL_W = (CW - 10) / 2, IMG_H = 26
  salto(IMG_H + 24)
  const imgs = await Promise.all([firmaADataUri(d.carta.firma_emisor_path), firmaADataUri(d.carta.firma_acuse_path)])
  const col = (i: number, img: { uri: string; w: number; h: number } | null, etiqueta: string) => {
    const x = M + i * (COL_W + 10)
    if (img) {
      const k = Math.min(COL_W / img.w, IMG_H / img.h)
      const w = img.w * k, h = img.h * k
      doc.addImage(img.uri, 'PNG', x + (COL_W - w) / 2, y + (IMG_H - h), w, h)
    }
    doc.setDrawColor(60); doc.line(x, y + IMG_H + 1, x + COL_W, y + IMG_H + 1)
    doc.setFontSize(9); doc.setFont('helvetica', 'normal')
    const lineas = doc.splitTextToSize(etiqueta, COL_W) as string[]
    lineas.forEach((l, j) => doc.text(l, x + COL_W / 2, y + IMG_H + 6 + j * 4.2, { align: 'center' }))
  }
  col(0, imgs[0], firmas[0])
  col(1, imgs[1], firmas[1])
  y += IMG_H + 6 + 4.2 * 3 + 4
  if (firmas[2]) { doc.setTextColor(170, 30, 30); texto(firmas[2], 10, true); doc.setTextColor(0) }

  const n = doc.getNumberOfPages()
  for (let p = 1; p <= n; p++) {
    doc.setPage(p); doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(120)
    doc.text(`${tipoLlamadaLabel(d.carta.tipo)} · ${d.carta.empleado_nombre} · Generado ${formatDateTime(new Date(), 'es')} · Página ${p}/${n}`, M, 290)
    doc.setTextColor(0)
  }
  return doc.output('blob')
}
