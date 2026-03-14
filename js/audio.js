// Copyright 2021-2022 James Deery
// Released under the MIT licence, https://opensource.org/licenses/MIT

import { wait, on, off } from './util.js';

let ctx;
let source;
let analyser;
let analyserWanted = false;
let enabled = true;
let selectedDeviceId = null;

export function getAnalyser() {
    return analyser;
}

export function enableAnalyser() {
    analyserWanted = true;
    if (!ctx || !source || analyser) return;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.3;
    source.connect(analyser);
}

export function disableAnalyser() {
    analyserWanted = false;
    if (!analyser) return;
    analyser.disconnect();
    analyser = null;
}

export async function listAudioInputs() {
    try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices.filter(d =>
            d.kind === 'audioinput' &&
            d.deviceId !== 'default' &&
            d.deviceId !== 'communications');
    } catch {
        return [];
    }
}

export async function selectDevice(deviceId) {
    selectedDeviceId = deviceId;
    if (ctx) {
        await stop();
        await start();
    }
}

export async function start(attempts = 1) {
    if (ctx || !enabled)
        return;

    try {
        ctx = new AudioContext();

        await navigator.mediaDevices.getUserMedia({ audio: true });
        let deviceId;

        if (selectedDeviceId) {
            deviceId = selectedDeviceId;
        } else {
            while (true) {
                deviceId = await findDeviceId();
                if (deviceId)
                    break;

                if (--attempts > 0) {
                    await wait(300);
                } else {
                    break;
                }
            }
        }

        if (!deviceId)
            throw new Error('M8 not found');

        const stream = await navigator.mediaDevices
            .getUserMedia({ audio: {
                deviceId: { exact: deviceId },
                autoGainControl: false,
                echoCancellation: false,
                noiseSuppression: false
            } })

        source = ctx.createMediaStreamSource(stream);
        source.connect(ctx.destination);

        if (analyserWanted) enableAnalyser();

        if (ctx.state !== 'running') {
            waitForUserGesture();
        }

    } catch (err) {
        console.error(err);
        stop();
    }

    if (!enabled) {
        stop();
    }
}

async function findDeviceId() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
        .filter(d =>
            d.kind === 'audioinput' &&
            /M8/.test(d.label) &&
            d.deviceId !== 'default' &&
            d.deviceId !== 'communications')
        .map(d => d.deviceId)[0];
}

export async function stop() {
    ctx && await ctx.close().catch(() => {});
    ctx = null;
    source = null;
    analyser = null;
}

function waitForUserGesture() {
    const events = ['keydown', 'mousedown', 'touchstart'];

    function resume() {
        ctx && ctx.resume();
        events.forEach(e =>
            off(document, e, resume));
    }

    events.forEach(e =>
        on(document, e, resume));
}

export function enable() {
    if (enabled)
        return;

    enabled = true;
    start();
}

export function disable() {
    enabled = false;
    stop();
}
