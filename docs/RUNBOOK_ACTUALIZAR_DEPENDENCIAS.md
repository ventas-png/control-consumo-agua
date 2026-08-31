# Runbook — actualizar dependencias del grupo `minor-y-patch`

Cómo llevar a verde un PR de dependencias, y las dos trampas que ya nos
costaron un ciclo cada una. Escrito a partir de #811, #819, #820 y #821.

---

## 1. Prefiere adoptar el par de Dependabot a re-resolver el árbol

Cuando el PR de Dependabot está abierto **contra el `main` actual**, adopta su
`package.json` y su `package-lock.json` tal cual:

```bash
git fetch origin refs/pull/<N>/head
git restore --source=FETCH_HEAD -- package.json package-lock.json
git diff --exit-code FETCH_HEAD -- package.json package-lock.json   # debe salir 0
npm ci                                                             # valida el par
```

**No** hagas `rm package-lock.json && npm install`. Los números de #821 lo
explican solos:

| | re-resolución desde cero | lockfile de Dependabot |
|---|---|---|
| Diff del lockfile | 1421 / 1516 | **545 / 447** |
| Saltos de major aparentes | 13 | **0** |

Dependabot hace una actualización quirúrgica; `npm install` sobre un lockfile
borrado re-resuelve el árbol entero y **reordena el hoisting**. Eso no rompe
nada, pero genera decenas de líneas que *parecen* cambios de major y que hay
que ir desmintiendo una a una.

Para distinguirlos, compara el **conjunto de versiones de cada nombre en todo
el árbol**, no la entrada de primer nivel: si `main` y la rama tienen el mismo
conjunto, es hoisting y nada cambió realmente. Un "downgrade" de primer nivel
(`open` 10→8, `is-wsl` 3→2) es casi siempre eso.

### Cuándo NO adoptarlo

Si el PR de Dependabot se abrió contra una base anterior, su `package.json`
lleva las versiones viejas de todo lo demás y fusionarlo **revierte** lo que
haya entrado en medio. Le pasó a #819: se abrió antes de React 19 y seguía
declarando `react ^18.2.0`. Ahí toca reproducir los rangos a mano sobre el
`main` actual.

## 2. Trampa: `ERESOLVE` al actualizar `@vitejs/plugin-react`

`npm install` incremental sobre el lockfile de `main` puede abortar:

```
Conflicting peer dependency: @babel/core@8.0.1
  peer @babel/core@"^8.0.0" from @babel/plugin-transform-runtime@8.0.1
    peerOptional @babel/plugin-transform-runtime from @rolldown/plugin-babel
      peerOptional @rolldown/plugin-babel from @vitejs/plugin-react@6.1.1
```

Es un artefacto del **camino incremental**, no una incompatibilidad: resuelto
desde cero, npm no instala el peer opcional y el árbol cierra limpio.

**Nunca** lo tapes con `--force` ni `--legacy-peer-deps`: dejan un árbol que
instala pero miente. Si adoptas el lockfile de Dependabot (paso 1) el problema
no aparece, porque no hay resolución incremental que hacer.

## 3. Verificación local, sobre Node 22

```bash
npm ci
npm audit && npm audit --omit=dev     # ambos deben dar 0 vulnerabilidades
npm run type-check
npm run lint                          # 0 errores; 7 avisos preexistentes
npm run test
npm run build
node scripts/migrations-guard.mjs && node scripts/migrations-append-only.mjs
```

`npm audit --omit=dev` importa aparte del completo: es el que dice si lo que
llega al navegador del cliente arrastra algo.

## 4. El E2E necesita un Preview que sea de verdad el sandbox

`scripts/e2e-preflight.mjs` es **fail-closed** y valida tres cosas contra el
`/e2e-meta.json` que publica el despliegue:

1. `commit_sha` — igual al HEAD del PR;
2. `environment` — `e2e-sandbox`, que sólo aparece si el build llevaba
   `VITE_E2E_ENVIRONMENT=e2e-sandbox`;
3. `supabase_project_ref` — igual a `E2E_EXPECTED_SUPABASE_REF`.

La tercera **no es burocracia**: la suite escribe (captura lecturas, emite
facturas, emite y paga cuotas). Sin ella, un Preview mal configurado corre los
caminos de dinero contra la base de producción. En #821 el preflight paró
exactamente eso.

Para que una rama pueda correr el E2E, su alcance **Preview** en Vercel
necesita las tres variables:

- `VITE_E2E_ENVIRONMENT=e2e-sandbox`
- `VITE_SUPABASE_URL` → la del proyecto sandbox
- `VITE_SUPABASE_ANON_KEY` → la de ese mismo proyecto

Configurar sólo la primera hace que el preflight avance un paso y falle en el
siguiente, que es lo que parece un problema nuevo y es el mismo hueco.

### `VITE_*` se inlinea en tiempo de build

Añadir la variable **no cambia un despliegue ya construido**. Hace falta un
build nuevo: un push a la rama, o *Redeploy* **sin** «Use existing Build
Cache».

Y ojo con cuál redeployas: en la lista de Vercel el Preview de la rama y el de
`main` se llaman igual y sólo se distinguen por `githubCommitRef`. Redesplegar
uno asociado a `main` **reconstruye ese artefacto**, no el Preview del PR. Eso
por sí solo **no mueve el alias productivo**: el alias sigue donde estaba
mientras no haya una **promoción explícita**, así que un redeploy equivocado no
es un incidente de producción.

Lo que sí es, es inútil para lo que querías: ese artefacto declara el
`commit_sha` de `main`, y el preflight exige el HEAD del PR. Fallará la primera
validación por SHA aunque lleve bien las variables.

## 5. Qué NO hacer para poner el E2E en verde

- **`pull_request_target`** — daría secretos a código no fusionado, y no
  arregla nada: cuando el E2E falla aquí no es por falta de secretos.
- **Relajar el preflight** para aceptar `no-e2e` o un ref distinto —
  reconstruye el verde vacío que este job ya tuvo una vez, cuando pasaba sin
  ejecutar ninguna prueba.
- **Re-ejecutar el job** esperando que cambie. Estos fallos son deterministas
  mientras la configuración del Preview no cambie.

## 6. Cerrar el PR de Dependabot

El PR interno **sustituye** al de Dependabot; no se fusionan los dos. Deja el
de Dependabot abierto hasta que el reemplazo esté verde, y ciérralo entonces
como duplicado, enlazando el que sí entró.
