# candl-parser: Advanced Reporting System

**Date:** 2026-06-08  
**Status:** Approved

## Context

candl-parser currently dumps all results sequentially to the terminal via `@clack/prompts` `note()` calls — no filtering, no persistence, no export. The goal is to transform it into a professional reporting tool: rich terminal summary, optional HTML dashboard with interactive filtering, JSON export, incremental cache for speed, and NPM packaging for distribution.

---

## Architecture

Dwa nowe moduły + integracja w pipeline:

```
src/
├── reporter/
│   ├── terminal.ts     — redesign: progress bary per kategoria + diff z cache
│   ├── html.ts         — generator self-contained candl-report.html
│   ├── json.ts         — serializer candl-report.json
│   └── index.ts        — orkiestracja (pyta co eksportować)
├── cache/
│   ├── file-hash.ts    — SHA-256 hash per plik → pomija niezmienione pliki
│   └── report-store.ts — przechowuje pełny JSON z poprzedniej sesji (historia + diff)
└── index.ts            — integruje reporter i cache w istniejący pipeline
```

**Flow:**
```
scan → [cache check: skip unchanged files]
     → analyze changed files only
     → merge with cached results
     → reporter/terminal  (zawsze)
     → prompt "Otwórz HTML?" → reporter/html (opcjonalnie)
     → prompt "Zapisz JSON?" → reporter/json (opcjonalnie)
     → cache/report-store.save()
```

---

## Sekcja 1: Terminal Summary (redesign)

Zastępuje obecne `outro()` — `note()` per plik zostają bez zmian.

```
┌─────────────────────────────────────────────────────────┐
│  Przeanalizowano 47 plików (12 pominiętych z cache)     │
│                                                          │
│  Hydration    ████████░░░░  4 issues  (2 high)          │
│  Build        █████░░░░░░░  3 issues  (1 high)          │
│  Tree-shaking ███████░░░░░  5 issues  (0 high)          │
│  Nuxt/Vue     ██░░░░░░░░░░  2 issues                    │
│  Pinia        ░░░░░░░░░░░░  0 issues  ✓                 │
│                                                          │
│  ↑ +2 nowe  ↓ -1 naprawione  (vs. poprzednie skanowanie)│
│                                                          │
│  Znaleziono 14 problemów. Czas na refactoring!          │
│                                                          │
│  ? Otwórz raport HTML? (y/n)                            │
│  ? Zapisz candl-report.json? (y/n)                      │
└─────────────────────────────────────────────────────────┘
```

**Implementacja:**
- Progress bary: pure string manipulation + `picocolors` (już w zależnościach — brak nowych pakietów)
- Kategorie mapowane z kodów reguł: prefiks kodu → kategoria (`HYDRATION_*`, `BUILD_*`, `TREESHAKE_*`, `NUXT_*`/`COMPOSABLE_*`, `PINIA_*`)
- Diff pojawia się tylko gdy istnieje `.candl-cache/last-report.json`
- Prompty eksportu: `@clack/prompts` `confirm()` (już w zależnościach)

---

## Sekcja 2: HTML Report

Generator: `src/reporter/html.ts` tworzy **jeden self-contained plik** `candl-report.html`.

**Struktura pliku:**
```
[HEADER]
  🕯️ candl-parser · projekt: <nazwa> · <data> · <N> issues

[DASHBOARD]
  Karty: HIGH / MEDIUM / LOW / plików przeanalizowanych
  Progress bary per kategoria

[FILTER PANEL] ← sticky
  Sidebar:  checkboxy severity (HIGH/MEDIUM/LOW) + kategoria
  Search:   pole tekstowe (filtruje po pliku, kodzie, treści anomalii)
  Sort:     severity ↕ / plik ↕ / kategoria ↕
  Export:   przycisk "⬇ JSON" pobiera aktualnie przefiltrowany JSON
  Toggle:   grupuj per plik / per reguła

[ISSUE LIST]
  Każdy wiersz: color-coded border | plik | linia | kod | opis
  Grupowanie per plik (domyślnie) lub per reguła
```

**Implementacja:**
- Dane wstrzykiwane jako `<script>const REPORT_DATA = {...}</script>` (JSON serialized)
- Cały CSS i JS inline w pliku — zero zewnętrznych zależności, działa offline
- Vanilla JS (nie React/Vue) — nie wymaga Bun build step dla HTML
- `html.ts` buduje string przez template literals + interpolację danych
- Plik otwierany automatycznie przez `Bun.spawn(['open', reportPath])` na macOS lub `start` na Windows

---

## Sekcja 3: JSON Export

`src/reporter/json.ts` serializuje wyniki do `candl-report.json`:

```json
{
  "meta": {
    "date": "2026-06-08T14:32:00Z",
    "project": "vehis-pl",
    "version": "0.2.0",
    "filesScanned": 47,
    "filesFromCache": 12
  },
  "summary": {
    "total": 14,
    "bySeverity": { "high": 3, "medium": 8, "low": 5 },
    "byCategory": { "hydration": 4, "build": 3, "treeshaking": 5, "nuxt": 2 }
  },
  "issues": [
    {
      "filePath": "composables/useAuth.ts",
      "code": "BUILD_CIRCULAR_DEPENDENCY",
      "severity": "high",
      "message": "Circular dependency: composables/useAuth.ts → ..."
    }
  ]
}
```

---

## Sekcja 4: Cache System

Cache zapisywany w **`.candl-cache/`** w katalogu docelowym projektu.

```
.candl-cache/
  hashes.json       — { "composables/useAuth.ts": "sha256:abc123", ... }
  results.json      — pełne wyniki per plik z ostatniego skanu
  last-report.json  — skrót: { date, totalIssues, byCategory, bySeverity }
```

**`file-hash.ts`:**
- Przy starcie: dla każdego pliku SHA-256 hash vs. `hashes.json`
- Zmienione/nowe pliki → analizuj normalnie
- Niezmienione pliki → wczytaj wyniki z `results.json[filePath]`
- Użyj `Bun.file().arrayBuffer()` + `crypto.subtle.digest('SHA-256', ...)` — bez nowych zależności

**`report-store.ts`:**
- `save(results, summary)` — zapisuje `results.json` + `last-report.json` + aktualizuje `hashes.json`
- `load()` — wczytuje poprzedni stan; zwraca `null` jeśli brak cache
- `diff(current, previous)` — oblicza `{ added, fixed }` dla terminal diffa

**Cache invalidation:** Brak automatycznego kasowania — użytkownik może dodać `--no-cache` flagę (TODO #5).

---

## Sekcja 5: NPM Packaging

**`package.json` zmiany:**

```json
{
  "name": "candl",
  "version": "0.2.0",
  "description": "Advanced static analyzer for Nuxt 4 / Vue 3",
  "bin": { "candl": "./candl-bin" },
  "main": "./src/index.ts",
  "files": ["src/", "candl-bin"],
  "keywords": ["nuxt", "vue", "linter", "static-analysis"],
  "engines": { "node": ">=18" }
}
```

**`candl-bin`** (plik bez rozszerzenia, executable):
```bash
#!/usr/bin/env bun
import('./src/index.ts')
```

**`build.ts`** — kompiluje do standalone binary:
```bash
bun build src/index.ts --compile --outfile candl-bin
```

Standalone binary bundluje Bun runtime — użytkownik nie potrzebuje Bun. Dla `npx candl` — użytkownik potrzebuje Bun.

**Użycie po instalacji:**
```bash
npx candl              # bez instalacji
npm install -g candl   # globalna instalacja
candl                  # po instalacji globalnej
```

---

## Pliki do modyfikacji / stworzenia

| Akcja | Plik |
|-------|------|
| NOWY | `src/reporter/index.ts` |
| NOWY | `src/reporter/terminal.ts` |
| NOWY | `src/reporter/html.ts` |
| NOWY | `src/reporter/json.ts` |
| NOWY | `src/cache/file-hash.ts` |
| NOWY | `src/cache/report-store.ts` |
| ZMIANA | `src/index.ts` — integracja reportera + cache |
| ZMIANA | `package.json` — name, bin, files, keywords |
| NOWY | `candl-bin` — wrapper script |

---

## Weryfikacja

```bash
# Uruchom na projekcie Nuxt z kilkoma plikami
bun run src/index.ts

# Oczekiwane: nowe terminal summary z progress barami
# Oczekiwane: prompt "Otwórz HTML?" i "Zapisz JSON?"
# Oczekiwane: candl-report.html otwiera się w przeglądarce z dashboardem
# Oczekiwane: .candl-cache/ pojawia się w katalogu projektu

# Drugie uruchomienie (test cache):
bun run src/index.ts
# Oczekiwane: "X pominiętych z cache"
# Oczekiwane: diff "+N nowe / -N naprawione"

# Test NPM packaging:
bun run build.ts
./candl-bin  # uruchomienie binary
```
