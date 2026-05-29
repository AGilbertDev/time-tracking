import perfectionist from 'eslint-plugin-perfectionist'
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended'

// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt([
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
