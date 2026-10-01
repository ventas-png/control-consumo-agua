// Contratos HISTÓRICOS sin proveedor vinculado: vista previa, vínculo y reversión.
//
// Los contratos anteriores al catálogo compartido tienen el proveedor en texto
// libre. Esta pantalla ayuda a vincularlos SIN destruir nada:
//   · propone solo coincidencias INEQUÍVOCAS (un único proveedor con el mismo
//     nombre normalizado y ninguna otra señal); lo demás exige elegir a mano;
//   · jamás borra ni fusiona proveedores, no toca su autorización ni inventa
//     datos fiscales, y conserva el texto, el id y los documentos del contrato;
//   · muestra los conteos ANTES y DESPUÉS y deja el vínculo en un LOTE que se
//     puede revertir.
// Aplicar es una decisión de quien administra el entorno; esta pantalla no
// ejecuta saneamientos por sí sola: simula primero y pide confirmación.
import { useState } from 'react'
import { StatusBadge } from '../shared/StatusBadge'
import { confirm, notify } from '../shared/Dialog'
import { openPromptDialog } from '../shared/PromptDialog'
import {
  useResumenVinculacionQuery,
  useVistaPreviaHistoricosQuery,
} from '../../domain/proveedores/queries'
import {
  useRevertirVinculosMutation,
  useVincularContratoMutation,
  useVincularInequivocosMutation,
} from '../../domain/proveedores/mutations'
import type {
  ClasificacionHistorico,
  ResultadoVincularInequivocos,
} from '../../types/proveedores'
import { btnLink, btnPrimario, btnSecundario } from '../contabilidad/ui'

interface Props {
  companyId: string
  /** Puede vincular (permiso de edición de la pestaña). El servidor lo exige igual. */
  puedeEditar: boolean
}

const TONO: Record<ClasificacionHistorico, 'success' | 'warning' | 'neutral'> = {
  inequivoca: 'success', ambigua: 'warning', sin_coincidencia: 'neutral',
}
const ETIQUETA: Record<ClasificacionHistorico, string> = {
  inequivoca: 'Inequívoca', ambigua: 'Ambigua · elegir', sin_coincidencia: 'Sin coincidencia',
}
const CRITERIO: Record<string, string> = {
  nombre_exacto: 'mismo nombre', forma_societaria: 'solo difiere la forma societaria', mismo_correo: 'mismo correo',
}

export function HistoricosPanel({ companyId, puedeEditar }: Props) {
  const { data: filas = [], isLoading } = useVistaPreviaHistoricosQuery(companyId)
  const { data: resumen } = useResumenVinculacionQuery(companyId)
  const vincular = useVincularContratoMutation()
  const masivo = useVincularInequivocosMutation()
  const revertir = useRevertirVinculosMutation()
  const [simulacion, setSimulacion] = useState<ResultadoVincularInequivocos | null>(null)
  const [loteAplicado, setLoteAplicado] = useState<ResultadoVincularInequivocos | null>(null)

  async function simular() {
    try {
      setSimulacion(await masivo.mutateAsync({ dryRun: true }))
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo simular', text: e instanceof Error ? e.message : 'Error inesperado.' })
    }
  }

  async function aplicar() {
    const n = simulacion?.propuestos ?? resumen?.propuesta.inequivocos ?? 0
    const ok = await confirm({
      title: `¿Vincular ${n} contrato${n === 1 ? '' : 's'} con coincidencia inequívoca?`,
      text: 'Solo se tocan los inequívocos. No se borra ni se fusiona nada, el texto histórico se conserva y el lote se puede revertir.',
      icon: 'warning',
      confirmText: 'Vincular',
    })
    if (!ok.isConfirmed) return
    try {
      const r = await masivo.mutateAsync({ dryRun: false })
      setLoteAplicado(r)
      setSimulacion(null)
      notify({ variant: 'success', title: 'Listo', text: `${r.vinculados} contrato(s) vinculados. Lote ${r.lote?.slice(0, 8)}…` })
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo', text: e instanceof Error ? e.message : 'Error inesperado.' })
    }
  }

  async function revertirLote() {
    if (!loteAplicado?.lote) return
    const r = await openPromptDialog({
      title: 'Revertir el lote de vínculos',
      description: 'Los contratos vuelven a quedar sin proveedor vinculado; su texto original nunca se tocó. Los que ya tienen órdenes de compra vinculadas se omiten.',
      fields: [{ name: 'motivo', label: '¿Por qué?', control: 'textarea', rows: 2, required: true }],
      submitText: 'Revertir',
    })
    const motivo = r?.motivo?.trim()
    if (!motivo) return
    try {
      const res = await revertir.mutateAsync({ lote: loteAplicado.lote, motivo })
      setLoteAplicado(null)
      notify({
        variant: res.omitidos.length ? 'warning' : 'success',
        title: 'Reversión',
        text: `${res.revertidos} revertido(s)${res.omitidos.length ? `, ${res.omitidos.length} omitido(s): ${res.omitidos.map((o) => o.motivo).join('; ')}` : ''}.`,
      })
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo', text: e instanceof Error ? e.message : 'Error inesperado.' })
    }
  }

  async function vincularManual(contratoId: string, proveedorId: string) {
    try {
      await vincular.mutateAsync({ contratoId, proveedorId })
      notify({ variant: 'success', title: 'Listo', text: 'Contrato vinculado al proveedor. Su texto original se conserva.' })
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo', text: e instanceof Error ? e.message : 'Error inesperado.' })
    }
  }

  if (isLoading) return <p style={{ fontSize: 13, color: 'var(--at-ink-soft)' }}>Revisando contratos históricos…</p>
  if (filas.length === 0) {
    return (
      <p data-testid="historicos-vacio" style={{ fontSize: 13, color: 'var(--at-ink-soft)' }}>
        Todos los contratos que puedes ver tienen su proveedor vinculado al catálogo.
      </p>
    )
  }

  return (
    <div data-testid="historicos-panel" style={{ display: 'grid', gap: 12 }}>
      <p style={{ margin: 0, fontSize: 13 }}>
        Estos contratos se capturaron antes del catálogo compartido: su proveedor es solo un texto. Vincularlos permite
        llegar desde el proveedor a sus contratos. <strong>No se borra ni se fusiona nada</strong>, el texto original y los
        documentos se conservan, y no se inventan autorizaciones ni datos fiscales.
      </p>

      {resumen && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8 }}>
          <Conteo titulo="Antes" lineas={[
            `${resumen.antes.total_contratos} contratos`, `${resumen.antes.vinculados} vinculados`, `${resumen.antes.sin_proveedor} sin proveedor`]} />
          <Conteo titulo="Propuesta" lineas={[
            `${resumen.propuesta.inequivocos} inequívocos`, `${resumen.propuesta.ambiguos} ambiguos (a mano)`, `${resumen.propuesta.sin_coincidencia} sin coincidencia`]} />
          <Conteo titulo="Después de aplicar los inequívocos" lineas={[
            `${resumen.despues_de_aplicar_inequivocos.vinculados} vinculados`, `${resumen.despues_de_aplicar_inequivocos.sin_proveedor} sin proveedor`]} />
        </div>
      )}

      {puedeEditar && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button style={btnSecundario} onClick={() => void simular()} disabled={masivo.isPending}>Simular vínculo de inequívocos</button>
          <button
            style={btnPrimario}
            onClick={() => void aplicar()}
            disabled={masivo.isPending || !simulacion || simulacion.propuestos === 0}
            title={!simulacion ? 'Simula primero para ver qué se vincularía' : undefined}
          >
            Aplicar ({simulacion?.propuestos ?? 0})
          </button>
          {loteAplicado?.lote && (
            <button style={btnSecundario} onClick={() => void revertirLote()}>Revertir lote {loteAplicado.lote.slice(0, 8)}…</button>
          )}
        </div>
      )}

      {simulacion && (
        <div role="status" style={{ padding: 10, borderRadius: 8, background: 'var(--at-chip)', fontSize: 12 }}>
          <strong>Simulación (no se cambió nada):</strong> se vincularían {simulacion.propuestos}.
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {simulacion.detalle.map((d) => (
              <li key={d.contrato_id}>«{d.texto_original}» → <strong>{d.proveedor_nombre}</strong></li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 640 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--at-ink-soft)' }}>
              <th style={{ padding: 6 }}>Texto del contrato</th>
              <th style={{ padding: 6 }}>Proyecto</th>
              <th style={{ padding: 6 }}>Estado</th>
              <th style={{ padding: 6 }}>Coincidencia</th>
              <th style={{ padding: 6 }}>Proveedor del catálogo</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.contrato_id} style={{ borderTop: '1px solid var(--at-line)', verticalAlign: 'top' }}>
                <td style={{ padding: 6 }}><strong>{f.proveedor_nombre_texto}</strong><div style={{ color: 'var(--at-ink-soft)' }}>{f.servicio}</div></td>
                <td style={{ padding: 6 }}>{f.proyecto_nombre}</td>
                <td style={{ padding: 6 }}>{f.estado}</td>
                <td style={{ padding: 6 }}>
                  <StatusBadge tone={TONO[f.clasificacion]}>{ETIQUETA[f.clasificacion]}</StatusBadge>
                  <div style={{ color: 'var(--at-ink-soft)', marginTop: 2 }}>{f.motivo}</div>
                </td>
                <td style={{ padding: 6 }}>
                  {f.clasificacion === 'inequivoca' && f.candidatos[0] && (
                    <span>→ <strong>{f.candidatos[0].nombre}</strong> {f.candidatos[0].codigo ? `(${f.candidatos[0].codigo})` : ''}</span>
                  )}
                  {f.clasificacion === 'ambigua' && puedeEditar && (
                    <select
                      defaultValue=""
                      aria-label={`Elegir proveedor para «${f.proveedor_nombre_texto}»`}
                      onChange={(e) => {
                        const id = e.target.value
                        e.target.value = ''
                        if (id) void vincularManual(f.contrato_id, id)
                      }}
                      style={{ padding: '4px 6px', borderRadius: 6, border: '1px solid var(--at-line)', maxWidth: 260 }}
                    >
                      <option value="">Elige uno de los candidatos…</option>
                      {f.candidatos.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nombre}{c.codigo ? ` (${c.codigo})` : ''} — {CRITERIO[c.criterio] ?? c.criterio}
                        </option>
                      ))}
                    </select>
                  )}
                  {f.clasificacion === 'sin_coincidencia' && (
                    <span style={{ color: 'var(--at-ink-soft)' }}>
                      Registra el proveedor en Contabilidad → Proveedores y vuelve a revisar.
                    </span>
                  )}
                  {f.clasificacion === 'inequivoca' && !puedeEditar && null}
                  {f.clasificacion !== 'inequivoca' && !puedeEditar && <button style={btnLink} disabled>Sin permiso para vincular</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Conteo({ titulo, lineas }: { titulo: string; lineas: string[] }) {
  return (
    <div style={{ padding: 10, borderRadius: 10, border: '1px solid var(--at-line)', background: 'var(--at-surface)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--at-ink-soft)', textTransform: 'uppercase' }}>{titulo}</div>
      {lineas.map((l) => <div key={l} style={{ fontSize: 13 }}>{l}</div>)}
    </div>
  )
}
