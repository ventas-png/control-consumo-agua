import { useEffect, useState } from 'react'
import { fetchMisLlamadasAtencion, ESTADO_LLAMADA, nombrePdfLlamada, tipoLlamadaLabel } from '../../domain/condominios/llamadasAtencion'
import { formatDateTime } from '../../lib/format'
import { notify } from '../shared/Dialog'
import { Button } from '../shared/Button'
import { EditModal } from '../shared/EditModal'
import { CartaLlamada } from '../condominios/tabs/llamadasAtencion/CartaLlamada'
import { AcuseLlamadaModal } from '../condominios/tabs/llamadasAtencion/AcuseLlamadaModal'
import { generarCartaLlamadaPdf } from '../condominios/tabs/llamadasAtencion/llamadasAtencionPdf'
import { compartirOdescargarPdf } from '../condominios/tabs/housekeepingPdf'
import type { LlamadaAtencionMia } from '../../types'

/**
 * Las llamadas de atención y sanciones dirigidas a la cuenta activa, en Mi
 * perfil: es la única pantalla que toda cuenta puede abrir, y a la que lleva
 * la notificación de la campana. El empleado no tiene el permiso del tab de
 * RRHH (vería las cartas de todos); lo suyo lo trae rrhh_llamadas_mias.
 * Sin cartas no se muestra nada: es el caso normal de quien no es empleado.
 */
export function MisLlamadasAtencion() {
  const [cartas, setCartas] = useState<LlamadaAtencionMia[] | null>(null)
  const [abierta, setAbierta] = useState<LlamadaAtencionMia | null>(null)
  const [firmando, setFirmando] = useState<LlamadaAtencionMia | null>(null)
  const [generando, setGenerando] = useState<string | null>(null)

  async function cargar() {
    const { data } = await fetchMisLlamadasAtencion()
    setCartas(data)
  }
  useEffect(() => { void cargar() }, [])

  if (!cartas || cartas.length === 0) return null
  const pendientes = cartas.filter(c => c.estado === 'pendiente')

  async function descargar(c: LlamadaAtencionMia) {
    setGenerando(c.id)
    try {
      const blob = await generarCartaLlamadaPdf({ carta: c, proyectoNombre: c.proyecto_nombre })
      const compartido = await compartirOdescargarPdf(blob, nombrePdfLlamada(c))
      if (!compartido) notify({ variant: 'info', title: 'PDF descargado', text: 'Quedó en tus descargas.', duration: 2000 })
    } catch (e) {
      notify({ variant: 'error', title: 'No se generó el PDF', text: e instanceof Error ? e.message : String(e) })
    } finally { setGenerando(null) }
  }

  return (
    <div id="mis-llamadas-atencion" style={{ background: 'var(--at-surface)', borderRadius: '16px', padding: '24px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: `1px solid ${pendientes.length ? 'var(--at-warning)' : 'var(--at-line)'}` }}>
      <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--at-ink)', marginBottom: '6px', paddingBottom: '12px', borderBottom: '1px solid var(--at-chip)' }}>
        Llamadas de atención y sanciones
      </div>
      {pendientes.length > 0 && (
        <div style={{ margin: '12px 0', padding: '10px 12px', borderRadius: '8px', background: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', fontSize: '13px' }}>
          Tenés {pendientes.length === 1 ? 'una carta' : `${pendientes.length} cartas`} por leer y firmar de recibido.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
        {cartas.map(c => {
          const estado = ESTADO_LLAMADA[c.estado]
          return (
            <div key={c.id} style={{ border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '10px 14px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px' }}>
              <button type="button" onClick={() => setAbierta(c)} aria-label={`Ver ${tipoLlamadaLabel(c.tipo)}: ${c.motivo}`}
                style={{ flex: '1 1 240px', minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: 'inherit' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: '13px' }}>{tipoLlamadaLabel(c.tipo)}</span>
                  <span style={{ fontSize: '11px', fontWeight: 700, padding: '1px 8px', borderRadius: '10px', background: estado.bg, color: estado.color }}>{estado.label}</span>
                </div>
                <div style={{ fontSize: '13px', color: 'var(--at-ink-2)', marginTop: '2px' }}>{c.motivo}</div>
                <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)' }}>{c.proyecto_nombre ? `${c.proyecto_nombre} · ` : ''}Emitida {formatDateTime(c.emitido_en, 'es')}</div>
              </button>
              <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto' }}>
                {c.estado === 'pendiente' && (
                  <Button size="sm" onClick={() => setFirmando(c)}>Leer y firmar</Button>
                )}
                <Button size="sm" variant="secondary" onClick={() => descargar(c)} loading={generando === c.id} loadingText="PDF…">PDF</Button>
              </div>
            </div>
          )
        })}
      </div>

      {abierta && (
        <EditModal title={tipoLlamadaLabel(abierta.tipo)} subtitle={abierta.motivo} maxWidth="720px" fullScreenOnMobile onClose={() => setAbierta(null)}
          footer={<>
            {abierta.estado === 'pendiente' && <Button onClick={() => { setFirmando(abierta); setAbierta(null) }}>Firmar de recibido</Button>}
            <Button variant="secondary" onClick={() => setAbierta(null)}>Cerrar</Button>
          </>}>
          <CartaLlamada carta={abierta} proyectoNombre={abierta.proyecto_nombre} />
        </EditModal>
      )}
      {firmando && (
        <AcuseLlamadaModal carta={firmando} proyectoNombre={firmando.proyecto_nombre} modo="usuario"
          onClose={() => setFirmando(null)}
          onAcusado={() => { setFirmando(null); void cargar() }} />
      )}
    </div>
  )
}
