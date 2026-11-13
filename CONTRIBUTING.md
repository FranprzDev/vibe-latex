# Contribuir a Vibe LaTeX

Gracias por querer aportar. Esta guía resume cómo preparar el entorno, correr
las pruebas y abrir un pull request.

## Requisitos

- Node.js 20 o superior.
- macOS para sintetizar los fixtures de audio con `say` y para el e2e de
  Obsidian (opcional).

## Preparar el entorno

```bash
npm install
```

## Scripts

```bash
npm run build          # bundle de producción a main.js
npm run dev            # bundle en modo watch
npm test               # tests unitarios (no requieren red)
npm run test:e2e       # e2e real (requiere OPENAI_API_KEY)
npm run test:obsidian  # e2e sobre Obsidian real (requiere Obsidian cerrado y CDP)
```

Antes de abrir un PR, verificá:

```bash
npx tsc --noEmit
npm run build
npm test
```

## Arquitectura

- `src/main.ts`: plugin de Obsidian (comandos, sesión de dictado, ajustes).
- `src/pipeline.ts`: audio → transcripción → conversión, desacoplado de Obsidian.
- `src/providers/`: interfaz `VoiceProvider` y la implementación de OpenAI.
- `src/recorder.ts`: grabación y segmentación por silencios.
- `src/settings.ts`: ajustes, defaults y migración de datos persistidos.
- `src/dictation-range.ts` y `src/abort.ts`: helpers puros y testeables.

La lógica que se pueda aislar de la API de Obsidian va en módulos puros, para
poder cubrirla con tests unitarios.

## Flujo de pull requests

1. Creá una rama descriptiva (`feat/…`, `fix/…`, `chore/…`).
2. Mantené los cambios acotados y con commits legibles.
3. Si tocás comportamiento, agregá o actualizá tests.
4. Asegurate de que `tsc`, `build` y `test` pasen en tu rama.
5. Actualizá `CHANGELOG.md` en la sección *Unreleased* si corresponde.
6. Abrí el PR describiendo el qué y el porqué, y referenciá el issue.

## Releases

1. Mové las entradas de *Unreleased* a la versión nueva en `CHANGELOG.md`.
2. Actualizá `package.json`, `manifest.json` y `versions.json`.
3. Mergeá a `main` y publicá un tag `X.Y.Z` **sin** el prefijo `v` (lo exige
   el listado oficial de plugins de la comunidad de Obsidian, porque el tag
   debe coincidir exactamente con la versión de `manifest.json`). El workflow
   de release adjunta `main.js`, `manifest.json` y `versions.json` al GitHub
   Release.
