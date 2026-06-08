# Design Spec: Nuxt Island Architecture Detection

**Data:** 2026-06-04  
**Status:** Approved

## Cel

Wykrywanie dwóch klas problemów związanych z architekturą wysp w Nuxt 4:
1. Komponenty `.vue` które **mogłyby być wyspami** (server components) ale nimi nie są
2. Pliki `.island.vue` które **są błędnie zaimplementowane** (używają client-side API)

---

## Architektura

Nowy moduł: `src/analyzers/island.ts`  
Eksport: `analyzeIsland(filePath: string, source: string): FileAnalysisResult`

Wywoływany w `index.ts` w tej samej pętli co `analyzeVueFile` — jeden `readFileSync` na plik, dwa analyzery.

---

## Reguły

### `ISLAND_CANDIDATE` — severity: `low`

**Plik:** zwykły `.vue` (nie `.island.vue`)  
**Znaczenie:** Komponent wygląda na czysto serwerowy — mógłby być wyspą dla lepszej wydajności.

**Kryteria kwalifikujące (wszystkie muszą być spełnione):**

| Kryterium | Detekcja |
|---|---|
| Brak reaktywnego stanu | Brak `ref()`, `reactive()`, `useState()`, `shallowRef()` w script setup AST |
| Brak interaktywnych event handlerów | Brak `@click`, `@submit`, `@change`, `@input`, `@keydown`, `@keyup`, `@mousedown`, `@mouseup`, `@touchstart`, `@touchend`, `@focus`, `@blur` w template AST |
| Brak lifecycle hooks klienta | Brak `onMounted`, `onUnmounted`, `onUpdated`, `onBeforeUnmount` w script setup AST |

**Wzmocnienie sugestii (informacyjne w message):**  
Jeśli komponent zawiera `useAsyncData()` lub `useFetch()` → komunikat podkreśla że to szczególnie dobry kandydat.

---

### `ISLAND_MISUSE` — severity: `high`

**Plik:** `.island.vue`  
**Znaczenie:** Wyspa używa API które nie działa w kontekście server-only.

Każdy z poniższych wzorców generuje osobną anomalię:

| Wzorzec | Komunikat |
|---|---|
| `ref()` / `reactive()` / `useState()` / `shallowRef()` | Reaktywny stan nie działa w wyspach Nuxt — wyspy są renderowane tylko na serwerze |
| `@click` / `@submit` / `@input` itp. w template | Event handlery nie są wywoływane w wyspach — komponent jest server-only |
| `onMounted` / `onUnmounted` / `onUpdated` | Lifecycle hooks klienta nie są wywoływane w wyspach Nuxt |

---

## Implementacja

### Parsowanie template

Używamy `compileTemplate()` z `@vue/compiler-sfc` (już używane w `analyzer.ts`).  
Sprawdzamy `v-on` / `@` dyrektywy w templateAst — analogicznie do obecnej detekcji `v-if="process.client"`.

### Parsowanie script setup

Przez istniejący `compileScript()` + Babel traverse (ten sam pattern co `analyzer.ts`).

### Lista interaktywnych event handlerów

```
click, submit, change, input, keydown, keyup, keypress,
mousedown, mouseup, mouseover, mouseleave, mouseenter,
touchstart, touchend, touchmove, focus, blur, focusin, focusout
```

---

## Integracja w `index.ts`

```typescript
import { analyzeIsland } from './analyzers/island';

// W pętli po vueFiles:
const islandRes = analyzeIsland(file, content);
if (islandRes.anomalies.length > 0) allResults.push(islandRes);
```

Jedna pętla — `readFileSync` raz, wywołanie `analyzeVueFile` + `analyzeIsland` na tym samym `content`.
