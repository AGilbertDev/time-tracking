import type { ZodError } from 'zod'

// Converts a ZodError into a structured 422 so the client gets per-field error messages.
export function sendZodError(error: ZodError): never {
  const data: Record<string, string> = {}

  for (const issue of error.issues) {
    const field = issue.path.join('.')
    if (field) data[field] = issue.message
  }

  throw createError({
    statusCode: 422,
    statusMessage: error.issues.map((i) => i.message).join(', '),
    data
  })
}
