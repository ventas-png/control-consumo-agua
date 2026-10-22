# Escribir exige la ACCIÓN del tab (RLS por sección)

Un mapa por sección del panel de condominios. Cada uno dice, por tabla, qué
acción de qué tab autoriza crear (`INSERT`), editar (`UPDATE`) y borrar
(`DELETE`). De él sale la migración de la sección, y contra él se prueba.

## Por qué

La pantalla decide cada escritura con la acción del tab (`canCreate` /
`canEdit` / `canDelete` → `condominios.tab.<tab>.<acción>`, con el fallback
legado `platform.condominios.view` + `.<acción>`). Las policies que instaló
`rbac_install_company_policies` aplicaban otra regla:

| Comando | Antes | Ahora |
|---|---|---|
| `INSERT` / `UPDATE` | ver el tab | la acción del mapa |
| `DELETE` | sólo `company_owner` / `admin` | la acción del mapa |

`company_owner` / `admin` siguen pasando (`user_has_permission` los trata como
exentos) y `super_admin`, como antes.

## El mapa

```jsonc
{
  "_migracion": "<versión>_rls_acciones_<sección>.sql",
  "_titulo": "…", "_porque": ["…"],
  "tablas": {
    "<tabla>": {
      "tab": "<tab de la tabla>",                  // la clave que hoy pide la policy
      "INSERT": ["<tab>.create", "<otro>.create"],  // por defecto [tab.create]
      "UPDATE": ["<tab>.edit"],                     // por defecto [tab.edit]
      "DELETE": ["<tab>.delete"],                   // por defecto [tab.delete]
      "evidencia": { "<otro>": ["components/…/OtroTab.tsx", "…/Hijo.tsx"] },
      "porque": "…"
    }
  }
}
```

La regla para armarlo:

- Cada comando admite siempre la acción del **propio** tab.
- **Más** la acción con la que cada OTRA pantalla que escribe la tabla lo
  controla en la UI (p. ej. Seguridad inicia rondas con `canCreate('seguridad')`).
- Un tab ajeno necesita `evidencia`: la cadena de imports desde su componente
  en `tabRegistry` hasta el archivo que escribe.

## Cómo se usa

```bash
node scripts/rls-acciones/generar.mjs <sección>             # escribe la migración
node supabase/tests/rls_acciones/run.mjs <sección>          # la prueba contra Postgres
node scripts/rls-acciones/generar.mjs <sección> --revertir  # SQL para volver atrás
```

El generador reconstruye la base desde las migraciones del repo y, en cada
policy de escritura, sustituye **sólo** los átomos de permiso
(`user_has_permission('condominios.tab.<tab>')` y
`current_user_role() = ANY (company_owner, admin)`). Empresa, `EXISTS` al
padre y ramas del residente quedan idénticos. Si no sabe sustituir algo, se
detiene.

## Qué lo vigila

- `supabase/tests/rls_acciones/run.mjs` (job `rls-sandbox`):
  - la migración es la generada;
  - el hueco de antes existe;
  - la huella cambia sólo en las policies de la sección;
  - la matriz por persona y comando coincide con el mapa;
  - el residente obtiene lo mismo que antes;
  - un mutante por tabla rompe la matriz.
- `src/__tests__/rlsAccionesMapas.test.ts`:
  - toda pantalla que escribe una tabla del mapa está en él;
  - todo tab ajeno trae evidencia válida;
  - toda pestaña que borra recibe `canDelete`;
  - el arnés está en CI.
