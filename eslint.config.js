// ESLint flat config.
//
// Hasta la auditoría 2026-07-28 este archivo cubría SOLO `src/components/**` y
// tenía dos reglas activas. Es decir: `src/domain/`, `src/lib/` y `src/hooks/`
// —donde vive la lógica de negocio y de datos— estaban SIN LINT. PR-29 amplía el
// alcance a todo `src/`, separando lo que debe aplicarse en todas partes de lo
// que solo tiene sentido en componentes.
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  {
    ignores: [
      'dist/**',
      'dev-dist/**',
      'coverage/**',
      'node_modules/**',
      'storybook-static/**',
      'supabase/**',
      'public/**',
      '**/*.config.{js,ts,mjs,cjs}',
    ],
  },

  // ── Bloque 1: TODO src/ ────────────────────────────────────────────────────
  // Reglas de correctitud que no dependen de la capa. Tests y stories quedan
  // fuera: mockean módulos y montan hooks fuera de componentes a propósito.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['**/__tests__/**', '**/*.test.{ts,tsx}', '**/*.stories.{ts,tsx}'],
    // `@typescript-eslint` se registra con sus reglas APAGADAS, igual que el repo
    // ya hacía con react-hooks/exhaustive-deps: al ampliar el alcance entraron
    // archivos con `// eslint-disable-next-line @typescript-eslint/no-explicit-any`,
    // y una directiva que apunta a una regla no registrada es un error de ESLint.
    // Encenderlas de verdad es un follow-up (requiere linting con tipos).
    plugins: { 'react-hooks': reactHooks, '@typescript-eslint': tseslint.plugin },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',

      // Correctness pura: previene bugs como React #310 (orden de hooks
      // inconsistente entre renders → estado corrupto).
      'react-hooks/rules-of-hooks': 'error',

      // PR-29: pasa de 'off' a 'warn'. En 'off' no solo no reportaba nada, sino
      // que las 26 supresiones `// eslint-disable-next-line
      // react-hooks/exhaustive-deps` del repo quedaban dormidas y sin poder
      // revalidarse. En 'warn' no bloquea CI —hay ~20 avisos preexistentes— pero
      // sí caza dependencias omitidas en código nuevo, que es de donde salen los
      // stale closures.
      'react-hooks/exhaustive-deps': 'warn',

      // Fecha LOCAL, no UTC (Bloque D · PR-24).
      //
      // `new Date().toISOString()` da la fecha UTC. En GMT-6, a partir de las
      // 18:00 locales ya es "mañana": el default de un <input type="date"> sale
      // con el día siguiente, y un payload a una columna DATE cae en el ciclo de
      // facturación equivocado. Con `.slice(0, 7)` el fallo es peor: la noche
      // del último día del mes reporta ya el mes siguiente.
      //
      // Ampliar esta regla a todo `src/` (antes solo componentes) destapó 5
      // ocurrencias más en `domain/` y `lib/` — incluida una en `lib/business.ts`,
      // que es lógica de dinero.
      'no-restricted-syntax': ['error', {
        selector:
          "CallExpression[callee.object.callee.object.callee.name='Date'][callee.object.callee.property.name='toISOString']",
        message:
          'No derives la fecha de `new Date().toISOString()`: devuelve la fecha UTC, ' +
          'que en husos negativos adelanta un día tras las 18:00 locales. Usá ' +
          '`hoyLocalISO()` / `dateLocalISO(d)` / `mesLocalISO(d)` de src/lib/format.ts.',
      }],
    },
  },

  // ── Excepción acotada y TEMPORAL: src/App.tsx ──────────────────────────────
  //
  // Al ampliar el alcance, `rules-of-hooks` reporta 31 violaciones en App.tsx.
  // NO son ruido: `App()` tiene tres `return` tempranos (rutas `/dev/components`,
  // `/aceptar-invitacion` y la suite legal, resueltas contra `window.location`
  // ANTES del router) y todos los hooks vienen DESPUÉS. En esas rutas el
  // componente se renderiza con 0 hooks; en el resto, con ~31.
  //
  // Hoy no explota porque esas tres rutas son terminales: se entra por carga
  // completa y no se navega desde ellas dentro de la app. Pero si algo llamara a
  // `navigate()` estando en una de ellas, App volvería a renderizar con 31 hooks
  // donde antes hubo 0, y React lanza "Rendered more hooks than during the
  // previous render". Es exactamente la clase de bug que la regla existe para
  // cazar; el propio código tiene un comentario en :100 afirmando que los hooks
  // se llaman incondicionalmente, cosa que los early returns de arriba desmienten.
  //
  // El arreglo es mecánico —mover los tres early returns a un wrapper y dejar los
  // hooks en un componente interno que siempre los ejecuta— pero reestructura el
  // componente RAÍZ, que no tiene tests propios. Se deja fuera de PR-29 para no
  // mezclar un cambio de estructura con el endurecimiento del lint, y queda
  // documentado aquí en vez de escondido tras un disable a nivel de archivo.
  {
    files: ['src/App.tsx'],
    rules: { 'react-hooks/rules-of-hooks': 'off' },
  },

  // ── Bloque 2: solo componentes ─────────────────────────────────────────────
  // El boundary de arquitectura (P0 #11): los componentes no hablan con Supabase
  // directo. NO puede aplicarse a todo src/ — `src/domain/` importa el cliente a
  // propósito, es su trabajo.
  {
    files: ['src/components/**/*.{ts,tsx}'],
    ignores: ['**/__tests__/**', '**/*.test.{ts,tsx}', '**/*.stories.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
    },
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/lib/supabase'],
          // Restringe SOLO el binding `supabase` (el cliente). `warmUpSupabase`
          // (ping anti cold-start, sin CRUD) sigue permitido en la landing.
          importNames: ['supabase'],
          message:
            'Los componentes no acceden a Supabase directo: usá la capa src/domain/ ' +
            '(queries/mutations). Ver src/domain/README.md. `warmUpSupabase` sí está permitido.',
        }],
      }],
    },
  },
]
