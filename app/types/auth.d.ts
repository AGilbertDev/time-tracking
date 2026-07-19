import type { Locale } from '#shared/theme'

declare module '#auth-utils' {
  interface User {
    darkTheme: string
    email: string
    firstName: string | null
    id: string
    lastName: string | null
    lightTheme: string
    locale: Locale
    onboarded: boolean
    role: string
  }
}
export {}
