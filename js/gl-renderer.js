// Copyright 2021 James Deery
// Released under the MIT licence, https://opensource.org/licenses/MIT

import * as Shaders from '../build/shaders.js';
import { font1 } from '../build/font1.js';
import { font2 } from '../build/font2.js';
import { font3 } from '../build/font3.js';
import { font4 } from '../build/font4.js';
import { font5 } from '../build/font5.js';

const MAX_RECTS = 1024;

// Model configs: [screenW, screenH, fonts]
// Each font: [cellW, cellH, glyphW, glyphH, voffset, cols, rows, fontImage, fontTexW, fontTexH]
const MODEL_CONFIGS = {
    0: { // MK1 (320x240)
        screenW: 320, screenH: 240,
        fonts: [
            { cellW: 8, cellH: 10, glyphW: 5, glyphH: 7, voffset: 0, textOffsetY: 3, cols: 40, rows: 24, src: font1, texW: 470, texH: 7 },
            { cellW: 10, cellH: 12, glyphW: 8, glyphH: 9, voffset: -40, textOffsetY: 0, cols: 40, rows: 24, src: font2, texW: 752, texH: 9, headerRows: 3, headerOffsetY: 5 },
        ]
    },
    1: { // MK2 (480x320)
        screenW: 480, screenH: 320,
        fonts: [
            { cellW: 12, cellH: 14, glyphW: 9, glyphH: 9, voffset: -2, textOffsetY: 3, cols: 40, rows: 23, src: font3, texW: 846, texH: 9 },
            { cellW: 14, cellH: 16, glyphW: 10, glyphH: 10, voffset: -2, textOffsetY: 4, cols: 34, rows: 20, src: font4, texW: 940, texH: 10, headerRows: 3, headerOffsetY: 5 },
            { cellW: 16, cellH: 18, glyphW: 12, glyphH: 12, voffset: -54, textOffsetY: 4, cols: 30, rows: 18, src: font5, texW: 1128, texH: 12, headerRows: 4, headerOffsetY: 5 },
        ]
    }
};

function generateShaders(screenW, screenH, fontCfg) {
    const sw = screenW.toFixed(1);
    const sh = screenH.toFixed(1);
    const hw = (screenW / 2).toFixed(1);
    const hh = (screenH / 2).toFixed(1);

    const blit_vert = `#version 300 es
out vec2 srcCoord;const vec2 corners[]=vec2[](vec2(0,0),vec2(0,1),vec2(1,0),vec2(1,1));void main(){vec2 pos=corners[gl_VertexID]*vec2(2.0,2.0)+vec2(-1.0,-1.0);gl_Position=vec4(pos,0.0,1.0);srcCoord=corners[gl_VertexID]*vec2(${sw},${sh});}`;

    const rect_vert = `#version 300 es
layout(location=0)in vec4 shape;layout(location=1)in vec3 colour;out vec3 colourV;const vec2 corners[]=vec2[](vec2(0,0),vec2(0,1),vec2(1,0),vec2(1,1));const vec2 camScale=vec2(2.0/${sw},-2.0/${sh});const vec2 camOffset=vec2(-${hw},-${hh});void main(){vec2 pos=shape.xy;vec2 size=shape.zw;pos=((corners[gl_VertexID]*size+pos)+camOffset)*camScale;gl_Position=vec4(pos,0.0,1.0);colourV=colour;}`;

    const wave_vert = `#version 300 es
layout(location=0)in uint value;const vec2 camScale=vec2(2.0/${sw},-2.0/${sh});const vec2 camOffset=vec2(-${hw},-${hh});void main(){vec2 pos=vec2(float(gl_VertexID),float(value));pos=(pos+vec2(0.5)+camOffset)*camScale;gl_PointSize=1.0;gl_Position=vec4(pos,0.0,1.0);}`;

    // Generate text vertex shaders for each font config
    const textShaders = {};
    fontCfg.forEach((f, idx) => {
        const gw = f.glyphW.toFixed(1);
        const gh = f.glyphH.toFixed(1);
        const cw = f.cellW.toFixed(1);
        const ch = f.cellH.toFixed(1);
        const cols = f.cols.toFixed(1);
        const offy = f.textOffsetY.toFixed(1);
        const headerRows = f.headerRows || 0;
        const headerOffsetY = (f.headerOffsetY || 0).toFixed(1);

        let shaderBody;
        if (headerRows > 0) {
            // Large font with header row adjustment (like text2)
            shaderBody = `#version 300 es
layout(location=0)in vec3 colour;layout(location=1)in float char;out vec3 colourV;out vec2 fontCoord;const vec2 corners[]=vec2[](vec2(0,0),vec2(0,1),vec2(1,0),vec2(1,1));const vec2 camScale=vec2(2.0/${sw},-2.0/${sh});const vec2 camOffset=vec2(-${hw},-${hh});const vec2 size=vec2(${gw},${gh});void main(){float row;float col=modf(float(gl_InstanceID)/${cols},row)*${cols};row=row-${headerRows.toFixed(1)};vec2 pos=vec2(col,row)*vec2(${cw},${ch})+vec2(0.0,${offy});if(row==0.0){pos=pos+vec2(0.0,${headerOffsetY});}pos=((corners[gl_VertexID]*size+pos)+camOffset)*camScale;gl_Position=vec4(char==0.0?vec2(2.0):pos,0.0,1.0);colourV=colour;fontCoord=(vec2(char-1.0,0.0)+corners[gl_VertexID])*size;}`;
        } else {
            // Small font (like text1)
            shaderBody = `#version 300 es
layout(location=0)in vec3 colour;layout(location=1)in float char;out vec3 colourV;out vec2 fontCoord;const vec2 corners[]=vec2[](vec2(0,0),vec2(0,1),vec2(1,0),vec2(1,1));const vec2 camScale=vec2(2.0/${sw},-2.0/${sh});const vec2 camOffset=vec2(-${hw},-${hh});const vec2 size=vec2(${gw},${gh});void main(){float row;float col=modf(float(gl_InstanceID)/${cols},row)*${cols};vec2 pos=vec2(col,row)*vec2(${cw},${ch})+vec2(0.0,${offy});pos=((corners[gl_VertexID]*size+pos)+camOffset)*camScale;gl_Position=vec4(char==0.0?vec2(2.0):pos,0.0,1.0);colourV=colour;fontCoord=(vec2(char-1.0,0.0)+corners[gl_VertexID])*size;}`;
        }
        textShaders[`text${idx}_vert`] = shaderBody;
    });

    return { blit_vert, rect_vert, wave_vert, ...textShaders };
}

export class Renderer {
    _canvas;
    _gl;
    _bg = [0, 0, 0];
    _frameQueued = false;
    _onBackgroundChanged;
    _model = 0;
    _modelConfig;
    _fontId = 0;
    _shaderSources;
    _bgTransparent = false;

    constructor(bg, onBackgroundChanged) {
        this._bg = [bg[0] / 255, bg[1] / 255, bg[2] / 255];
        this._onBackgroundChanged = onBackgroundChanged;

        this._canvas = document.getElementById('canvas');
        this._gl = this._canvas.getContext('webgl2', {
            alpha: true,
            premultipliedAlpha: false,
            antialias: false
        });

        this._modelConfig = MODEL_CONFIGS[0];
        this._shaderSources = null; // use built-in Shaders for MK1

        const gl = this._gl;
        this._setupRects(gl);
        this._setupText(gl);
        this._setupWave(gl);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.viewport(0, 0, this._modelConfig.screenW, this._modelConfig.screenH);

        this._queueFrame();
    }

    setModel(model) {
        if (this._model === model) return;
        const config = MODEL_CONFIGS[model];
        if (!config) return;

        this._model = model;
        this._modelConfig = config;
        this._fontId = 0;

        // Resize canvas
        this._canvas.width = config.screenW;
        this._canvas.height = config.screenH;

        // Generate model-specific shaders
        this._shaderSources = generateShaders(config.screenW, config.screenH, config.fonts);

        const gl = this._gl;
        gl.viewport(0, 0, config.screenW, config.screenH);

        // Rebuild GL pipeline
        this._setupRects(gl);
        this._setupText(gl);
        this._setupWave(gl);

        this.clear();
    }

    setFont(f) {
        if (f >= this._modelConfig.fonts.length) f = 0;
        if (this._fontId === f) return;
        this._fontId = f;
        const gl = this._gl;
        this._setupText(gl);
    }

    setBgTransparent(transparent) {
        this._bgTransparent = transparent;
        this._rectsClear = true;
        this._queueFrame();
    }

    _rectShader;
    _rectVao;
    _rectShapes = new Uint16Array(MAX_RECTS * 6);
    _rectColours = new Uint8Array(this._rectShapes.buffer, 8);
    _rectCount = 0;
    _rectsClear = true;
    _rectsTex;
    _rectsFramebuffer;
    _blitShader;

    _setupRects(gl) {
        this._rectShader = this._buildProgram(gl, 'rect');

        this._rectVao = gl.createVertexArray();
        gl.bindVertexArray(this._rectVao);

        this._rectShapes.glBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this._rectShapes.glBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this._rectShapes, gl.STREAM_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 4, gl.UNSIGNED_SHORT, false, 12, 0);
        gl.vertexAttribDivisor(0, 1);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, gl.UNSIGNED_BYTE, true, 12, 8);
        gl.vertexAttribDivisor(1, 1);

        const sw = this._modelConfig.screenW;
        const sh = this._modelConfig.screenH;

        this._rectsTex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._rectsTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, sw, sh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

        this._rectsFramebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this._rectsFramebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._rectsTex, 0);

        this._blitShader = this._buildProgram(gl, 'blit');
        gl.useProgram(this._blitShader);
        gl.uniform1i(gl.getUniformLocation(this._blitShader, 'src'), 0);
        this._blitBgColorLoc = gl.getUniformLocation(this._blitShader, 'bgColor');
        this._blitBgTransparentLoc = gl.getUniformLocation(this._blitShader, 'bgTransparent');
    }

    _renderRects(gl) {
        if (this._rectsClear) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, this._rectsFramebuffer);

            const bgAlpha = this._bgTransparent ? 0 : 1;
            gl.clearColor(this._bg[0], this._bg[1], this._bg[2], bgAlpha);
            gl.clear(gl.COLOR_BUFFER_BIT);
            this._rectsClear = false;
        }

        if (this._rectCount > 0) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, this._rectsFramebuffer);

            gl.useProgram(this._rectShader);
            gl.bindVertexArray(this._rectVao);

            gl.bindBuffer(gl.ARRAY_BUFFER, this._rectShapes.glBuffer);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, this._rectShapes.subarray(0, this._rectCount * 6));

            gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this._rectCount);

            this._rectCount = 0;
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.disable(gl.BLEND);
        gl.useProgram(this._blitShader);
        gl.uniform3fv(this._blitBgColorLoc, this._bg);
        gl.uniform1i(this._blitBgTransparentLoc, this._bgTransparent ? 1 : 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.enable(gl.BLEND);
    }

    drawRect(x, y, w, h, r, g, b) {
        const sw = this._modelConfig.screenW;
        const sh = this._modelConfig.screenH;
        const fontCfg = this._modelConfig.fonts[this._fontId];
        const voffset = fontCfg ? fontCfg.voffset : 0;

        if (x === 0 && y === 0 && w >= sw && h >= sh) {
            this._onBackgroundChanged(r, g, b);

            this._bg = [r / 255, g / 255, b / 255];
            this._rectCount = 0;
            this._rectsClear = true;

            if (this._textChars) {
                this._textChars.fill(0);
                this._textChars.updated = true;
            }

            this._waveOn = false;

        } else if (this._rectCount < MAX_RECTS) {
            const i = this._rectCount;
            this._rectShapes[i * 6 + 0] = x;
            this._rectShapes[i * 6 + 1] = y ? y + voffset : y;
            this._rectShapes[i * 6 + 2] = w;
            this._rectShapes[i * 6 + 3] = h;
            this._rectColours[i * 12 + 0] = r;
            this._rectColours[i * 12 + 1] = g;
            this._rectColours[i * 12 + 2] = b;
            this._rectCount++;
        }

        if (this._rectCount >= MAX_RECTS) {
            this._renderRects(this._gl);
        }

        this._queueFrame();
    }

    _textShader;
    _textVao;
    _textTex;
    _textColours;
    _textChars;
    _textGridSize = 0;

    _setupText(gl) {
        const fontCfg = this._modelConfig.fonts[this._fontId];
        if (!fontCfg) return;

        const gridSize = fontCfg.cols * fontCfg.rows;

        // Rebuild text arrays if grid size changed
        if (gridSize !== this._textGridSize) {
            this._textColours = new Uint8Array(gridSize * 3);
            this._textChars = new Uint8Array(gridSize);
            this._textGridSize = gridSize;
        }

        // Build text shader for this font
        if (this._shaderSources) {
            // MK2: use generated shaders
            this._textShader = this._buildProgramFromSource(gl, `text${this._fontId}`,
                this._shaderSources[`text${this._fontId}_vert`],
                Shaders.text1_frag); // All text frags are the same
        } else {
            // MK1: use pre-built shaders
            if (this._fontId === 0) {
                this._textShader = this._buildProgram(gl, 'text1');
            } else {
                this._textShader = this._buildProgram(gl, 'text2');
            }
        }

        gl.useProgram(this._textShader);
        gl.uniform1i(gl.getUniformLocation(this._textShader, 'font'), 1);

        this._textVao = gl.createVertexArray();
        gl.bindVertexArray(this._textVao);

        this._textColours.glBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this._textColours.glBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this._textColours, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.UNSIGNED_BYTE, true, 0, 0);
        gl.vertexAttribDivisor(0, 1);

        this._textChars.glBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this._textChars.glBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this._textChars, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 1, gl.UNSIGNED_BYTE, false, 0, 0);
        gl.vertexAttribDivisor(1, 1);

        this._textTex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this._textTex);

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fontCfg.texW, fontCfg.texH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        const fontImage = new Image();
        fontImage.onload = () => {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this._textTex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, fontImage);
            this._queueFrame();
        };
        fontImage.src = fontCfg.src;
    }

    _renderText(gl) {
        if (!this._textChars) return;
        gl.useProgram(this._textShader);
        gl.bindVertexArray(this._textVao);

        if (this._textColours.updated) {
            gl.bindBuffer(gl.ARRAY_BUFFER, this._textColours.glBuffer);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, this._textColours);
            this._textColours.updated = false;
        }

        if (this._textChars.updated) {
            gl.bindBuffer(gl.ARRAY_BUFFER, this._textChars.glBuffer);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, this._textChars);
            this._textChars.updated = false;
        }

        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this._textGridSize);
    }

    drawText(c, x, y, r, g, b) {
        const fontCfg = this._modelConfig.fonts[this._fontId];
        if (!fontCfg) return;

        const cols = fontCfg.cols;
        const i = Math.floor(y / fontCfg.cellH) * cols + Math.floor(x / fontCfg.cellW);
        if (i >= this._textGridSize || i < 0) return;
        this._textChars[i] = c - 32;
        this._textChars.updated = true;
        this._textColours[i * 3 + 0] = r;
        this._textColours[i * 3 + 1] = g;
        this._textColours[i * 3 + 2] = b;
        this._textColours.updated = true;

        this._queueFrame();
    }

    _waveData;
    _waveColour = new Float32Array([0.5, 1, 1]);
    _waveOn = false;

    _setupWave(gl) {
        const sw = this._modelConfig.screenW;
        this._waveData = new Uint8Array(sw);

        this._waveShader = this._buildProgram(gl, 'wave');
        this._waveShader.colourUniform = gl.getUniformLocation(this._waveShader, 'colour');
        this._waveVao = gl.createVertexArray();
        gl.bindVertexArray(this._waveVao);

        this._waveData.glBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this._waveData.glBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this._waveData, gl.STREAM_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribIPointer(0, 1, gl.UNSIGNED_BYTE, 1, 0);
    }

    _renderWave(gl) {
        if (this._waveOn) {
            gl.useProgram(this._waveShader);
            gl.uniform3fv(this._waveShader.colourUniform, this._waveColour);
            gl.bindVertexArray(this._waveVao);

            if (this._waveData.updated) {
                gl.bindBuffer(gl.ARRAY_BUFFER, this._waveData.glBuffer);
                gl.bufferSubData(gl.ARRAY_BUFFER, 0, this._waveData);
                this._waveData.updated = false;
            }

            gl.drawArrays(gl.POINTS, 0, this._modelConfig.screenW);
        }
    }

    drawWave(r, g, b, data) {
        const sw = this._modelConfig.screenW;
        this._waveColour[0] = r / 255;
        this._waveColour[1] = g / 255;
        this._waveColour[2] = b / 255;

        if (data.length != 0) {
            if (data.length > sw) {
                data = data.subarray(data.length - sw);
            }
            this._waveData.fill(-1);
            this._waveData.set(data, sw - data.length);
            this._waveData.updated = true;
            this._waveOn = true;
            this._queueFrame();

        } else if (this._waveOn) {
            this._waveOn = false;
            this._queueFrame();
        }
    }

    _renderFrame() {
        const gl = this._gl;

        this._renderRects(gl);
        this._renderText(gl);
        this._renderWave(gl);

        this._frameQueued = false;
    }

    _queueFrame() {
        if (!this._frameQueued) {
            requestAnimationFrame(() => this._renderFrame());
            this._frameQueued = true;
        }
    }

    clear() {
        this._rectsClear = true;
        this._rectCount = 0;
        if (this._textChars) {
            this._textChars.fill(0);
            this._textChars.updated = true;
        }
        this._waveOn = false;

        this._queueFrame();
    }

    // Shader building helpers
    _compileShaderSource(gl, name, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
            throw new Error(`Failed to compile shader (${name}): ${gl.getShaderInfoLog(shader)}`);
        return shader;
    }

    _buildProgram(gl, name) {
        const vertSrc = (this._shaderSources && this._shaderSources[`${name}_vert`]) || Shaders[`${name}_vert`];
        const fragSrc = (this._shaderSources && this._shaderSources[`${name}_frag`]) || Shaders[`${name}_frag`];
        return this._linkProgram(gl, name,
            this._compileShaderSource(gl, `${name}_vert`, gl.VERTEX_SHADER, vertSrc),
            this._compileShaderSource(gl, `${name}_frag`, gl.FRAGMENT_SHADER, fragSrc));
    }

    _buildProgramFromSource(gl, name, vertSrc, fragSrc) {
        return this._linkProgram(gl, name,
            this._compileShaderSource(gl, `${name}_vert`, gl.VERTEX_SHADER, vertSrc),
            this._compileShaderSource(gl, `${name}_frag`, gl.FRAGMENT_SHADER, fragSrc));
    }

    _linkProgram(gl, name, vertexShader, fragmentShader) {
        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS))
            throw new Error(`Failed to link program (${name}): ${gl.getProgramInfoLog(program)}`);
        return program;
    }
}
