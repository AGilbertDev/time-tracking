import { getMe } from './handlers/getMe'

// Thin route. The authenticated wrapper enforces the session first (401 otherwise), then the
// handler reads the current user's fresh row from the database. The target is always the session
// user.id; no id is ever read from the request. Mirrors the other me routes delegating to handlers/.
export default defineAuthenticatedEventHandler((event) => getMe(event))
