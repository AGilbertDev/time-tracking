import type { ZodError } from 'zod'

// Converts a ZodError into a structured 422 so the client gets per-field error messages.
export function sendZodError(error: ZodError): never {
  const data: Record<string, string> = {}

  for (const issue of error.issues) {
    // A strict object reports every unknown key in a single issue carrying an empty path, so keying
    // by the path alone would drop it and leave a 422 with nothing in `data` to act on. Naming each
    // rejected key is what lets a client say which field is not writable rather than only that
    // something in the body was wrong.
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) data[key] = issue.message
      continue
    }

    const field = issue.path.join('.')
    if (field) data[field] = issue.message
  }

  throw createError({
    statusCode: 422,
    statusMessage: error.issues.map((i) => i.message).join(', '),
    data
  })
}
