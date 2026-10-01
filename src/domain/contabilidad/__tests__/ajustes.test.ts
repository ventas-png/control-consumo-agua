// Reglas de pantalla de las solicitudes de ajuste (20261011000000). El
// servidor las vuelve a aplicar (supabase/tests/conta_ajustes); aquí se fija
// que la pantalla no ofrezca lo que el servidor rechazaría.
import { describe, expect, it, vi } from 'vitest'

const sb = vi.hoisted(() => ({
  upload: vi.fn(async (_p: string, _b: unknown, _o: unknown) => ({ data: { path: 'x' }, error: null as { message: string } | null })),
  rpc: vi.fn((_n: string, _a: Record<string, unknown>) => ({
    abortSignal: async () => ({ data: [{ respaldo_id: 'r1', repetida: false }], error: null }),
  })),
}))
vi.mock('../../../lib/supabase', () => ({
  supabase: { storage: { from: () => ({ upload: sb.upload }) }, rpc: sb.rpc },
  warmUpSupabase: vi.fn(),
}))

import {
  accionesSolicitud, adjuntarRespaldo, nombreSeguroRespaldo, rutaRespaldo, textoDependencias,
  textoSolicitudEnviada, ETIQUETA_TIPO_AJUSTE,
} from '../ajustes'

const YO = 'u-yo'
const OTRO = 'u-otro'

describe('accionesSolicitud · E1 (cuatro ojos, autoaprobación sólo del dueño)', () => {
  it('E8: resolver un cobro en línea no se autoaprueba, ni el dueño; otros tipos conservan la excepción', () => {
    const owner = { userId: YO, rol: 'company_owner', puedeAprobar: true }
    const resolver = accionesSolicitud({ tipo: 'resolver_cobro_en_linea', estado: 'pendiente', solicitado_por: YO, autoaprobada: false }, owner)
    expect(resolver).toMatchObject({ aprobar: false, autoaprobar: false, cancelar: true })
    const otro = accionesSolicitud({ tipo: 'anular_cuota', estado: 'pendiente', solicitado_por: YO, autoaprobada: false }, owner)
    expect(otro.autoaprobar).toBe(true)
    const deOtra = accionesSolicitud({ tipo: 'resolver_cobro_en_linea', estado: 'pendiente', solicitado_por: OTRO, autoaprobada: false }, owner)
    expect(deOtra.aprobar).toBe(true)
  })

  it('la solicitud de otra persona la aprueba quien tiene permiso', () => {
    const a = accionesSolicitud({ estado: 'pendiente', solicitado_por: OTRO, autoaprobada: false },
      { userId: YO, rol: 'admin', puedeAprobar: true })
    expect(a).toMatchObject({ aprobar: true, autoaprobar: false, rechazar: true, cancelar: false })
  })

  it('la propia NO la aprueba un admin (ni con permiso)', () => {
    const a = accionesSolicitud({ estado: 'pendiente', solicitado_por: YO, autoaprobada: false },
      { userId: YO, rol: 'admin', puedeAprobar: true })
    expect(a.aprobar).toBe(false)
    expect(a.autoaprobar).toBe(false)
    expect(a.cancelar).toBe(true)
  })

  it('la propia sólo la autoaprueba el company_owner (con confirmación en la pantalla)', () => {
    const a = accionesSolicitud({ estado: 'pendiente', solicitado_por: YO, autoaprobada: false },
      { userId: YO, rol: 'company_owner', puedeAprobar: true })
    expect(a).toMatchObject({ aprobar: false, autoaprobar: true })
  })

  it('no hay excepción por «único aprobador»: sin rol de dueño, la propia no se aprueba', () => {
    // Un usuario que es el único con permiso de aprobar en su empresa.
    const a = accionesSolicitud({ estado: 'pendiente', solicitado_por: YO, autoaprobada: false },
      { userId: YO, rol: 'operator', puedeAprobar: true })
    expect(a.aprobar || a.autoaprobar).toBe(false)
  })

  it('sin permiso de aprobar no hay aprobar, rechazar ni reintentar', () => {
    const a = accionesSolicitud({ estado: 'fallida', solicitado_por: OTRO, autoaprobada: false },
      { userId: YO, rol: 'operator', puedeAprobar: false })
    expect(a).toEqual({ aprobar: false, autoaprobar: false, rechazar: false, reintentar: false, cancelar: false })
  })

  it('fallida: reintenta otra persona; quien la pidió, sólo si fue su autoaprobación', () => {
    const otro = accionesSolicitud({ estado: 'fallida', solicitado_por: OTRO, autoaprobada: false },
      { userId: YO, rol: 'admin', puedeAprobar: true })
    expect(otro.reintentar).toBe(true)
    const propia = accionesSolicitud({ estado: 'fallida', solicitado_por: YO, autoaprobada: false },
      { userId: YO, rol: 'admin', puedeAprobar: true })
    expect(propia.reintentar).toBe(false)
    const autoaprobada = accionesSolicitud({ estado: 'fallida', solicitado_por: YO, autoaprobada: true },
      { userId: YO, rol: 'company_owner', puedeAprobar: true })
    expect(autoaprobada.reintentar).toBe(true)
  })

  it('ejecutada, rechazada o cancelada: sin acciones (no vencen ni se reabren)', () => {
    for (const estado of ['ejecutada', 'rechazada', 'cancelada'] as const) {
      const a = accionesSolicitud({ estado, solicitado_por: YO, autoaprobada: false },
        { userId: YO, rol: 'company_owner', puedeAprobar: true })
      expect(Object.values(a).some(Boolean)).toBe(false)
    }
  })
})

describe('textoSolicitudEnviada', () => {
  it('deja claro que nada cambia hasta la aprobación', () => {
    expect(textoSolicitudEnviada({ solicitud_id: 's', estado: 'pendiente', repetida: false })).toMatch(/Nada cambia hasta que otra persona/)
    expect(textoSolicitudEnviada({ solicitud_id: 's', estado: 'pendiente', repetida: true })).toMatch(/ya estaba registrada/)
  })
})

describe('respaldo documental (20261012000000)', () => {
  it('la ruta es <empresa>/<solicitud>/<clave>-<archivo> y el nombre no escapa de la carpeta', () => {
    expect(rutaRespaldo('c1', 's1', 'k1', 'Acta Asamblea.pdf')).toBe('c1/s1/k1-Acta_Asamblea.pdf')
    expect(nombreSeguroRespaldo('../../otra/empresa.pdf')).not.toContain('/')
    expect(nombreSeguroRespaldo('...')).toBe('respaldo')
  })

  it('sube sin sobrescribir y registra el archivo por la RPC, con el hash del contenido', async () => {
    sb.upload.mockClear(); sb.rpc.mockClear()
    const archivo = new File(['%PDF-1.4 hola'], 'acta.pdf', { type: 'application/pdf' })
    const r = await adjuntarRespaldo({ clave: 'k1', companyId: 'c1', solicitudId: 's1', archivo })
    expect(r).toEqual({ respaldo_id: 'r1', repetida: false })
    expect(sb.upload).toHaveBeenCalledWith('c1/s1/k1-acta.pdf', archivo, { contentType: 'application/pdf', upsert: false })
    const [nombre, args] = sb.rpc.mock.calls[0]
    expect(nombre).toBe('conta_ajuste_adjuntar_respaldo')
    expect(args).toMatchObject({ p_id: 'k1', p_solicitud_id: 's1', p_storage_path: 'c1/s1/k1-acta.pdf' })
    expect(String(args.p_sha256)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('un reintento con el archivo ya subido sólo lo registra', async () => {
    sb.upload.mockResolvedValueOnce({ data: null as unknown as { path: string }, error: { message: 'The resource already exists' } })
    const archivo = new File(['x'], 'a.png', { type: 'image/png' })
    await expect(adjuntarRespaldo({ clave: 'k2', companyId: 'c1', solicitudId: 's1', archivo })).resolves.toBeTruthy()
  })

  it('rechaza tipos y tamaños no admitidos antes de subir', async () => {
    sb.upload.mockClear()
    await expect(adjuntarRespaldo({ clave: 'k', companyId: 'c', solicitudId: 's', archivo: new File(['x'], 'a.exe', { type: 'application/x-msdownload' }) }))
      .rejects.toThrow(/PDF o imagen/)
    const grande = new File([new Uint8Array(16 * 1024 * 1024)], 'g.pdf', { type: 'application/pdf' })
    await expect(adjuntarRespaldo({ clave: 'k', companyId: 'c', solicitudId: 's', archivo: grande })).rejects.toThrow(/15 MB/)
    expect(sb.upload).not.toHaveBeenCalled()
  })
})

describe('anular cuota por solicitud (20261012000000)', () => {
  it('tiene etiqueta propia', () => {
    expect(ETIQUETA_TIPO_AJUSTE.anular_cuota).toBe('Anular cuota')
  })
  it('las dependencias se explican con cómo resolverlas', () => {
    const t = textoDependencias([
      { dependencia: 'cobro', id: 'p1', monto: 10, estado: 'aplicado', detalle: 'Cobro efectivo', como_resolver: 'Recházalo o anúlalo en Pagos antes de anular la cuota.' },
    ])
    expect(t).toBe('• Cobro efectivo (10.00): Recházalo o anúlalo en Pagos antes de anular la cuota.')
  })
})
