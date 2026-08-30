import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['src/node-verify.js'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-console': 'error',
    },
  },
  {
    files: [
      'src/main.tsx',
      'src/verify.ts',
      'src/services/api.ts',
      'src/services/soroban.ts',
      'src/components/CopyableAddress.tsx',
      'src/components/CreateStreamForm.tsx',
      'src/components/RecipientDashboard.tsx',
      'src/components/StreamsTable.tsx',
      'src/hooks/useDraftAutosave.ts',
      'src/hooks/useFreighter.ts',
      'src/components/StreamMetricsChart.tsx',
    ],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    files: ['**/*.stories.tsx'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-empty': 'off',
      'no-console': 'off',
      'prefer-const': 'off',
    },
  },
);
