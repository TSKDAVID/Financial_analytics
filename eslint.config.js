import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'apps/mobile/**', '**/*.config.*', 'data/**'] },
  ...tseslint.configs.recommended,
  { plugins: { 'react-hooks': hooks }, rules: { ...hooks.configs.recommended.rules, '@typescript-eslint/no-explicit-any': 'off', 'react-hooks/exhaustive-deps': 'off' } }
);
