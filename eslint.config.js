// ESLint flat config — guardarraíl de arquitectura (P0 #11 de la auditoría
// 2026-07-10). El objetivo NO es un lint exhaustivo del monorepo (eso es un
// follow-up), sino gatear en CI el BOUNDARY que la convención de src/domain/
// no podía hacer respetar por sí sola: los componentes no acceden a Supabase
// directo. Esta regla evita exactamente la regresión que reintrodujo imports
// directos de `supabase` en componentes.
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
  {
    // Solo componentes. Los hooks (useAuth/useNotifications/…) sí retienen el
    // cliente `supabase` a propósito para Realtime/auth; el dominio es la capa
    // que habla con la BD. Los tests/stories quedan fuera (mockean supabase).
    files: ['src/components/**/*.{ts,tsx}'],
    ignores: ['**/__tests__/**', '**/*.test.{ts,tsx}', '**/*.stories.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    // Los `// eslint-disable react-hooks/exhaustive-deps` existentes quedan
    // dormidos (la regla está off); no los reportamos como "unused".
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
    },
    rules: {
      // rules-of-hooks es correctness pura (previene bugs como React #310);
      // exhaustive-deps se deja off (ruidoso) pero registrado para que los
      // `// eslint-disable react-hooks/exhaustive-deps` existentes resuelvan.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'off',
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
      // Fecha LOCAL, no UTC (auditoría 2026-07-28, Bloque D · PR-24).
      //
      // `new Date().toISOString()` da la fecha UTC. En GMT-6, a partir de las
      // 18:00 locales ya es "mañana": el default de un <input type="date"> sale
      // con el día siguiente, y un payload a una columna DATE cae en el ciclo de
      // facturación equivocado. `src/lib/format.ts` trae `hoyLocalISO()` desde
      // que se detectó (E4/D5), pero solo lo usaban 6 archivos: el barrido de
      // PR-24 migró 204 ocurrencias en 128 archivos.
      //
      // Sin esta regla el patrón vuelve solo — es lo que pasó entre que se
      // escribió el helper y esta auditoría.
      'no-restricted-syntax': ['error', {
        selector:
          "CallExpression[callee.object.callee.object.callee.name='Date'][callee.object.callee.property.name='toISOString']",
        message:
          'No derives la fecha de `new Date().toISOString()`: devuelve la fecha UTC, ' +
          'que en husos negativos adelanta un día tras las 18:00 locales. Usá ' +
          '`hoyLocalISO()` de src/lib/format.ts (o `dateLocalISO(d)` para una fecha dada).',
      }],
    },
  },
]
