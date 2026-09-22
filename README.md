# Good Stuff DS Game Maker

A modernized, Nintendo DS–flavored video game maker — an Electron + React desktop
app inspired by editors like Godot, built as a pnpm monorepo with clean n-tier
separation between domain logic, UI, build tooling, and the Electron shell.

## Layout

```
apps/
  desktop/            Electron shell (main, preload, renderer composition root)
packages/
  core/                @goodstuff/core        domain models (projects, scenes) — no UI/Electron deps
  ui/                   @goodstuff/ui          shared React components (designer UI lives here)
  build-config/         @goodstuff/build-config shared electron-vite build configuration
```

The Electron app (`apps/desktop`) is intentionally thin: it wires up the main
process, preload bridge, and renders `<App />` from `@goodstuff/ui`. Actual UI
components and domain models live in dedicated packages so they can be tested,
reused, or swapped independently of the Electron shell.

## Getting started

```bash
pnpm install
pnpm dev      # launch the Electron app in development mode
pnpm build    # build all packages, then the desktop app
```

## Status

This is the initial scaffold: a working Electron + React "Hello World" wired
through the core/ui/build-config packages. No designer UI has been built yet.
