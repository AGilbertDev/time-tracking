import perfectionist from 'eslint-plugin-perfectionist'
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended'

// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt([
  // .claude/worktrees holds throwaway copies of the repository that agents create
  // while they work, so resolving their nested ESLint config was never meaningful.
  // An ignores key on its own is a global ignore, which keeps ESLint from
  // descending into those directories at all.
  { ignores: ['.claude/**'] },
  eslintPluginPrettierRecommended,
  {
    plugins: { perfectionist },
    rules: {
      'perfectionist/sort-named-imports': ['warn'],
      'perfectionist/sort-interfaces': ['warn'],
      'perfectionist/sort-imports': ['warn'],
      'vue/attributes-order': ['warn', { alphabetical: true }]
    }
  }
])
