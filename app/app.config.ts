export default defineAppConfig({
  ui: {
    colors: {
      primary: 'brand',
      // Reserved semantic colors. Fixed across every theme so status always
      // reads the same, never recolored by the active atmosphere.
      //
      // success is emerald rather than green, moved by the PLAN-32c accessibility read against
      // rendered pixels. green-800 resolves to oklch(0.448 0.119 151) and `revision_internal`'s
      // printed name to oklch(0.47 0.11 140), an Oklab chord of 0.0336, which is closer than the two
      // revision categories are to each other (0.0461). A completed internal revision therefore put
      // the same green in the Catégorie cell and the Statut cell of one row, and the pair a user must
      // never confuse read as more alike than the pair that is meant to look related. Under
      // simulated protanopia it collapsed to 0.0201, about one just-noticeable difference.
      // emerald-800 is oklch(0.432 0.095 167). It lifts the closest trackable category to 0.0604
      // (0.0548 under protanopia) and raises the worst status contrast on the muted off-day card from
      // 5.74:1 to 6.13:1, so it is better on contrast as well as on separation. A category hue is the
      // primary user's own colour and ships verbatim, so the reserved role is what moves. teal was
      // measured too and rejected: it lands 7 degrees from `translation`'s cyan and trades one
      // collision for another. Only the palette name lives here, never a color value.
      success: 'emerald',
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
