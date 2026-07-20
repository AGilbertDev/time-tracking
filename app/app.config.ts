export default defineAppConfig({
  ui: {
    colors: {
      primary: 'brand',
      // Reserved semantic colors. Fixed across every theme so status always
      // reads the same, never recolored by the active atmosphere.
      success: 'green',
      info: 'blue',
      warning: 'amber',
      error: 'red',
      neutral: 'stone'
    },
    // One global container padding scale so every section agrees. Keep Nuxt UI's
    // own centering and max-width, override only the horizontal padding.
    container: {
      base: 'mx-auto w-full max-w-(--ui-container) px-6 sm:px-6 lg:px-8'
    },
    button: {
      // The glow hover (a crisp primary ring, defined as `.btn-glow` in app/assets/css/main.css)
      // is the default for every button rather than an opt-in class, so the whole app shares one
      // hover idiom. Appended to the base slot so it reaches every <UButton> with no per-call-site
      // class. The `.glow-on` modifier still lets a button stay lit for a persistent state.
      slots: {
        base: 'btn-glow'
      },
      variants: {
        size: {
          md: { base: 'text-md' },
          // Oversized CTA for future landing/hero use. Scales down on mobile and
          // pairs with `block` so long bilingual labels stack full width, never truncate.
          '2xl': {
            base: 'text-base px-5 py-3 gap-2 sm:text-xl sm:px-7 sm:py-4',
            leadingIcon: 'size-5 sm:size-6',
            trailingIcon: 'size-5 sm:size-6'
          }
        }
      },
      defaultVariants: { size: 'md' }
    },
    input: { defaultVariants: { size: 'md' } },
    inputNumber: { defaultVariants: { size: 'md' } },
    select: { defaultVariants: { size: 'md' } },
    selectMenu: { defaultVariants: { size: 'md' } },
    textarea: { defaultVariants: { size: 'md' } },
    badge: { defaultVariants: { size: 'md' } },
    checkbox: { defaultVariants: { size: 'md' } },
    radioGroup: { defaultVariants: { size: 'md' } },
    switch: { defaultVariants: { size: 'md' } },
    kbd: { defaultVariants: { size: 'md' } },
    progress: { defaultVariants: { size: 'md' } },
    navigationMenu: {
      slots: {
        link: 'text-md'
      }
    },
    header: {
      slots: {
        root: 'bg-elevated border-b border-default h-(--ui-header-height) sticky top-0 z-50'
      }
    },
    footer: {
      slots: {
        root: 'bg-elevated border-t border-default'
      }
    },
    main: {
      base: 'min-h-0 flex-1'
    }
  }
})
