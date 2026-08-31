import { resetOnboarding } from './handlers/reset'

// POST /api/admin/onboarding/reset. Admin-gated by the wrapper, which calls requireUserSession and
// then rejects any role that is not exactly 'admin', so the server is the real authorization
// boundary and hiding the control on the settings page is only an affordance.
//
// No request body and no query parameters, so there is nothing to validate and no Zod model. The
// endpoint always acts on the session user, so there is nothing to parameterise. A confirm flag was
// considered and rejected, because the confirmation is a user-interface concern and a boolean the
// client sets itself adds no safety while putting a second copy of the confirmation rule on the
// server. Anything sent in a body is simply never read.
//
// The runtime switch that can turn this feature off is checked in the handler rather than here or in
// the wrapper. defineAdminEventHandler serves every admin route and this switch governs exactly one
// of them, so putting it in the wrapper would spread one feature's lifetime across all of them.
export default defineAdminEventHandler((event) => resetOnboarding(event))
