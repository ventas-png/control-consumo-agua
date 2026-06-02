import type { StorybookConfig } from '@storybook/react-vite'

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-essentials'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  // F3.13 ext: la app usa vite.config.ts con plugin sentry + PWA. Para
  // Storybook NO necesitamos esos (build separado), asi que pasamos un config
  // minimal en preview.
  viteFinal: async (cfg) => {
    cfg.define = {
      ...cfg.define,
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://demo.supabase.co'),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('demo-key'),
    }
    return cfg
  },
}

export default config
