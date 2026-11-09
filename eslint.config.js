import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.wrangler/**',
      '**/migrations/**',
      '**/coverage/**',
      '**/playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // R3: nenhuma credencial em localStorage (preferências visuais/idioma são permitidas).
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='setItem'][arguments.0.value=/token|secret|password|passw|key|session|auth/i]",
          message: 'Não grave credenciais em storage (R3). Use cookie HttpOnly.',
        },
      ],
    },
  },
);
