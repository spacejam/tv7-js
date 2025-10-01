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
 * DX7-compatible LFO
 */

import { lfoDelay, lfoFrequency, pitchModSensitivity } from './dx_units.js';
import { sine } from '../stmlib/dsp.js';
import { getFloat } from '../stmlib/random.js';

/**
 * LFO waveform types
 */
export const Waveform = {
    /** Triangle wave (0) */
    Triangle: 0,
    /** Ramp down / sawtooth wave (1) */
    RampDown: 1,
    /** Ramp up / reverse sawtooth wave (2) */
    RampUp: 2,
    /** Square wave (3) */
    Square: 3,
    /** Sine wave (4) */
    Sine: 4,
    /** Sample and hold / random stepped values (5) */
    SAndH: 5,
};

/**
 * Convert u8 to Waveform enum
 */
function waveformFromU8(value) {
    switch (value) {
        case 1: return Waveform.RampDown;
        case 2: return Waveform.RampUp;
        case 3: return Waveform.Square;
        case 4: return Waveform.Sine;
        case 5: return Waveform.SAndH;
        default: return Waveform.Triangle;
    }
}

/**
 * DX7-style LFO
 */
export class Lfo {
    /**
     * Creates a new LFO
     */
    constructor() {
        this.phase = 0.0;
        this.frequency = 0.1;
        this.delayPhase = 0.0;
        this.delayIncrement = new Float32Array([0.1, 0.1]);
        this.value_ = 0.0;
        this.randomValue = 0.0;
        this.oneHz = 0.0;
        this.ampModDepth = 0.0;
        this.pitchModDepth = 0.0;
        this.waveform = Waveform.Triangle;
        this.resetPhase = false;
        this.phaseIntegral = 0;
    }

    /**
     * Initializes the LFO
     */
    init(sampleRate) {
        this.phase = 0.0;
        this.frequency = 0.1;
        this.delayPhase = 0.0;
        this.delayIncrement[0] = 0.1;
        this.delayIncrement[1] = 0.1;
        this.randomValue = 0.0;
        this.value_ = 0.0;

        this.oneHz = 1.0 / sampleRate;

        this.ampModDepth = 0.0;
        this.pitchModDepth = 0.0;

        this.waveform = Waveform.Triangle;
        this.resetPhase = false;

        this.phaseIntegral = 0;
    }

    /**
     * Configures the LFO from patch parameters
     */
    set(modulations) {
        this.frequency = lfoFrequency(modulations.rate) * this.oneHz;

        const delayArr = lfoDelay(modulations.delay);
        this.delayIncrement[0] = delayArr[0] * this.oneHz;
        this.delayIncrement[1] = delayArr[1] * this.oneHz;

        this.waveform = waveformFromU8(modulations.waveform);
        this.resetPhase = modulations.resetPhase !== 0;

        this.ampModDepth = modulations.ampModDepth * 0.01;

        this.pitchModDepth = modulations.pitchModDepth * 0.01
            * pitchModSensitivity(modulations.pitchModSensitivity);
    }

    /**
     * Resets the LFO phase
     */
    reset() {
        if (this.resetPhase) {
            this.phase = 0.0;
        }
        this.delayPhase = 0.0;
    }

    /**
     * Advances the LFO by one step (scaled)
     */
    step(scale) {
        this.phase += scale * this.frequency;
        if (this.phase >= 1.0) {
            this.phase -= 1.0;
            this.randomValue = getFloat();
        }
        this.value_ = this.value();

        this.delayPhase += scale
            * this.delayIncrement[this.delayPhase < 0.5 ? 0 : 1];
        if (this.delayPhase >= 1.0) {
            this.delayPhase = 1.0;
        }
    }

    /**
     * Scrubs the LFO to a specific sample position (for envelope scrubbing)
     */
    scrub(sample) {
        const phase = sample * this.frequency;
        const phaseIntegral = Math.floor(phase);
        const phaseFractional = phase - phaseIntegral;
        this.phase = phaseFractional;
        if (phaseIntegral !== this.phaseIntegral) {
            this.phaseIntegral = phaseIntegral;
            this.randomValue = getFloat();
        }
        this.value_ = this.value();

        this.delayPhase = sample * this.delayIncrement[0];
        if (this.delayPhase > 0.5) {
            const sampleAdjusted = sample - 0.5 / this.delayIncrement[0];
            this.delayPhase = 0.5 + sampleAdjusted * this.delayIncrement[1];
            if (this.delayPhase >= 1.0) {
                this.delayPhase = 1.0;
            }
        }
    }

    /**
     * Calculates the current LFO value based on the waveform
     */
    value() {
        switch (this.waveform) {
            case Waveform.Triangle:
                return 2.0 * (this.phase < 0.5
                    ? 0.5 - this.phase
                    : this.phase - 0.5);
            case Waveform.RampDown:
                return 1.0 - this.phase;
            case Waveform.RampUp:
                return this.phase;
            case Waveform.Square:
                return this.phase < 0.5 ? 0.0 : 1.0;
            case Waveform.Sine:
                return 0.5 + 0.5 * sine(this.phase + 0.5);
            case Waveform.SAndH:
                return this.randomValue;
            default:
                return 0.0;
        }
    }

    /**
     * Returns the delay ramp value
     */
    delayRamp() {
        if (this.delayPhase < 0.5) {
            return 0.0;
        } else {
            return (this.delayPhase - 0.5) * 2.0;
        }
    }

    /**
     * Returns the pitch modulation amount
     */
    pitchMod() {
        return (this.value_ - 0.5) * this.delayRamp() * this.pitchModDepth;
    }

    /**
     * Returns the amplitude modulation amount
     */
    ampMod() {
        return (1.0 - this.value_) * this.delayRamp() * this.ampModDepth;
    }
}
