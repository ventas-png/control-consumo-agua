// Dónde se está trabajando: EMPRESA y PROYECTO activos, siempre visibles.
//
// El catálogo de proveedores es de la EMPRESA (lo comparten todos sus
// proyectos); los contratos, las órdenes y las reglas de compra son de un
// PROYECTO (o de la contabilidad de la empresa). Mezclar los dos niveles en
// silencio es como se carga un contrato en el proyecto equivocado.
import { useEmpresaNombreQuery } from '../../domain/proveedores/queries'

interface Props {
  companyId?: string
  /** Nombre del proyecto activo; null = contabilidad de la empresa (sin proyecto). */
  proyectoNombre: string | null
  /** De qué nivel es lo que se está viendo en esta pantalla. */
  alcance: 'empresa' | 'proyecto'
  /** Qué se está viendo, ej. «Proveedores» o «Contratos». */
  titulo: string
}

export function ContextoActivo({ companyId, proyectoNombre, alcance, titulo }: Props) {
  const { data: empresa } = useEmpresaNombreQuery(companyId)
  return (
    <div
      data-testid="contexto-activo"
      role="note"
      aria-label={`Contexto activo de ${titulo}`}
      style={{
        display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
        padding: '8px 12px', borderRadius: 10, fontSize: 12,
        background: 'var(--at-chip)', color: 'var(--at-ink)', border: '1px solid var(--at-line)',
      }}
    >
      <span style={{ fontWeight: 700 }}>{titulo}</span>
      <span aria-hidden>·</span>
      <span>🏢 Empresa: <strong>{empresa ?? 'activa'}</strong></span>
      <span aria-hidden>·</span>
      {proyectoNombre ? (
        <span>📍 Proyecto: <strong>{proyectoNombre}</strong></span>
      ) : (
        <span>📍 Contabilidad de la empresa (sin proyecto)</span>
      )}
      <span style={{ marginLeft: 'auto', color: 'var(--at-ink-soft)' }}>
        {alcance === 'empresa'
          ? 'Catálogo compartido por todos los proyectos de la empresa.'
          : proyectoNombre
            ? 'Solo lo de este proyecto.'
            : 'Solo lo de la contabilidad de la empresa.'}
      </span>
    </div>
  )
}
