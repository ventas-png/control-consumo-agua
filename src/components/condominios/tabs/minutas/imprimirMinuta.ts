// Versión imprimible de una minuta (misma mecánica que las actas: ventana
// nueva + printHtml, que escapa todo lo que viene de la base).
import { printHtml, raw } from '../../../../lib/printHtml'
import { formatFechaCalendario } from '../../../../lib/format'
import { TIPO_ACUERDO_INFO, TIPO_PARTICIPANTE_INFO, documentosDe, fechaDeMinuta, fotosDe, participantesDe, puntosDe } from '../../../../domain/condominios/minutas'
import { nombreDeArchivo } from '../../../shared/FileUploader'
import type { NotaAdmin } from '../../../../types'
import { categoriaInfo, prioridadInfo } from './comun'

export function htmlMinuta(nota: NotaAdmin): string {
  const participantes = participantesDe(nota)
  const puntos = puntosDe(nota)
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
  </style></head><body>
  <h1>${nota.titulo}</h1>
  <div class="cab">Minuta de reunión · ${categoriaInfo(nota.categoria).label} · ${fecha}${gestor ? ` · Gestiona: ${gestor.nombre}` : ''}${nota.resuelta ? ' · CERRADA' : ''}</div>
  ${nota.contenido?.trim() ? raw(printHtml`<h2>Objetivo</h2><p>${nota.contenido}</p>`) : ''}
  ${lista ? raw(printHtml`<h2>Participantes</h2><ul>${raw(lista)}</ul>`) : ''}
  <h2>Puntos abordados</h2>${cuerpo ? raw(cuerpo) : raw('<p class="desc">Sin puntos registrados.</p>')}
  ${nota.fecha_recordatorio ? raw(printHtml`<p><strong>Próximo seguimiento:</strong> ${formatFechaCalendario(nota.fecha_recordatorio)}</p>`) : ''}
  ${fotosDe(nota).length > 0 ? raw(printHtml`<p><strong>Fotos adjuntas:</strong> ${fotosDe(nota).length} (se consultan en la minuta)</p>`) : ''}
  ${documentosDe(nota).length > 0 ? raw(printHtml`<p><strong>Documentos adjuntos:</strong> ${documentosDe(nota).map(nombreDeArchivo).join(', ')}</p>`) : ''}
  <div class="pie">Prioridad: ${prioridadInfo(nota.prioridad).label}${nota.autor ? ` · Registró: ${nota.autor}` : ''}</div>
  </body></html>`
}

export function imprimirMinuta(nota: NotaAdmin): void {
  const win = window.open('', '_blank')
  if (!win) return
  win.document.write(htmlMinuta(nota))
  win.document.close()
  win.print()
}
