/**
 * tv7-js - Generate Tonverk-compatible multisample archives from DX7 patches
 *
 * This module handles:
 * - WAV file generation with multiple pitch samples
 * - .elmulti TOML configuration file generation
 * - ZIP archive creation containing both files
 */

import JSZip from 'jszip';
import { generateSamples } from './dx7.js';

/**
 * Sanitize name for Tonverk compatibility
 */
export function tonverkSanitize(input) {
    const allowedSymbols = ['~', '!', '@', '#', '$', '%', '^', '&', '(', ')', '_', '+', '-', '=', ' '];
    const allowedLetters = ['å', 'ß', 'ä', 'ö', 'ü', 'æ', 'ø', 'ç', 'ñ', 'Å', 'ẞ', 'Ä', 'Ö', 'Ü', 'Æ', 'Ø', 'Ç', 'Ñ'];

    return input
        .split('')
        .filter(c => {
            const code = c.charCodeAt(0);
            const isAsciiAlphanumeric = (code >= 48 && code <= 57) || // 0-9
                                        (code >= 65 && code <= 90) ||  // A-Z
                                        (code >= 97 && code <= 122);   // a-z
            return isAsciiAlphanumeric || allowedSymbols.includes(c) || allowedLetters.includes(c);
        })
        .join('')
        .trim();
}

/**
 * Generate WAV file data from audio samples
 * @param {Float32Array[]} pitchBuffers - Array of sample buffers for each pitch
 * @param {number} sampleRate - Sample rate in Hz
 * @returns {Uint8Array} - WAV file bytes
 */
export function generateWav(pitchBuffers, sampleRate) {
    // Find the longest buffer
    const maxLength = Math.max(...pitchBuffers.map(buf => buf.length));

    // Calculate total samples (each buffer padded to maxLength)
    const totalSamples = maxLength * pitchBuffers.length;

    // WAV file format:
    // RIFF header (12 bytes) + fmt chunk (24 bytes) + data chunk (8 bytes + data)
    const dataSize = totalSamples * 4; // 32-bit float = 4 bytes per sample
    const fileSize = 44 + dataSize;

    const buffer = new ArrayBuffer(fileSize);
    const view = new DataView(buffer);

    // RIFF header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, fileSize - 8, true);
    writeString(view, 8, 'WAVE');

    // fmt chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, 3, true);  // format = IEEE float
    view.setUint16(22, 1, true);  // channels = 1 (mono)
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 4, true); // byte rate
    view.setUint16(32, 4, true);  // block align
    view.setUint16(34, 32, true); // bits per sample

    // data chunk
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // Write samples
    let offset = 44;
    for (const pitchBuffer of pitchBuffers) {
        // Write actual samples
        for (let i = 0; i < pitchBuffer.length; i++) {
            view.setFloat32(offset, pitchBuffer[i], true);
            offset += 4;
        }
        // Pad with zeros to maxLength
        for (let i = pitchBuffer.length; i < maxLength; i++) {
            view.setFloat32(offset, 0.0, true);
            offset += 4;
        }
    }

    return new Uint8Array(buffer);
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

/**
 * Generate .elmulti TOML configuration
 * @param {string} name - Patch name
 * @param {Array<{pitch: number, start: number, end: number}>} zones - Key zone definitions
 * @returns {string} - TOML configuration text
 */
export function generateElmulti(name, zones) {
    let toml = `# ELEKTRON MULTI-SAMPLE MAPPING FORMAT
version = 0
name = '${name}'
`;

    zones.forEach((zone, index) => {
        const isLast = index === zones.length - 1;

        toml += `
[[key-zones]]
pitch = ${zone.pitch}
key-center = ${zone.pitch}.0

[[key-zones.velocity-layers]]
velocity = 0.9960785
strategy = 'Forward'

[[key-zones.velocity-layers.sample-slots]]
sample = '${name}.wav'
trim-start = ${zone.start}
`;

        if (!isLast) {
            toml += `trim-end = ${zone.end}\n`;
        }
    });

    return toml;
}

/**
 * Generate a Tonverk-compatible multisample archive
 * @param {Patch} patch - DX7 patch
 * @param {Array<number>} midiNotes - Array of MIDI note numbers to sample
 * @param {number} sampleRate - Sample rate in Hz
 * @param {number} durationMs - Key-on duration in milliseconds
 * @returns {Promise<Blob>} - ZIP file blob
 */
export async function generateMultisample(patch, midiNotes, sampleRate, durationMs) {
    const name = tonverkSanitize(patch.getName());

    // Use a Map to store buffers, keyed by MIDI note (mimics Rust's BTreeMap)
    const bufs = new Map();

    for (const midiNote of midiNotes) {
        let buf = generateSamples(patch, midiNote, sampleRate, durationMs);

        // Find peak amplitude for normalization (per-buffer, like Rust)
        let peak = 0.0;
        for (let i = 0; i < buf.length; i++) {
            const abs = Math.abs(buf[i]);
            if (abs > peak) peak = abs;
        }

        // Normalize to -1.0 to 1.0 range if needed, with headroom
        const normalizeFactor = peak > 0.8 ? 0.8 / peak : 1.0;
        for (let i = 0; i < buf.length; i++) {
            buf[i] *= normalizeFactor;
        }

        bufs.set(midiNote, buf);
    }

    // Find the longest buffer
    let maxLength = 0;
    for (const buf of bufs.values()) {
        if (buf.length > maxLength) maxLength = buf.length;
    }

    // Sort pitches in ascending order (mimics BTreeMap iteration order)
    const sortedPitches = Array.from(bufs.keys()).sort((a, b) => a - b);

    // Build ordered pitch buffers and zones
    const pitchBuffers = [];
    const zones = [];
    let runningSampleCount = 0;

    for (const pitch of sortedPitches) {
        const buf = bufs.get(pitch);
        pitchBuffers.push(buf);

        const start = runningSampleCount;
        const end = start + maxLength;
        runningSampleCount = end;

        zones.push({ pitch, start, end });
    }

    // Generate WAV file
    const wavData = generateWav(pitchBuffers, sampleRate);

    // Generate TOML file
    const tomlData = generateElmulti(name, zones);

    // Create ZIP archive
    const zip = new JSZip();
    const folder = zip.folder(name);
    folder.file(`${name}.wav`, wavData);
    folder.file(`${name}.elmulti`, tomlData);

    return await zip.generateAsync({ type: 'blob' });
}
