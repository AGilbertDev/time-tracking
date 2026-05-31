// Checks a password against the Have I Been Pwned breach corpus using k-anonymity.
// Only the first five characters of the SHA-1 hash are sent; the full password
// and full hash never leave the server. Returns true when the password appears
// in a known breach.
export async function isPasswordBreached(password: string): Promise<boolean> {
  const bytes = new TextEncoder().encode(password)
  const digest = await crypto.subtle.digest('SHA-1', bytes)
  const hash = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()

  const prefix = hash.slice(0, 5)
  const suffix = hash.slice(5)

  try {
    const list = await $fetch<string>(`https://api.pwnedpasswords.com/range/${prefix}`, {
      responseType: 'text'
    })
    return list.split('\n').some((line) => line.split(':')[0] === suffix)
  } catch {
    // Fail open. A breach-list outage must not block a legitimate user from onboarding.
    return false
  }
}
