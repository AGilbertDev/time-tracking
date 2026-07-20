import { serveAvatar } from './handlers/serveAvatar'

// Thin route. The authenticated wrapper enforces the session first (401 otherwise), then the handler
// re-derives the storage key from the session user.id and streams that user's own avatar bytes. The
// target is always the session user, so no id, path, or key is ever read from the request and the
// ?v= cache-buster is ignored. Mirrors the other me routes delegating to handlers/.
export default defineAuthenticatedEventHandler((event) => serveAvatar(event))
