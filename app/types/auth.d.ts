declare module '#auth-utils' {
  interface User {
    email: string
    firstName: string | null
    id: string
    lastName: string | null
    onboarded: boolean
  }
}
export {}
