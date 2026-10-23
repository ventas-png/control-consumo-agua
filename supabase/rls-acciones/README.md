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
      "ramas": { "columna": "<col>", "valores": {      // la policy elige el tab por columna
        "<valor>": { "tab": "<tab>", "INSERT": ["<tab>.create"], "receta": { … } } } },
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
- Una policy de escritura que no pide ningún permiso (p. ej. un UPDATE que
  sólo mira la empresa) se declara en `agregar_en` con el fragmento literal
  junto al que va la acción; el generador escribe «(fragmento AND acción)».
- `receta` fija el valor de columnas para la fila que fabrica el arnés,
  cuando una regla de negocio rechaza el valor por tipo (un CHECK de varias
  columnas, un trigger que exige un proveedor del catálogo). Es SQL y se
  evalúa al fabricar, como el admin de la empresa: puede pedir un padre
  (`ra.padre('public.proveedores', ra.id('A'), 1) ->> 'id'`).
  Con `true` como cuarto argumento, el padre es propio de cada fila (para
  columnas de una clave única). Una tabla padre que no está en el mapa lleva
  su receta en `_recetas` (p. ej. el código de un cargo, que tiene formato).
- `ramas` es para la policy que elige la clave del tab por el valor de una
  columna: `user_has_permission(CASE clase WHEN 'correspondencia' THEN
  'condominios.tab.correspondencia' ELSE 'condominios.tab.paqueteria' END)`.
  Cada `WHEN` pasa a pedir la acción de su rama y el `ELSE` la de la tabla.
  El CASE tiene que coincidir con el mapa (columna, valores y tabs), o el
  generador se detiene. Un comando que la rama no declara no se sustituye en
  ella: si su policy la resuelve sin átomo (p. ej. «sólo company_owner»),
  queda igual. El arnés fabrica una fila por rama, con su `receta` encima de
  la de la tabla, y la prueba con los pares de su rama.
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
  - un mutante por tabla, y uno por rama, rompe la matriz.
- `src/__tests__/rlsAccionesMapas.test.ts`:
  - toda pantalla que escribe una tabla del mapa está en él (y una que la
    escribe sin recibir ningún permiso, falla);
  - todo tab ajeno trae evidencia válida (el tab de una rama no es ajeno);
  - toda pestaña que borra —también por baja lógica, `softDelete`— recibe
    `canDelete`;
  - el arnés está en CI.
