// Suministros y proformas históricos cuyo proveedor es solo un texto.
//
// Se IDENTIFICAN y se proponen coincidencias por nombre normalizado, pero nada se
// une solo: cada vínculo lo decide una persona, uno a uno, y el texto original se
// conserva. Una coincidencia «inequívoca» es solo una sugerencia.
import { useMemo, useState } from 'react'
import { useProveedoresQuery } from '../../domain/cxp/queries'
import { useOperacionesLegadoQuery, type OperacionLegado } from '../../domain/proveedores/queries'
import { useVincularOperacionMutation } from '../../domain/proveedores/mutations'
import { etiquetaProveedor } from '../../domain/proveedores/identidad'
import type { ProveedorCatalogo } from '../../types/proveedores'
import { notify } from '../shared/Dialog'
import { StatusBadge } from '../shared/StatusBadge'

const ROTULO: Record<OperacionLegado['clasificacion'], { texto: string; tono: 'success' | 'warning' | 'neutral' }> = {
  inequivoca: { texto: 'Coincidencia sugerida', tono: 'success' },
  ambigua: { texto: 'Varias coincidencias', tono: 'warning' },
  sin_coincidencia: { texto: 'Sin coincidencia', tono: 'neutral' },
}

export function OperacionesLegadoPanel({
  companyId, tabla, projectId, canEdit,
}: {
  companyId: string
  tabla: OperacionLegado['tabla']
  projectId: string
  canEdit: boolean
}) {
  const { data: filas = [], isLoading } = useOperacionesLegadoQuery(companyId)
  const { data: proveedores = [] } = useProveedoresQuery(companyId)
  const vincular = useVincularOperacionMutation()
  const [elegido, setElegido] = useState<Record<string, string>>({})

  const propias = useMemo(
    () => filas.filter((f) => f.tabla === tabla && f.project_id === projectId),
    [filas, tabla, projectId],
  )
  const catalogo = proveedores as ProveedorCatalogo[]

  if (isLoading || propias.length === 0) return null

  async function aplicar(f: OperacionLegado) {
    const proveedorId = elegido[f.registro_id] ?? (f.clasificacion === 'inequivoca' ? f.candidatos[0]?.id : undefined)
    if (!proveedorId) {
      notify({ variant: 'warning', title: 'Elige un proveedor', text: 'Selecciona el proveedor del catálogo al que corresponde.' })
      return
    }
    try {
      await vincular.mutateAsync({ tabla: f.tabla, registroId: f.registro_id, proveedorId })
      notify({ variant: 'success', title: 'Listo', text: 'Registro vinculado. Su texto original se conserva.' })
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo', text: e instanceof Error ? e.message : 'Error inesperado.' })
    }
  }

  return (
    <section data-testid="operaciones-legado" style={{ marginTop: 16, border: '1px dashed var(--at-line-strong)', borderRadius: 10, padding: 12 }}>
      <strong style={{ fontSize: 13 }}>Registros con proveedor solo en texto ({propias.length})</strong>
      <p style={{ margin: '4px 0 8px', fontSize: 12, color: 'var(--at-ink-3)' }}>
        Se capturaron antes del catálogo compartido. Vincúlalos uno a uno: <strong>nada se une automáticamente</strong> ni por parecido de nombre.
      </p>
      <div style={{ display: 'grid', gap: 6 }}>
        {propias.map((f) => (
          <div key={f.registro_id} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 12 }}>
            <span style={{ minWidth: 160 }}>«{f.texto}»</span>
            <StatusBadge tone={ROTULO[f.clasificacion].tono}>{ROTULO[f.clasificacion].texto}</StatusBadge>
            {canEdit && (
              <>
                <select
                  aria-label={`Proveedor del catálogo para ${f.texto}`}
                  value={elegido[f.registro_id] ?? (f.clasificacion === 'inequivoca' ? f.candidatos[0]?.id ?? '' : '')}
                  onChange={(e) => setElegido((m) => ({ ...m, [f.registro_id]: e.target.value }))}
                  style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--at-line)' }}
                >
                  <option value="">Elegir…</option>
                  {(f.candidatos.length > 0 ? f.candidatos.map((c) => catalogo.find((p) => p.id === c.id) ?? null) : catalogo)
                    .filter((p): p is ProveedorCatalogo => p !== null)
                    .map((p) => <option key={p.id} value={p.id}>{etiquetaProveedor(p)}</option>)}
                </select>
                <button type="button" disabled={vincular.isPending} onClick={() => void aplicar(f)}
                  style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--at-line)', cursor: 'pointer', fontSize: 12 }}>
                  Vincular
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
