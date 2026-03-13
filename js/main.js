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

Settings.onChange('controlMapping', () => {
    hide('#info');
    Input.startMapping().then(resizeCanvas);
    resizeCanvas();
});

Settings.onChange('firmware', () => {
    hide('#info');
    Firmware.open();
});

function toggleFullscreen() {
    if (document.fullscreenElement) {
        document.exitFullscreen();
    } else {
        document.body.requestFullscreen();
    }
}

Settings.onChange('fullscreen', toggleFullscreen);

on('#display', 'dblclick', toggleFullscreen);

Settings.onChange('about', () => show('#info'));

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
let bgVideo = null;
let videoInput = null;
let bgElement = null;
let bgAnimating = false;
let smoothedRms = 0;
let peakRms = 0;
let bgInvert = false;
const analyserData = new Uint8Array(2048);

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
    }
    canvasEl.style.transform = '';
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

    // --- Canvas glitch (tiny shear/shake on loud peaks) ---
    const glitchRaw = Math.min(peakRms * 2.5, 1);
    const glitchLevel = Math.max(0, (glitchRaw - 0.4) / 0.6);

    if (glitchLevel > 0 && Math.random() < glitchLevel * 0.6) {
        const shakeX = (Math.random() - 0.5) * glitchLevel * 3;
        const shakeY = (Math.random() - 0.5) * glitchLevel * 1.5;
        const skewX = (Math.random() - 0.5) * glitchLevel * 1.5;
        canvasEl.style.transform = `translate(${shakeX}px, ${shakeY}px) skewX(${skewX}deg)`;
    } else {
        canvasEl.style.transform = '';
    }

    // --- Video invert filter (toggle with 'i') ---
    if (bgElement.tagName !== 'IFRAME') {
        bgElement.style.filter = bgInvert ? 'invert(1)' : '';
    }

    requestAnimationFrame(updateBgReactive);
}

// Toggle invert with 'i' key
on(document, 'keydown', e => {
    if (e.key === 'i' && bgElement && !e.repeat) {
        bgInvert = !bgInvert;
    }
});

function getYouTubeId(url) {
    const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : null;
}

Settings.onChange('bgYoutube', () => {
    const url = prompt('Enter YouTube URL:');
    if (!url) return;
    const id = getYouTubeId(url);
    if (!id) {
        alert('Could not parse YouTube video ID from that URL');
        return;
    }
    clearBackground();
    const iframe = document.createElement('iframe');
    iframe.className = 'bg-youtube';
    iframe.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&loop=1&mute=1&controls=0&showinfo=0&rel=0&modestbranding=1&iv_load_policy=3&disablekb=1&playlist=${id}&playsinline=1`;
    iframe.allow = 'autoplay; encrypted-media';
    iframe.setAttribute('frameborder', '0');
    iframe.style.display = 'block';
    document.body.insertBefore(iframe, document.getElementById('display'));
    bgElement = iframe;
    activateBackground();
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
    document.getElementById('settings').append(div);

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
