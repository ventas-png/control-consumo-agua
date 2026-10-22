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
  },
  "_sin_clave": { "<tab>": "por qué el catálogo no siembra sus claves" }
}
```

La regla para armarlo:

- Cada comando admite siempre la acción del **propio** tab.
- **Más** la acción con la que cada OTRA pantalla que escribe la tabla lo
  controla en la UI (p. ej. Seguridad inicia rondas con `canCreate('seguridad')`).
- Un tab ajeno necesita `evidencia`: la cadena de imports desde su componente
  en `tabRegistry` hasta el archivo que escribe.
- Si la tabla no tiene policy permisiva para un comando (p. ej. `votos` no
  tiene UPDATE), nadie lo hace, antes y después: no se crea, y el mapa no
  puede declararlo.
- Toda clave `condominios.tab.<tab>[.<acción>]` del mapa debe existir en
  `permissions`. Un tab cuyas claves el catálogo no siembra a propósito (hoy
  sólo lo ven company_owner/admin) se declara en `_sin_clave`; cualquier otro
  par ausente es una errata y el arnés falla.

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
  - la matriz por persona y comando coincide con el mapa (las compuertas
    RESTRICTIVE ajenas al permiso —plan contratado, MFA— no las toca la
    migración y se retiran en la prueba, antes y después por igual);
  - el residente obtiene lo mismo que antes;
  - un mutante por tabla rompe la matriz.
- `src/__tests__/rlsAccionesMapas.test.ts`:
  - toda pantalla que escribe una tabla del mapa está en él (y una que la
    escribe sin recibir ningún permiso, falla);
  - todo tab ajeno trae evidencia válida;
  - toda pestaña que borra —también por baja lógica, `softDelete`— recibe
    `canDelete`;
  - el arnés está en CI.
