import { getCategoryQuotas } from './handlers/getCategoryQuotas'

// Thin route. The authenticated wrapper enforces the session (401 when missing), the handler does the
// read. It takes no date parameter: the figures are resolved for today in the user's own timezone, and
// PLAN-22 resolves other dates through the server-side resolver rather than through this endpoint.
export default defineAuthenticatedEventHandler((event) => getCategoryQuotas(event))
