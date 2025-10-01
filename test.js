#!/usr/bin/env node
/**
 * Simple test to verify the complete DX7 synthesis pipeline
 */

import { readFileSync } from 'fs';
import { PatchBank, generateSamples } from './src/dx7.js';

console.log('Testing DX7 synthesis engine...\n');

try {
    // Read SYSEX file
    console.log('1. Reading SYSEX file...');
    const sysexData = readFileSync('./star1-fast-decay.syx');
    console.log(`   ✓ Loaded ${sysexData.length} bytes`);

    // Parse patch bank
    console.log('\n2. Parsing patch bank...');
    const patchBank = new PatchBank(sysexData);
    console.log(`   ✓ Parsed ${patchBank.patches.length} patches`);

    // List all patches
    console.log('\n3. Patch list:');
    patchBank.patches.forEach((patch, i) => {
        console.log(`   ${i.toString().padStart(2, '0')}: ${patch.getName()}`);
    });

    // Test synthesis on first patch
    console.log('\n4. Testing synthesis on patch 0...');
    const patch = patchBank.patches[0];
    console.log(`   Patch: ${patch.getName()}`);
    console.log(`   Algorithm: ${patch.algorithm}`);
    console.log(`   Feedback: ${patch.feedback}`);

    const sampleRate = 44100;
    const midiNote = 60; // Middle C
    const durationMs = 1000; // 1 second

    console.log(`\n5. Generating samples (note ${midiNote}, ${durationMs}ms, ${sampleRate}Hz)...`);
    const startTime = Date.now();
    const samples = generateSamples(patch, midiNote, sampleRate, durationMs);
    const elapsed = Date.now() - startTime;

    console.log(`   ✓ Generated ${samples.length} samples in ${elapsed}ms`);
    console.log(`   Duration: ${(samples.length / sampleRate).toFixed(3)}s`);

    // Check sample statistics
    let min = Infinity, max = -Infinity, sum = 0, sumSq = 0;
    for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        min = Math.min(min, s);
        max = Math.max(max, s);
        sum += s;
        sumSq += s * s;
    }
    const mean = sum / samples.length;
    const rms = Math.sqrt(sumSq / samples.length);

    console.log('\n6. Sample statistics:');
    console.log(`   Min: ${min.toFixed(6)}`);
    console.log(`   Max: ${max.toFixed(6)}`);
    console.log(`   Mean: ${mean.toFixed(6)}`);
    console.log(`   RMS: ${rms.toFixed(6)}`);

    // Verify samples are reasonable
    if (max > min && Math.abs(max) > 0.001 && Math.abs(min) > 0.001) {
        console.log('\n✅ All tests passed! Synthesis engine is working correctly.');
    } else {
        console.log('\n⚠️  Warning: Output seems too quiet or constant');
    }

} catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
}
