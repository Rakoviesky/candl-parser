# 🤖 Instrukcje dla Claude Code: Rozwój "candl-parser"

## 📌 Kontekst Projektu
Pracujesz nad narzędziem CLI o nazwie **"candl-parser"** jest to zaawansowany, statyczny analizator kodu (Linter) przeznaczony dla ekosystemu **Nuxt 4 / Vue 3**.
Projekt jest napisany w **TypeScript** i uruchamiany w środowisku **Bun** (co pozwala na natychmiastowe działanie i kompilację do pliku binarnego).

Do parsowania plików `.vue` używamy `@vue/compiler-sfc`, a do analizy drzewa AST używamy `@babel/traverse` i `@babel/types`. Interfejs w terminalu obsługuje biblioteka `@clack/prompts`.

## 🏗️ Obecna Architektura
Projekt składa się z trzech głównych modułów w folderze `src/`:
1. `index.ts` - Orkiestrator i UI w terminalu (obsługa `@clack/prompts`).
2. `scanner.ts` - Rekursywne przeszukiwanie dysku za plikami `.vue`.
3. `analyzer.ts` - Silnik (mózg) parsowania AST, który aktualnie wykrywa statyczne deklaracje `ref()`, które nie są mutowane (sugerując zmianę na `const` lub `shallowRef`).

---

## 🎯 Twój Cel Główny
Twoim zadaniem jest rozbudowa pliku `src/analyzer.ts` o nowe reguły analityczne i detekcję anty-wzorców specyficznych dla Nuxta. Musisz zaimplementować poniższe funkcjonalności, dodając nowe ścieżki (paths) do wizytatora w `traverse()`.
Zwracaj wyniki analizy w postaci ustandaryzowanego obiektu `Anomaly`, który już istnieje w projekcie.

## 🛠️ Wytyczne Techniczne (Zasady Kodowania dla Claude)
1. **Ochrona UI:** NIE modyfikuj plików `index.ts` i struktury wyjściowej w konsoli bez wyraźnej prośby. Zmiany masz skupić w logicznym silniku w `analyzer.ts`.
2. **Bezpieczeństwo AST:** Parser `@babel/traverse` potrafi wyrzucać błędy przy TypeScript. Pamiętaj, aby odpowiednio rzutować typy węzłów (np. `t.isIdentifier(path.node)` itp.) i zawsze korzystaj ze strażników typów (Type Guards), aby uniknąć błędów `undefined` przy odczytywaniu właściwości węzłów.
3. **Efektywność iteracji:** Zamiast odpalać `traverse` wielokrotnie, umieść wszystkie reguły (detekcję hydracji, detekcję fetchów, analizę zmiennych) w jednym przejściu (single pass) po drzewie AST. Zoptymalizuje to znacznie czas działania skanera.

## 🏁 Akcja do wykonania
Przeczytaj ten plik, przeanalizuj obecny stan `src/analyzer.ts`. Zanim napiszesz kod, krótko potwierdź, że rozumiesz przekazane instrukcje.