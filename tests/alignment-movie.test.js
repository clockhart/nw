const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../AlignmentEngine.js');
const Movie = require('../AlignmentMovie.js');
const matrices = require('../SubstitutionMatrices.js');

test('every matrix cell is revealed once, after all of its dependencies', () => {
    for (const [side, top] of [['ABC', 'AB'], ['', 'ABC'], ['ABC', ''], ['', '']]) {
        const engine = Engine.create(side, top);
        const plan = Movie.create(engine);
        const seen = new Set();
        assert.equal(plan.fillCount, (side.length + 1) * (top.length + 1));
        for (let i = 0; i < plan.fillCount; i++) {
            const f = plan.frame(i), { x, y } = f.cell;
            assert.equal(plan.cellIndex(x, y), i, 'cell-to-frame mapping is reversible');
            assert.equal(f.revealed, i + 1);
            assert.ok(!seen.has(`${x},${y}`), 'no cell is repeated');
            for (const from of f.sources) assert.ok(seen.has(`${from.x},${from.y}`), 'every candidate source has already been explained');
            if (x && y) {
                for (const [dx, dy] of [[-1, 0], [0, -1], [-1, -1]]) assert.ok(seen.has(`${x + dx},${y + dy}`));
                assert.equal(f.phase, 'Fill matrix');
                assert.equal(Math.max(...f.candidates.map(c => c.score)), f.cell.score);
            } else assert.equal(f.phase, 'Initialize');
            seen.add(`${x},${y}`);
        }
        assert.equal(seen.size, plan.fillCount);
        assert.equal(plan.frame(plan.fillCount).path.length, 1, 'traceback starts only after the entire grid is visible');
        assert.equal(plan.frame(plan.total - 1).phase, 'Complete');
    }
});

test('initialization explains the configured simple or affine gap costs', () => {
    for (const gapModel of ['simple', 'affine']) {
        const engine = Engine.create('AAA', 'AA', { gapModel, gap: -3, gapOpen: -5, gapExtend: -1 });
        const movie = Movie.create(engine);
        assert.equal(movie.frame(0).cell.score, 0);
        assert.match(movie.frame(0).description, /both sequence prefixes are empty/);
        const boundary = movie.frame(movie.cellIndex(0, 3));
        assert.equal(boundary.cell.score, gapModel === 'affine' ? -7 : -9);
        assert.match(boundary.reason, gapModel === 'affine' ? /Open.*extend/ : /once per letter/);
    }
});

test('traceback frames retain exact states and reconcile prefix and suffix scores', () => {
    const configurations = [
        {}, { match: 0, mismatch: 0, gap: 0 },
        { gapModel: 'affine', gapOpen: -2, gapExtend: -1 },
        { match: 2, mismatch: -2, gapModel: 'affine', gapOpen: -1, gapExtend: -4 },
        { match: 0.7, mismatch: -0.4, gapModel: 'affine', gapOpen: -1.1, gapExtend: -0.3 },
        { substitution: 'BLOSUM62', gapModel: 'affine', gapOpen: -10, gapExtend: -1 }
    ];
    for (const config of configurations) {
        for (const [a, b] of [['AAAA', 'A'], ['ABAB', 'AABA'], ['HEAGAWGHEE', 'PAWHEAE']]) {
            const engine = Engine.create(a, b, config, matrices);
            for (const rank of new Set([0n, engine.count / 2n, engine.count - 1n])) {
                const movie = Movie.create(engine, rank);
                const path = engine.traceback(rank);
                for (let step = 0; step < path.length; step++) {
                    const f = movie.frame(movie.fillCount + step);
                    assert.deepEqual(f.path, path.slice(0, step + 1));
                    assert.equal(f.revealed, movie.fillCount);
                    assert.ok(engine.equal(f.prefixScore + f.suffixScore, engine.score), 'affine gap history is retained while revealing the aligned suffix');
                    for (const candidate of f.candidates) for (const variant of candidate.variants) {
                        assert.ok(engine.equal(variant.previous + variant.delta, candidate.score));
                    }
                }
                const last = movie.frame(movie.total - 1);
                assert.equal(last.phase, 'Complete');
                assert.ok(engine.equal(last.suffixScore, engine.score));
                assert.deepEqual(last.path.at(-1), { x: 0, y: 0, state: 'd' });
            }
        }
    }
});

test('ties and matrix scores are explained from actual candidate values', () => {
    const tied = Movie.create(Engine.create('AA', 'AA', { match: 0, gap: 0 }));
    assert.match(tied.frame(tied.cellIndex(1, 1)).reason, /3 moves tie/);
    const protein = Movie.create(Engine.create('W', 'A', { substitution: 'BLOSUM62' }, matrices));
    const f = protein.frame(protein.cellIndex(1, 1));
    assert.match(f.description, /BLOSUM62 score: -3/);
    assert.equal(f.candidates.find(c => c.direction === 'd').score, -3);
});

test('affine traceback explains a chosen state below the displayed cell maximum', () => {
    const engine = Engine.create('AB', 'AAA', { match: 2, mismatch: -5,
        gapModel: 'affine', gapOpen: -3, gapExtend: -1 });
    const movie = Movie.create(engine);
    const extension = movie.frame(movie.fillCount + 1);
    assert.equal(extension.suffixScore, -1);
    assert.match(extension.description, /gap extension/);
    const conditional = movie.frame(movie.fillCount + 2);
    assert.match(conditional.reason, /below the displayed cell maximum/);
    assert.equal(conditional.candidates[0].score, -4);
    assert.equal(engine.cell(2, 2).score, -3);
    assert.equal(conditional.prefixScore + conditional.suffixScore, engine.score);
});

test('large matrices can be sought directly without generating intermediate frames', () => {
    const engine = Engine.create('A'.repeat(100), 'A'.repeat(100));
    const plan = Movie.create(engine);
    const last = plan.frame(plan.total - 1);
    assert.equal(last.phase, 'Complete');
    assert.equal(last.path.length, 101);
    const middle = plan.frame(plan.cellIndex(50, 50));
    assert.equal(middle.cell.score, 50);
    assert.equal(plan.frame(0).revealed, 1, 'seeking back restores the initial frame');
    assert.throws(() => plan.frame(-1), RangeError);
    assert.throws(() => plan.frame(plan.total), RangeError);
    assert.throws(() => plan.frame(1.5), RangeError);
    assert.throws(() => plan.cellIndex(101, 0), RangeError);
    assert.throws(() => Movie.create(engine, engine.count), /Invalid/);
});
