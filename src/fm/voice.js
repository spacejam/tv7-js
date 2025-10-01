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
 * DX7 voice - main synthesis entry point
 */

import { Algorithms } from './algorithms.js';
import {
    ampModSensitivity,
    frequencyRatio,
    keyboardScaling,
    normalizeVelocity,
    operatorLevel,
    pow2Fast,
    rateScaling,
} from './dx_units.js';
import { OperatorEnvelope, PitchEnvelope } from './envelope.js';
import { Operator } from './operator.js';
import { semitonesToRatioSafe } from '../stmlib/dsp.js';

const NUM_OPERATORS = 6;

/**
 * Voice parameters for rendering
 */
export class Parameters {
    constructor() {
        /** Sustain mode (envelope scrubbing) */
        this.sustain = false;
        /** Gate signal (note on/off) */
        this.gate = false;
        /** MIDI note number */
        this.note = 48.0;
        /** Velocity (0.0-1.0) */
        this.velocity = 0.5;
        /** Brightness control (affects modulator levels) */
        this.brightness = 0.5;
        /** Envelope time control (0.0-1.0, 0.5 = normal) */
        this.envelopeControl = 0.5;
        /** Pitch modulation amount */
        this.pitchMod = 0.0;
        /** Amplitude modulation amount */
        this.ampMod = 0.0;
    }
}

/**
 * DX7 FM voice
 */
export class Voice {
    /**
     * Creates a new voice
     */
    constructor(patch, sampleRate) {
        this.algorithms = new Algorithms();
        this.sampleRate = sampleRate;
        this.oneHz = 1.0 / sampleRate;
        this.a0 = 55.0 / sampleRate;
        this.gate = false;
        this.operator = Array.from({ length: NUM_OPERATORS }, () => new Operator());
        this.operatorEnvelope = Array.from({ length: NUM_OPERATORS }, () => new OperatorEnvelope());
        this.pitchEnvelope = new PitchEnvelope();
        this.normalizedVelocity = 10.0;
        this.note = 48.0;
        this.ratios = new Float32Array(NUM_OPERATORS);
        this.levelHeadroom = new Float32Array(NUM_OPERATORS);
        this.level = new Float32Array(NUM_OPERATORS);
        this.feedbackState = new Float32Array([0.0, 0.0]);
        this.patch = patch;
        this.dirty = true;

        const nativeSr = 44100.0;
        const envelopeScale = nativeSr * this.oneHz;

        for (let i = 0; i < NUM_OPERATORS; i++) {
            this.operator[i].reset();
            this.operatorEnvelope[i].init(envelopeScale);
        }
        this.pitchEnvelope.init(envelopeScale);
        this.setup();
    }

    /**
     * Pre-computes patch-dependent data
     */
    setup() {
        if (!this.dirty) {
            return false;
        }

        this.pitchEnvelope.set(
            this.patch.pitchEnvelope.rate,
            this.patch.pitchEnvelope.level
        );

        for (let i = 0; i < NUM_OPERATORS; i++) {
            const op = this.patch.op[i];
            const level = operatorLevel(op.level);
            this.operatorEnvelope[i].set(op.envelope.rate, op.envelope.level, level);
            this.levelHeadroom[i] = 127 - level;
            const sign = op.mode === 0 ? 1.0 : -1.0;
            this.ratios[i] = sign * frequencyRatio(op);
        }

        this.dirty = false;
        return true;
    }

    /**
     * Returns the level of an operator
     */
    opLevel(i) {
        return this.level[i];
    }

    /**
     * Renders audio with 2 output buffers (out and aux)
     */
    renderStereo(parameters, temp, out, aux) {
        const size = out.length;
        const buffers = [
            out,
            aux,
            temp.subarray(0, size),
            temp.subarray(size, size * 2),
        ];
        this.renderInternal(parameters, buffers, size);
    }

    /**
     * Renders audio with single temp buffer
     */
    renderTemp(parameters, temp) {
        const size = Math.floor(temp.length / 3);
        const buffers = [
            temp.subarray(0, size),
            temp.subarray(size, size * 2),
            temp.subarray(size * 2, size * 3),
            temp.subarray(size * 2, size * 3),
        ];
        this.renderInternal(parameters, buffers, size);
    }

    renderInternal(parameters, buffers, size) {
        if (this.setup()) {
            return;
        }

        const envelopeRate = size;
        const adScale = pow2Fast((0.5 - parameters.envelopeControl) * 8.0, 1);
        const rScale = pow2Fast(-Math.abs(parameters.envelopeControl - 0.3) * 8.0, 1);
        const gateDuration = 1.5 * this.sampleRate;
        const envelopeSample = gateDuration * parameters.envelopeControl;

        const inputNote = parameters.note - 24.0 + this.patch.transpose;

        const pitchEnvelope = parameters.sustain
            ? this.pitchEnvelope.renderAtSample(envelopeSample, gateDuration)
            : this.pitchEnvelope.renderScaled(parameters.gate, envelopeRate, adScale, rScale);

        const pitchMod = pitchEnvelope + parameters.pitchMod;
        const f0 = this.a0 * 0.25 * semitonesToRatioSafe(inputNote - 9.0 + pitchMod * 12.0);

        const noteOn = parameters.gate && !this.gate;
        this.gate = parameters.gate;
        if (noteOn || parameters.sustain) {
            this.normalizedVelocity = normalizeVelocity(parameters.velocity);
            this.note = inputNote;
        }

        if (noteOn && this.patch.resetPhase !== 0) {
            for (let i = 0; i < NUM_OPERATORS; i++) {
                this.operator[i].phase = 0;
            }
        }

        const f = new Float32Array(NUM_OPERATORS);
        const a = new Float32Array(NUM_OPERATORS);

        for (let i = 0; i < NUM_OPERATORS; i++) {
            const op = this.patch.op[i];
            f[i] = this.ratios[i]
                * (this.ratios[i] < 0.0 ? -this.oneHz : f0);

            const rateScalingVal = rateScaling(this.note, op.rateScaling);
            const level = parameters.sustain
                ? this.operatorEnvelope[i].renderAtSample(envelopeSample, gateDuration)
                : this.operatorEnvelope[i].renderScaled(
                    parameters.gate,
                    envelopeRate * rateScalingVal,
                    adScale,
                    rScale
                );

            const kbScaling = keyboardScaling(this.note, op.keyboardScaling);
            const velocityScaling = this.normalizedVelocity * op.velocitySensitivity;
            const brightness = this.algorithms.isModulator(this.patch.algorithm, i)
                ? (parameters.brightness - 0.5) * 32.0
                : 0.0;

            const levelAdjusted = level
                + 0.125 * Math.min(kbScaling + velocityScaling + brightness, this.levelHeadroom[i]);
            this.level[i] = levelAdjusted;

            const sensitivity = ampModSensitivity(op.ampModSensitivity);

            // In JavaScript, we don't have compile-time features, so we'll use the default path
            // #[cfg(not(feature = "fast_op_level_modulation"))]
            const logLevelMod = sensitivity * parameters.ampMod - 1.0;
            const levelMod = 1.0 - pow2Fast(6.4 * logLevelMod, 2);
            a[i] = pow2Fast(-14.0 + levelAdjusted * levelMod, 2);
        }

        let i = 0;
        while (i < NUM_OPERATORS) {
            const call = this.algorithms.renderCall(this.patch.algorithm, i);
            const opsSlice = this.operator.slice(i, i + call.n);
            const fSlice = f.subarray(i, i + call.n);
            const aSlice = a.subarray(i, i + call.n);

            const inputBuffer = buffers[call.inputIndex];
            const outputBuffer = buffers[call.outputIndex];

            call.renderFn(
                opsSlice,
                fSlice,
                aSlice,
                this.feedbackState,
                this.patch.feedback,
                inputBuffer,
                outputBuffer
            );

            i += call.n;
        }
    }
}
