<script setup lang="ts">
import type { FormError, FormSubmitEvent, TableColumn } from '@nuxt/ui'

import * as z from 'zod'

// Route name admin-users, localized to /utilisateurs (fr) and /users (en) by nuxt.config.
// The admin middleware redirects a non-admin away; the server wrapper is the real gate.
definePageMeta({ middleware: 'admin' })

const { t, locale } = useI18n()
const toast = useToast()
const { user } = useUserSession()

// Authenticated admin surface: keep it out of the index explicitly, even though the whole
// app is auth-gated. No canonical or hreflang is asserted here.
useSeoMeta({
  title: () => t('adminUsers.title'),
  robots: 'noindex, nofollow'
})

// --- Types matching the admin API contract -------------------------------------------------
type UserStatus = 'invited' | 'active' | 'deactivated'

interface AdminUserRow {
  date: string
  email: string
  firstName: string | null
  lastName: string | null
  role: string | null
  status: UserStatus
}

interface UsersResponse {
  page: number
  pageSize: number
  rows: AdminUserRow[]
  total: number
  totalPages: number
}

type InviteResult =
  | { result: 'invited'; delivered: boolean }
  | { result: 'already-active' }
  | { result: 'deactivated' }

type MutationResult =
  | { result: 'deactivated'; hadAccount: boolean; delivered?: boolean }
  | { result: 'reactivated' }

// --- List (server-side pagination, 20 per page) --------------------------------------------
const PAGE_SIZE = 20
const page = ref(1)

const { data, status, refresh } = await useAsyncData(
  'admin-users',
  () =>
    $fetch<UsersResponse>('/api/admin/users', {
      query: { page: page.value, pageSize: PAGE_SIZE }
    }),
  { watch: [page] }
)

const total = computed(() => data.value?.total ?? 0)
const isLoading = computed(() => status.value === 'pending' || status.value === 'idle')

// The count line uses vue-i18n pluralization: named { count } for interpolation, the trailing
// number selects the zero / one / other form so "1 utilisateur" is never pluralized wrong.
const countLabel = computed(() =>
  t('adminUsers.pagination.count', { count: total.value }, total.value)
)

// The active locale drives the date format so the medium date reads in the user's language.
const dateFormatter = computed(() => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }))
function formatDate(iso: string) {
  return dateFormatter.value.format(new Date(iso))
}

// Fixed status colours so the meaning never rethemes.
const statusColor: Record<UserStatus, 'info' | 'success' | 'neutral'> = {
  invited: 'info',
  active: 'success',
  deactivated: 'neutral'
}

const currentEmail = computed(() => user.value?.email ?? '')

const columns = computed<TableColumn<AdminUserRow>[]>(() => [
  { accessorKey: 'firstName', header: t('adminUsers.table.firstName') },
  { accessorKey: 'lastName', header: t('adminUsers.table.lastName') },
  { accessorKey: 'email', header: t('adminUsers.table.email') },
  {
    accessorKey: 'role',
    header: t('adminUsers.table.role'),
    meta: { class: { th: 'hidden md:table-cell', td: 'hidden md:table-cell' } }
  },
  { accessorKey: 'status', header: t('adminUsers.table.status') },
  {
    accessorKey: 'date',
    header: t('adminUsers.table.date'),
    meta: { class: { th: 'hidden md:table-cell', td: 'hidden md:table-cell' } }
  },
  // The actions column shows no visible header (design), but a screen reader still needs a
  // column name, so render a visually-hidden header rather than an empty <th>.
  {
    id: 'actions',
    header: () => h('span', { class: 'sr-only' }, t('adminUsers.table.actions')),
    meta: { class: { td: 'text-right' } }
  }
])

// --- Invite --------------------------------------------------------------------------------
const inviteState = reactive<{ email: string }>({ email: '' })
const inviting = ref(false)

// Localized validation rather than the raw Zod message, matching the house form pattern.
function validateInvite(state: { email: string }): FormError[] {
  const errors: FormError[] = []
  const email = state.email?.trim() ?? ''
  if (!email) errors.push({ name: 'email', message: t('adminUsers.invite.validation.required') })
  else if (!z.email().safeParse(email).success)
    errors.push({ name: 'email', message: t('adminUsers.invite.validation.invalid') })
  return errors
}

async function onInvite(event: FormSubmitEvent<{ email: string }>) {
  inviting.value = true
  try {
    const res = await $fetch<InviteResult>('/api/admin/users/invite', {
      method: 'POST',
      body: { email: event.data.email.trim() }
    })

    if (res.result === 'invited') {
      if (res.delivered === false) {
        toast.add({
          title: t('adminUsers.toast.deliveryWarning'),
          color: 'warning',
          icon: 'i-ph-warning'
        })
      } else {
        toast.add({
          title: t('adminUsers.toast.invited'),
          color: 'success',
          icon: 'i-ph-check-circle'
        })
      }
      inviteState.email = ''
      // A row was added or its invited_at refreshed, so re-read the list.
      await refresh()
    } else if (res.result === 'already-active') {
      toast.add({ title: t('adminUsers.toast.alreadyUser'), color: 'info', icon: 'i-ph-info' })
    } else {
      toast.add({
        title: t('adminUsers.toast.useReactivate'),
        color: 'warning',
        icon: 'i-ph-warning'
      })
    }
  } catch {
    toast.add({
      title: t('adminUsers.toast.error'),
      color: 'error',
      icon: 'i-ph-warning-circle'
    })
  } finally {
    inviting.value = false
  }
}

// --- Row actions + shared confirmation modal -----------------------------------------------
interface PendingAction {
  email: string
  status: UserStatus
  type: 'deactivate' | 'reactivate'
}

const pending = ref<PendingAction | null>(null)
const confirmOpen = ref(false)
const mutating = ref(false)

// One source of truth: the pending action's type and the row's status pick the copy case.
const confirmCase = computed<'deactivateActive' | 'revokeInvite' | 'reactivate' | null>(() => {
  if (!pending.value) return null
  if (pending.value.type === 'reactivate') return 'reactivate'
  return pending.value.status === 'invited' ? 'revokeInvite' : 'deactivateActive'
})
const confirmColor = computed<'error' | 'primary'>(() =>
  pending.value?.type === 'reactivate' ? 'primary' : 'error'
)

function openConfirm(row: AdminUserRow) {
  pending.value = {
    type: row.status === 'deactivated' ? 'reactivate' : 'deactivate',
    email: row.email,
    status: row.status
  }
  confirmOpen.value = true
}

async function confirmAction() {
  if (!pending.value) return
  const { type, email } = pending.value
  mutating.value = true
  try {
    const res = await $fetch<MutationResult>(`/api/admin/users/${type}`, {
      method: 'POST',
      body: { email }
    })

    if (res.result === 'deactivated') {
      if (res.delivered === false) {
        toast.add({
          title: t('adminUsers.toast.deliveryWarning'),
          color: 'warning',
          icon: 'i-ph-warning'
        })
      } else {
        toast.add({
          title: t('adminUsers.toast.deactivated'),
          color: 'success',
          icon: 'i-ph-check-circle'
        })
      }
    } else {
      toast.add({
        title: t('adminUsers.toast.reactivated'),
        color: 'success',
        icon: 'i-ph-check-circle'
      })
    }

    confirmOpen.value = false
    await refresh()
  } catch (error) {
    const code = (error as { data?: { statusMessage?: string } })?.data?.statusMessage
    toast.add({
      title:
        code === 'cannot_deactivate_self'
          ? t('adminUsers.toast.cannotDeactivateSelf')
          : t('adminUsers.toast.error'),
      color: 'error',
      icon: 'i-ph-warning-circle'
    })
  } finally {
    mutating.value = false
  }
}
</script>

<template>
  <div
    class="mx-auto w-full max-w-5xl px-6 py-[clamp(2rem,6vh,4rem)] sm:px-6 lg:px-8 xl:max-w-6xl space-y-[clamp(1.5rem,4vh,2.5rem)]"
  >
    <!-- Heading, directly on the canvas. -->
    <div>
      <h1
        class="text-[clamp(1.5rem,1.6vw+0.5rem,2.25rem)] font-bold tracking-tight text-highlighted"
      >
        {{ t('adminUsers.title') }}
      </h1>
      <p class="mt-2 text-sm text-balance text-muted">{{ t('adminUsers.intro') }}</p>
    </div>

    <!-- Invite card. -->
    <UCard class="rounded-2xl bg-default ring ring-default">
      <h2 class="text-lg font-semibold text-highlighted">{{ t('adminUsers.invite.heading') }}</h2>

      <UForm
        class="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start"
        :state="inviteState"
        :validate="validateInvite"
        @submit="onInvite"
      >
        <UFormField class="flex-1" :label="t('adminUsers.invite.emailLabel')" name="email" required>
          <UInput
            v-model="inviteState.email"
            autocomplete="email"
            class="w-full"
            icon="i-ph-envelope-simple"
            :placeholder="t('adminUsers.invite.emailPlaceholder')"
            size="lg"
            type="email"
          />
        </UFormField>

        <UButton
          class="btn-glow w-full sm:mt-6 sm:w-auto"
          color="primary"
          icon="i-ph-user-plus"
          :label="t('adminUsers.invite.submit')"
          :loading="inviting"
          size="lg"
          type="submit"
        />
      </UForm>
    </UCard>

    <!-- Users table card: body padding stripped so the table spans edge to edge. -->
    <UCard
      class="rounded-2xl bg-default ring ring-default"
      :ui="{ body: 'p-0', footer: 'px-4 py-3.5' }"
    >
      <div class="overflow-x-auto">
        <UTable
          :columns="columns"
          :data="data?.rows ?? []"
          :loading="isLoading"
          :ui="{ base: 'min-w-full' }"
        >
          <template #firstName-cell="{ row }">
            <span v-if="row.original.firstName" class="text-default">{{
              row.original.firstName
            }}</span>
            <span v-else aria-hidden="true" class="text-dimmed">&mdash;</span>
          </template>

          <template #lastName-cell="{ row }">
            <span v-if="row.original.lastName" class="text-default">{{
              row.original.lastName
            }}</span>
            <span v-else aria-hidden="true" class="text-dimmed">&mdash;</span>
          </template>

          <template #email-cell="{ row }">
            <span class="break-all text-default">{{ row.original.email }}</span>
          </template>

          <template #role-cell="{ row }">
            <UBadge
              v-if="row.original.role"
              :color="row.original.role === 'admin' ? 'primary' : 'neutral'"
              :label="t(`adminUsers.role.${row.original.role}`)"
              size="sm"
              variant="subtle"
            />
            <span v-else aria-hidden="true" class="text-dimmed">&mdash;</span>
          </template>

          <template #status-cell="{ row }">
            <UBadge
              :color="statusColor[row.original.status]"
              :label="t(`adminUsers.status.${row.original.status}`)"
              size="sm"
              variant="subtle"
            />
          </template>

          <template #date-cell="{ row }">
            <span class="tabular-nums text-muted">{{ formatDate(row.original.date) }}</span>
          </template>

          <template #actions-cell="{ row }">
            <div class="text-right">
              <UBadge
                v-if="row.original.email === currentEmail"
                color="neutral"
                :label="t('adminUsers.actions.you')"
                size="sm"
                variant="subtle"
              />
              <UButton
                v-else-if="row.original.status === 'deactivated'"
                :aria-label="t('adminUsers.actions.reactivateNamed', { email: row.original.email })"
                color="primary"
                icon="i-ph-arrow-counter-clockwise"
                :label="t('adminUsers.actions.reactivate')"
                size="sm"
                variant="soft"
                @click="openConfirm(row.original)"
              />
              <UButton
                v-else
                :aria-label="t('adminUsers.actions.deactivateNamed', { email: row.original.email })"
                color="error"
                icon="i-ph-user-minus"
                :label="t('adminUsers.actions.deactivate')"
                size="sm"
                variant="ghost"
                @click="openConfirm(row.original)"
              />
            </div>
          </template>

          <template #empty>
            <div v-if="total === 0" class="py-[clamp(2.5rem,8vh,4rem)] text-center">
              <UIcon class="mx-auto size-10 text-dimmed" name="i-ph-users" />
              <p class="mt-3 text-sm font-medium text-highlighted">
                {{ t('adminUsers.empty.title') }}
              </p>
              <p class="mt-1 text-sm text-muted">{{ t('adminUsers.empty.hint') }}</p>
            </div>
          </template>
        </UTable>
      </div>

      <template #footer>
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p class="text-sm text-muted">{{ countLabel }}</p>
          <UPagination v-model:page="page" :items-per-page="PAGE_SIZE" :total="total" />
        </div>
      </template>
    </UCard>

    <!-- Shared confirmation modal, copy and colour driven by the pending action. -->
    <UModal
      v-model:open="confirmOpen"
      :description="confirmCase ? t(`adminUsers.confirm.${confirmCase}.body`) : ''"
      :title="confirmCase ? t(`adminUsers.confirm.${confirmCase}.title`) : ''"
      :ui="{ footer: 'justify-end' }"
    >
      <template #footer="{ close }">
        <UButton
          color="neutral"
          :label="t('adminUsers.confirm.cancel')"
          variant="ghost"
          @click="close"
        />
        <UButton
          :color="confirmColor"
          :label="confirmCase ? t(`adminUsers.confirm.${confirmCase}.confirm`) : ''"
          :loading="mutating"
          @click="confirmAction"
        />
      </template>
    </UModal>
  </div>
</template>
