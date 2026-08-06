import type { PlanningTask } from '#shared/planning'
import type { TaskWritePayload } from '~/utils/taskEditor'

// The one place the inline editor writes a task, so a create and an edit go through the same
// composable rather than two bare $fetch calls in a component. Both endpoints answer with the task in
// the exact shape the list endpoint returns, so a caller that wants the saved row already has it.
//
// It deliberately is not a TanStack mutation. Every other write in the app is, because every other
// read is a TanStack query, and the planning week is not: app/pages/index.vue reads it with
// useAsyncData('planning-tasks'). A mutation invalidating a query key would refresh nothing here, so
// it would be the convention followed in name and broken in effect. The documented path for a
// useAsyncData read is refreshNuxtData with its key, and the page does that after this resolves.

// A create, or a patch against one task id. The body is the same type either way, because both
// endpoints draw from one writable field set on the server.
export type TaskWriteRequest =
  | { body: TaskWritePayload; id: string; mode: 'update' }
  | { body: TaskWritePayload; mode: 'create' }

export function useTaskWrite() {
  // In flight, which the save control binds its loading state to.
  const saving = ref(false)

  async function save(request: TaskWriteRequest): Promise<PlanningTask> {
    saving.value = true

    try {
      if (request.mode === 'create') {
        return await $fetch<PlanningTask>('/api/tasks', { body: request.body, method: 'POST' })
      }

      return await $fetch<PlanningTask>(`/api/tasks/${request.id}`, {
        body: request.body,
        method: 'PATCH'
      })
    } catch (error) {
      // A failed save is recoverable and the form stays open, so the control has to come back to life
      // for the retry.
      saving.value = false
      throw error
    }

    // On success the flag is deliberately left set. The write has landed but the week still has to be
    // refreshed and the editor collapsed, and the control must not flicker back to life in between,
    // which is what makes two rapid activations one request (AC41). The editor is unmounted by the
    // collapse, which is what clears it.
  }

  return { save, saving }
}
