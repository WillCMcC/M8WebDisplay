// Copyright 2021 James Deery
// Released under the MIT licence, https://opensource.org/licenses/MIT

const NORMAL = Symbol('normal');
const ESCAPE = Symbol('escape');
const ERROR = Symbol('error');

const EMPTY = new Uint8Array(0);

export class Parser {
    _state = NORMAL;
    _buffer = new Uint8Array(512);
    _i = 0;
    _renderer;
    _lastRectR = 0;
    _lastRectG = 0;
    _lastRectB = 0;

    constructor(renderer) {
        this._renderer = renderer;
    }

    _processFrame(frame) {
        switch (frame[0]) {
            case 0xfe: { // rect — variable length: 5, 8, 9, or 12 bytes
                const len = frame.length;
                if (len !== 5 && len !== 8 && len !== 9 && len !== 12) {
                    console.log('Bad RECT frame, length=' + len);
                    break;
                }
                const x = frame[1] + frame[2] * 256;
                const y = frame[3] + frame[4] * 256;
                let w = 1, h = 1;
                let r = this._lastRectR, g = this._lastRectG, b = this._lastRectB;

                if (len === 8) {
                    r = frame[5]; g = frame[6]; b = frame[7];
                } else if (len === 9) {
                    w = frame[5] + frame[6] * 256;
                    h = frame[7] + frame[8] * 256;
                } else if (len === 12) {
                    w = frame[5] + frame[6] * 256;
                    h = frame[7] + frame[8] * 256;
                    r = frame[9]; g = frame[10]; b = frame[11];
                }

                this._lastRectR = r;
                this._lastRectG = g;
                this._lastRectB = b;
                this._renderer.drawRect(x, y, w, h, r, g, b);
                break;
            }

            case 0xfd:
                if (frame.length === 12) {
                    this._renderer.drawText(
                        frame[1],
                        frame[2] + frame[3] * 256,
                        frame[4] + frame[5] * 256,
                        frame[6],
                        frame[7],
                        frame[8]);

                } else {
                    console.log('Bad TEXT frame');
                }
                break;

            case 0xfc: // wave — up to 484 bytes (1 + 3 color + 480 waveform)
                if (frame.length === 4) {
                    this._renderer.drawWave(
                        frame[1],
                        frame[2],
                        frame[3],
                        EMPTY);

                } else if (frame.length >= 4 && frame.length <= 484) {
                    this._renderer.drawWave(
                        frame[1],
                        frame[2],
                        frame[3],
                        frame.subarray(4));

                } else {
                    console.log('Bad WAVE frame');
                }
                break;

            case 0xfb: // joypad
                if (frame.length !== 3) {
                    console.log('Bad JPAD frame');
                }
                break;

            case 0xff: // system
                if (frame.length >= 6) {
                    const hwTypes = ['Headless', 'Beta M8', 'Production M8', 'Production M8 Model:02'];
                    const hw = frame[1];
                    console.log(`M8 System Info: ${hwTypes[hw] || 'Unknown'} (type=${hw}), FW ${frame[2]}.${frame[3]}.${frame[4]}, font=${frame[5]}`);
                    this._renderer.setModel(hw === 0x03 ? 1 : 0);
                    this._renderer.setFont(frame[5]);
                }
                break;
            default:
                console.log('BAD FRAME');
        }
    }

    process(data) {
        for (let i = 0; i < data.length; i++) {
            const b = data[i];

            switch (this._state) {
                case NORMAL:
                    switch (b) {
                        case 0xc0:
                            this._processFrame(this._buffer.subarray(0, this._i));
                            this._i = 0;
                            break;

                        case 0xdb:
                            this._state = ESCAPE;
                            break;

                        default:
                            this._buffer[this._i++] = b;
                            break;
                    }
                    break;

                case ESCAPE:
                    switch (b) {
                        case 0xdc:
                            this._buffer[this._i++] = 0xc0;
                            this._state = NORMAL;
                            break;

                        case 0xdd:
                            this._buffer[this._i++] = 0xdb;
                            this._state = NORMAL;
                            break;

                        default:
                            this._state = ERROR;
                            console.log('Unexpected SLIP sequence');
                            break;
                    }
                    break;

                case ERROR:
                    switch (b) {
                        case 0xc0:
                            this._state = NORMAL;
                            this._i = 0;
                            console.log('SLIP recovered');
                            break;

                        default:
                            break;
                    }
            }
        }
    }

    reset() {
        this._state = NORMAL;
        this._i = 0;
    }
}
