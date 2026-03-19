// Copyright 2021-2022 James Deery
// Released under the MIT licence, https://opensource.org/licenses/MIT

import { UsbConnection } from './usb.js';
import { SerialConnection } from './serial.js';
import { Parser } from './parser.js';
import { Renderer as OldRenderer } from './renderer.js';
import { Renderer as GlRenderer } from './gl-renderer.js';
import { show, hide, toggle, appendButton, on } from './util.js';
import { setup as setupWorker } from './worker-setup.js';

import * as Input from './input.js';
import * as Audio from './audio.js';
import * as Settings from './settings.js';
import * as Firmware from './firmware.js';
import * as Wake from './wake.js';

function setBackground(r, g, b) {
    const colour = `rgb(${r}, ${g}, ${b})`;
    document.body.style.backgroundColor = colour;
    document.documentElement.style.backgroundColor = colour;
    Settings.save('background', [r, g, b]);
}
const bg = Settings.load('background', [0, 0, 0]);
setBackground(bg[0], bg[1], bg[2]);
const renderer = Settings.get('displayType') === 'webgl2'
    ? new GlRenderer(bg, setBackground)
    : new OldRenderer(bg, setBackground);

const parser = new Parser(renderer);

let resizeCanvas = (function() {
    const display = document.getElementById('display');
    const canvas = document.getElementById('canvas');

    function applySize(el, w, h, l, t) {
        el.style.width = w;
        el.style.height = h;
        el.style.left = l;
        el.style.top = t;
    }

    function resize() {
        const ratio = devicePixelRatio;
        const dW = display.clientWidth * ratio;
        const svg = document.getElementById('screen');

        if (Settings.get('snapPixels') && dW <= 1600) {
            let dH = display.clientHeight * ratio;
            if (Settings.get('showControls') || Input.isMapping) {
                dH /= 2;
            }

            const width = Math.floor(dW / 320) * 320 / ratio;
            const height = Math.floor(dH / 240) * 240 / ratio;
            const left = Math.round((dW / ratio - width) / 2);
            const top = Math.round((dH / ratio - height) / 2);

            const w = `${width}px`, h = `${height}px`, l = `${left}px`, t = `${top}px`;
            applySize(canvas, w, h, l, t);
            if (svg) applySize(svg, w, h, l, t);
        } else {
            applySize(canvas, null, null, null, null);
            if (svg) applySize(svg, null, null, null, null);
        }
    }

    on(window, 'resize', resize);
    window.matchMedia('screen and (min-resolution: 2dppx)')
        .addListener(resize);

    resize();

    return resize;
})();

Settings.onChange('showControls', value => {
    document
        .getElementById('display')
        .classList
        .toggle('with-controls', value);
    resizeCanvas();
});

Settings.onChange('enableAudio', value => {
    if (value) { Audio.enable(); }
    else { Audio.disable(); }
});

Settings.onChange('snapPixels', () => resizeCanvas());


function toggleFullscreen() {
    if (document.fullscreenElement) {
        document.exitFullscreen();
    } else {
        document.body.requestFullscreen();
    }
}

Settings.onChange('fullscreen', toggleFullscreen);

on('#display', 'dblclick', toggleFullscreen);


function connectionChanged(isConnected) {
    if (isConnected) {
        hide('#buttons, .error, #info');
        Audio.start(10);

    } else {
        renderer.clear();
        show('#buttons');
        Audio.stop();
    }

    Wake.connectionChanged(isConnected);
}

if (navigator.serial) {
    setupConnection(
        new SerialConnection(parser, connectionChanged),
        '#serial-fail');

} else if (navigator.usb) {
    setupConnection(
        new UsbConnection(parser, connectionChanged),
        '#usb-fail');

} else {
    show('#no-serial-usb');
}

function setupConnection(connection, errorMessage) {
    Input.setup(connection);

    on('#connect', 'click', () =>
        connection.connect()
            .catch(() => {
                hide('#info');
                show(errorMessage);
            }));

    on(window, 'beforeunload', e =>
        connection.disconnect());

    connection.connect(true).catch(() => {});
}

on('#info button', 'click', () => hide('#info'));

// --- Background Video ---

const canvasEl = document.getElementById('canvas');
const displayEl = document.getElementById('display');
let bgVideo = null;
let videoInput = null;
let bgElement = null;
let bgAnimating = false;
let smoothedRms = 0;
let peakRms = 0;
let bgInvert = false;
const analyserData = new Uint8Array(2048);

// --- Reactivity FX Config ---

const fxSliders = [
    { key: 'fxShake',       label: 'SHAKE',        default: 50, group: 'canvas' },
    { key: 'fxSkew',        label: 'SKEW',         default: 50, group: 'canvas' },
    { key: 'fxZoom',        label: 'ZOOM PULSE',   default: 0,  group: 'canvas' },
    { key: 'fxHueShift',    label: 'HUE SHIFT',    default: 0,  group: 'canvas' },
    { key: 'fxInvert',      label: 'INVERT FLASH', default: 0,  group: 'canvas' },
    { key: 'fxScanlines',   label: 'SCANLINES',    default: 0,  group: 'canvas' },
    { key: 'fxBgBright',    label: 'BG PULSE',     default: 0,  group: 'video' },
    { key: 'fxBgBlur',      label: 'BG BLUR',      default: 0,  group: 'video' },
    { key: 'fxBgZoom',      label: 'BG ZOOM',      default: 0,  group: 'video' },
    { key: 'fxBgSaturate',  label: 'BG SATURATE',  default: 0,  group: 'video' },
];

const fx = {};
fxSliders.forEach(s => { fx[s.key] = Settings.load('fx_' + s.key, s.default); });

// --- Reactivity Panel ---

function buildReactivityPanel() {
    const panel = document.createElement('div');
    panel.id = 'reactivity';
    panel.classList.add('hidden');

    // Click backdrop to close
    on(panel, 'click', e => { if (e.target === panel) panel.classList.add('hidden'); });

    const content = document.createElement('div');
    content.className = 'fx-panel';

    const header = document.createElement('div');
    header.className = 'fx-header';
    const headerText = document.createElement('span');
    headerText.textContent = 'REACTIVITY';
    const headerClose = document.createElement('button');
    headerClose.className = 'fx-close';
    headerClose.innerHTML = '&times;';
    on(headerClose, 'click', () => panel.classList.add('hidden'));
    header.append(headerText, headerClose);
    content.append(header);

    const body = document.createElement('div');
    body.className = 'fx-body';

    let lastGroup = '';
    for (const s of fxSliders) {
        if (s.group !== lastGroup) {
            const groupLabel = document.createElement('div');
            groupLabel.className = 'fx-group';
            groupLabel.textContent = s.group === 'canvas' ? 'DISPLAY' : 'BACKGROUND';
            body.append(groupLabel);
            lastGroup = s.group;
        }

        const row = document.createElement('div');
        row.className = 'fx-row';

        const label = document.createElement('span');
        label.className = 'fx-label';
        label.textContent = s.label;

        const input = document.createElement('input');
        input.type = 'range';
        input.min = '0';
        input.max = '100';
        input.value = fx[s.key];

        const val = document.createElement('span');
        val.className = 'fx-val';
        val.textContent = fx[s.key];

        on(input, 'input', () => {
            const v = parseInt(input.value);
            fx[s.key] = v;
            val.textContent = v;
            Settings.save('fx_' + s.key, v);
        });

        row.append(label, input, val);
        body.append(row);
    }

    content.append(body);

    const btnRow = document.createElement('div');
    btnRow.className = 'fx-buttons';

    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'RESET';
    on(resetBtn, 'click', () => {
        fxSliders.forEach(s => {
            fx[s.key] = s.default;
            Settings.save('fx_' + s.key, s.default);
        });
        body.querySelectorAll('.fx-row').forEach((row, i) => {
            row.querySelector('input').value = fxSliders[i].default;
            row.querySelector('.fx-val').textContent = fxSliders[i].default;
        });
    });

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'CLOSE';
    on(closeBtn, 'click', () => panel.classList.add('hidden'));

    btnRow.append(resetBtn, closeBtn);
    content.append(btnRow);

    panel.append(content);
    document.body.append(panel);
    return panel;
}

const reactivityPanel = buildReactivityPanel();

Settings.onChange('reactivity', () => {
    reactivityPanel.classList.toggle('hidden');
});

// --- Scanline Overlay ---

const scanlineOverlay = document.createElement('div');
scanlineOverlay.id = 'scanlines';
document.getElementById('display').append(scanlineOverlay);

// --- Display Drag & Resize ---

const DISPLAY_POS_KEY = 'displayPos';

function loadDisplayPos() {
    try { return JSON.parse(localStorage.getItem(DISPLAY_POS_KEY)); }
    catch { return null; }
}

function saveDisplayPos(pos) {
    localStorage.setItem(DISPLAY_POS_KEY, JSON.stringify(pos));
}

function applyCustomPosition(pos) {
    displayEl.classList.add('custom-position');
    displayEl.style.left = pos.x + 'px';
    displayEl.style.top = pos.y + 'px';
    displayEl.style.width = pos.w + 'px';
    displayEl.style.height = pos.h + 'px';
}

function clearCustomPosition() {
    displayEl.classList.remove('custom-position', 'dragging');
    displayEl.style.left = '';
    displayEl.style.top = '';
    displayEl.style.width = '';
    displayEl.style.height = '';
    localStorage.removeItem(DISPLAY_POS_KEY);
    resizeCanvas();
}

function getDisplayRect() {
    const saved = loadDisplayPos();
    if (saved) return saved;
    const r = displayEl.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
}

// Create resize handles
['nw', 'ne', 'sw', 'se'].forEach(dir => {
    const handle = document.createElement('div');
    handle.className = `resize-handle ${dir}`;
    displayEl.append(handle);

    on(handle, 'mousedown', e => {
        e.preventDefault();
        e.stopPropagation();
        const startRect = getDisplayRect();
        if (!displayEl.classList.contains('custom-position')) {
            applyCustomPosition(startRect);
        }
        const e0x = e.clientX, e0y = e.clientY;

        function onMove(ev) {
            const dx = ev.clientX - e0x;
            const dy = ev.clientY - e0y;
            let { x, y, w, h } = startRect;

            if (dir.includes('e')) w += dx;
            if (dir.includes('w')) { w -= dx; x += dx; }
            if (dir.includes('s')) h += dy;
            if (dir.includes('n')) { h -= dy; y += dy; }

            if (w < 160) { if (dir.includes('w')) x = startRect.x + startRect.w - 160; w = 160; }
            if (h < 120) { if (dir.includes('n')) y = startRect.y + startRect.h - 120; h = 120; }

            const pos = { x, y, w, h };
            applyCustomPosition(pos);
            saveDisplayPos(pos);
            resizeCanvas();
        }

        function onUp() {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        }

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    });
});

// Drag display by clicking on canvas area
on(displayEl, 'mousedown', e => {
    if (e.button !== 0) return;
    if (e.target.closest('.resize-handle, #controls, #buttons, #mapping-buttons, #mapping-help, button, a, input, select')) return;

    const e0x = e.clientX, e0y = e.clientY;
    const startRect = getDisplayRect();
    let dragging = false;

    function onMove(ev) {
        const dx = ev.clientX - e0x;
        const dy = ev.clientY - e0y;

        if (!dragging) {
            if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
            dragging = true;
            if (!displayEl.classList.contains('custom-position')) {
                applyCustomPosition(startRect);
            }
            displayEl.classList.add('dragging');
        }

        const pos = { x: startRect.x + dx, y: startRect.y + dy, w: startRect.w, h: startRect.h };
        applyCustomPosition(pos);
        saveDisplayPos(pos);
    }

    function onUp() {
        displayEl.classList.remove('dragging');
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
});

// Restore saved display position
const savedDisplayPos = loadDisplayPos();
if (savedDisplayPos) applyCustomPosition(savedDisplayPos);

Settings.onChange('resetPosition', clearCustomPosition);

// --- Background Video ---

function ensureBgVideo() {
    if (bgVideo) return bgVideo;
    bgVideo = document.createElement('video');
    bgVideo.id = 'bg-video';
    bgVideo.loop = true;
    bgVideo.muted = true;
    bgVideo.playsInline = true;
    bgVideo.style.display = 'none';
    const display = document.getElementById('display');
    document.body.insertBefore(bgVideo, display);
    return bgVideo;
}

function ensureVideoInput() {
    if (videoInput) return videoInput;
    videoInput = document.createElement('input');
    videoInput.type = 'file';
    videoInput.accept = 'video/*';
    videoInput.className = 'hidden';
    document.body.appendChild(videoInput);

    on(videoInput, 'change', () => {
        const file = videoInput.files[0];
        if (!file) return;
        clearBackground();
        const v = ensureBgVideo();
        v.src = URL.createObjectURL(file);
        v.style.display = 'block';
        v.play();
        bgElement = v;
        activateBackground();
    });

    return videoInput;
}

function activateBackground() {
    renderer.setBgTransparent(true);
    Audio.enableAnalyser();
    startBgLoop();
}

function clearBackground() {
    if (bgVideo) {
        if (bgVideo.srcObject) {
            bgVideo.srcObject.getTracks().forEach(t => t.stop());
            bgVideo.srcObject = null;
        }
        if (bgVideo.src) {
            bgVideo.pause();
            URL.revokeObjectURL(bgVideo.src);
            bgVideo.removeAttribute('src');
        }
        bgVideo.style.display = 'none';
    }
    const ytFrame = document.querySelector('.bg-youtube');
    if (ytFrame) ytFrame.remove();
    if (bgElement) {
        bgElement.style.filter = '';
        bgElement.style.transform = '';
    }
    displayEl.style.transform = '';
    canvasEl.style.filter = '';
    scanlineOverlay.style.opacity = '0';
    renderer.setBgTransparent(false);
    bgElement = null;
    bgAnimating = false;
    bgInvert = false;
    smoothedRms = 0;
    peakRms = 0;
    Audio.disableAnalyser();
}

function startBgLoop() {
    if (bgAnimating) return;
    bgAnimating = true;
    requestAnimationFrame(updateBgReactive);
}

let lastPeakHit = 0;

function updateBgReactive() {
    if (!bgAnimating || !bgElement) return;

    const analyser = Audio.getAnalyser();
    let rms = 0;

    if (analyser) {
        analyser.getByteTimeDomainData(analyserData);
        let sum = 0;
        for (let i = 0; i < analyser.fftSize; i++) {
            const v = (analyserData[i] - 128) / 128;
            sum += v * v;
        }
        rms = Math.sqrt(sum / analyser.fftSize);
    }

    smoothedRms = smoothedRms * 0.7 + rms * 0.3;
    peakRms = rms > peakRms ? rms * 0.6 + peakRms * 0.4 : peakRms * 0.92;

    const glitchRaw = Math.min(peakRms * 2.5, 1);
    const glitchLevel = Math.max(0, (glitchRaw - 0.4) / 0.6);
    const now = performance.now();

    // --- Canvas transform: shake + skew + zoom ---
    const transforms = [];
    const shakeAmt = fx.fxShake / 100;
    const skewAmt = fx.fxSkew / 100;
    const zoomAmt = fx.fxZoom / 100;

    if (shakeAmt > 0 && glitchLevel > 0 && Math.random() < glitchLevel * 0.6) {
        const shakeX = (Math.random() - 0.5) * glitchLevel * shakeAmt * 6;
        const shakeY = (Math.random() - 0.5) * glitchLevel * shakeAmt * 3;
        transforms.push(`translate(${shakeX}px, ${shakeY}px)`);
    }

    if (skewAmt > 0 && glitchLevel > 0 && Math.random() < glitchLevel * 0.5) {
        const skewX = (Math.random() - 0.5) * glitchLevel * skewAmt * 4;
        transforms.push(`skewX(${skewX}deg)`);
    }

    if (zoomAmt > 0) {
        const scale = 1 + smoothedRms * zoomAmt * 0.3;
        transforms.push(`scale(${scale})`);
    }

    displayEl.style.transform = transforms.length ? transforms.join(' ') : '';

    // --- Canvas filter: hue-shift + invert flash ---
    const filters = [];
    const hueAmt = fx.fxHueShift / 100;
    const invertAmt = fx.fxInvert / 100;

    if (hueAmt > 0) {
        const hue = smoothedRms * hueAmt * 360;
        filters.push(`hue-rotate(${hue}deg)`);
    }

    if (invertAmt > 0 && glitchLevel > 0.3) {
        if (rms > peakRms * 0.8 && now - lastPeakHit > 100) {
            lastPeakHit = now;
        }
        if (now - lastPeakHit < 60 * invertAmt) {
            filters.push('invert(1)');
        }
    }

    canvasEl.style.filter = filters.length ? filters.join(' ') : '';

    // --- Scanlines ---
    const scanAmt = fx.fxScanlines / 100;
    scanlineOverlay.style.opacity = scanAmt > 0 ? scanAmt * 0.5 : '0';

    // --- Video filters: brightness, blur, saturate ---
    const bgFilters = [];
    const brightAmt = fx.fxBgBright / 100;
    const blurAmt = fx.fxBgBlur / 100;
    const satAmt = fx.fxBgSaturate / 100;

    if (brightAmt > 0) {
        const brightness = 0.6 + smoothedRms * brightAmt * 2.0;
        bgFilters.push(`brightness(${brightness})`);
    }

    if (blurAmt > 0) {
        const blur = (1 - Math.min(smoothedRms * 4, 1)) * blurAmt * 8;
        bgFilters.push(`blur(${blur}px)`);
    }

    if (satAmt > 0) {
        const saturate = 0.5 + smoothedRms * satAmt * 4;
        bgFilters.push(`saturate(${saturate})`);
    }

    if (bgInvert) bgFilters.push('invert(1)');

    bgElement.style.filter = bgFilters.length ? bgFilters.join(' ') : '';

    // --- Video transform: zoom ---
    const bgZoomAmt = fx.fxBgZoom / 100;
    if (bgZoomAmt > 0) {
        const bgScale = 1 + smoothedRms * bgZoomAmt * 0.4;
        bgElement.style.transform = `scale(${bgScale})`;
    } else {
        bgElement.style.transform = '';
    }

    requestAnimationFrame(updateBgReactive);
}

on(document, 'keydown', e => {
    if (e.key === 'i' && bgElement && !e.repeat) {
        bgInvert = !bgInvert;
    }
    if (e.key === 'Escape') {
        closeYtModal();
        reactivityPanel.classList.add('hidden');
    }
});

function getYouTubeId(url) {
    const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : null;
}

// --- YouTube Modal & Library ---

const YT_LIBRARY_KEY = 'ytLibrary';

function loadYtLibrary() {
    try { return JSON.parse(localStorage.getItem(YT_LIBRARY_KEY)) || []; }
    catch { return []; }
}

function saveYtLibrary(lib) {
    localStorage.setItem(YT_LIBRARY_KEY, JSON.stringify(lib));
}

function renderYtLibrary() {
    const container = document.getElementById('yt-library');
    const library = loadYtLibrary();
    container.innerHTML = '';

    const toggleAll = document.getElementById('yt-toggle-all');
    if (toggleAll) toggleAll.style.display = library.length ? '' : 'none';

    if (library.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'yt-empty';
        empty.textContent = 'no videos yet';
        container.append(empty);
        updateYtPlayBtn();
        return;
    }

    library.forEach(video => {
        const item = document.createElement('div');
        item.className = 'yt-item';
        item.dataset.id = video.id;
        item.draggable = true;

        const grip = document.createElement('span');
        grip.className = 'yt-grip';
        grip.textContent = '\u2261';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'yt-check';

        const thumb = document.createElement('img');
        thumb.className = 'yt-thumb';
        thumb.src = `https://img.youtube.com/vi/${video.id}/default.jpg`;
        thumb.alt = '';
        thumb.loading = 'lazy';

        const label = document.createElement('span');
        label.className = 'yt-id';
        label.textContent = video.id;

        const del = document.createElement('button');
        del.className = 'yt-del';
        del.textContent = '\u00d7';
        on(del, 'click', e => {
            e.stopPropagation();
            const lib = loadYtLibrary().filter(v => v.id !== video.id);
            saveYtLibrary(lib);
            renderYtLibrary();
        });

        on(item, 'click', e => {
            if (e.target !== checkbox && e.target !== del && e.target !== grip) {
                checkbox.checked = !checkbox.checked;
            }
            updateYtPlayBtn();
        });

        on(item, 'dragstart', e => {
            item.classList.add('yt-dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', video.id);
        });

        on(item, 'dragend', () => {
            item.classList.remove('yt-dragging');
            container.querySelectorAll('.yt-drag-over').forEach(el => el.classList.remove('yt-drag-over'));
        });

        on(item, 'dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const dragging = container.querySelector('.yt-dragging');
            if (dragging && dragging !== item) {
                item.classList.add('yt-drag-over');
            }
        });

        on(item, 'dragleave', () => {
            item.classList.remove('yt-drag-over');
        });

        on(item, 'drop', e => {
            e.preventDefault();
            item.classList.remove('yt-drag-over');
            const draggedId = e.dataTransfer.getData('text/plain');
            if (draggedId && draggedId !== video.id) {
                const lib = loadYtLibrary();
                const fromIdx = lib.findIndex(v => v.id === draggedId);
                const toIdx = lib.findIndex(v => v.id === video.id);
                if (fromIdx !== -1 && toIdx !== -1) {
                    const [moved] = lib.splice(fromIdx, 1);
                    lib.splice(toIdx, 0, moved);
                    saveYtLibrary(lib);
                    renderYtLibrary();
                }
            }
        });

        item.append(grip, checkbox, thumb, label, del);
        container.append(item);
    });

    updateYtPlayBtn();
}

function getSelectedYtIds() {
    const ids = [];
    document.querySelectorAll('#yt-library .yt-item').forEach(item => {
        if (item.querySelector('.yt-check').checked) {
            ids.push(item.dataset.id);
        }
    });
    return ids;
}

function updateYtPlayBtn() {
    const btn = document.getElementById('yt-play');
    const count = getSelectedYtIds().length;
    btn.textContent = count > 0 ? `PLAY ${count} VIDEO${count > 1 ? 'S' : ''}` : 'PLAY';
    btn.classList.toggle('yt-btn-disabled', count === 0);
}

function playYouTubeVideos(ids) {
    if (ids.length === 0) return;
    clearBackground();
    const iframe = document.createElement('iframe');
    iframe.className = 'bg-youtube';
    const first = ids[0];
    iframe.src = `https://www.youtube-nocookie.com/embed/${first}?autoplay=1&loop=1&mute=1&controls=0&showinfo=0&rel=0&modestbranding=1&iv_load_policy=3&disablekb=1&playlist=${ids.join(',')}&playsinline=1`;
    iframe.allow = 'autoplay; encrypted-media';
    iframe.setAttribute('frameborder', '0');
    iframe.style.display = 'block';
    document.body.insertBefore(iframe, document.getElementById('display'));
    bgElement = iframe;
    activateBackground();
}

function openYtModal() {
    renderYtLibrary();
    show('#yt-modal');
    const input = document.getElementById('yt-url');
    input.value = '';
    input.focus();
    hide('#yt-error');
}

function closeYtModal() {
    hide('#yt-modal');
}

function addYtVideo() {
    const input = document.getElementById('yt-url');
    const url = input.value.trim();
    if (!url) return;

    const id = getYouTubeId(url);
    if (!id) {
        show('#yt-error');
        return;
    }

    hide('#yt-error');
    const library = loadYtLibrary();

    if (library.some(v => v.id === id)) {
        const existing = document.querySelector(`#yt-library .yt-item[data-id="${id}"]`);
        if (existing) {
            existing.classList.remove('yt-flash');
            void existing.offsetWidth;
            existing.classList.add('yt-flash');
        }
        input.value = '';
        return;
    }

    library.unshift({ id, url, addedAt: Date.now() });
    saveYtLibrary(library);
    input.value = '';
    renderYtLibrary();
}

Settings.onChange('bgYoutube', openYtModal);

on('#yt-close', 'click', closeYtModal);
on('#yt-modal', 'click', e => { if (e.target.id === 'yt-modal') closeYtModal(); });
on('#yt-add', 'click', addYtVideo);
on('#yt-url', 'keydown', e => { if (e.key === 'Enter') addYtVideo(); });
on('#yt-play', 'click', () => {
    const ids = getSelectedYtIds();
    if (ids.length > 0) {
        playYouTubeVideos(ids);
        closeYtModal();
    }
});
on('#yt-clear', 'click', () => {
    clearBackground();
    closeYtModal();
});
on('#yt-toggle-all', 'click', () => {
    const checks = document.querySelectorAll('#yt-library .yt-check');
    const allChecked = [...checks].every(c => c.checked);
    checks.forEach(c => { c.checked = !allChecked; });
    updateYtPlayBtn();
});

Settings.onChange('bgVideoFile', () => {
    ensureVideoInput().click();
});

Settings.onChange('bgCamera', () => {
    navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        .then(stream => {
            clearBackground();
            const v = ensureBgVideo();
            v.srcObject = stream;
            v.style.display = 'block';
            v.play();
            bgElement = v;
            activateBackground();
        })
        .catch(err => {
            console.error('Camera access denied:', err);
            alert('Could not access camera');
        });
});

Settings.onChange('bgScreenShare', () => {
    navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
        .then(stream => {
            clearBackground();
            const v = ensureBgVideo();
            v.srcObject = stream;
            v.style.display = 'block';
            v.play();
            bgElement = v;
            activateBackground();
            stream.getVideoTracks()[0].addEventListener('ended', () => clearBackground());
        })
        .catch(err => {
            console.error('Screen share denied:', err);
        });
});

Settings.onChange('bgRemove', () => {
    clearBackground();
});

// --- Audio Device Selection ---

(async function setupAudioDeviceSelect() {
    const div = document.createElement('div');
    div.classList.add('setting');
    const label = document.createElement('label');
    label.innerText = 'Audio Source';
    const select = document.createElement('select');
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.text = 'M8 (auto)';
    select.append(defaultOpt);
    label.append(select);
    div.append(label);
    const bgSection = document.querySelector('.settings-section[data-section="background"]');
    if (bgSection) {
        bgSection.parentNode.insertBefore(div, bgSection);
    } else {
        document.getElementById('settings-body').append(div);
    }

    on(select, 'focus', async () => {
        const devices = await Audio.listAudioInputs();
        while (select.options.length > 1) select.remove(1);
        for (const d of devices) {
            const opt = document.createElement('option');
            opt.value = d.deviceId;
            opt.text = d.label || `Device ${d.deviceId.slice(0, 8)}`;
            select.append(opt);
        }
    });

    on(select, 'change', () => {
        Audio.selectDevice(select.value || null);
    });
})();

setupWorker();
