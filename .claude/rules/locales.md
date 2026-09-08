---
paths:
  - 'i18n/locales/**'
---

Before changing a locale file, load `/workflow:quebec-french` and follow it.

The two that get missed. French copy is Québécois, never français de France. The no-break space before `? ! : ;` is the literal U+00A0 character, not an escape and not a plain space, and `grep -P '\x{00A0}'` is the only form that reliably finds it.
