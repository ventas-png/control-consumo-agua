// Versión imprimible de una minuta (misma mecánica que las actas: ventana
// nueva + printHtml, que escapa todo lo que viene de la base). Las firmas van
// como imagen: se bajan del bucket privado y se incrustan como data-URI.
import { printHtml, raw } from '../../../../lib/printHtml'
import { formatDateTime, formatFechaCalendario } from '../../../../lib/format'
import {
  PASOS_MINUTA, TIPO_ACUERDO_INFO, TIPO_PARTICIPANTE_INFO, documentosDe, estadoFirma, fechaDeMinuta, firmasDe, fotosDe, minutaEnCurso, participantesDe, pasoBorradorDe,
  puntosDe, versionAcuerdos,
} from '../../../../domain/condominios/minutas'
import { downloadMedia } from '../../../../domain/shared/storage'
import { BUCKET_MEDIA } from '../../../../domain/shared/buckets'
import { nombreDeArchivo } from '../../../shared/FileUploader'
import type { NotaAdmin } from '../../../../types'
import { categoriaInfo, prioridadInfo } from './comun'

/** Sólo una imagen PNG o JPEG en base64 entra sin escapar como `src`. */
const DATA_URI_IMAGEN = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/

/** `imagenes`: ruta de cada firma → data-URI ya descargado. Sin él, la firma sale como línea en blanco. */
export function htmlMinuta(nota: NotaAdmin, imagenes: Readonly<Record<string, string>> = {}): string {
  const participantes = participantesDe(nota)
  const puntos = puntosDe(nota)
  const firmas = firmasDe(nota)
  const version = versionAcuerdos(puntos, participantes)
  const bloquesFirma = participantes.map(p => {
    const f = firmas.find(x => x.participante_id === p.id)
    const img = f ? imagenes[f.path] : undefined
    const trazo = img && DATA_URI_IMAGEN.test(img) ? raw(`<img src="${img}" alt="">`) : raw('<div class="linea"></div>')
    const estado = !f ? 'Firma pendiente'
      : `Firmó el ${formatDateTime(f.firmado_at)}${estadoFirma(f, version) === 'anterior' ? ' · sobre una versión anterior de los acuerdos' : ''}`
    return printHtml`<div class="firma">${trazo}<div class="quien">${p.nombre}</div><div class="meta">${p.detalle ? `${p.detalle} · ` : ''}${estado}</div></div>`
  }).join('')
  const nombreDe = (id: string | null | undefined) => participantes.find(p => p.id === id)?.nombre ?? null
  const gestor = participantes.find(p => p.gestiona)
  const fecha = formatFechaCalendario(fechaDeMinuta(nota), { day: 'numeric', month: 'long', year: 'numeric' })

  const lista = participantes.map(p => printHtml`<li>${p.nombre}${p.detalle ? ` — ${p.detalle}` : ''} <em>(${TIPO_PARTICIPANTE_INFO[p.tipo].label}${p.gestiona ? ', gestiona' : ''})</em></li>`).join('')
  const cuerpo = puntos.map((p, i) => {
    const acuerdos = p.acuerdos.map(a => {
      const resp = a.tipo === 'compromiso' ? nombreDe(a.responsable_id) : null
      const limite = a.tipo === 'compromiso' && a.fecha_limite ? formatFechaCalendario(a.fecha_limite) : null
      const meta = [resp ? `Responsable: ${resp}` : null, limite ? `Fecha límite: ${limite}` : null, a.tipo === 'compromiso' ? (a.cumplido ? 'Cumplido' : 'Pendiente') : null].filter(Boolean).join(' · ')
      return printHtml`<li class="${a.tipo}"><strong>${TIPO_ACUERDO_INFO[a.tipo].label}:</strong> ${a.texto}${meta ? raw(printHtml`<div class="meta">${meta}</div>`) : ''}</li>`
    }).join('')
    return printHtml`<div class="punto"><h3>${i + 1}. ${p.titulo}</h3>${p.descripcion ? raw(printHtml`<p class="desc">${p.descripcion}</p>`) : ''}${acuerdos ? raw(printHtml`<ul>${raw(acuerdos)}</ul>`) : raw('<p class="desc">Sin acuerdos registrados.</p>')}</div>`
  }).join('')

  return printHtml`<html><head><title>${nota.titulo}</title>
  <style>
    body{font-family:serif;max-width:760px;margin:40px auto;font-size:13px;line-height:1.6;color:#222}
    h1{font-size:18px;text-align:center;margin-bottom:4px}h2{font-size:14px;border-bottom:1px solid #ccc;padding-bottom:4px;margin-top:24px}
    h3{font-size:13px;margin:0 0 4px}.punto{margin:12px 0 16px}.desc{margin:2px 0 6px;color:#555}
    ul{margin:0;padding-left:20px}li{margin:4px 0}li.compromiso{border-left:3px solid #999;padding-left:8px;list-style:none;margin-left:-12px}
    .meta{color:#666;font-size:11px}.cab{color:#666;font-size:12px;text-align:center;margin-bottom:20px}.pie{margin-top:36px;color:#666;font-size:11px;text-align:right}
    .firmas{display:grid;grid-template-columns:repeat(2,1fr);gap:24px 32px;margin-top:12px}.firma{break-inside:avoid;text-align:center}
    .firma img{height:70px;max-width:100%;object-fit:contain}.firma .linea{height:70px;border-bottom:1px solid #333}.firma .quien{border-top:1px solid #333;padding-top:4px;font-weight:bold}
    .declara{color:#444;font-size:12px}
  </style></head><body>
  <h1>${nota.titulo}</h1>
  <div class="cab">Minuta de reunión · ${categoriaInfo(nota.categoria).label} · ${fecha}${gestor ? ` · Gestiona: ${gestor.nombre}` : ''}${nota.resuelta ? ' · CERRADA' : ''}${minutaEnCurso(nota) ? ` · EN CURSO (paso ${pasoBorradorDe(nota)} de ${PASOS_MINUTA.length})` : ''}</div>
  ${nota.contenido?.trim() ? raw(printHtml`<h2>Objetivo</h2><p>${nota.contenido}</p>`) : ''}
  ${lista ? raw(printHtml`<h2>Participantes</h2><ul>${raw(lista)}</ul>`) : ''}
  <h2>Puntos abordados</h2>${cuerpo ? raw(cuerpo) : raw('<p class="desc">Sin puntos registrados.</p>')}
  ${nota.fecha_recordatorio ? raw(printHtml`<p><strong>Próximo seguimiento:</strong> ${formatFechaCalendario(nota.fecha_recordatorio)}</p>`) : ''}
  ${fotosDe(nota).length > 0 ? raw(printHtml`<p><strong>Fotos adjuntas:</strong> ${fotosDe(nota).length} (se consultan en la minuta)</p>`) : ''}
  ${documentosDe(nota).length > 0 ? raw(printHtml`<p><strong>Documentos adjuntos:</strong> ${documentosDe(nota).map(nombreDeArchivo).join(', ')}</p>`) : ''}
  ${bloquesFirma ? raw(printHtml`<h2>Firmas</h2><p class="declara">Con su firma, cada participante acepta los acuerdos y compromisos de esta minuta.</p><div class="firmas">${raw(bloquesFirma)}</div>`) : ''}
  <div class="pie">Prioridad: ${prioridadInfo(nota.prioridad).label}${nota.autor ? ` · Registró: ${nota.autor}` : ''}</div>
  </body></html>`
}

/**
 * Abre la ventana en el mismo clic (si no, el navegador la bloquea), baja las
 * firmas y recién entonces escribe la minuta e imprime. Una firma que no se
 * pueda bajar sale como línea en blanco.
 */
export async function imprimirMinuta(nota: NotaAdmin): Promise<void> {
  const win = window.open('', '_blank')
  if (!win) return
  win.document.write('<p style="font-family:sans-serif">Preparando la minuta para imprimir…</p>')
  const imagenes: Record<string, string> = {}
  await Promise.all(firmasDe(nota).map(async f => {
    const blob = await downloadMedia(BUCKET_MEDIA, f.path).catch(() => null)
    const uri = blob ? await comoDataUri(blob).catch(() => null) : null
    if (uri) imagenes[f.path] = uri
  }))
  if (win.closed) return
  win.document.open()
  win.document.write(htmlMinuta(nota, imagenes))
  win.document.close()
  win.print()
}

function comoDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}
