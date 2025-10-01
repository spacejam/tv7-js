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

/**
 * DX7 SYSEX patch bank parser and audio sample generator
 *
 * This is a JavaScript port of the Rust dx7 library which itself is a port
 * of the Mutable Instruments Plaits DX7/FM synthesis engine.
 */

import { PatchBank, Patch } from './fm/patch.js';
import { Voice } from './fm/voice.js';
import { Lfo } from './fm/lfo.js';

export { PatchBank, Patch };

/**
 * Number of operators for DX7
 */
const NUM_OPERATORS = 6;

/**
 * Number of algorithms for DX7
 */
const NUM_ALGORITHMS = 32;

/**
 * Generate audio samples for a patch
 * @param {Patch} patch - The DX7 patch
 * @param {number} midiNote - MIDI note number (60 = C4)
 * @param {number} sampleRate - Sample rate in Hz
 * @param {number} durationMs - Duration in milliseconds
 * @returns {Float32Array} - Array of audio samples
 */
export function generateSamples(patch, midiNote, sampleRate, durationMs) {
    const MAX_BLOCK_SIZE = 24; // Match C++ implementation
    const nSamples = Math.floor((durationMs / 1000) * sampleRate);
    const silenceThreshold = 0.0001;
    const silenceDurationSamples = Math.floor((sampleRate * 100) / 1000); // 100ms

    const voice = new Voice(patch, sampleRate);
    const lfo = new Lfo();
    lfo.init(sampleRate);
    lfo.set(patch.modulations);
    lfo.reset();

    const output = [];

    // Phase 1: Render with gate on for the requested duration
    const parameters = {
        gate: true,
        sustain: false,
        velocity: 1.0,
        note: midiNote,
        brightness: 0.5,
        envelopeControl: 0.5,
        pitchMod: 0.0,
        ampMod: 0.0,
    };

    let remaining = nSamples;
    while (remaining > 0) {
        const blockSize = Math.min(remaining, MAX_BLOCK_SIZE);

        // Step the LFO
        lfo.step(blockSize);

        // Apply LFO modulations to parameters
        parameters.pitchMod = lfo.pitchMod();
        parameters.ampMod = lfo.ampMod();

        const buf = new Float32Array(blockSize * 3); // render_temp needs 3x size
        voice.renderTemp(parameters, buf);

        // Extract the output (first blockSize samples)
        for (let i = 0; i < blockSize; i++) {
            output.push(buf[i]);
        }

        remaining -= blockSize;
    }

    // Phase 2: Turn gate off and render until 100ms of silence
    parameters.gate = false;
    let consecutiveSilentSamples = 0;

    while (true) {
        // Step the LFO
        lfo.step(MAX_BLOCK_SIZE);

        // Apply LFO modulations to parameters
        parameters.pitchMod = lfo.pitchMod();
        parameters.ampMod = lfo.ampMod();

        const chunk = new Float32Array(MAX_BLOCK_SIZE * 3);
        voice.renderTemp(parameters, chunk);

        // Check for silence in the rendered output
        for (let i = 0; i < MAX_BLOCK_SIZE; i++) {
            const sample = chunk[i];
            if (Math.abs(sample) < silenceThreshold) {
                consecutiveSilentSamples++;
            } else {
                consecutiveSilentSamples = 0;
            }
            output.push(sample);
        }

        // Check if we've accumulated enough silence
        if (consecutiveSilentSamples >= silenceDurationSamples) {
            // Truncate to end after the silence duration
            const truncateTo = Math.max(
                0,
                output.length - (consecutiveSilentSamples - silenceDurationSamples)
            );
            output.length = truncateTo;
            break;
        }

        // Safety limit: don't render more than 10 seconds total
        if (output.length > sampleRate * 10) {
            break;
        }
    }

    return new Float32Array(output);
}
