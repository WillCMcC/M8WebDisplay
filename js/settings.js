// Copyright 2021-2022 James Deery
// Released under the MIT licence, https://opensource.org/licenses/MIT

import { show, hide, toggle, appendButton, on } from './util.js';

on('#menu-button', 'click', () => toggle('#settings'));

on('#settings', 'click', e => {
    if (e.target.id === 'settings') {
        hide('#settings');
    }
});

on('#settings-close', 'click', () => hide('#settings'));

on(document, 'keydown', e => {
    if (e.key === 'Escape') hide('#settings');
});

const actions = {};
const values = {};

setupSection('DISPLAY');
setupSelect(
    'displayType',
    'Display Type',
    { webgl2: 'WebGL2', old: 'Canvas + SVG' },
    'webgl2');
setupToggle('snapPixels', 'Snap Pixels', true);
setupButton('fullscreen', 'Fullscreen');

setupSection('INPUT');
setupToggle('showControls', 'Show Controls', false);
setupToggle('virtualKeyboard', 'Virtual Keyboard', true);

setupSection('AUDIO');
setupToggle('enableAudio', 'Enable Audio', true);

setupSection('BACKGROUND');
setupButton('bgYoutube', 'YouTube');
setupButton('bgVideoFile', 'Video File');
setupButton('bgCamera', 'Camera');
setupButton('bgRemove', 'Remove');
setupButton('reactivity', 'Reactivity');

setupSection('SYSTEM');
setupToggle('preventSleep', 'Prevent Sleep', false);
setupToggle('hideMenu', 'Hide Menu', false);

onChange('hideMenu', value => document
    .getElementById('menu-button')
    .classList
    .toggle('auto-hide', value));

function setupSection(title) {
    const div = document.createElement('div');
    div.className = 'settings-section';
    div.dataset.section = title.toLowerCase();
    div.textContent = title;
    document.getElementById('settings-body').append(div);
}

function setupToggle(setting, title, defaultValue) {
    const value = load(setting, defaultValue);

    const div = document.createElement('div');
    div.classList.add('setting');
    const label = document.createElement('label');
    label.innerText = title;
    div.append(label);
    const input = document.createElement('input');
    input.setAttribute('type', 'checkbox');
    input.checked = value;
    label.append(input);

    on(input, 'change', () =>
        save(setting, input.checked));

    document
        .getElementById('settings-body')
        .append(div);
}

function setupSelect(setting, title, options, defaultValue) {
    const value = load(setting, defaultValue);

    const div = document.createElement('div');
    div.classList.add('setting');
    const label = document.createElement('label');
    label.innerText = title;
    div.append(label);
    const select = document.createElement('select');

    for (const [value, title] of Object.entries(options)) {
        const option = document.createElement('option');
        option.value = value;
        option.text = title;
        select.append(option);
    }
    select.value = value;

    label.append(select);

    on(select, 'change', () =>
        save(setting, select.value));

    document
        .getElementById('settings-body')
        .append(div);
}

function setupButton(setting, title) {
    const div = document.createElement('div');
    div.classList.add('setting');
    appendButton(div, title, () => {
        hide('#settings');
        actions[setting] && actions[setting]();
    });

    document
        .getElementById('settings-body')
        .append(div);
}

export function load(setting, defaultValue) {
    let value = localStorage[setting];
    value = value === undefined ? defaultValue : JSON.parse(value);
    values[setting] = value;

    return value;
}

export function save(setting, value) {
    values[setting] = value;
    actions[setting] && actions[setting](value);
    localStorage[setting] = JSON.stringify(value);
}

export function onChange(setting, action) {
    actions[setting] = action;
    if (get(setting) !== undefined) {
        action(get(setting));
    }
}

export function get(setting) {
    return values[setting];
}
