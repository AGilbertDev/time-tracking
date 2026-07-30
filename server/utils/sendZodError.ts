import type { ZodError } from 'zod'

// The key a validation failure is filed under when it belongs to the body as a whole rather than to
// any one field. A client keys its messages off these names, so this one is part of the response
// contract and is declared once here rather than written inline at the point of use.
//
// The name was picked to stay out of the space of real field names. Every field on every request
// schema in this app is a plain camelCase column name, so a leading underscore cannot be produced by
// a path join, and `_form` is the spelling form libraries already use for an error that belongs to
// the submission instead of an input. It is reserved: no request schema may declare a field literally
// called `_form`, because `data` has one slot per key and the two would silently overwrite each
// other. That reservation is the whole reason the constant is named and exported instead of inlined.
export const FORM_LEVEL_KEY = '_form'

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

    // Every other path-less issue is the same problem wearing different clothes. A top-level refine
    // reports against the body rather than a field, so its path is empty too, and TaskUpdateSchema's
    // empty-patch guard is exactly that shape: an empty PATCH used to answer 422 with an empty
    // `data`, which is the unactionable response the branch above exists to prevent. Filing it under
    // a form-level key keeps `data` uniform, so a client reads one map for every failure and never
    // has to fall back to parsing statusMessage for the cases that happen to name no field.
    //
    // Several issues sharing a key keep the last message, form-level and per-field alike, which is
    // one rule rather than two. Nothing is lost by it, since statusMessage already carries every
    // message in order.
    const field = issue.path.join('.') || FORM_LEVEL_KEY
    data[field] = issue.message
  }

  throw createError({
    statusCode: 422,
    statusMessage: error.issues.map((i) => i.message).join(', '),
    data
  })
}
