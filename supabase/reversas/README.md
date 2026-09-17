# `supabase/reversas/`

DDL **ejecutable** para deshacer migraciones que retiran objetos.

## Por qué existe este directorio

Una migración que BORRA algo no es reversible por sí sola. El comentario
`REVERSIÓN` que llevan las migraciones de este repositorio alcanza cuando lo que
hay que deshacer es una línea (`ALTER TABLE … DROP COLUMN`, un `SET DEFAULT`),
pero no cuando hay que **reponer un objeto entero**: para eso hace falta su
definición completa, y una definición no cabe cómodamente en un comentario ni se
puede ejecutar desde ahí.

Guardar sólo la **huella** del objeto no sirve como reversa. Una huella es un
`sha256`, y de un `sha256` no se reconstruye nada: sirve para DETECTAR que algo
cambió, no para REPONERLO. Este directorio existe porque esa confusión llegó a
escribirse en un PR de este repositorio.

## Por qué NO está en `supabase/migrations/`

Porque ahí se aplicaría solo. `listarMigraciones()` en
`scripts/schema-drift/reconstruir.mjs` toma **todo** `*.sql` de ese directorio,
y el CLI de Supabase hace lo mismo al desplegar y al construir una rama Preview.
Una reversa que se aplica sola no es una reversa: es un `CREATE` disfrazado que
repondría en cada entorno justo lo que la migración acaba de retirar.

Nada de este directorio se ejecuta automáticamente. Se corre **a mano**, y sólo
si hace falta.

## Cómo se usa

```bash
psql "$CADENA_DE_PRODUCCION" -v ON_ERROR_STOP=1 \
  -f supabase/reversas/<version>_<que_repone>.sql
```

Cada archivo lleva en su cabecera de dónde salió la definición, cuándo se
capturó y cómo comprobar que repuso exactamente lo que había.
