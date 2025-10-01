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
 * Multi-segment envelope generator
 *
 * Implements DX7-style envelopes with quirks like:
 * - Vaguely logarithmic shape for ascending segments
 * - Direct jump above a threshold for ascending segments
 * - Specific logic and rates for plateaus
 */

import { operatorEnvelopeIncrement, operatorLevel, pitchEnvelopeLevel, pitchEnvelopeIncrement } from './dx_units.js';

/** Sentinel value indicating to use the previous level */
const PREVIOUS_LEVEL = -100.0;

/**
 * Generic multi-segment envelope
 */
class Envelope {
    /**
     * Creates a new envelope
     * @param {number} numStages - Number of envelope stages
     * @param {boolean} reshapeAscending - Whether to reshape ascending segments
     */
    constructor(numStages, reshapeAscending) {
        this.numStages = numStages;
        this.reshapeAscending = reshapeAscending;
        this.stage = numStages - 1;
        this.phase = 1.0;
        this.start = 0.0;
        this.increment = new Float32Array(numStages);
        this.level = new Float32Array(numStages);
        this.scale = 1.0;

        // Initialize levels with decreasing defaults
        for (let i = 0; i < numStages; i++) {
            this.increment[i] = 0.001;
            this.level[i] = 1.0 / (1 << i);
        }
        this.level[numStages - 1] = 0.0;
    }

    /**
     * Initializes the envelope with a scale factor
     */
    init(scale) {
        this.scale = scale;
        this.stage = this.numStages - 1;
        this.phase = 1.0;
        this.start = 0.0;
        for (let i = 0; i < this.numStages; i++) {
            this.increment[i] = 0.001;
            this.level[i] = 1.0 / (1 << i);
        }
        this.level[this.numStages - 1] = 0.0;
    }

    /**
     * Directly sets increment and level arrays
     */
    set(increment, level) {
        for (let i = 0; i < this.numStages; i++) {
            this.increment[i] = increment[i];
            this.level[i] = level[i];
        }
    }

    /**
     * Renders envelope at a specific time (for "envelope scrubbing")
     */
    renderAtSample(t, gateDuration) {
        if (t > gateDuration) {
            // In release phase
            const phase = (t - gateDuration) * this.increment[this.numStages - 1];
            if (phase >= 1.0) {
                return this.level[this.numStages - 1];
            } else {
                const sustainValue = this.renderAtSample(gateDuration, gateDuration);
                return this.valueAt(this.numStages - 1, phase, sustainValue);
            }
        }

        // Find which stage we're in
        let stage = 0;
        let remainingTime = t;
        for (let i = 0; i < this.numStages - 1; i++) {
            const stageDuration = 1.0 / this.increment[i];
            if (remainingTime < stageDuration) {
                stage = i;
                break;
            }
            remainingTime -= stageDuration;
            stage = i + 1;
        }

        if (stage === this.numStages - 1) {
            remainingTime -= gateDuration;
            if (remainingTime <= 0.0) {
                return this.level[this.numStages - 2];
            } else if (remainingTime * this.increment[this.numStages - 1] > 1.0) {
                return this.level[this.numStages - 1];
            }
        }

        return this.valueAt(stage, remainingTime * this.increment[stage], PREVIOUS_LEVEL);
    }

    /**
     * Renders one sample of the envelope
     */
    render(gate) {
        return this.renderScaled(gate, 1.0, 1.0, 1.0);
    }

    /**
     * Renders one sample with rate and level scaling
     */
    renderScaled(gate, rate, adScale, releaseScale) {
        if (gate) {
            if (this.stage === this.numStages - 1) {
                // Trigger: move to attack stage
                this.start = this.value();
                this.stage = 0;
                this.phase = 0.0;
            }
        } else {
            if (this.stage !== this.numStages - 1) {
                // Release: move to release stage
                this.start = this.value();
                this.stage = this.numStages - 1;
                this.phase = 0.0;
            }
        }

        const scaleFactor = this.stage === this.numStages - 1 ? releaseScale : adScale;
        this.phase += this.increment[this.stage] * rate * scaleFactor;

        if (this.phase >= 1.0) {
            if (this.stage >= this.numStages - 2) {
                // Stay in sustain or release
                this.phase = 1.0;
            } else {
                // Move to next stage
                this.phase = 0.0;
                this.stage += 1;
            }
            this.start = PREVIOUS_LEVEL;
        }

        return this.value();
    }

    /**
     * Calculates current envelope value
     */
    value() {
        return this.valueAt(this.stage, this.phase, this.start);
    }

    /**
     * Calculates envelope value at a specific stage and phase
     */
    valueAt(stage, phase, startLevel) {
        let from = startLevel === PREVIOUS_LEVEL
            ? this.level[(stage + this.numStages - 1) % this.numStages]
            : startLevel;
        let to = this.level[stage];

        if (this.reshapeAscending && from < to) {
            from = Math.max(from, 6.7);
            to = Math.max(to, 6.7);
            phase *= (2.5 - phase) * 0.666667;
        }

        return phase * (to - from) + from;
    }
}

/**
 * Operator envelope with DX7-specific quirks (4 stages, reshaped ascending)
 */
export class OperatorEnvelope {
    /**
     * Creates a new operator envelope
     */
    constructor() {
        this.envelope = new Envelope(4, true);
    }

    /**
     * Initializes the envelope
     */
    init(scale) {
        this.envelope.init(scale);
    }

    /**
     * Configures the envelope from DX7 patch data
     */
    set(rate, level, globalLevel) {
        // Configure levels
        for (let i = 0; i < 4; i++) {
            let levelScaled = operatorLevel(level[i]);
            levelScaled = (levelScaled & ~1) + globalLevel - 133;
            this.envelope.level[i] =
                0.125 * (levelScaled < 1 ? 0.5 : levelScaled);
        }

        // Configure increments with DX7 quirks
        for (let i = 0; i < 4; i++) {
            let increment = operatorEnvelopeIncrement(rate[i]);
            const from = this.envelope.level[(i + 4 - 1) % 4];
            const to = this.envelope.level[i];

            if (from === to) {
                // Quirk: for plateaus, the increment is scaled
                increment *= 0.6;
                if (i === 0 && level[i] === 0) {
                    // Quirk: the attack plateau is faster
                    increment *= 20.0;
                }
            } else if (from < to) {
                const fromClamped = Math.max(from, 6.7);
                const toClamped = Math.max(to, 6.7);
                if (fromClamped === toClamped) {
                    // Quirk: because of the jump, the attack might disappear
                    increment = 1.0;
                } else {
                    // Quirk: because of the weird shape, the rate is adjusted
                    increment *= 7.2 / (toClamped - fromClamped);
                }
            } else {
                increment *= 1.0 / (from - to);
            }
            this.envelope.increment[i] = increment * this.envelope.scale;
        }
    }

    /**
     * Renders one sample
     */
    render(gate) {
        return this.envelope.render(gate);
    }

    /**
     * Renders one sample with scaling
     */
    renderScaled(gate, rate, adScale, releaseScale) {
        return this.envelope.renderScaled(gate, rate, adScale, releaseScale);
    }

    /**
     * Renders at a specific sample time (for envelope scrubbing)
     */
    renderAtSample(t, gateDuration) {
        return this.envelope.renderAtSample(t, gateDuration);
    }
}

/**
 * Pitch envelope (4 stages, no reshaping)
 */
export class PitchEnvelope {
    /**
     * Creates a new pitch envelope
     */
    constructor() {
        this.envelope = new Envelope(4, false);
    }

    /**
     * Initializes the envelope
     */
    init(scale) {
        this.envelope.init(scale);
    }

    /**
     * Configures the envelope from DX7 patch data
     */
    set(rate, level) {
        // Configure levels
        for (let i = 0; i < 4; i++) {
            this.envelope.level[i] = pitchEnvelopeLevel(level[i]);
        }

        // Configure increments
        for (let i = 0; i < 4; i++) {
            const from = this.envelope.level[(i + 4 - 1) % 4];
            const to = this.envelope.level[i];
            let increment = pitchEnvelopeIncrement(rate[i]);

            if (from !== to) {
                increment *= 1.0 / Math.abs(from - to);
            } else if (i !== 3) {
                increment = 0.2;
            }
            this.envelope.increment[i] = increment * this.envelope.scale;
        }
    }

    /**
     * Renders one sample
     */
    render(gate) {
        return this.envelope.render(gate);
    }

    /**
     * Renders one sample with scaling
     */
    renderScaled(gate, rate, adScale, releaseScale) {
        return this.envelope.renderScaled(gate, rate, adScale, releaseScale);
    }

    /**
     * Renders at a specific sample time (for envelope scrubbing)
     */
    renderAtSample(t, gateDuration) {
        return this.envelope.renderAtSample(t, gateDuration);
    }
}
