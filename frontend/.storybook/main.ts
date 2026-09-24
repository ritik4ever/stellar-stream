import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: [
    '@storybook/addon-essentials',
  ],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  viteFinal: async (viteConfig) => {
  const allPlugins = ((viteConfig.plugins ?? []) as any[]).flat(Infinity);
  console.log('PLUGIN NAMES:', allPlugins.map((p) => p?.name));

  viteConfig.plugins = allPlugins.filter((plugin) => {
    const name = plugin?.name;
    return !name?.startsWith('vite-plugin-pwa');
  });

  return viteConfig;
  },
};

export default config;
