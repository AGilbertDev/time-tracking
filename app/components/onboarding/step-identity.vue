<script setup lang="ts">
// The identity step captures the only mandatory fields. It writes straight into the shared
// wizard form, and the page reads password and confirm from that same form to gate Next and to
// surface a mismatch, so this component holds no local copy of the values.
const { t } = useI18n()
const form = useOnboardingForm()
</script>

<template>
  <div class="flex flex-col gap-4">
    <UFormField :label="t('onboarding.firstName')">
      <UInput
        v-model="form.firstName"
        autocomplete="given-name"
        class="w-full"
        required
        size="lg"
      />
    </UFormField>

    <UFormField :label="t('onboarding.lastName')">
      <UInput
        v-model="form.lastName"
        autocomplete="family-name"
        class="w-full"
        required
        size="lg"
      />
    </UFormField>

    <UFormField :help="t('onboarding.passwordHint')" :label="t('onboarding.password')">
      <UInput
        v-model="form.password"
        autocomplete="new-password"
        class="w-full"
        required
        size="lg"
        type="password"
      />
    </UFormField>

    <UFormField :label="t('onboarding.passwordConfirm')">
      <UInput
        v-model="form.confirm"
        autocomplete="new-password"
        class="w-full"
        required
        size="lg"
        type="password"
      />
    </UFormField>
  </div>
</template>
