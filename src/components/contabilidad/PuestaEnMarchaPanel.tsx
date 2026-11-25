// Puesta en marcha de la contabilidad activa: qué le falta para operar.
//
// Se muestra arriba de las pestañas SOLO mientras falte algo; con todo listo no
// ocupa lugar. La regla vive en `domain/contabilidad/puestaEnMarcha` (pura y
// probada); aquí solo se juntan las consultas que las pestañas ya hacen (misma
// query key: no hay peticiones de más al abrir cada una) y se pinta.
import { useMemo, useState } from 'react'
import {
  useConfigTiposCargoQuery, useCuentasEspecialesQuery, useCuentasQuery, useHayAperturaQuery, useMapeoQuery,
} from '../../domain/contabilidad/queries'
import { useCuentasBancariasQuery } from '../../domain/bancos/queries'
import {
  evaluarPuestaEnMarcha, resumirPuestaEnMarcha, type DestinoPuestaEnMarcha,
} from '../../domain/contabilidad/puestaEnMarcha'
import { btnLink } from './ui'

interface Props {
  companyId: string
  /** null = contabilidad de la empresa. */
  projectId: string | null
  onIrA: (destino: DestinoPuestaEnMarcha) => void
}

export function PuestaEnMarchaPanel({ companyId, projectId, onIrA }: Props) {
  const cuentas = useCuentasQuery(companyId, projectId)
  const especiales = useCuentasEspecialesQuery(companyId, projectId)
  const mapeo = useMapeoQuery(companyId, projectId)
  const tipos = useConfigTiposCargoQuery(companyId, projectId)
  const apertura = useHayAperturaQuery(companyId, projectId)
  const bancos = useCuentasBancariasQuery(companyId, projectId)

  // Hasta tener TODAS las respuestas no se afirma que falte nada: un «falta el catálogo» que desaparece al segundo
  // enseña a ignorar el aviso. Si alguna consulta falla, tampoco se muestra (cada pestaña ya reporta su error).
  const consultas = [cuentas, especiales, mapeo, tipos, apertura, bancos]
  const listo = consultas.every((q) => q.isSuccess)

  const pasos = useMemo(() => {
    if (!listo) return []
    return evaluarPuestaEnMarcha({
      projectId,
      totalCuentas: (cuentas.data ?? []).length,
      especiales: especiales.data ?? [],
      eventosMapeados: (mapeo.data ?? []).map((m) => m.evento),
      tiposCargo: tipos.data ?? [],
      hayApertura: apertura.data ?? false,
      totalCuentasBancarias: (bancos.data ?? []).length,
    })
  }, [listo, projectId, cuentas.data, especiales.data, mapeo.data, tipos.data, apertura.data, bancos.data])
  const resumen = useMemo(() => resumirPuestaEnMarcha(pasos), [pasos])

  // Abierto mientras falte algo REQUERIDO; si solo faltan recomendados, plegado (una línea).
  const [abiertoManual, setAbiertoManual] = useState<boolean | null>(null)
  if (!listo || resumen.completa) return null
  const urgente = resumen.requeridosPendientes > 0
  const abierto = abiertoManual ?? urgente

  return (
    <section
      aria-label="Puesta en marcha de esta contabilidad"
      style={{
        border: `1px solid ${urgente ? 'var(--at-danger)' : 'var(--at-line)'}`,
        borderRadius: 10, padding: '10px 14px', background: 'var(--at-surface)', fontSize: 13,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <strong style={{ flex: 1, minWidth: 220 }}>
          Puesta en marcha: {resumen.listos} de {resumen.total} pasos listos
          {urgente && (
            <span style={{ fontWeight: 400, color: 'var(--at-danger)' }}>
              {' '}· {resumen.requeridosPendientes === 1 ? 'falta 1 requerido' : `faltan ${resumen.requeridosPendientes} requeridos`}: hay operaciones que no se contabilizarán
            </span>
          )}
        </strong>
        <button type="button" style={btnLink} aria-expanded={abierto} onClick={() => setAbiertoManual(!abierto)}>
          {abierto ? 'Ocultar pasos' : 'Ver pasos'}
        </button>
      </div>
      {abierto && (
        <ol style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {pasos.map((p) => (
            <li key={p.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span aria-hidden="true" style={{ width: 16, color: p.listo ? 'var(--at-success)' : p.nivel === 'requerido' ? 'var(--at-danger)' : 'var(--at-ink-soft)' }}>
                {p.listo ? '✓' : '○'}
              </span>
              <span style={{ fontWeight: 600, minWidth: 150 }}>{p.titulo}</span>
              <span style={{ flex: 1, minWidth: 200, color: 'var(--at-ink-soft)' }}>
                {p.listo ? 'Listo' : `${p.nivel === 'recomendado' ? 'Recomendado. ' : ''}${p.detalle}`}
              </span>
              {!p.listo && (
                <button type="button" style={btnLink} onClick={() => onIrA(p.destino)}>{p.accion}</button>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
