import type { DehydratedState, VueQueryPluginOptions } from '@tanstack/vue-query'

import { dehydrate, hydrate, QueryClient, VueQueryPlugin } from '@tanstack/vue-query'

// Registers TanStack Query once for the app with SSR hydration. The server dehydrates the cache
// into the Nuxt payload after render and the client hydrates from it, so a query fetched during SSR
// is not refetched on the first client paint. This is the single place the query client is created.
export default defineNuxtPlugin((nuxt) => {
  const vueQueryState = useState<DehydratedState | null>('vue-query')

  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 5 * 1000 } }
  })
  const options: VueQueryPluginOptions = { queryClient }

  nuxt.vueApp.use(VueQueryPlugin, options)

  if (import.meta.server) {
    nuxt.hooks.hook('app:rendered', () => {
      vueQueryState.value = dehydrate(queryClient)
    })
  }

  if (import.meta.client) {
    hydrate(queryClient, vueQueryState.value)
  }
})
