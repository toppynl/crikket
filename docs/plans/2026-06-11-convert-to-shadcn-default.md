# Plan: Convert to a generic, stock shadcn/ui admin UI

**Date:** 2026-06-11
**Goal:** Make the whole monorepo look and behave like a default, "latest-standards" shadcn/ui admin app — not a bespoke theme. Cover `packages/ui`, `apps/web`, `apps/docs`, `apps/extension`, and `sdks/capture`.

## What the user asked for

1. As close to a **default / generic shadcn/ui** interface as possible, using the **latest shadcn standards**. Primitive choice (Base UI vs Radix) does **not** matter.
2. Concretely, for the admin UI:
   - Use the **default shadcn/ui collapsible sidebar**.
   - Move the **Settings items into the main menu** as a collapsible group (promote them out of the separate settings page nav).
   - **Stop center-aligning settings** — settings should fill the page like the rest of the dashboard.

## Current state (findings)

The repo is already ~95% a shadcn setup. The non-generic parts are concentrated, which makes this tractable.

### Theme (the biggest visual offender)
- `apps/web` loads `packages/ui/src/styles/dashboard.css` (via `apps/web/src/app/layout.tsx`), a custom theme that is the opposite of "generic":
  - `--radius: 0rem` → sharp corners everywhere.
  - `--font-sans/serif/mono: Geist Mono, monospace` → the entire admin UI is monospace.
  - `--primary: oklch(0.5555 0 0)` → mid-gray primary instead of near-black.
  - `--chart-1..5` all identical gray → monochrome charts.
  - All `--shadow-*` set to opacity `0` → fully flat.
- `packages/ui/src/styles/globals.css` (used by `docs` + `extension`) is, by contrast, already ~stock neutral (`--radius: 0.625rem`, near-black primary, real borders) — but uses `Inter Variable` and carries `marquee` keyframes + `fumadocs` imports.
- Canonical latest shadcn (from `shadcn-ui/ui` `apps/v4`): `style: new-york-v4`, `baseColor: neutral`, OKLch tokens, `--radius: 0.625rem`, **Geist** (sans) + Geist Mono, blue chart palette, real shadows.

### Components / config
- `packages/ui/components.json`: `style: "base-vega"` (a Base UI variant), `baseColor: neutral`, aliases correct, registries for `@diceui` + `@magicui`. Components wrap `@base-ui/react` with `data-slot` patterns + CVA — already the modern shadcn shape, just a non-default style id.
- Only `packages/ui` has a `components.json`. Latest shadcn monorepo convention wants **one `components.json` per workspace** (apps point `tailwind.css` at the shared globals; identical `style`/`baseColor`/`iconLibrary`).
- All apps + extension already import from `@crikket/ui/components/ui/*`; no conflicting local base components. Good.

### Sidebar + settings layout (`apps/web`)
- `apps/web/src/components/app-sidebar.tsx` already uses the shared `Sidebar` primitives with `variant="inset"` + `collapsible="icon"` — i.e. **already the canonical shadcn sidebar shell**. Groups: "Platform" (Bug Reports), "Settings" (single flat link → `/settings`), secondary (Documentation). No collapsible sub-menus yet.
- Settings lives at `(protected)/(dashboard)/settings/*` with 6 sections: User, Organization, Projects, Public Keys, Billing, GitHub.
- `settings/layout.tsx` centers content: `mx-auto flex w-full max-w-[1200px] ...` + a `lg:grid-cols-[260px_minmax(0,1fr)]` with `<SettingsNavigation/>` (card-style left nav in `_components/settings-navigation.tsx`) and an inner `max-w-[860px]` content column.
- The dashboard shell (`components/shell.tsx`) is full-width `flex flex-1 flex-col gap-4 p-4 pt-0`. Settings should match this.

## Decision to confirm before starting

**Style / primitive strategy.** Two viable paths; both reach a "stock" look. Recommend **Option A** (lowest risk, fastest to the generic look).

- **Option A — Keep Base UI, restyle to stock (recommended).** Keep the working `@base-ui/react` components. Switch `components.json` style from `base-vega` to the current default **base variant** (`base-nova` / `new-york-v4`-equivalent for Base) and re-pull only components that have drifted from the registry. The dominant visual change comes from the **theme tokens**, not the primitive. Minimal API churn.
- **Option B — Re-init on Radix `new-york-v4`.** `shadcn init --base radix`, regenerate all components, drop `@base-ui/react`. Truly canonical, but every component's import/API surface changes → high churn across web/docs/extension/SDK, and the local custom components (data-table, faceted, sortable, dialogs) need re-reconciliation.

The rest of this plan is written to work for either, with Option A assumed.

---

## Phase 1 — Standardize the theme tokens (highest visual impact)

**Outcome:** the admin UI reads as stock shadcn neutral: rounded, real sans font, near-black primary, subtle shadows, blue charts.

1. **Retire the bespoke `dashboard.css` theme.** Decide between:
   - **1a (recommended):** Point `apps/web` at the shared `globals.css` and delete `dashboard.css`, so there is one canonical theme for the whole monorepo. Update the import in `apps/web/src/app/layout.tsx`.
   - **1b:** Keep `dashboard.css` as the file but overwrite its token block with the canonical neutral values (below). Use only if web must diverge from docs later.
2. **Set canonical neutral tokens** in the surviving theme file to match `shadcn-ui/ui apps/v4 app/globals.css`:
   - `--radius: 0.625rem` (drop `0rem`).
   - Restore real shadows (the v4 default `--shadow-*` ladder) instead of opacity-0.
   - `--primary: oklch(0.205 0 0)` / dark `oklch(0.922 0 0)` (near-black / near-white), not mid-gray.
   - Restore a real chart palette (`--chart-1..5` blue ramp) instead of 5× identical gray.
   - `baseColor` stays `neutral`.
3. **Fonts → Geist sans (generic), not monospace.** Replace `Geist Mono` as `--font-sans`/`--font-serif` with **Geist** (sans). Keep Geist Mono only for `--font-mono`. Wire the font in `apps/web/src/app/layout.tsx` via `next/font` (`Geist`, `Geist_Mono`) and expose `--font-sans`/`--font-mono`. Reconcile `globals.css`'s current `Inter Variable` to the same choice so all apps share one font stack.
4. **Drop non-generic flourishes from the shared theme** (or isolate them so they don't bleed into the admin look):
   - `marquee` / `marquee-vertical` keyframes + `--animate-marquee*` — keep only if a marketing surface still uses MagicUI; otherwise remove.
   - `fumadocs-ui/css/*` imports belong to `apps/docs` only — move them out of the shared admin theme into a docs-local stylesheet so the admin app isn't themed by Fumadocs presets.
5. **Verify** light/dark parity (`.dark` block matches the canonical inverted values) and that `@theme inline` still maps every `--color-*`/`--radius-*` token.

## Phase 2 — Align shadcn config to latest monorepo standard

1. **Update `packages/ui/components.json`** `style` from `base-vega` to the current default (Option A: `base-nova`/`new-york-v4`; Option B: `new-york-v4` with Radix). Keep `baseColor: neutral`, `iconLibrary: lucide`, `cssVariables: true`.
2. **Add a `components.json` to each consuming workspace** (`apps/web`, `apps/docs`, `apps/extension`, `sdks/capture`) per the monorepo docs:
   - Identical `style` / `baseColor` / `iconLibrary`.
   - `tailwind.css` → relative path to the shared `packages/ui/src/styles/globals.css`.
   - `tailwind.config: ""` (Tailwind v4).
   - Aliases pointing at `@crikket/ui/*` so `shadcn add` drops shared components into `packages/ui` and app-specific blocks into the app.
3. **Re-pull drifted base components** from the registry into `packages/ui/src/components/ui` (Option A), reviewing diffs so intentional local changes (data-slot tweaks, extra `size` variants) are preserved. Do **not** blindly overwrite `data-table/`, `faceted`, `sortable`, `dialogs/`, `magicui/` — those are app-specific.

## Phase 3 — Default collapsible sidebar + promote Settings into the main menu

**Outcome:** the standard shadcn sidebar where Settings is a collapsible group whose children are the settings sections, navigated inline.

1. **Restructure `apps/web/src/components/app-sidebar.tsx`:**
   - Keep `Sidebar variant="inset" collapsible="icon"` (already canonical).
   - Replace the flat `navSettings` link with a **collapsible nav item** using the shared `Collapsible` + `SidebarMenuButton` + `SidebarMenuSub`/`SidebarMenuSubButton` primitives (the canonical shadcn `nav-main` "collapsible group" pattern). Children = the 6 settings sections sourced from a single shared array.
   - **Single source of nav data:** extract the settings sections (currently `SETTINGS_ITEMS` in `settings/_components/settings-navigation.tsx`) into one shared module (e.g. `apps/web/src/lib/settings-nav.ts`) consumed by both the sidebar and any remaining settings UI, so they can't drift.
   - Active-state: highlight the open Settings group + the active sub-item based on `pathname` prefix.
2. **Behavior:** group auto-expands when on a `/settings/*` route; collapses to icon with the rest of the sidebar in icon mode (sub-items become a flyout, which the shared sidebar primitive already supports).

## Phase 4 — De-center settings; unify with the dashboard shell

**Outcome:** settings pages fill the content area like every other page.

1. **Rewrite `settings/layout.tsx`:** remove `mx-auto`, `max-w-[1200px]`, the `lg:grid-cols-[260px_minmax(0,1fr)]` two-column grid, and the inner `max-w-[860px]`. Render children directly inside the standard `Shell` flow (`flex flex-1 flex-col gap-4 p-4`), matching the dashboard. Keep a heading block if desired, full-width.
2. **Remove the in-page `SettingsNavigation` card-nav** (its role moves to the sidebar collapsible group from Phase 3). If a secondary in-page nav is still wanted for wide screens, replace the bespoke card grid with stock shadcn **Tabs** or breadcrumbs — but default to relying on the sidebar.
3. **Audit individual settings pages** (`user`, `organization`, `projects`, `keys`, `billing`, `integrations/github`) for their own `max-w-*`/`mx-auto`/centering wrappers and strip them so content is left-aligned and full-width, consistent with stock shadcn settings blocks.
4. **Breadcrumb:** ensure the dashboard header breadcrumb reflects `Settings / <section>` now that there's no settings sub-header.

## Phase 5 — Propagate across docs, extension, SDK

1. **`apps/docs`:** confirm it still imports `globals.css`; move the Fumadocs preset imports here (from Phase 1.4). Verify the new font/token set doesn't clash with Fumadocs theming; if it does, scope Fumadocs styles to the docs route.
2. **`apps/extension`:** it imports `@crikket/ui/styles/globals.css` and a handful of components (button/field/input/select/textarea). Re-check rendering under the new tokens (radius/shadows/font) in the extension popup; extensions have constrained viewports — verify the sidebar/dialog primitives still fit.
3. **`sdks/capture`:** identify whether it ships any of these shadcn components/tokens to embedders. If it injects styles, ensure the standardized tokens are scoped (shadow/prefix) so they don't leak into host pages. If it has no shadcn surface, document that it's out of visual scope.

## Phase 6 — Verify

1. `bun run check-types` and `bun run check` (Ultracite/Biome) clean across the workspace.
2. `bun run dev:web` — manually verify: collapsible Settings group (expand/collapse, icon-mode flyout, active states), settings pages full-width and left-aligned, rounded corners + real font + subtle shadows present, light/dark both correct.
3. Spot-check `apps/docs` (`:4000`) and the extension popup render.
4. No leftover references to `dashboard.css`, removed marquee/MagicUI tokens, or the old `SettingsNavigation`.

## Risks / watch-outs

- **Theme is shared.** Changing `globals.css` affects docs + extension simultaneously — verify all three surfaces, not just web. Prefer one canonical theme (Phase 1a) but test broadly.
- **Component re-pull can clobber local tweaks.** Diff every regenerated component; protect `data-table/`, `faceted`, `sortable`, `dialogs/`, `magicui/`.
- **Option B (Radix swap) is high-churn** — only take it if "default" must mean Radix specifically; the user said it needn't.
- **Fumadocs presets** currently leak into the shared theme; isolating them (Phase 1.4) is necessary or the admin app keeps inheriting doc styles.
- **Extension viewport** constraints — the standard sidebar/dialog sizing may need extension-specific checks.

## Suggested execution order

Phase 1 (theme) → Phase 2 (config) in parallel-ish, then Phase 3 (sidebar) → Phase 4 (settings layout) which are tightly coupled, then Phase 5 (propagate) → Phase 6 (verify). Phase 1 alone delivers most of the visible "generic admin" transformation; Phases 3–4 deliver the specific sidebar/settings requests.
