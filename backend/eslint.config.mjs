import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-console': 'error',
    },
  },
  {
    files: [
      'src/index.ts',
      'src/logger.ts',
      'src/middleware/requestLogger.ts',
      'src/services/auth.ts',
      'src/services/cache.ts',
      'src/services/db.ts',
      'src/services/eventHistory.ts',
      'src/services/indexer.ts',
      'src/services/metricsHistory.ts',
      'src/services/migrations.ts',
      'src/services/openIssues.ts',
      'src/services/reconciliationJob.ts',
      'src/services/streamStore.ts',
      'src/config/validateEnv.ts',
      'src/services/webhook.ts',
      'src/services/webhookWorker.ts',
    ],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['src/services/db.ts'],
    rules: {
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
    },
  },
  {
    files: ['src/**/*.test.ts', 'src/**/*.integration.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'no-console': 'off',
      'no-empty': 'off',
      'no-useless-assignment': 'off',
      'prefer-const': 'off',
    },
  },
);
