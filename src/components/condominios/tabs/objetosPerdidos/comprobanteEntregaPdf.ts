// Comprobante PDF de la entrega de un objeto perdido: qué objeto, dónde y quién
// lo encontró, quién lo custodió, quién lo recibió y cuándo, con sus fotos y la
// firma de recibido. Se arma en el cliente con la fila, las fotos y la firma del
// bucket; no se guarda: con los mismos datos sale siempre el mismo documento.
// jsPDF se importa al generar, no al abrir la pestaña (como llamadasAtencionPdf).
import { BUCKET_MEDIA } from '../../../../domain/shared/buckets'
import { downloadMedia } from '../../../../domain/shared/storage'
import { fotosDe, hallazgoDe } from '../../../../domain/condominios/objetosPerdidos'
import { formatDateTime, formatFechaCalendario } from '../../../../lib/format'
import type { ObjetoPerdido } from '../../../../types'

export interface DatosComprobanteEntrega {
  objeto: ObjetoPerdido
  /** Nombre vigente del área donde se encontró (o el lugar legado). */
  lugar: string
  /** Área de almacenamiento y ubicación exacta. */
  almacen: string
  proyectoNombre?: string | null
}

/** Fotos del objeto que caben en el comprobante (una fila). */
export const MAX_FOTOS_COMPROBANTE = 3

const fechaLarga = (iso: string) => formatFechaCalendario(iso, { day: 'numeric', month: 'long', year: 'numeric' }, 'es', iso)
const SIN_DATO = '—'

/** Lo que dice el comprobante (puro, para probarlo sin jsPDF ni el bucket). */
export function lineasComprobanteEntrega(d: DatosComprobanteEntrega) {
  const o = d.objeto
  const quien = hallazgoDe(o)
  const recibe = o.reclamado_por?.trim() || SIN_DATO
  const cuando = o.entregado_en ? formatDateTime(o.entregado_en, 'es') : o.fecha_reclamo ? fechaLarga(o.fecha_reclamo) : SIN_DATO

  const objeto: [string, string][] = [
    ['Objeto', o.descripcion],
    ['Encontrado el', fechaLarga(o.fecha_encontrado)],
    ['Dónde', d.lugar || SIN_DATO],
    ['Encontrado por', quien ? `${quien.nombre}${quien.tercero ? ' (tercero)' : ''}${quien.contacto ? ` · ${quien.contacto}` : ''}` : SIN_DATO],
    ['Custodio', o.custodio_nombre || SIN_DATO],
    ['Almacenado en', d.almacen || SIN_DATO],
  ]
  if (o.notas?.trim()) objeto.push(['Notas', o.notas.trim()])

  const entrega: [string, string][] = [['Recibió', recibe]]
  if (o.entrega_documento) entrega.push(['Documento', o.entrega_documento])
  entrega.push(['Fecha y hora', cuando], ['Entregó', o.entregado_por_nombre || SIN_DATO])

  return {
    titulo: 'COMPROBANTE DE ENTREGA DE OBJETO PERDIDO',
    folio: `Registro ${o.id.slice(0, 8).toUpperCase()}`,
    objeto,
    entrega,
    declaracion: `Yo, ${recibe}, declaro haber recibido el objeto descrito en este comprobante.`,
    firma: `Firma de recibido: ${recibe} · ${cuando}`,
  }
}

/** Baja una imagen del bucket y la pasa a data-URI (achicada para no inflar el PDF). null si no está. */
async function imagenDeBucket(path: string, tipo: 'image/png' | 'image/jpeg', maxLado: number): Promise<{ uri: string; w: number; h: number } | null> {
  const blob = await downloadMedia(BUCKET_MEDIA, path)
  if (!blob) return null
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('img')); i.src = url
    })
    const k = Math.min(1, maxLado / Math.max(img.width, img.height))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k))
    const ctx = c.getContext('2d')!
    // La firma es PNG con fondo blanco; una foto con transparencia tampoco queda negra en JPEG.
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height)
    ctx.drawImage(img, 0, 0, c.width, c.height)
    return { uri: c.toDataURL(tipo, 0.85), w: c.width, h: c.height }
  } catch { return null } finally { URL.revokeObjectURL(url) }
}

export async function generarComprobanteEntregaPdf(d: DatosComprobanteEntrega): Promise<Blob> {
  const { default: jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const PW = 210, M = 18, CW = PW - M * 2, LABEL_W = 38
  let y = M

  const salto = (alto: number) => { if (y + alto > 280) { doc.addPage(); y = M } }
  const texto = (t: string, size = 11, bold = false, align: 'left' | 'center' = 'left') => {
    doc.setFontSize(size); doc.setFont('helvetica', bold ? 'bold' : 'normal')
    for (const l of doc.splitTextToSize(t, CW) as string[]) {
      salto(size * 0.5)
      doc.text(l, align === 'center' ? PW / 2 : M, y, { align })
      y += size * 0.48
    }
    y += 1.5
  }
  const seccion = (t: string) => {
    salto(14); y += 3
    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(90)
    doc.text(t.toUpperCase(), M, y); doc.setTextColor(0)
    y += 2; doc.setDrawColor(200); doc.line(M, y, PW - M, y); y += 5
  }
  // Rótulo a la izquierda y valor a la derecha, que puede ocupar varias líneas.
  const filas = (pares: [string, string][]) => {
    for (const [label, valor] of pares) {
      doc.setFontSize(10.5)
      const lineas = doc.splitTextToSize(valor, CW - LABEL_W) as string[]
      salto(lineas.length * 5 + 1)
      doc.setFont('helvetica', 'bold'); doc.text(label, M, y)
      doc.setFont('helvetica', 'normal')
      lineas.forEach((l, i) => doc.text(l, M + LABEL_W, y + i * 5))
      y += lineas.length * 5 + 1.5
    }
  }

  const l = lineasComprobanteEntrega(d)
  if (d.proyectoNombre) texto(d.proyectoNombre, 10, true)
  doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(110)
  doc.text(l.folio, PW - M, M, { align: 'right' }); doc.setTextColor(0)
  y += 4
  texto(l.titulo, 14, true, 'center')

  seccion('El objeto')
  filas(l.objeto)

  const [fotos, firma] = await Promise.all([
    Promise.all(fotosDe(d.objeto).slice(0, MAX_FOTOS_COMPROBANTE).map(p => imagenDeBucket(p, 'image/jpeg', 1000))),
    d.objeto.firma_entrega_path ? imagenDeBucket(d.objeto.firma_entrega_path, 'image/png', 1200) : Promise.resolve(null),
  ])
  const visibles = fotos.filter((f): f is NonNullable<typeof f> => !!f)
  if (visibles.length > 0) {
    const GAP = 4, FOTO_H = 42
    const FOTO_W = (CW - GAP * (MAX_FOTOS_COMPROBANTE - 1)) / MAX_FOTOS_COMPROBANTE
    salto(FOTO_H + 4); y += 2
    visibles.forEach((f, i) => {
      const k = Math.min(FOTO_W / f.w, FOTO_H / f.h)
      const w = f.w * k, h = f.h * k
      const x = M + i * (FOTO_W + GAP)
      doc.addImage(f.uri, 'JPEG', x + (FOTO_W - w) / 2, y + (FOTO_H - h) / 2, w, h)
      doc.setDrawColor(220); doc.rect(x, y, FOTO_W, FOTO_H)
    })
    y += FOTO_H + 4
  }

  seccion('Entrega')
  filas(l.entrega)
  y += 3
  texto(l.declaracion, 11)

  // Firma de recibido centrada: la imagen sobre la línea y el nombre debajo.
  const FIRMA_W = 90, FIRMA_H = 30
  salto(FIRMA_H + 20); y += 6
  const x = (PW - FIRMA_W) / 2
  if (firma) {
    const k = Math.min(FIRMA_W / firma.w, FIRMA_H / firma.h)
    const w = firma.w * k, h = firma.h * k
    doc.addImage(firma.uri, 'PNG', x + (FIRMA_W - w) / 2, y + (FIRMA_H - h), w, h)
  }
  doc.setDrawColor(60); doc.line(x, y + FIRMA_H + 1, x + FIRMA_W, y + FIRMA_H + 1)
  doc.setFontSize(9); doc.setFont('helvetica', 'normal')
  const pie = doc.splitTextToSize(firma ? l.firma : `${l.firma} (la firma no se pudo cargar)`, FIRMA_W + 30) as string[]
  pie.forEach((linea, j) => doc.text(linea, PW / 2, y + FIRMA_H + 6 + j * 4.2, { align: 'center' }))

  const n = doc.getNumberOfPages()
  for (let p = 1; p <= n; p++) {
    doc.setPage(p); doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(120)
    doc.text(`Objetos perdidos · ${l.folio} · Generado ${formatDateTime(new Date(), 'es')} · Página ${p}/${n}`, M, 290)
    doc.setTextColor(0)
  }
  return doc.output('blob')
}
