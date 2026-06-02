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
    button: {
      variants: {
        size: {
          md: { base: 'text-md' }
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
        root: 'bg-elevated/75 backdrop-blur border-b border-default h-(--ui-header-height) sticky top-0 z-50'
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
