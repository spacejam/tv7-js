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
 * FM algorithms and routing structures
 */

import { renderOperators } from './operator.js';

const NUM_OPERATORS = 6;
const NUM_ALGORITHMS = 32;

// Opcode flag constants
const DESTINATION_MASK = 0x03;
const SOURCE_MASK = 0x30;
const SOURCE_FEEDBACK = 0x30;
const ADDITIVE_FLAG = 0x04;
const FEEDBACK_SOURCE_FLAG = 0x40;

// Helper functions for opcode construction (translated from C++ macros)
function modFlags(n) {
    return n << 4;
}

function addFlags(n) {
    return n | ADDITIVE_FLAG;
}

function outFlags(n) {
    return n;
}

const FB_SRC = FEEDBACK_SOURCE_FLAG;
const FB_DST = modFlags(3);
const FB = FB_SRC | FB_DST;
const NO_MOD = modFlags(0);
const OUTPUT = addFlags(0);

/**
 * Store information about all FM algorithms, and which functions to call
 * to render them.
 */
export class Algorithms {
    /**
     * Creates and initializes a new algorithm manager
     */
    constructor() {
        this.renderCalls = Array.from({ length: NUM_ALGORITHMS }, () =>
            Array.from({ length: NUM_OPERATORS }, () => new RenderCall())
        );
        this.init();
    }

    /**
     * Initializes all algorithms by compiling their opcodes
     */
    init() {
        for (let i = 0; i < NUM_ALGORITHMS; i++) {
            this.compile(i);
        }
    }

    /**
     * Returns the render call for a specific algorithm and operator
     */
    renderCall(algorithm, op) {
        return this.renderCalls[algorithm][op];
    }

    /**
     * Checks if an operator is a modulator (not a carrier)
     */
    isModulator(algorithm, op) {
        return (OPCODES_6[algorithm][op] & DESTINATION_MASK) !== 0;
    }

    compile(algorithm) {
        const opcodes = OPCODES_6[algorithm];
        let i = 0;

        while (i < NUM_OPERATORS) {
            const opcode = opcodes[i];
            let n = 1;

            // Try to chain operators together
            while (i + n < NUM_OPERATORS) {
                const from = opcodes[i + n - 1];
                const to = (opcodes[i + n] & SOURCE_MASK) >> 4;

                const hasAdditive = (from & ADDITIVE_FLAG) !== 0;
                const broken = (from & DESTINATION_MASK) !== to;

                if (hasAdditive || broken) {
                    if (to === (opcode & DESTINATION_MASK)) {
                        n = 1;
                    }
                    break;
                }
                n += 1;
            }

            // Try to find if a pre-compiled renderer is available for this chain
            for (let attempt = 0; attempt < 2; attempt++) {
                const outOpcode = opcodes[i + n - 1];
                const additive = (outOpcode & ADDITIVE_FLAG) !== 0;

                let modulationSource = -3;
                if ((opcode & SOURCE_MASK) === 0) {
                    modulationSource = -1;
                } else if ((opcode & SOURCE_MASK) !== SOURCE_FEEDBACK) {
                    modulationSource = -2;
                } else {
                    for (let j = 0; j < n; j++) {
                        if ((opcodes[i + j] & FEEDBACK_SOURCE_FLAG) !== 0) {
                            modulationSource = j;
                        }
                    }
                }

                const renderFn = this.getRenderer(n, modulationSource, additive);
                if (renderFn !== null) {
                    this.renderCalls[algorithm][i] = new RenderCall(
                        renderFn,
                        n,
                        (opcode & SOURCE_MASK) >> 4,
                        outOpcode & DESTINATION_MASK
                    );
                    break;
                } else if (n > 1) {
                    n = 1;
                }
            }
            i += n;
        }
    }

    getRenderer(n, modulationSource, additive) {
        for (const specs of RENDERERS_6) {
            if (specs.n === 0) {
                break;
            }
            if (specs.n === n
                && specs.modulationSource === modulationSource
                && specs.additive === additive) {
                return specs.renderFn;
            }
        }
        return null;
    }
}

/**
 * Information about a render call for an operator or chain of operators
 */
export class RenderCall {
    constructor(renderFn = null, n = 0, inputIndex = 0, outputIndex = 0) {
        /** Function to render the operators */
        this.renderFn = renderFn || renderOperators(1, -1, false);
        /** Number of operators in this chain */
        this.n = n;
        /** Index of the input buffer (modulation source) */
        this.inputIndex = inputIndex;
        /** Index of the output buffer (destination) */
        this.outputIndex = outputIndex;
    }
}

class RendererSpecs {
    constructor(n, modulationSource, additive, renderFn) {
        this.n = n;
        this.modulationSource = modulationSource;
        this.additive = additive;
        this.renderFn = renderFn;
    }
}

// 6-operator opcodes (DX7)
const OPCODES_6 = [
    [FB | outFlags(1), modFlags(1) | outFlags(1), modFlags(1) | outFlags(1), modFlags(1) | OUTPUT, NO_MOD | outFlags(1), modFlags(1) | addFlags(0)],
    [NO_MOD | outFlags(1), modFlags(1) | outFlags(1), modFlags(1) | outFlags(1), modFlags(1) | OUTPUT, FB | outFlags(1), modFlags(1) | addFlags(0)],
    [FB | outFlags(1), modFlags(1) | outFlags(1), modFlags(1) | OUTPUT, NO_MOD | outFlags(1), modFlags(1) | outFlags(1), modFlags(1) | addFlags(0)],
    [FB_DST | NO_MOD | outFlags(1), modFlags(1) | outFlags(1), FB_SRC | modFlags(1) | OUTPUT, NO_MOD | outFlags(1), modFlags(1) | outFlags(1), modFlags(1) | addFlags(0)],
    [FB | outFlags(1), modFlags(1) | OUTPUT, NO_MOD | outFlags(1), modFlags(1) | addFlags(0), NO_MOD | outFlags(1), modFlags(1) | addFlags(0)],
    [FB_DST | NO_MOD | outFlags(1), FB_SRC | modFlags(1) | OUTPUT, NO_MOD | outFlags(1), modFlags(1) | addFlags(0), NO_MOD | outFlags(1), modFlags(1) | addFlags(0)],
    [FB | outFlags(1), modFlags(1) | outFlags(1), NO_MOD | addFlags(1), modFlags(1) | OUTPUT, NO_MOD | outFlags(1), modFlags(1) | addFlags(0)],
    [NO_MOD | outFlags(1), modFlags(1) | outFlags(1), FB | addFlags(1), modFlags(1) | OUTPUT, NO_MOD | outFlags(1), modFlags(1) | addFlags(0)],
    [NO_MOD | outFlags(1), modFlags(1) | outFlags(1), NO_MOD | addFlags(1), modFlags(1) | OUTPUT, FB | outFlags(1), modFlags(1) | addFlags(0)],
    [NO_MOD | outFlags(1), NO_MOD | addFlags(1), modFlags(1) | OUTPUT, FB | outFlags(1), modFlags(1) | outFlags(1), modFlags(1) | addFlags(0)],
    [FB | outFlags(1), NO_MOD | addFlags(1), modFlags(1) | OUTPUT, NO_MOD | outFlags(1), modFlags(1) | outFlags(1), modFlags(1) | addFlags(0)],
    [NO_MOD | outFlags(1), NO_MOD | addFlags(1), NO_MOD | addFlags(1), modFlags(1) | OUTPUT, FB | outFlags(1), modFlags(1) | addFlags(0)],
    [FB | outFlags(1), NO_MOD | addFlags(1), NO_MOD | addFlags(1), modFlags(1) | OUTPUT, NO_MOD | outFlags(1), modFlags(1) | addFlags(0)],
    [FB | outFlags(1), NO_MOD | addFlags(1), modFlags(1) | outFlags(1), modFlags(1) | OUTPUT, NO_MOD | outFlags(1), modFlags(1) | addFlags(0)],
    [NO_MOD | outFlags(1), NO_MOD | addFlags(1), modFlags(1) | outFlags(1), modFlags(1) | OUTPUT, FB | outFlags(1), modFlags(1) | addFlags(0)],
    [FB | outFlags(1), modFlags(1) | outFlags(1), NO_MOD | outFlags(2), modFlags(2) | addFlags(1), NO_MOD | addFlags(1), modFlags(1) | OUTPUT],
    [NO_MOD | outFlags(1), modFlags(1) | outFlags(1), NO_MOD | outFlags(2), modFlags(2) | addFlags(1), FB | addFlags(1), modFlags(1) | OUTPUT],
    [NO_MOD | outFlags(1), modFlags(1) | outFlags(1), modFlags(1) | outFlags(1), FB | addFlags(1), NO_MOD | addFlags(1), modFlags(1) | OUTPUT],
    [FB | outFlags(1), modFlags(1) | OUTPUT, modFlags(1) | addFlags(0), NO_MOD | outFlags(1), modFlags(1) | outFlags(1), modFlags(1) | addFlags(0)],
    [NO_MOD | outFlags(1), NO_MOD | addFlags(1), modFlags(1) | OUTPUT, FB | outFlags(1), modFlags(1) | addFlags(0), modFlags(1) | addFlags(0)],
    [NO_MOD | outFlags(1), modFlags(1) | OUTPUT, modFlags(1) | addFlags(0), FB | outFlags(1), modFlags(1) | addFlags(0), modFlags(1) | addFlags(0)],
    [FB | outFlags(1), modFlags(1) | OUTPUT, modFlags(1) | addFlags(0), modFlags(1) | addFlags(0), NO_MOD | outFlags(1), modFlags(1) | addFlags(0)],
    [FB | outFlags(1), modFlags(1) | OUTPUT, modFlags(1) | addFlags(0), NO_MOD | outFlags(1), modFlags(1) | addFlags(0), NO_MOD | addFlags(0)],
    [FB | outFlags(1), modFlags(1) | OUTPUT, modFlags(1) | addFlags(0), modFlags(1) | addFlags(0), NO_MOD | addFlags(0), NO_MOD | addFlags(0)],
    [FB | outFlags(1), modFlags(1) | OUTPUT, modFlags(1) | addFlags(0), NO_MOD | addFlags(0), NO_MOD | addFlags(0), NO_MOD | addFlags(0)],
    [FB | outFlags(1), NO_MOD | addFlags(1), modFlags(1) | OUTPUT, NO_MOD | outFlags(1), modFlags(1) | addFlags(0), NO_MOD | addFlags(0)],
    [NO_MOD | outFlags(1), NO_MOD | addFlags(1), modFlags(1) | OUTPUT, FB | outFlags(1), modFlags(1) | addFlags(0), NO_MOD | addFlags(0)],
    [NO_MOD | OUTPUT, FB | outFlags(1), modFlags(1) | outFlags(1), modFlags(1) | addFlags(0), NO_MOD | outFlags(1), modFlags(1) | addFlags(0)],
    [FB | outFlags(1), modFlags(1) | OUTPUT, NO_MOD | outFlags(1), modFlags(1) | addFlags(0), NO_MOD | addFlags(0), NO_MOD | addFlags(0)],
    [NO_MOD | OUTPUT, FB | outFlags(1), modFlags(1) | outFlags(1), modFlags(1) | addFlags(0), NO_MOD | addFlags(0), NO_MOD | addFlags(0)],
    [FB | outFlags(1), modFlags(1) | OUTPUT, NO_MOD | addFlags(0), NO_MOD | addFlags(0), NO_MOD | addFlags(0), NO_MOD | addFlags(0)],
    [FB | OUTPUT, NO_MOD | addFlags(0), NO_MOD | addFlags(0), NO_MOD | addFlags(0), NO_MOD | addFlags(0), NO_MOD | addFlags(0)],
];

// 6-operator renderers
const RENDERERS_6 = [
    new RendererSpecs(1, -2, false, renderOperators(1, -2, false)),
    new RendererSpecs(1, -2, true, renderOperators(1, -2, true)),
    new RendererSpecs(1, -1, false, renderOperators(1, -1, false)),
    new RendererSpecs(1, -1, true, renderOperators(1, -1, true)),
    new RendererSpecs(1, 0, false, renderOperators(1, 0, false)),
    new RendererSpecs(1, 0, true, renderOperators(1, 0, true)),
    new RendererSpecs(3, 2, true, renderOperators(3, 2, true)),
    new RendererSpecs(2, 1, true, renderOperators(2, 1, true)),
    new RendererSpecs(0, 0, false, renderOperators(1, -1, false)),
];
