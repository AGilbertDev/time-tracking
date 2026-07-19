import { z } from 'zod'

export const LoginSchema = z.object({
  // Normalize before validating (trim, lowercase, then check the email format) so a mixed-case
  // login input still matches the lowercased email stored at signup. The login handler looks the
  // user up with an exact eq(users.email, ...) and SQLite text comparison is case-sensitive, so
  // without this a user who typed any uppercase could not sign in. Matches the emailSchema style
  // in server/models/admin.ts.
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1)
})
