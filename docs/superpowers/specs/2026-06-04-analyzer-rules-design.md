# Design Spec: candl-parser — Nowe reguły analityczne

**Data:** 2026-06-04  
**Status:** Approved

## Cel

Rozszerzenie candl-parser o 4 kategorie reguł analitycznych dla Nuxt 4 / Vue 3, poprawiających jakość kodu i optymalizację projektową.

---

## Architektura

```
src/
├── index.ts              (minimalne zmiany — integracja)
├── scanner.ts            (+ findComposableFiles, findStoreFiles)
├── analyzer.ts           (+ hydration rules + nuxt4 rules w istniejącym traverse)
└── analyzers/
    ├── composable.ts     (analiza plików .ts z composables/)
    └── pinia.ts          (cross-file analiza stores/)
```

---

## Kategoria 1: Hydration Mismatch Detection

Dodane do `analyzer.ts` — single-pass traverse dla `.vue` script setup.

| Kod | Wzorzec | Severity |
|---|---|---|
| `HYDRATION_BROWSER_GLOBAL` | `window.*`, `document.*`, `localStorage.*`, `navigator.*` poza `onMounted` lub `process.client` guard | `high` |
| `HYDRATION_NON_DETERMINISTIC` | `Math.random()`, `Date.now()`, `new Date()` w computed lub template | `high` |
| `HYDRATION_MISSING_CLIENT_ONLY` | `v-if="process.client"` bez `<ClientOnly>` wrappera | `medium` |
| `HYDRATION_NO_FALLBACK` | `v-if="process.client"` bez `v-else` lub `#fallback` | `medium` |

---

## Kategoria 2: Pinia Store Analysis

Plik: `src/analyzers/pinia.ts` — cross-file, dwuprzebiegowy algorytm.

**Pass 1:** Zbiera `defineStore` definitions z `stores/` (obsługa options i setup syntax).  
**Pass 2:** Zlicza użycia `useXxxStore()` we wszystkich `.vue` + `.ts`.

| Kod | Warunek | Severity |
|---|---|---|
| `PINIA_UNUSED_STORE` | Store nigdzie nie używany | `high` |
| `PINIA_SINGLE_CONSUMER` | Store używany tylko w 1 pliku | `low` |
| `PINIA_NO_STATE` | Setup store bez `ref/reactive/computed` | `medium` |
| `PINIA_SHOULD_BE_UTILITY` | Options store: tylko `actions`, brak `state`/`getters` | `medium` |

---

## Kategoria 3: Composable Necessity Check

Plik: `src/analyzers/composable.ts` — analiza plików `.ts` z `composables/`.

| Kod | Warunek | Severity |
|---|---|---|
| `COMPOSABLE_NO_REACTIVITY` | Brak `ref/reactive/computed/watch/watchEffect/provide/inject` | `medium` |
| `COMPOSABLE_NO_LIFECYCLE` | Brak lifecycle hooks | `medium` |
| `COMPOSABLE_PURE_TRANSFORM` | Czysta transformacja danych bez Vue API | `low` |

---

## Kategoria 4: Nuxt 4 Optimization Rules

Dodane do `analyzer.ts`. SEO rules tylko dla plików w `pages/`.

| Kod | Wzorzec | Severity |
|---|---|---|
| `NUXT_MANUAL_IMPORT` | Ręczny import `ref/computed/useRouter` — Nuxt auto-importuje | `low` |
| `NUXT_MISSING_ASYNC_COMPONENT` | Sync import komponentu `Modal/Drawer/Dialog/Panel/Overlay` | `low` |
| `NUXT_MISSING_PAGE_META` | Brak `definePageMeta()` w stronie | `medium` |
| `NUXT_MISSING_SEO_META` | Brak `useSeoMeta()`/`useHead()` w stronie | `low` |
