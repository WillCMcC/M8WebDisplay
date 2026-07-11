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
    const menuBtn = document.getElementById('menu-button');
    if (isConnected) {
        hide('#buttons, .error, #info');
        Audio.start(10);
        menuBtn.classList.add('auto-hide');
    } else {
        renderer.clear();
        show('#buttons');
        Audio.stop();
        menuBtn.classList.remove('auto-hide');
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

// --- Background Sources ---

const canvasEl = document.getElementById('canvas');
const displayEl = document.getElementById('display');
const bgContainer = document.getElementById('bg-sources');
let bgAnimating = false;
let smoothedRms = 0;
let peakRms = 0;
const analyserData = new Uint8Array(2048);

const sources = [];
let nextSourceId = 1;

function createSource(type, opts = {}) {
    return {
        id: nextSourceId++,
        type,
        mode: 'fullscreen',
        opacity: 100,
        invert: false,
        pos: null,
        element: null,
        wrapper: null,
        label: opts.label || type.toUpperCase(),
        ytIds: opts.ytIds || [],
    };
}

function saveSources() {
    const data = sources.map(s => ({
        id: s.id, type: s.type, mode: s.mode,
        opacity: s.opacity, invert: s.invert,
        pos: s.pos, label: s.label, ytIds: s.ytIds,
    }));
    localStorage.setItem('bgSources', JSON.stringify(data));
}

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

// --- Mixer Panel ---

function buildMixerPanel() {
    const panel = document.createElement('div');
    panel.id = 'mixer';
    panel.classList.add('hidden');

    const content = document.createElement('div');
    content.className = 'mixer-panel';

    // Header
    const header = document.createElement('div');
    header.className = 'mixer-header';
    const headerText = document.createElement('span');
    headerText.textContent = 'MIXER';
    const headerClose = document.createElement('button');
    headerClose.className = 'mixer-close';
    headerClose.innerHTML = '&times;';
    headerClose.setAttribute('aria-label', 'Close mixer');
    on(headerClose, 'click', () => panel.classList.add('hidden'));
    header.append(headerText, headerClose);
    content.append(header);

    const body = document.createElement('div');
    body.className = 'mixer-body';

    // --- SOURCES section ---
    const srcGroup = document.createElement('div');
    srcGroup.className = 'mixer-group';
    srcGroup.textContent = 'SOURCES';
    body.append(srcGroup);

    const srcList = document.createElement('div');
    srcList.id = 'mixer-sources';
    body.append(srcList);

    // Add buttons
    const addRow = document.createElement('div');
    addRow.className = 'mixer-add-row';
    for (const [label, action] of [['+ YT', 'youtube'], ['+ CAM', 'camera'], ['+ SCREEN', 'screen'], ['+ FILE', 'file']]) {
        const b = document.createElement('button');
        b.textContent = label;
        b.setAttribute('aria-label', `Add ${action === 'youtube' ? 'YouTube' : action} source`);
        on(b, 'click', () => addSource(action));
        addRow.append(b);
    }
    body.append(addRow);

    // --- YouTube inline sub-panel ---
    const ytPanel = document.createElement('div');
    ytPanel.id = 'mixer-yt';
    ytPanel.className = 'hidden';

    const ytInputRow = document.createElement('div');
    ytInputRow.className = 'yt-input-row';
    const ytUrlInput = document.createElement('input');
    ytUrlInput.type = 'text';
    ytUrlInput.id = 'yt-url';
    ytUrlInput.placeholder = 'paste url';
    ytUrlInput.spellcheck = false;
    ytUrlInput.autocomplete = 'off';
    const ytAddBtn = document.createElement('button');
    ytAddBtn.id = 'yt-add';
    ytAddBtn.textContent = 'ADD';
    ytInputRow.append(ytUrlInput, ytAddBtn);
    ytPanel.append(ytInputRow);

    const ytError = document.createElement('div');
    ytError.id = 'yt-error';
    ytError.className = 'yt-error hidden';
    ytError.textContent = 'invalid youtube url';
    ytPanel.append(ytError);

    const ytSection = document.createElement('div');
    ytSection.className = 'yt-section';
    const ytSectionLabel = document.createElement('span');
    ytSectionLabel.className = 'yt-section-label';
    ytSectionLabel.textContent = 'LIBRARY';
    const ytToggleAll = document.createElement('span');
    ytToggleAll.id = 'yt-toggle-all';
    ytToggleAll.className = 'yt-toggle-all';
    ytToggleAll.textContent = 'ALL';
    ytSection.append(ytSectionLabel, ytToggleAll);
    ytPanel.append(ytSection);

    const ytLib = document.createElement('div');
    ytLib.id = 'yt-library';
    ytPanel.append(ytLib);

    const ytActions = document.createElement('div');
    ytActions.className = 'yt-actions';
    const ytPlayBtn = document.createElement('button');
    ytPlayBtn.id = 'yt-play';
    ytPlayBtn.className = 'yt-btn-disabled';
    ytPlayBtn.textContent = 'ADD SOURCE';
    const ytCancelBtn = document.createElement('button');
    ytCancelBtn.id = 'yt-cancel';
    ytCancelBtn.textContent = 'CANCEL';
    ytActions.append(ytPlayBtn, ytCancelBtn);
    ytPanel.append(ytActions);

    body.append(ytPanel);

    // --- REACTIVITY section ---
    const fxGroup = document.createElement('div');
    fxGroup.className = 'mixer-group';
    fxGroup.textContent = 'REACTIVITY';
    body.append(fxGroup);

    let lastGroup = '';
    for (const s of fxSliders) {
        if (s.group !== lastGroup) {
            const subGroup = document.createElement('div');
            subGroup.className = 'mixer-subgroup';
            subGroup.textContent = s.group === 'canvas' ? 'DISPLAY' : 'BACKGROUND';
            body.append(subGroup);
            lastGroup = s.group;
        }

        const row = document.createElement('div');
        row.className = 'mixer-fx-row';

        const label = document.createElement('span');
        label.className = 'mixer-fx-label';
        label.textContent = s.label;

        const input = document.createElement('input');
        input.type = 'range';
        input.min = '0';
        input.max = '100';
        input.value = fx[s.key];
        input.setAttribute('aria-label', `${s.label} intensity`);

        const val = document.createElement('span');
        val.className = 'mixer-fx-val';
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

    const fxBtnRow = document.createElement('div');
    fxBtnRow.className = 'mixer-fx-buttons';
    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'RESET FX';
    on(resetBtn, 'click', () => {
        fxSliders.forEach(s => {
            fx[s.key] = s.default;
            Settings.save('fx_' + s.key, s.default);
        });
        body.querySelectorAll('.mixer-fx-row').forEach((row, i) => {
            row.querySelector('input').value = fxSliders[i].default;
            row.querySelector('.mixer-fx-val').textContent = fxSliders[i].default;
        });
    });
    fxBtnRow.append(resetBtn);
    body.append(fxBtnRow);

    content.append(body);
    panel.append(content);
    document.body.append(panel);

    // Wire YouTube events
    on(ytAddBtn, 'click', addYtVideo);
    on(ytUrlInput, 'keydown', e => { if (e.key === 'Enter') addYtVideo(); });
    on(ytPlayBtn, 'click', () => {
        const ids = getSelectedYtIds();
        if (ids.length > 0) {
            addYouTubeSource(ids);
            hideYtPanel();
        }
    });
    on(ytCancelBtn, 'click', hideYtPanel);
    on(ytToggleAll, 'click', () => {
        const checks = document.querySelectorAll('#yt-library .yt-check');
        const allChecked = [...checks].every(c => c.checked);
        checks.forEach(c => { c.checked = !allChecked; });
        updateYtPlayBtn();
    });

    return panel;
}

const mixerPanel = buildMixerPanel();

Settings.onChange('mixer', () => {
    mixerPanel.classList.toggle('hidden');
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

// --- Source Management ---

function addSourceElement(source) {
    const wrapper = document.createElement('div');
    wrapper.className = 'bg-source';
    wrapper.dataset.sourceId = source.id;
    source.wrapper = wrapper;
    bgContainer.append(wrapper);
    applySourceLayout(source);
    return wrapper;
}

function applySourceLayout(source) {
    if (!source.wrapper) return;
    const w = source.wrapper;
    w.style.opacity = source.opacity / 100;

    // Remove old resize handles from wrapper
    w.querySelectorAll('.resize-handle').forEach(h => h.remove());

    if (source.mode === 'fullscreen') {
        w.className = 'bg-source bg-source-fullscreen';
        w.style.left = '';
        w.style.top = '';
        w.style.width = '';
        w.style.height = '';
        w.style.cursor = '';
    } else {
        w.className = 'bg-source bg-source-windowed';
        if (!source.pos) {
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            source.pos = {
                x: vw * 0.15 + sources.indexOf(source) * 30,
                y: vh * 0.15 + sources.indexOf(source) * 30,
                w: vw * 0.3,
                h: vh * 0.3,
            };
        }
        w.style.left = source.pos.x + 'px';
        w.style.top = source.pos.y + 'px';
        w.style.width = source.pos.w + 'px';
        w.style.height = source.pos.h + 'px';
        attachWindowedDrag(source);
    }
    w.dataset.sourceId = source.id;
}

function attachWindowedDrag(source) {
    const wrapper = source.wrapper;

    ['nw', 'ne', 'sw', 'se'].forEach(dir => {
        const handle = document.createElement('div');
        handle.className = `resize-handle ${dir}`;
        wrapper.append(handle);

        on(handle, 'mousedown', e => {
            e.preventDefault();
            e.stopPropagation();
            const startRect = { ...source.pos };
            const e0x = e.clientX, e0y = e.clientY;

            function onMove(ev) {
                const dx = ev.clientX - e0x;
                const dy = ev.clientY - e0y;
                let { x, y, w, h } = startRect;

                if (dir.includes('e')) w += dx;
                if (dir.includes('w')) { w -= dx; x += dx; }
                if (dir.includes('s')) h += dy;
                if (dir.includes('n')) { h -= dy; y += dy; }

                if (w < 120) { if (dir.includes('w')) x = startRect.x + startRect.w - 120; w = 120; }
                if (h < 80) { if (dir.includes('n')) y = startRect.y + startRect.h - 80; h = 80; }

                source.pos = { x, y, w, h };
                wrapper.style.left = x + 'px';
                wrapper.style.top = y + 'px';
                wrapper.style.width = w + 'px';
                wrapper.style.height = h + 'px';
                saveSources();
            }

            function onUp() {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
            }
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
        });
    });

    on(wrapper, 'mousedown', e => {
        if (e.button !== 0 || e.target.closest('.resize-handle')) return;
        const e0x = e.clientX, e0y = e.clientY;
        const startPos = { ...source.pos };
        let dragging = false;

        function onMove(ev) {
            const dx = ev.clientX - e0x;
            const dy = ev.clientY - e0y;
            if (!dragging) {
                if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
                dragging = true;
                wrapper.classList.add('dragging');
            }
            source.pos = { ...startPos, x: startPos.x + dx, y: startPos.y + dy };
            wrapper.style.left = source.pos.x + 'px';
            wrapper.style.top = source.pos.y + 'px';
            saveSources();
        }

        function onUp() {
            wrapper.classList.remove('dragging');
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        }
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    });
}

function removeSource(id) {
    const idx = sources.findIndex(s => s.id === id);
    if (idx === -1) return;
    const source = sources[idx];

    if (source.element) {
        if (source.element.srcObject) {
            source.element.srcObject.getTracks().forEach(t => t.stop());
        }
        if (source.element.src && source.type === 'file') {
            URL.revokeObjectURL(source.element.src);
        }
    }

    if (source.wrapper) source.wrapper.remove();
    sources.splice(idx, 1);
    saveSources();

    if (sources.length === 0) {
        renderer.setBgTransparent(false);
        bgAnimating = false;
        smoothedRms = 0;
        peakRms = 0;
        displayEl.style.transform = '';
        canvasEl.style.filter = '';
        scanlineOverlay.style.opacity = '0';
        Audio.disableAnalyser();
    }

    refreshSourceCards();
}

function removeAllSources() {
    while (sources.length > 0) removeSource(sources[0].id);
}

// --- Source Factories ---

function activateBackground() {
    renderer.setBgTransparent(true);
    Audio.enableAnalyser();
    startBgLoop();
}

function addYouTubeSource(ids) {
    const lib = loadYtLibrary();
    const titles = ids.map(id => {
        const entry = lib.find(v => v.id === id);
        return entry && entry.title ? entry.title : id;
    });
    const source = createSource('youtube', {
        label: ids.length === 1 ? titles[0] : `${ids.length} videos`,
        ytIds: ids,
    });
    sources.push(source);

    const iframe = document.createElement('iframe');
    const first = ids[0];
    iframe.src = `https://www.youtube-nocookie.com/embed/${first}?autoplay=1&loop=1&mute=1&controls=0&showinfo=0&rel=0&modestbranding=1&iv_load_policy=3&disablekb=1&playlist=${ids.join(',')}&playsinline=1`;
    iframe.allow = 'autoplay; encrypted-media';
    iframe.setAttribute('frameborder', '0');
    source.element = iframe;

    addSourceElement(source);
    source.wrapper.append(iframe);
    activateBackground();
    saveSources();
    refreshSourceCards();
}

function addCameraSource() {
    navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        .then(stream => {
            const source = createSource('camera', { label: 'CAMERA' });
            sources.push(source);

            const video = document.createElement('video');
            video.loop = true;
            video.muted = true;
            video.playsInline = true;
            video.srcObject = stream;
            video.play();
            source.element = video;

            addSourceElement(source);
            source.wrapper.append(video);
            activateBackground();
            saveSources();
            refreshSourceCards();
        })
        .catch(err => {
            console.error('Camera access denied:', err);
        });
}

function addScreenSource() {
    navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
        .then(stream => {
            const source = createSource('screen', { label: 'SCREEN' });
            sources.push(source);

            const video = document.createElement('video');
            video.loop = true;
            video.muted = true;
            video.playsInline = true;
            video.srcObject = stream;
            video.play();
            source.element = video;

            addSourceElement(source);
            source.wrapper.append(video);
            activateBackground();
            saveSources();
            refreshSourceCards();

            stream.getVideoTracks()[0].addEventListener('ended', () => {
                removeSource(source.id);
            });
        })
        .catch(err => {
            console.error('Screen share denied:', err);
        });
}

function addFileSource() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*';
    on(input, 'change', () => {
        const file = input.files[0];
        if (!file) return;

        const source = createSource('file', { label: file.name.slice(0, 20) });
        sources.push(source);

        const video = document.createElement('video');
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        video.src = URL.createObjectURL(file);
        video.play();
        source.element = video;

        addSourceElement(source);
        source.wrapper.append(video);
        activateBackground();
        saveSources();
        refreshSourceCards();
    });
    input.click();
}

function addSource(type) {
    switch (type) {
        case 'youtube': showYtPanel(); break;
        case 'camera': addCameraSource(); break;
        case 'screen': addScreenSource(); break;
        case 'file': addFileSource(); break;
    }
}

// --- Reactive Loop ---

function startBgLoop() {
    if (bgAnimating) return;
    bgAnimating = true;
    requestAnimationFrame(updateBgReactive);
}

let lastPeakHit = 0;

function updateBgReactive() {
    if (!bgAnimating || sources.length === 0) {
        bgAnimating = false;
        return;
    }

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

    // --- Per-source background effects ---
    const bgFilters = [];
    const brightAmt = fx.fxBgBright / 100;
    const blurAmt = fx.fxBgBlur / 100;
    const satAmt = fx.fxBgSaturate / 100;
    const bgZoomAmt = fx.fxBgZoom / 100;

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

    const bgFilterStr = bgFilters.length ? bgFilters.join(' ') : '';
    const bgScale = bgZoomAmt > 0 ? `scale(${1 + smoothedRms * bgZoomAmt * 0.4})` : '';

    for (const source of sources) {
        if (!source.wrapper) continue;
        const f = source.invert
            ? (bgFilterStr ? bgFilterStr + ' invert(1)' : 'invert(1)')
            : bgFilterStr;
        source.wrapper.style.filter = f;
        if (source.element) {
            source.element.style.transform = bgScale;
        }
    }

    requestAnimationFrame(updateBgReactive);
}

// --- Keyboard ---

on(document, 'keydown', e => {
    if (e.key === 'i' && sources.length > 0 && !e.repeat) {
        sources.forEach(s => {
            if (s.mode === 'fullscreen') s.invert = !s.invert;
        });
        saveSources();
        refreshSourceCards();
    }
    if (e.key === 'Escape') {
        mixerPanel.classList.add('hidden');
    }
});

// --- YouTube Library ---

const YT_LIBRARY_KEY = 'ytLibrary';

function getYouTubeId(url) {
    const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : null;
}

function fetchYouTubeTitle(id) {
    return fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`)
        .then(r => r.ok ? r.json() : null)
        .then(data => data ? data.title : null)
        .catch(() => null);
}

function loadYtLibrary() {
    try { return JSON.parse(localStorage.getItem(YT_LIBRARY_KEY)) || []; }
    catch { return []; }
}

function saveYtLibrary(lib) {
    localStorage.setItem(YT_LIBRARY_KEY, JSON.stringify(lib));
}

function showYtPanel() {
    const panel = document.getElementById('mixer-yt');
    panel.classList.remove('hidden');
    renderYtLibrary();
    const input = document.getElementById('yt-url');
    input.value = '';
    input.focus();
    document.getElementById('yt-error').classList.add('hidden');

    // Backfill missing titles
    const lib = loadYtLibrary();
    const missing = lib.filter(v => !v.title);
    if (missing.length > 0) {
        Promise.all(missing.map(v =>
            fetchYouTubeTitle(v.id).then(title => { if (title) v.title = title; })
        )).then(() => {
            saveYtLibrary(lib);
            renderYtLibrary();
        });
    }
}

function hideYtPanel() {
    document.getElementById('mixer-yt').classList.add('hidden');
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
        label.textContent = video.title || video.id;

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
    btn.textContent = count > 0 ? `ADD ${count} VIDEO${count > 1 ? 'S' : ''}` : 'ADD SOURCE';
    btn.classList.toggle('yt-btn-disabled', count === 0);
}

function addYtVideo() {
    const input = document.getElementById('yt-url');
    const url = input.value.trim();
    if (!url) return;

    const id = getYouTubeId(url);
    if (!id) {
        document.getElementById('yt-error').classList.remove('hidden');
        return;
    }

    document.getElementById('yt-error').classList.add('hidden');
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

    fetchYouTubeTitle(id).then(title => {
        if (!title) return;
        const lib = loadYtLibrary();
        const entry = lib.find(v => v.id === id);
        if (entry) {
            entry.title = title;
            saveYtLibrary(lib);
            renderYtLibrary();
        }
    });
}

// --- Mixer Source Cards ---

function syncSourceDomOrder() {
    for (const source of sources) {
        if (source.wrapper) bgContainer.append(source.wrapper);
    }
}

function refreshSourceCards() {
    const container = document.getElementById('mixer-sources');
    if (!container) return;
    container.innerHTML = '';

    if (sources.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'mixer-empty';
        empty.textContent = 'no sources';
        container.append(empty);
        return;
    }

    for (const source of sources) {
        const card = document.createElement('div');
        card.className = 'source-card';
        card.dataset.sourceId = String(source.id);
        card.draggable = true;

        const hdr = document.createElement('div');
        hdr.className = 'source-card-header';

        const grip = document.createElement('span');
        grip.className = 'source-grip';
        grip.textContent = '\u2261';

        const badge = document.createElement('span');
        badge.className = 'source-badge';
        const badges = { youtube: 'YT', camera: 'CAM', screen: 'SCR', file: 'FILE' };
        badge.textContent = badges[source.type] || '?';

        const lbl = document.createElement('span');
        lbl.className = 'source-label';
        lbl.textContent = source.label;

        const removeBtn = document.createElement('button');
        removeBtn.className = 'source-remove';
        removeBtn.textContent = '\u00d7';
        removeBtn.setAttribute('aria-label', `Remove ${source.label}`);
        on(removeBtn, 'click', () => removeSource(source.id));

        hdr.append(grip, badge, lbl, removeBtn);
        card.append(hdr);

        // Drag-to-reorder
        on(card, 'dragstart', e => {
            card.classList.add('source-dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(source.id));
        });

        on(card, 'dragend', () => {
            card.classList.remove('source-dragging');
            container.querySelectorAll('.source-drag-over').forEach(el => el.classList.remove('source-drag-over'));
        });

        on(card, 'dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const dragging = container.querySelector('.source-dragging');
            if (dragging && dragging !== card) {
                card.classList.add('source-drag-over');
            }
        });

        on(card, 'dragleave', () => {
            card.classList.remove('source-drag-over');
        });

        on(card, 'drop', e => {
            e.preventDefault();
            card.classList.remove('source-drag-over');
            const draggedId = parseInt(e.dataTransfer.getData('text/plain'));
            if (draggedId && draggedId !== source.id) {
                const fromIdx = sources.findIndex(s => s.id === draggedId);
                const toIdx = sources.findIndex(s => s.id === source.id);
                if (fromIdx !== -1 && toIdx !== -1) {
                    const [moved] = sources.splice(fromIdx, 1);
                    sources.splice(toIdx, 0, moved);
                    syncSourceDomOrder();
                    saveSources();
                    refreshSourceCards();
                }
            }
        });

        const body = document.createElement('div');
        body.className = 'source-card-body';

        // Mode toggle
        const modeRow = document.createElement('div');
        modeRow.className = 'source-row';
        const modeLabel = document.createElement('span');
        modeLabel.textContent = 'MODE';
        const modeSelect = document.createElement('select');
        modeSelect.className = 'source-mode';
        modeSelect.setAttribute('aria-label', `${source.label} layout mode`);
        for (const [val, txt] of [['fullscreen', 'FULL'], ['windowed', 'WINDOW']]) {
            const opt = document.createElement('option');
            opt.value = val;
            opt.text = txt;
            modeSelect.append(opt);
        }
        modeSelect.value = source.mode;
        on(modeSelect, 'change', () => {
            source.mode = modeSelect.value;
            applySourceLayout(source);
            saveSources();
            refreshSourceCards();
        });
        modeRow.append(modeLabel, modeSelect);
        body.append(modeRow);

        // Opacity slider
        const opRow = document.createElement('div');
        opRow.className = 'source-row';
        const opLabel = document.createElement('span');
        opLabel.textContent = 'OPACITY';
        const opSlider = document.createElement('input');
        opSlider.type = 'range';
        opSlider.min = '0';
        opSlider.max = '100';
        opSlider.value = source.opacity;
        opSlider.setAttribute('aria-label', `${source.label} opacity`);
        const opVal = document.createElement('span');
        opVal.className = 'source-val';
        opVal.textContent = source.opacity;
        on(opSlider, 'input', () => {
            source.opacity = parseInt(opSlider.value);
            opVal.textContent = source.opacity;
            if (source.wrapper) source.wrapper.style.opacity = source.opacity / 100;
            saveSources();
        });
        opRow.append(opLabel, opSlider, opVal);
        body.append(opRow);

        // Invert toggle (fullscreen only)
        if (source.mode === 'fullscreen') {
            const invRow = document.createElement('div');
            invRow.className = 'source-row';
            const invLabel = document.createElement('span');
            invLabel.textContent = 'INVERT';
            const invCheck = document.createElement('input');
            invCheck.type = 'checkbox';
            invCheck.checked = source.invert;
            invCheck.className = 'source-check';
            on(invCheck, 'change', () => {
                source.invert = invCheck.checked;
                saveSources();
            });
            invRow.append(invLabel, invCheck);
            body.append(invRow);
        }

        card.append(body);
        container.append(card);
    }
}

refreshSourceCards();

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
