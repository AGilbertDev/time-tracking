import { uploadAvatar } from './handlers/uploadAvatar'

// Thin route. The authenticated wrapper enforces the session first (401 otherwise), then the
// handler reads the multipart body, validates and processes the image, stores it, and persists the
// URL. Mirrors server/api/me/profile.patch.ts delegating to updateProfile. The target is always the
// session user, so no id is ever read from the request.
export default defineAuthenticatedEventHandler((event) => uploadAvatar(event))
