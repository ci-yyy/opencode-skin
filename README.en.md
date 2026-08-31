# OpenCode Skin

**Reskin OpenCode Desktop through loopback CDP injection (`127.0.0.1:9345`) without modifying the app bundle, code signature, or session data — only CSS variables are overridden.**

28 built-in themes: 22 background-image/gradient themes (full semantic palettes translated straight onto OpenCode's `--v2-*` variables) plus 6 hue-recipe themes that retint OpenCode's current palette at any lightness. Switching is instant (no restart); one command restores the official UI.

> ## 🆕 0.1.0 first release
>
> Dual-mode engine: **palette direct-copy** (22 background/gradient themes, full semantic palettes injected verbatim) + **hue recipes** (a single `hue` retints the current UI). Keep-alive daemon restores the skin after refresh/restart; `create-theme.mjs` turns one image into a theme, fully automatic. See [CHANGELOG.md](CHANGELOG.md).

## What it looks like

Real screenshots of built-in themes running in OpenCode (empty session window) — native controls stay fully interactive:

| Wuthering Tide | Genshin Night |
| --- | --- |
| ![Wuthering Tide theme](docs/images/preview-wuthering-tide.png) | ![Genshin Night theme](docs/images/preview-genshin-night.png) |

| Miku 488137 | Cyber Neon |
| --- | --- |
| ![Miku theme](docs/images/preview-miku-488137.png) | ![Cyber Neon theme](docs/images/preview-cyber-neon.png) |

## Quick Start (macOS)

Requirements: macOS + Node.js 22+ (zero npm dependencies — CDP uses Node's built-in WebSocket and fetch). OpenCode has no debug port by default, so enable it once:

```bash
bash apply-skin.sh        # quit OpenCode → relaunch with port 9345 → inject default theme
bash install-daemon.sh    # optional: keep-alive daemon (auto-restore skin after refresh/restart)
bash uninstall.sh         # remove page injection + daemon + state/logs (--purge deletes the dir)
```

Day-to-day switching (instant, no restart):

```bash
bash use-skin.sh          # interactive menu
bash use-skin.sh 21       # by number
bash use-skin.sh origami  # by directory name
bash use-skin.sh 还原      # restore official look
```

## How It Works

Two theme modes:

- **Palette mode (22 background/gradient themes)** — each theme JSON carries a full semantic palette (`colors`: `sidebar`, `card`, `foreground`, `brand`, …). A fixed mapping table (`ZC_TO_OC` in `lib/palette.mjs`) translates it onto OpenCode's `--v2-*` variables: `card` becomes the window-wide base, `sidebar` the deep layer, `foreground` the text, `brand` the accent. Color values are untouched — the theme renders exactly as designed. Hero images are embedded as data URLs on the `html` layer; window-wide base variables get their alpha rewritten to the theme's `surfaceAlpha` (default 55%) so the background shows through.
- **Recipe mode (6 hue themes)** — a theme is just a hue. On apply, the tool harvests OpenCode's *currently effective* computed CSS variables, preserves each value's saturation/lightness structure, shifts the hue, and re-injects. Re-apply after switching OpenCode's built-in theme to follow the new base.

Guardrail rules baked into code and tests: never re-inject the `--color-*` namespace (Tailwind token layer — injecting literal values freezes the `var()` bridge and blacks out the UI); always harvest in a clean state (no skin attached); determine variable roles by variable *name*, not by value lightness (OpenCode's values are fixed at launch per system appearance).

## Commands

| Command | Purpose |
|---|---|
| `bash use-skin.sh` | Interactive theme menu |
| `bash apply-skin.sh` | First-time enable / port recovery (relaunches OpenCode with the debug port) |
| `bash install-daemon.sh` / `bash uninstall-daemon.sh` | Install/remove the keep-alive LaunchAgent |
| `bash uninstall.sh` | One-shot uninstall (`--purge` also deletes the tool directory) |
| `node skin.mjs list / status / inject / remove / persistence / shot` | Injector CLI |
| `npm test` | Test suite (23 cases, `node --test`, zero dependencies) |

## Security

The only attack surface is OpenCode's debug port (9345, loopback only, no authentication — inherent to CDP). The tool itself listens on no ports. See [SECURITY.md](SECURITY.md).

## License

Code is MIT-licensed. Bundled anime artwork belongs to its respective rights holders and is for personal use only.
