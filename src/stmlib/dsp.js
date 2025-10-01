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
 * DSP utility functions and unit conversions
 */

import { LUT_SINE } from './sine_lut.js';

const SINE_LUT_SIZE = 512.0;
const SINE_LUT_BITS = 9;

/**
 * Linear interpolation in a table
 */
export function interpolate(table, index, size) {
    index = index * size;
    const indexIntegral = Math.min(Math.floor(index), table.length - 2);
    const indexFractional = index - indexIntegral;
    const a = table[indexIntegral];
    const b = table[indexIntegral + 1];
    return a + (b - a) * indexFractional;
}

/**
 * Linear interpolation in a table with wrapping
 */
export function interpolateWrap(table, index, size) {
    index -= Math.floor(index);
    index *= size;
    const indexIntegral = Math.floor(index);
    const indexFractional = index - indexIntegral;
    const a = table[indexIntegral];
    const b = table[indexIntegral + 1];
    return a + (b - a) * indexFractional;
}

/**
 * Convert semitones to frequency ratio
 */
export function semitonesToRatio(semitones) {
    return Math.pow(2.0, semitones / 12.0);
}

/**
 * Convert semitones to frequency ratio with safe handling of extreme values
 */
export function semitonesToRatioSafe(semitones) {
    let scale = 1.0;
    while (semitones > 120.0) {
        semitones -= 120.0;
        scale *= 1024.0;
    }
    while (semitones < -120.0) {
        semitones += 120.0;
        scale *= 1.0 / 1024.0;
    }
    return scale * semitonesToRatio(semitones);
}

/**
 * Sine lookup with wrapping (safe for phase >= 0.0)
 */
export function sine(phase) {
    return interpolateWrap(LUT_SINE, phase, SINE_LUT_SIZE);
}

/**
 * Phase modulated sine - with positive or negative phase modulation up to an index of 32
 */
export function sinePm(phase, pm) {
    const MAX_UINT32 = 4294967296.0;
    const MAX_INDEX = 32;
    const OFFSET = MAX_INDEX;
    const SCALE = MAX_UINT32 / (MAX_INDEX * 2.0);

    // Use JavaScript's unsigned 32-bit arithmetic
    const phaseOffset = ((pm + OFFSET) * SCALE) >>> 0;
    const multiplier = (MAX_INDEX * 2) >>> 0;

    // Perform unsigned 32-bit wrapping addition
    phase = (phase + (phaseOffset * multiplier)) >>> 0;

    const integral = (phase >>> (32 - SINE_LUT_BITS)) & 0x1FF;
    const fractional = ((phase << SINE_LUT_BITS) >>> 0) / MAX_UINT32;
    const a = LUT_SINE[integral];
    const b = LUT_SINE[integral + 1];
    return a + (b - a) * fractional;
}
