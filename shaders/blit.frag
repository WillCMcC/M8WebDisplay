#version 300 es
// Copyright 2021 James Deery
// Released under the MIT licence, https://opensource.org/licenses/MIT

precision highp float;

uniform sampler2D src;
uniform vec3 bgColor;
uniform bool bgTransparent;

in vec2 srcCoord;

out vec4 fragColour;

void main() {
    vec4 texel = texelFetch(src, ivec2(srcCoord), 0);
    if (bgTransparent && all(lessThan(abs(texel.rgb - bgColor), vec3(0.003)))) {
        fragColour = vec4(0.0);
    } else {
        fragColour = texel;
    }
}
