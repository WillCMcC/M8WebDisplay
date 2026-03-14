# M8WebDisplay

Web-based frontend for M8 Headless Firmware. Renders the M8 display via WebGL, connects over Web Serial/WebUSB, supports keyboard/gamepad input. Static site (vanilla JS, no framework) built with Make + Rollup + Terser + SASS.

Fork of https://github.com/derkyjadex/M8WebDisplay with local modifications for:
- MK2 (480x320) support with fonts 3-5
- Transparent background mode (YouTube/video/camera backgrounds)
- Audio-reactive visual effects (zoom, shake, skew, blur, etc.)
- Scanline overlay

## Build

- `make all` -- builds everything into `build/`
- `make run` -- serves on localhost:8000
- `npm ci` -- install deps (juice, local-web-server, rollup, sass, terser)
- Rollup bundles JS, Terser minifies, SASS compiles CSS, Juice inlines CSS into HTML
- Font PNGs (font1-5.png) are base64-encoded into JS modules at build time
- Makefile stamps build number via `git rev-parse --short HEAD`

## Deployment (CapRover)

- App: `m8` | Domain: `m8.3218i.com` | Cluster: `3218i` at `https://captain.3218i.com`
- Deploy command:
  ```
  tar -czf /tmp/m8-deploy.tar.gz --exclude=node_modules --exclude=build --exclude=.git --exclude=cert . && caprover deploy -n 3218i -a m8 -t /tmp/m8-deploy.tar.gz
  ```
- MUST use tarball deploy (not git deploy) -- font3-5.png and local modifications are not pushed to upstream remote
- Dockerfile: multi-stage build (node:20-alpine with make/perl/git for building, nginx:alpine for serving)
- Dockerfile creates a dummy git repo (`git init && git commit`) because Makefile needs `git rev-parse`
- After deploy, ALWAYS purge Cloudflare cache: `/Users/will/Code/caprover-control/scripts/cloudflare-purge.sh m8.3218i.com`
- Service worker (worker.js) caches aggressively -- users may need hard refresh (Cmd+Shift+R) or unregister SW in DevTools

## Architecture

- WebGL renderer uses a rect accumulation framebuffer that persists between frames (incremental M8 protocol)
- Transparent bg mode: blit shader color-keys background-colored pixels to alpha=0
- Screen transitions detected by full-screen rect draws (x=0, y=0, w>=screenW, h>=screenH) which clear rects, text, and waveform
- Audio analyser uses `analyserWanted` flag to auto-reconnect after audio source changes
- CSS transforms for reactivity applied to #display (not canvas) to avoid overflow clipping
- #display sized at 90vw/90vh to leave headroom for zoom transforms

## Files Modified from Upstream

- `js/gl-renderer.js` -- MK2 support, transparent bg, color-key blit shader
- `js/main.js` -- reactivity panel, background video/YouTube/camera, reactive effects loop
- `js/audio.js` -- analyserWanted auto-reconnect
- `js/renderer.js` -- canvas fallback: waveform clearing on screen transitions
- `css/display.scss` -- 90vw/90vh sizing, overflow visible, reactivity panel, scanlines, bg-youtube styles
- `css/index.scss` -- html/body overflow hidden
- `shaders/blit.frag` -- bgColor/bgTransparent uniforms for color-keying
- `Makefile` -- font3-5 build rules
- `Dockerfile`, `captain-definition`, `package.json` -- CapRover deployment

## Troubleshooting

- Deploy fails with registry errors: check `/etc/hosts` on cluster nodes for `192.168.1.69 registry.3218i.com`
- HTTPS cert expires: fix symlinks in certbot container (`/etc/letsencrypt/live/*/`) then force-renew
- Build fails with font errors: ensure font3.png, font4.png, font5.png exist (extracted from build/font*.js base64)
- Reactivity cuts out: audio analyser may have been destroyed by source change -- `analyserWanted` flag should handle this automatically
