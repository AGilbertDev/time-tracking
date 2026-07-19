// Central query-key factory. Every query and mutation reads its keys from here so the keys a
// mutation invalidates always match the queries that produced them. Add one function per key.
export const queryKeys = {
  // The current user and their persisted preferences.
  me: () => ['me'] as const
}
