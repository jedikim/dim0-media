import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { globalIgnores } from 'eslint/config'

export default tseslint.config([
  globalIgnores(['dist', 'src-tauri/target']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  // Stricter, TYPE-AWARE linting for the local-first code we're actively
  // building. Catches real bugs `tsc` won't (floating/misused promises,
  // await-thenable, …). The `no-unsafe-*` family is disabled — it only fires
  // on the unavoidable `as` casts at the canvas-harness boundary, not on bugs.
  {
    files: [
      'src/features/agent/**/*.{ts,tsx}',
      'src/features/board/local/**/*.{ts,tsx}',
      'src/features/board/persist/local/**/*.{ts,tsx}',
      'src/features/board/harness/agent/**/*.{ts,tsx}',
      'src/features/mini-app/**/*.{ts,tsx}',
    ],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      // `async` bodies with no `await` are interface conformance (Tool.run must
      // return a Promise), test mocks, and generator helpers — not bugs.
      '@typescript-eslint/require-await': 'off',
      // Async JSX event handlers (onClick={async …}) are idiomatic React; only
      // the attribute check is noisy. Keep the rest of the rule.
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      // Sentinel literals like `"none" | "any" | string` are intentional, documented.
      '@typescript-eslint/no-redundant-type-constituents': 'off',
    },
  },
])
