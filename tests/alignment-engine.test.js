const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../AlignmentEngine.js');
const matrices = require('../SubstitutionMatrices.js');

// Enumerate aligned strings directly, without a scoring matrix or traceback DP.
function allAlignments(side, top, i = 0, j = 0, a = '', b = '', output = []) {
    if (i === side.length && j === top.length) { output.push([a, b]); return output; }
    if (i < side.length && j < top.length) { allAlignments(side, top, i + 1, j + 1, a + side[i], b + top[j], output); }
    if (i < side.length) { allAlignments(side, top, i + 1, j, a + side[i], b + '-', output); }
    if (j < top.length) { allAlignments(side, top, i, j + 1, a + '-', b + top[j], output); }
    return output;
}
function scoreStrings(a, b, settings) {
    const config = { match: 1, mismatch: -1, gap: -2, gapOpen: -2, gapExtend: -1, ...settings };
    let total = 0, previous = 'pair';
    for (let i = 0; i < a.length; i++) {
        const type = a[i] === '-' ? 'sideGap' : b[i] === '-' ? 'topGap' : 'pair';
        if (type === 'pair') {
            total += config.substitution && config.substitution !== 'simple' ?
                matrices[config.substitution].scores[a[i]][b[i]] : a[i] === b[i] ? config.match : config.mismatch;
        } else {
            total += config.gapModel === 'affine' ?
                (previous === type ? config.gapExtend : config.gapOpen) : config.gap;
        }
        previous = type;
    }
    return total;
}
function strings(path, side, top) {
    let a = '', b = '';
    for (let i = path.length - 1; i > 0; i--) {
        const from = path[i], to = path[i - 1];
        a += to.y > from.y ? side[from.y] : '-';
        b += to.x > from.x ? top[from.x] : '-';
    }
    return [a, b];
}
function verify(side, top, settings) {
    const candidates = allAlignments(side, top);
    const scores = candidates.map(([a, b]) => scoreStrings(a, b, settings));
    const best = Math.max(...scores);
    const expected = new Set(candidates.filter((_, i) => Math.abs(scores[i] - best) < 1e-8).map(pair => pair.join('\n')));
    const model = Engine.create(side, top, settings, matrices);
    assert.ok(Math.abs(model.score - best) < 1e-8, `${side}/${top}: score`);
    assert.equal(model.count, BigInt(expected.size), `${side}/${top}: exact number of optimal alignments`);
    const actual = new Set();
    for (let rank = 0n; rank < model.count; rank++) {
        const path = model.traceback(rank);
        assert.equal(model.rankPath(path), rank, 'rank and traceback agree');
        const [a, b] = strings(path, side, top);
        assert.ok(Math.abs(scoreStrings(a, b, settings) - best) < 1e-8);
        actual.add([a, b].join('\n'));
    }
    assert.deepEqual(actual, expected, `${side}/${top}: every optimum exactly once`);
}

test('all short alignments agree with exhaustive enumeration for simple and affine gaps', () => {
    const sequences = ['', 'A', 'B', 'AA', 'AB', 'BA', 'BB', 'AAA', 'ABA', 'BAB'];
    const settings = [
        {}, { match: 0, mismatch: 0, gap: 0 }, { mismatch: -10, gap: -1 }, { gap: 2 },
        { gapModel: 'affine', gapOpen: -3, gapExtend: -1 },
        { gapModel: 'affine', gapOpen: -1, gapExtend: -4 },
        { gapModel: 'affine', gapOpen: 2, gapExtend: -1 },
        { gapModel: 'affine', gapOpen: 0, gapExtend: 0, match: 0, mismatch: 0 },
        { gapModel: 'affine', gapOpen: -1.1, gapExtend: -0.3, match: 0.7, mismatch: -0.4 }
    ];
    for (const config of settings) for (const side of sequences) for (const top of sequences) verify(side, top, config);
});

test('a contiguous affine gap is opened once and extended for the remaining letters', () => {
    const linear = Engine.create('AAAA', 'A', {}, matrices);
    const affine = Engine.create('AAAA', 'A', { gapModel: 'affine', gapOpen: -2, gapExtend: -1 }, matrices);
    assert.equal(linear.score, -5);
    assert.equal(linear.count, 4n);
    assert.equal(affine.score, -3);
    assert.equal(affine.count, 2n);
    assert.deepEqual(new Set([0n, 1n].map(i => strings(affine.traceback(i), 'AAAA', 'A').join('/'))),
        new Set(['AAAA/A---', 'AAAA/---A']));
});

test('all bundled substitution matrices have expected published entries and symmetric tables', () => {
    const expected = { BLOSUM45: [5, 15], BLOSUM50: [5, 15], BLOSUM62: [4, 11],
        BLOSUM80: [7, 16], BLOSUM90: [5, 11], PAM30: [6, 13], PAM70: [5, 13], PAM250: [2, 17] };
    assert.deepEqual(Object.keys(matrices), Object.keys(expected));
    assert.equal(matrices['NUC.4.4'], undefined);
    for (const [name, [aa, ww]] of Object.entries(expected)) {
        assert.equal(matrices[name].scores.A.A, aa, name + ': A/A reference value');
        assert.equal(matrices[name].scores.W.W, ww, name + ': W/W reference value');
    }
    assert.equal(matrices.BLOSUM62.scores.A.S, 1);
    for (const matrix of Object.values(matrices)) {
        for (const a of matrix.alphabet) for (const b of matrix.alphabet) assert.equal(matrix.scores[a][b], matrix.scores[b][a]);
    }
    for (const name of Object.keys(matrices)) {
        for (const gaps of [{}, { gapModel: 'affine', gapOpen: -3, gapExtend: -1 }]) {
            verify('ACG', 'AG', { substitution: name, ...gaps });
        }
    }
});

test('matrix direction uses Sequence 1 as the row and Sequence 2 as the column', () => {
    const library = { asymmetric: { scores: { A: { A: 2, B: 7 }, B: { A: -5, B: 3 } } } };
    assert.equal(Engine.create('A', 'B', { substitution: 'asymmetric', gap: -100 }, library).score, 7);
    assert.equal(Engine.create('B', 'A', { substitution: 'asymmetric', gap: -100 }, library).score, -5);
});

test('exponential ties are counted exactly and individual alignments can be selected directly', () => {
    const n = 50;
    const model = Engine.create('A'.repeat(n), 'A'.repeat(n), { match: 0, mismatch: 0, gap: 0 }, matrices);
    function choose(n, k) { let result = 1n; for (let i = 1; i <= k; i++) result = result * BigInt(n - i + 1) / BigInt(i); return result; }
    let expected = 0n;
    for (let k = 0; k <= n; k++) expected += choose(n, k) * choose(n + k, k);
    assert.equal(model.count, expected);
    assert.ok(model.count > BigInt(Number.MAX_SAFE_INTEGER));
    for (const rank of [0n, 1n, model.count / 2n, model.count - 1n]) {
        const path = model.traceback(rank);
        assert.equal(model.rankPath(path), rank);
        assert.equal(scoreStrings(...strings(path, 'A'.repeat(n), 'A'.repeat(n)), { match: 0, gap: 0 }), 0);
    }
});

test('unsupported matrix characters and non-optimal paths are rejected explicitly', () => {
    assert.throws(() => Engine.create('J', 'A', { substitution: 'BLOSUM62' }, matrices), /Sequence 1, position 1/);
    const model = Engine.create('A', 'A', {}, matrices);
    assert.equal(model.rankPath([{ x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0 }]), null);
    assert.throws(() => model.traceback(-1), /Invalid/);
    assert.throws(() => model.traceback(model.count), /Invalid/);
    assert.deepEqual(model.options(0, 0), []);
});
