import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'apps/mobile/android/**', 'apps/mobile/test/.smoke.cjs', 'apps/mobile/ios/**', 'apps/mobile/src/local/pdfjs-assets.generated.ts', '**/*.config.*', 'data/**'] },
  ...tseslint.configs.recommended,
  { ignores: ['apps/mobile/**'], plugins: { 'react-hooks': hooks }, rules: { ...hooks.configs.recommended.rules, '@typescript-eslint/no-explicit-any': 'off', 'react-hooks/exhaustive-deps': 'off' } },
  { files: ['apps/mobile/**/*.{ts,tsx}'], plugins: { 'react-hooks': hooks }, rules: { 'react-hooks/rules-of-hooks': 'error' } },
  { files: ['apps/mobile/**/*.{ts,tsx,js,cjs}'], rules: { '@typescript-eslint/no-explicit-any': 'off', '@typescript-eslint/no-unused-vars': 'off', '@typescript-eslint/no-require-imports': 'off', '@typescript-eslint/ban-ts-comment': 'off', '@typescript-eslint/no-empty-object-type': 'off', 'no-empty': 'off', 'prefer-const': 'off' } }
);
