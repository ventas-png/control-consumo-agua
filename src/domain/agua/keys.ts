// T7 — Query keys del dominio Agua.
//
// Convención (replicable en cada dominio):
//   - `all`: raíz del dominio. Permite invalidar todo de una:
//       queryClient.invalidateQueries({ queryKey: aguaKeys.all })
//   - cada entidad es una función que añade el scope relevante (companyId) para
//     que cada tenant tenga su propia entrada en caché y no haya cross-leak.
//   - companyId ausente se normaliza a `null` para que la key sea estable
//     (`undefined` rompería la igualdad estructural entre renders).
export const aguaKeys = {
  all: ['agua'] as const,
  proyectos: (companyId?: string) => [...aguaKeys.all, 'proyectos', companyId ?? null] as const,
  // Asignaciones de proyecto del usuario (user_project_assignments). Scope por
  // usuario, no por empresa: define qué proyectos ve un rol restringido.
  proyectoAssignments: (userId?: string) => [...aguaKeys.all, 'proyecto-assignments', userId ?? null] as const,
  fuentesAgua: (companyId?: string) => [...aguaKeys.all, 'fuentes-agua', companyId ?? null] as const,
  registrosCalidad: (companyId?: string) => [...aguaKeys.all, 'registros-calidad', companyId ?? null] as const,
  empresa: (companyId?: string) => [...aguaKeys.all, 'empresa', companyId ?? null] as const,
  clientes: (companyId?: string) => [...aguaKeys.all, 'clientes', companyId ?? null] as const,
  registros: (companyId?: string) => [...aguaKeys.all, 'registros', companyId ?? null] as const,
  rutas: (companyId?: string) => [...aguaKeys.all, 'rutas', companyId ?? null] as const,
  tarifas: (companyId?: string) => [...aguaKeys.all, 'tarifas', companyId ?? null] as const,
  contadores: (companyId?: string) => [...aguaKeys.all, 'contadores', companyId ?? null] as const,
  unidades: (companyId?: string) => [...aguaKeys.all, 'unidades', companyId ?? null] as const,
  proveedoresEnergia: (companyId?: string) => [...aguaKeys.all, 'proveedores-energia', companyId ?? null] as const,
  tarifasEnergia: (companyId?: string) => [...aguaKeys.all, 'tarifas-energia', companyId ?? null] as const,
  fuentesEnergia: (companyId?: string) => [...aguaKeys.all, 'fuentes-energia', companyId ?? null] as const,
  facturasEnergia: (companyId?: string) => [...aguaKeys.all, 'facturas-energia', companyId ?? null] as const,
  // Lecturas con scope (parametrizadas). El scope completo forma parte de la key
  // para que cada combinación (proyecto, mes) tenga su propia entrada en caché.
  contadoresPorProyecto: (companyId: string, proyectoId: string) =>
    [...aguaKeys.all, 'contadores', 'por-proyecto', companyId, proyectoId] as const,
  consumoPorProyecto: (proyectoId: string, mes: string) =>
    [...aguaKeys.all, 'registros', 'consumo-por-proyecto', proyectoId, mes] as const,
  consumoMensualPorProyecto: (proyectoId: string) =>
    [...aguaKeys.all, 'registros', 'consumo-mensual-por-proyecto', proyectoId] as const,
  medidoresAguaPorProyecto: (companyId: string, proyectoId: string) =>
    [...aguaKeys.all, 'medidores-agua', 'por-proyecto', companyId, proyectoId] as const,
  // Anomalías de consumo (RPC agua_anomalias_consumo) por tenant/proyecto.
  anomaliasConsumo: (companyId?: string, projectId?: string | null) =>
    [...aguaKeys.all, 'anomalias-consumo', companyId ?? null, projectId ?? null] as const,
} as const
