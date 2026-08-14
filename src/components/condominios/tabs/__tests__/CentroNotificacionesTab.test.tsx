// El Centro de Notificaciones cubría vencimientos y cobros, pero no la
// actividad entrante: el mensaje que un residente acaba de mandar, la solicitud
// que espera respuesta, el comunicado que acaba de salir. Estos tests fijan que
// ahora sí aparecen, con la urgencia que les toca.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { ComponentProps } from 'react'
import type {
  MensajePortal, SolicitudResidente, SolicitudConcierge, SolicitudCertificado,
  SolicitudRentaUnidad, SolicitudMudanzaUnidad, ComunicadoCondominio,
} from '../../../../types'

const { default: CentroNotificacionesTab } = await import('../CentroNotificacionesTab')

afterEach(cleanup)

function mensaje(over: Partial<MensajePortal> = {}): MensajePortal {
  return {
    id: 'm1', company_id: 'c1', project_id: 'p1', unidad_id: 'u1',
    asunto: 'Ruido en el pasillo', cuerpo: 'Todas las noches',
    tipo: 'queja', estado: 'nuevo', foto_urls: [], archivo_urls: [],
    created_at: '2026-08-10T10:00:00.000Z', unidad_nombre: 'Apto. 2A',
    ...over,
  } as MensajePortal
}

type CentroProps = ComponentProps<typeof CentroNotificacionesTab>

/** Props vacías: cada test enciende sólo la colección que le interesa. */
const VACIO: CentroProps = {
  cuotas: [], tickets: [], reservas: [], polizas: [], sugerencias: [],
  vencimientosExtra: [], inspecciones: [], contratos: [], unidades: [],
  moneda: 'Q',
  mensajesPortal: [], solicitudes: [], solicitudesConcierge: [],
  certificados: [], solicitudesRenta: [], solicitudesMudanza: [], comunicados: [],
}

function montar(over: Partial<CentroProps> = {}) {
  return render(<CentroNotificacionesTab {...VACIO} {...over} />)
}

describe('mensajes del portal', () => {
  it('avisa de los mensajes nuevos sin leer', () => {
    montar({ mensajesPortal: [mensaje(), mensaje({ id: 'm2', asunto: 'Fuga' })] })
    expect(screen.getByText(/2 mensaje\(s\) nuevo\(s\) del portal sin leer/)).toBeTruthy()
  })

  // Una emergencia y una consulta no pueden compartir tarjeta: la emergencia se
  // perdería en el conteo.
  it('separa las emergencias en su propia tarjeta crítica', () => {
    montar({
      mensajesPortal: [
        mensaje({ id: 'm1', tipo: 'emergencia', asunto: 'Se rompió una tubería' }),
        mensaje({ id: 'm2', tipo: 'consulta' }),
      ],
    })
    // La crítica es la emergencia; el mensaje ordinario baja a "Alto". El badge
    // de urgencia es hermano del título dentro de la misma cabecera de tarjeta.
    const emergencia = screen.getByText(/1 emergencia\(s\) reportada\(s\) desde el portal/)
    expect(emergencia.parentElement?.textContent).toContain('Crítico')
    const ordinario = screen.getByText(/1 mensaje\(s\) nuevo\(s\) del portal sin leer/)
    expect(ordinario.parentElement?.textContent).toContain('Alto')
    expect(ordinario.parentElement?.textContent).not.toContain('Crítico')
  })

  it('ignora los mensajes ya atendidos', () => {
    montar({ mensajesPortal: [mensaje({ estado: 'respondido' }), mensaje({ id: 'm2', estado: 'cerrado' })] })
    expect(screen.queryByText(/mensaje\(s\) nuevo\(s\) del portal/)).toBeNull()
    expect(screen.getByText('Todo en orden')).toBeTruthy()
  })
})

describe('solicitudes', () => {
  // Una tarjeta por cola: agregarlas todas escondería cuál está atascada.
  it('cuenta cada cola de solicitud por separado', () => {
    montar({
      solicitudes: [{ id: 's1', estado: 'pendiente' } as SolicitudResidente],
      solicitudesRenta: [
        { id: 'r1', estado: 'pendiente' } as SolicitudRentaUnidad,
        { id: 'r2', estado: 'pendiente' } as SolicitudRentaUnidad,
      ],
      solicitudesMudanza: [{ id: 'd1', estado: 'pendiente' } as SolicitudMudanzaUnidad],
      certificados: [{ id: 'c1', estado: 'pendiente' } as SolicitudCertificado],
      solicitudesConcierge: [{ id: 'k1', estado: 'pendiente' } as SolicitudConcierge],
    })
    expect(screen.getByText(/1 solicitud\(es\) de residente sin resolver/)).toBeTruthy()
    expect(screen.getByText(/2 autorización\(es\) de renta sin resolver/)).toBeTruthy()
    expect(screen.getByText(/1 autorización\(es\) de mudanza sin resolver/)).toBeTruthy()
    expect(screen.getByText(/1 solicitud\(es\) de certificado sin resolver/)).toBeTruthy()
    expect(screen.getByText(/1 pedido\(s\) de concierge sin resolver/)).toBeTruthy()
  })

  it('no muestra la cola que ya está resuelta', () => {
    montar({
      solicitudes: [{ id: 's1', estado: 'resuelto' } as SolicitudResidente],
      solicitudesRenta: [{ id: 'r1', estado: 'aprobada' } as SolicitudRentaUnidad],
    })
    expect(screen.queryByText(/sin resolver/)).toBeNull()
  })
})

describe('comunicados', () => {
  function comunicado(fechaEnvio: string): ComunicadoCondominio {
    return {
      id: `cm-${fechaEnvio}`, company_id: 'c1', project_id: 'p1',
      titulo: `Aviso ${fechaEnvio}`, contenido: 'cuerpo',
      tipo: 'aviso', destinatario: 'todos', fecha_envio: fechaEnvio,
      firmado: false, created_at: fechaEnvio,
    } as ComunicadoCondominio
  }

  const hace = (dias: number) => new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10)

  it('lista los publicados en la última semana', () => {
    montar({ comunicados: [comunicado(hace(1)), comunicado(hace(5))] })
    expect(screen.getByText(/2 comunicado\(s\) publicado\(s\) en los últimos 7 días/)).toBeTruthy()
  })

  it('deja fuera los viejos y los programados a futuro', () => {
    montar({ comunicados: [comunicado(hace(30)), comunicado(hace(-10))] })
    expect(screen.queryByText(/comunicado\(s\) publicado\(s\)/)).toBeNull()
  })
})

describe('estado vacío', () => {
  it('sigue diciendo "Todo en orden" cuando no hay nada pendiente', () => {
    montar()
    expect(screen.getByText('Todo en orden')).toBeTruthy()
  })
})
