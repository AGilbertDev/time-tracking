<script setup lang="ts">
// Inline SVG so the mark recolors with the active theme. The calendar inherits
// the ink color and the clock inherits the primary, both via Nuxt UI tokens, so
// it adapts to every theme and to dark mode without separate image files.
</script>

<template>
  <span class="inline-flex">
    <svg class="h-full w-auto" fill="none" viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg">
      <mask id="badgeCut">
        <rect fill="white" height="240" width="240" />
        <circle cx="170" cy="172" fill="black" r="42" />
      </mask>
      <g
        fill="none"
        mask="url(#badgeCut)"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="15"
        style="stroke: var(--ui-text)"
      >
        <rect height="138" rx="26" width="152" x="44" y="62" />
        <line x1="86" x2="86" y1="46" y2="74" />
        <line x1="154" x2="154" y1="46" y2="74" />
        <line x1="52" x2="188" y1="98" y2="98" />
      </g>
      <path
        d="M170 144 A28 28 0 1 0 192 188"
        fill="none"
        stroke-linecap="round"
        stroke-width="11"
        style="stroke: var(--ui-primary)"
      />
      <g stroke-linecap="round" stroke-width="11" style="stroke: var(--ui-text)">
        <line x1="170" x2="156.8" y1="176" y2="162.9" />
        <line x1="170" x2="194.3" y1="176" y2="154.4" />
      </g>
      <circle cx="170" cy="176" r="4.5" style="fill: var(--ui-text)" />
    </svg>
  </span>
</template>
