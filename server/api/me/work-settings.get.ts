import { getWorkSettings } from './handlers/getWorkSettings'

// Thin route. The authenticated wrapper enforces the session, the handler does the read.
export default defineAuthenticatedEventHandler((event) => getWorkSettings(event))
