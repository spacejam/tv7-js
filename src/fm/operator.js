// Copyright 2025 Tyler Neely (tylerneely@gmail.com).
// Copyright 2021 Emilie Gillet (emilie.o.gillet@gmail.com).
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
 * FM operator with phase accumulation and sine generation
 */

import { sinePm } from '../stmlib/dsp.js';

/**
 * Modulation source identifiers for operators
 */
export const ModulationSource = {
    /** External modulation source (-2) */
    External: -2,
    /** No modulation (-1) */
    None: -1,
    /** Feedback modulation (0) */
    Feedback: 0,
};

/**
 * FM operator state
 */
export class Operator {
    constructor() {
        /** Phase accumulator (32-bit unsigned for wraparound) */
        this.phase = 0;
        /** Current amplitude */
        this.amplitude = 0.0;
    }

    /**
     * Resets the operator state
     */
    reset() {
        this.phase = 0;
        this.amplitude = 0.0;
    }
}

/**
 * Renders a chain of operators with specified modulation source
 * @param {number} N - Number of operators in chain
 * @param {number} MODULATION_SOURCE - Source of modulation
 * @param {boolean} ADDITIVE - Whether to add to output or replace
 */
export function renderOperators(N, MODULATION_SOURCE, ADDITIVE) {
    return function(ops, f, a, fbState, fbAmount, modulation, out) {
        const size = out.length;
        let previous0 = 0.0;
        let previous1 = 0.0;

        if (MODULATION_SOURCE >= 0) {
            previous0 = fbState[0];
            previous1 = fbState[1];
        }

        const frequency = new Uint32Array(N);
        const phase = new Uint32Array(N);
        const amplitude = new Float32Array(N);
        const amplitudeIncrement = new Float32Array(N);

        const scale = 1.0 / size;
        for (let i = 0; i < N; i++) {
            frequency[i] = (Math.min(f[i], 0.5) * 4294967296.0) >>> 0;
            phase[i] = ops[i].phase;
            amplitude[i] = ops[i].amplitude;
            amplitudeIncrement[i] = (Math.min(a[i], 4.0) - amplitude[i]) * scale;
        }

        const fbScale = fbAmount !== 0
            ? (1 << fbAmount) / 512.0
            : 0.0;

        let modIdx = 0;
        for (let sampleIdx = 0; sampleIdx < size; sampleIdx++) {
            let pm = 0.0;
            if (MODULATION_SOURCE >= 0) {
                pm = (previous0 + previous1) * fbScale;
            } else if (MODULATION_SOURCE === -2) {
                pm = modulation[modIdx];
            }

            if (MODULATION_SOURCE === -2) {
                modIdx += 1;
            }

            for (let i = 0; i < N; i++) {
                phase[i] = (phase[i] + frequency[i]) >>> 0;
                pm = sinePm(phase[i], pm) * amplitude[i];
                amplitude[i] += amplitudeIncrement[i];
                if (i === MODULATION_SOURCE) {
                    previous1 = previous0;
                    previous0 = pm;
                }
            }

            if (ADDITIVE) {
                out[sampleIdx] += pm;
            } else {
                out[sampleIdx] = pm;
            }
        }

        for (let i = 0; i < N; i++) {
            ops[i].phase = phase[i];
            ops[i].amplitude = amplitude[i];
        }

        if (MODULATION_SOURCE >= 0) {
            fbState[0] = previous0;
            fbState[1] = previous1;
        }
    };
}
