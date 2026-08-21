import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-types/**',
      // 빌드 시 node_modules에서 복사하는 vendor 자산 (ADR-0004)
      'apps/viewer-web/public/vendor/**',
      '**/node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // 빌드 대상 tsconfig와 테스트 전용 tsconfig를 함께 준다.
        // 테스트 파일은 빌드 산출물에서 제외되므로 tsconfig.tests.json이 담당한다.
        project: [
          './tsconfig.tests.json',
          './packages/contracts/tsconfig.json',
          './packages/domain/tsconfig.json',
          './packages/test-fixtures/tsconfig.json',
          './apps/viewer-web/tsconfig.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      // Event 이름과 Command 이름은 계약의 키로만 등장한다.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='publish'] > Literal:first-child[value=/^$/]",
          message: 'Event 이름은 빈 문자열일 수 없다. AppEventMap의 키를 사용한다.',
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['*.config.js', '*.config.ts', 'eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);
