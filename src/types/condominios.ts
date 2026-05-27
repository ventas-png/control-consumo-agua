// Tipos del módulo Condominios
// Primer paso de la partición de `src/types/index.ts` por dominio (cond:C9).
// Por ahora solo viven aquí los tipos compartidos por la UI de cuotas;
// el resto se migrará incrementalmente en PRs sucesivos.
//
// El barrel `src/types/index.ts` re-exporta estos tipos para mantener la
// compatibilidad con código existente que hace `import { MetodoCalculo }
// from '@/types'` o `from '../../types'`.

export type MetodoCalculo = 'fijo' | 'por_m2' | 'alicuota'

export interface RubroConfig {
  nombre: string
  metodo: MetodoCalculo
  valor: number        // fijo: monto total; por_m2: precio/m²; alicuota: monto total del gasto
  notas?: string
}

export interface RubroDetalle extends RubroConfig {
  monto_calculado: number
}
