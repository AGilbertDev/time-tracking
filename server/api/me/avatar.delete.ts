import { removeAvatar } from './handlers/removeAvatar'

// Thin route. The authenticated wrapper enforces the session first (401 otherwise), then the
// handler nulls the column and deletes the stored blob. The target is always the session user, so
// no id is ever read from the request.
export default defineAuthenticatedEventHandler((event) => removeAvatar(event))
