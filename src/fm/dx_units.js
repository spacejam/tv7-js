// Copyright 2025 Tyler Neely (tylerneely@gmail.com).
// Copyright 2021 Emilie Gillet (emilie.o.gillet@gmail.com)
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.
//
// See http://creativecommons.org/licenses/MIT/ for more information.

/**
 * Various "magic" conversion functions for DX7 patch data
 */

import { interpolate, semitonesToRatioSafe } from '../stmlib/dsp.js';

/** Coarse frequency lookup table (in semitones) */
export const LUT_COARSE = new Float32Array([
    -12.000000, 0.000000, 12.000000, 19.019550, 24.000000, 27.863137,
    31.019550, 33.688259, 36.000000, 38.039100, 39.863137, 41.513180,
    43.019550, 44.405276, 45.688259, 46.882687, 48.000000, 49.049554,
    50.039100, 50.975130, 51.863137, 52.707809, 53.513180, 54.282743,
    55.019550, 55.726274, 56.405276, 57.058650, 57.688259, 58.295772,
    58.882687, 59.450356,
]);

/** Amplitude modulation sensitivity lookup table */
export const LUT_AMP_MOD_SENSITIVITY = new Float32Array([0.0, 0.2588, 0.4274, 1.0]);

/** Pitch modulation sensitivity lookup table */
export const LUT_PITCH_MOD_SENSITIVITY = new Float32Array([
    0.0, 0.0781250, 0.1562500, 0.2578125, 0.4296875, 0.7187500, 1.1953125, 2.0,
]);

/** Cube root lookup table for velocity normalization */
export const LUT_CUBE_ROOT = new Float32Array([
    0.0, 0.39685062976, 0.50000000000, 0.57235744065, 0.62996081605,
    0.67860466725, 0.72112502092, 0.75914745216, 0.79370070937, 0.82548197054,
    0.85498810729, 0.88258719406, 0.90856038354, 0.93312785379, 0.95646563396,
    0.97871693135, 1.0,
]);

/** Minimum LFO frequency */
export const MIN_LFO_FREQUENCY = 0.005865;

/**
 * Computes 2^x using a fast polynomial approximation
 * @param {number} x - Input value
 * @param {number} order - Polynomial order (1, 2, or 3)
 */
export function pow2Fast(x, order) {
    if (order === 1) {
        // Very fast, low accuracy
        const w = (1 << 23) * (127.0 + x);
        // JavaScript doesn't have direct bit manipulation for floats,
        // so we use an approximation
        return Math.pow(2, x);
    }

    let xIntegral = Math.floor(x);
    if (x < 0.0) {
        xIntegral -= 1;
    }
    x -= xIntegral;

    let result;
    if (order === 2) {
        result = 1.0 + x * (0.6565 + x * 0.3435);
    } else {
        // order === 3
        result = 1.0 + x * (0.6958 + x * (0.2251 + x * 0.0791));
    }

    // Manipulate the exponent
    // JavaScript approximation of bit manipulation
    return result * Math.pow(2, xIntegral);
}

/**
 * Convert an operator (envelope) level from 0-99 to the complement of the "TL" value
 * - 0 => 0 (TL = 127)
 * - 20 => 48 (TL = 79)
 * - 50 => 78 (TL = 49)
 * - 99 => 127 (TL = 0)
 */
export function operatorLevel(level) {
    let tlc = level;
    if (level < 20) {
        tlc = tlc < 15 ? (tlc * (36 - tlc)) >> 3 : 27 + tlc;
    } else {
        tlc += 28;
    }
    return tlc;
}

/**
 * Convert an envelope level from 0-99 to an octave shift
 * - 0 => -4 octaves
 * - 18 => -1 octave
 * - 50 => 0
 * - 82 => +1 octave
 * - 99 => +4 octaves
 */
export function pitchEnvelopeLevel(level) {
    const l = (level - 50.0) / 32.0;
    const tail = Math.max(Math.abs(l) + 0.02 - 1.0, 0.0);
    return l * (1.0 + tail * tail * 5.3056);
}

/**
 * Convert an operator envelope rate from 0-99 to a frequency increment
 */
export function operatorEnvelopeIncrement(rate) {
    const rateScaled = (rate * 41) >> 6;
    const mantissa = 4 + (rateScaled & 3);
    const exponent = 2 + (rateScaled >> 2);
    return (mantissa << exponent) / (1 << 24);
}

/**
 * Convert a pitch envelope rate from 0-99 to a frequency increment
 */
export function pitchEnvelopeIncrement(rate) {
    const r = rate * 0.01;
    return (1.0 + 192.0 * r * (r * r * r * r + 0.3333)) / (21.3 * 44100.0);
}

/**
 * Convert an LFO rate from 0-99 to a frequency
 */
export function lfoFrequency(rate) {
    let rateScaled = rate === 0 ? 1 : (rate * 165) >> 6;
    rateScaled = rateScaled * (rateScaled < 160 ? 11 : 11 + ((rateScaled - 160) >> 4));
    return rateScaled * MIN_LFO_FREQUENCY;
}

/**
 * Convert an LFO delay from 0-99 to two increments
 */
export function lfoDelay(delay) {
    if (delay === 0) {
        return new Float32Array([100000.0, 100000.0]);
    } else {
        const d = 99 - delay;
        const dScaled = (16 + (d & 15)) << (1 + (d >> 4));
        const inc0 = dScaled * MIN_LFO_FREQUENCY;
        const inc1 = Math.max(0x80, dScaled & 0xff80) * MIN_LFO_FREQUENCY;
        return new Float32Array([inc0, inc1]);
    }
}

/**
 * Pre-process velocity to easily compute velocity scaling
 */
export function normalizeVelocity(velocity) {
    const cubeRoot = interpolate(LUT_CUBE_ROOT, velocity, 16.0);
    return 16.0 * (cubeRoot - 0.918);
}

/**
 * MIDI note to envelope increment ratio for rate scaling
 */
export function rateScaling(note, rateScaling) {
    return pow2Fast(rateScaling * (note * 0.33333 - 7.0) * 0.03125, 1);
}

/**
 * Operator amplitude modulation sensitivity (0-3)
 */
export function ampModSensitivity(ampModSensitivity) {
    return LUT_AMP_MOD_SENSITIVITY[ampModSensitivity];
}

/**
 * Pitch modulation sensitivity (0-7)
 */
export function pitchModSensitivity(pitchModSensitivity) {
    return LUT_PITCH_MOD_SENSITIVITY[pitchModSensitivity];
}

/**
 * Keyboard tracking to TL adjustment
 */
export function keyboardScaling(note, ks) {
    const x = note - ks.breakPoint - 15.0;
    const curve = x > 0.0 ? ks.rightCurve : ks.leftCurve;

    let t = Math.abs(x);
    if (curve === 1 || curve === 2) {
        t = Math.min(t * 0.010467, 1.0);
        t = t * t * t;
        t *= 96.0;
    }
    if (curve < 2) {
        t = -t;
    }

    const depth = x > 0.0 ? ks.rightDepth : ks.leftDepth;
    return t * depth * 0.02677;
}

/**
 * Calculate frequency ratio for an operator
 */
export function frequencyRatio(op) {
    const detune = op.mode === 0 && op.fine !== 0
        ? 1.0 + 0.01 * op.fine
        : 1.0;

    let base = op.mode === 0
        ? LUT_COARSE[op.coarse]
        : ((op.coarse & 3) * 100 + op.fine) * 0.39864;

    base += (op.detune - 7.0) * 0.015;

    return semitonesToRatioSafe(base) * detune;
}
