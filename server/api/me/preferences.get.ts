import { getPreferences } from './handlers/getPreferences'

// Thin route. The authenticated wrapper enforces the session, the handler does the read.
export default defineAuthenticatedEventHandler((event) => getPreferences(event))
