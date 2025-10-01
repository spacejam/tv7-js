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
 * DX7 patch data structures
 */

/** Size of SysEx patch data */
export const SYX_SIZE = 128;

const BANK_PATCHES = 32;

const HEADER_BANK = new Uint8Array([0xF0, 0x43, 0x00, 0x09, 0x20, 0x00]);

/** DX6 voice bank (32 voices = 32 * 128 bytes packed + 2 bytes checksum) */
export const BULK_FULL_SYSEX_SIZE = 4104;

/**
 * DX7 envelope parameters (4-stage)
 */
export class OpEnvelope {
    constructor() {
        /** Rate for each of the 4 envelope stages */
        this.rate = new Uint8Array([99, 99, 99, 99]);
        /** Level for each of the 4 envelope stages */
        this.level = new Uint8Array([99, 99, 99, 0]);
    }
}

/**
 * DX7 pitch envelope parameters (4-stage)
 */
export class PitchEnvelope {
    constructor() {
        /** Rate for each of the 4 envelope stages */
        this.rate = new Uint8Array([99, 99, 99, 99]);
        /** Level for each of the 4 envelope stages */
        this.level = new Uint8Array([50, 50, 50, 50]);
    }
}

/**
 * Keyboard scaling parameters
 */
export class KeyboardScaling {
    constructor() {
        /** Break point key (0-99) */
        this.breakPoint = 0;
        /** Depth of scaling on the left side of break point */
        this.leftDepth = 0;
        /** Depth of scaling on the right side of break point */
        this.rightDepth = 0;
        /** Curve type for left side (0-3) */
        this.leftCurve = 0;
        /** Curve type for right side (0-3) */
        this.rightCurve = 0;
    }
}

/**
 * DX7 operator parameters
 */
export class Operator {
    constructor() {
        /** Amplitude envelope */
        this.envelope = new OpEnvelope();
        /** Keyboard scaling settings */
        this.keyboardScaling = new KeyboardScaling();
        /** Rate scaling (0-7) */
        this.rateScaling = 0;
        /** Amplitude modulation sensitivity (0-3) */
        this.ampModSensitivity = 0;
        /** Velocity sensitivity (0-7) */
        this.velocitySensitivity = 0;
        /** Output level (0-99) */
        this.level = 0;
        /** Oscillator mode: 0 = ratio, 1 = fixed frequency */
        this.mode = 0;
        /** Coarse frequency multiplier (0-31) */
        this.coarse = 0;
        /** Fine frequency adjustment (0-99, multiplies frequency by 1 + 0.01 * fine) */
        this.fine = 0;
        /** Detune amount (0-14) */
        this.detune = 0;
    }
}

/**
 * LFO modulation parameters
 */
export class ModulationParameters {
    constructor() {
        /** LFO rate (0-99) */
        this.rate = 0;
        /** LFO delay (0-99) */
        this.delay = 0;
        /** Pitch modulation depth (0-99) */
        this.pitchModDepth = 0;
        /** Amplitude modulation depth (0-99) */
        this.ampModDepth = 0;
        /** Reset phase on note trigger */
        this.resetPhase = 0;
        /** LFO waveform (0-5) */
        this.waveform = 0;
        /** Pitch modulation sensitivity */
        this.pitchModSensitivity = 0;
    }
}

/**
 * Complete DX7 patch
 */
export class Patch {
    constructor() {
        /** Six operators (DX7 has 6 operators) */
        this.op = Array.from({ length: 6 }, () => new Operator());
        /** Pitch envelope */
        this.pitchEnvelope = new PitchEnvelope();
        /** Algorithm number (0-31) */
        this.algorithm = 31;
        /** Feedback amount (0-7) */
        this.feedback = 0;
        /** Reset oscillator phases on note trigger */
        this.resetPhase = 0;
        /** LFO/modulation parameters */
        this.modulations = new ModulationParameters();
        /** Transpose value (0-48) */
        this.transpose = 0;
        /** Patch name (10 characters) */
        this.name = new Array(10).fill(' ');
        /** Active operators bitmask */
        this.activeOperators = 0x3f; // All 6 operators active
    }

    /**
     * Returns the name of the Patch as a trimmed String
     */
    getName() {
        return this.name.join('').trim();
    }

    /**
     * Set the 1-offset operator number corresponding to DX7 patches
     * Internally this is mapped to a 0-offset reverse ordered sequence
     */
    setOp(idx, operator) {
        if (idx < 1 || idx > 6) {
            throw new Error('Invalid operator index. Must be between 1 and 6 inclusive');
        }

        // 6 -> 0, 5 -> 1, 4 -> 2, 3 -> 3, 2 -> 4, 1 -> 5
        const actualIdx = 6 - idx;
        this.op[actualIdx] = operator;
    }

    /**
     * Creates a new patch from SYSEX bytes
     */
    static fromBytes(data) {
        const patch = new Patch();
        patch.unpack(data);
        return patch;
    }

    /**
     * Unpacks a DX7 SysEx patch from raw bytes
     */
    unpack(data) {
        if (data.length !== SYX_SIZE) {
            throw new Error(`Patch data not exactly ${SYX_SIZE} bytes long`);
        }

        // Unpack the 6 operators
        for (let i = 0; i < 6; i++) {
            const o = this.op[i];
            const opData = data.slice(i * 17);

            // Envelope rates and levels
            for (let j = 0; j < 4; j++) {
                o.envelope.rate[j] = Math.min(opData[j] & 0x7f, 99);
                o.envelope.level[j] = Math.min(opData[4 + j] & 0x7f, 99);
            }

            // Keyboard scaling
            o.keyboardScaling.breakPoint = Math.min(opData[8] & 0x7f, 99);
            o.keyboardScaling.leftDepth = Math.min(opData[9] & 0x7f, 99);
            o.keyboardScaling.rightDepth = Math.min(opData[10] & 0x7f, 99);
            o.keyboardScaling.leftCurve = opData[11] & 0x3;
            o.keyboardScaling.rightCurve = (opData[11] >> 2) & 0x3;

            // Other operator parameters
            o.rateScaling = opData[12] & 0x7;
            o.ampModSensitivity = opData[13] & 0x3;
            o.velocitySensitivity = (opData[13] >> 2) & 0x7;
            o.level = Math.min(opData[14] & 0x7f, 99);
            o.mode = opData[15] & 0x1;
            o.coarse = (opData[15] >> 1) & 0x1f;
            o.fine = Math.min(opData[16] & 0x7f, 99);
            o.detune = Math.min((opData[12] >> 3) & 0xf, 14);
        }

        // Pitch envelope
        for (let j = 0; j < 4; j++) {
            this.pitchEnvelope.rate[j] = Math.min(data[102 + j] & 0x7f, 99);
            this.pitchEnvelope.level[j] = Math.min(data[106 + j] & 0x7f, 99);
        }

        // Global parameters
        this.algorithm = data[110] & 0x1f;
        this.feedback = data[111] & 0x7;
        this.resetPhase = (data[111] >> 3) & 0x1;

        // Modulation parameters
        this.modulations.rate = Math.min(data[112] & 0x7f, 99);
        this.modulations.delay = Math.min(data[113] & 0x7f, 99);
        this.modulations.pitchModDepth = Math.min(data[114] & 0x7f, 99);
        this.modulations.ampModDepth = Math.min(data[115] & 0x7f, 99);
        this.modulations.resetPhase = data[116] & 0x1;
        this.modulations.waveform = Math.min((data[116] >> 1) & 0x7, 5);
        this.modulations.pitchModSensitivity = data[116] >> 4;

        this.transpose = Math.min(data[117] & 0x7f, 48);

        // Patch name
        for (let i = 0; i < 10; i++) {
            this.name[i] = String.fromCharCode(data[118 + i] & 0x7f);
        }

        this.activeOperators = 0x3f; // All operators active by default
    }
}

/**
 * A bank of 32 DX7 patches parsed from sysex
 */
export class PatchBank {
    /**
     * Parse a bank of 32 patches from a single SYSEX file's data
     */
    constructor(data) {
        if (data.length !== BULK_FULL_SYSEX_SIZE) {
            throw new Error(
                `Currently only support parsing banks with exactly 32 patches, which must be ${BULK_FULL_SYSEX_SIZE} bytes exactly`
            );
        }

        // Check header
        for (let i = 0; i < 6; i++) {
            if (data[i] !== HEADER_BANK[i]) {
                throw new Error('Sysex header is not correct');
            }
        }

        /** The array of 32 patches */
        this.patches = [];

        const patchData = data.slice(6);

        for (let idx = 0; idx < BANK_PATCHES; idx++) {
            const start = idx * SYX_SIZE;
            const end = (idx + 1) * SYX_SIZE;
            const patch = Patch.fromBytes(patchData.slice(start, end));
            this.patches.push(patch);
        }
    }
}
