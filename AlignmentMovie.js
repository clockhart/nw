/* A seekable teaching timeline built from the alignment engine's actual scores
 * and state-aware traceback. Frames are generated on demand, including for
 * large matrices; playback does not build a second dynamic-programming table.
 */
var AlignmentMovie = (function () {
    'use strict';
    function create(engine, rank) {
        rank = BigInt(rank === undefined || rank === null ? 0 : rank);
        var width = engine.top.length, height = engine.side.length;
        var fillCount = (width + 1) * (height + 1);
        var path = engine.traceback(rank);
        var total = fillCount + path.length;
        var suffixScores = [0];
        var format = function (n) { return String(Number(n.toFixed(8))); };
        for (var i = 1; i < path.length; i++) {
            var to = path[i - 1], from = path[i];
            suffixScores[i] = suffixScores[i - 1] + engine.stepScore(to.state, from.state, to.x, to.y);
        }

        function cellAt(index) {
            if (!Number.isInteger(index) || index < 0 || index >= fillCount) { throw new RangeError('Invalid movie cell index.'); }
            if (index <= width) { return engine.cell(index, 0); }
            if (index <= width + height) { return engine.cell(0, index - width); }
            var offset = index - width - height - 1;
            return engine.cell(offset % width + 1, Math.floor(offset / width) + 1);
        }
        function cellIndex(x, y) {
            if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x > width || y > height) {
                throw new RangeError('Invalid movie cell coordinates.');
            }
            return !y ? x : !x ? width + y : width + height + (y - 1) * width + x;
        }
        function frame(index) {
            if (!Number.isInteger(index) || index < 0 || index >= total) { throw new RangeError('Invalid movie frame.'); }
            var result = { index: index, total: total, revealed: Math.min(index + 1, fillCount),
                path: [], candidates: [], sources: [], goalScore: engine.score, rank: rank };
            if (index < fillCount) {
                var cell = cellAt(index), boundary = !cell.x || !cell.y;
                result.phase = boundary ? 'Initialize' : 'Fill matrix';
                result.cell = cell;
                result.heading = 'Row ' + cell.y + ' \u00b7 Column ' + cell.x;
                result.candidates = engine.options(cell.x, cell.y);
                result.sources = result.candidates.map(function (option) { return { x: option.fromX, y: option.fromY }; });
                if (!cell.x && !cell.y) {
                    result.description = 'Start at 0: both sequence prefixes are empty.';
                    result.reason = 'First initialize the top row and left column, then fill the interior row by row.';
                } else if (boundary) {
                    var n = cell.x || cell.y;
                    result.description = 'An empty Sequence ' + (cell.x ? '1' : '2') +
                        ' prefix must align to ' + n + (n === 1 ? ' gap.' : ' gaps.');
                    result.reason = engine.config.gapModel === 'affine' ?
                        'Open the first gap, then extend the same run: ' + format(engine.config.gapOpen) +
                            ' + ' + (n - 1) + ' \u00d7 ' + format(engine.config.gapExtend) + ' = ' + format(cell.score) + '.' :
                        'Add the gap score once per letter: ' + n + ' \u00d7 ' + format(engine.config.gap) + ' = ' + format(cell.score) + '.';
                } else {
                    var a = engine.side[cell.y - 1], b = engine.top[cell.x - 1];
                    result.description = 'Compare Seq 1 ' + a + ' with Seq 2 ' + b + '. ' +
                        (engine.config.substitution === 'simple' ? (a === b ? 'Match' : 'Mismatch') : engine.config.substitution) +
                        ' score: ' + format(engine.pairScore(a, b)) + '.';
                    var winners = result.candidates.filter(function (option) { return engine.equal(option.score, cell.score); });
                    result.reason = 'Keep the highest score: ' + format(cell.score) + '. ' +
                        (winners.length > 1 ? winners.length + ' moves tie; keep all their arrows for traceback.' :
                            winners[0].label.slice(2) + ' wins.');
                    if (engine.config.gapModel === 'affine') {
                        result.reason += ' Each gap candidate compares opening a run with extending one.';
                    }
                }
                return result;
            }

            var step = index - fillCount;
            var current = path[step];
            result.phase = step === path.length - 1 ? 'Complete' : 'Traceback';
            result.cell = engine.cell(current.x, current.y);
            result.path = path.slice(0, step + 1);
            result.suffixScore = suffixScores[step];
            result.prefixScore = result.cell.states[current.state].score;
            result.heading = step === path.length - 1 ? 'Alignment complete' :
                'Traceback \u00b7 Row ' + current.y + ', column ' + current.x;
            if (!step) {
                result.description = 'The matrix is filled. Start at the bottom-right cell: ' + format(engine.score) +
                    ' is the best score for both complete sequences.';
                result.reason = 'Follow the selected optimal path backward. Each move adds a column to the front of the alignment below.';
            } else {
                var destination = path[step - 1], direction = destination.state;
                var contribution = engine.stepScore(direction, current.state, destination.x, destination.y);
                var operation = direction === 'd' ?
                    'Pair ' + engine.side[destination.y - 1] + ' with ' + engine.top[destination.x - 1] :
                    'Align ' + (direction === 'u' ? engine.side[destination.y - 1] : engine.top[destination.x - 1]) +
                        ' to a gap in Seq ' + (direction === 'u' ? '2' : '1');
                if (direction !== 'd' && engine.config.gapModel === 'affine') {
                    operation += current.state === direction ? ' (gap extension)' : ' (gap creation)';
                }
                result.description = operation + '. Add this column to the front of the alignment.';
                result.sources = [{ x: destination.x, y: destination.y }];
                var transitionScore = result.prefixScore + contribution;
                result.candidates = [{ direction: direction,
                    label: { d: '\u2196 Diagonal', u: '\u2191 Up', s: '\u2190 Left' }[direction],
                    fromX: current.x, fromY: current.y, score: transitionScore,
                    variants: [{ label: 'Chosen step', state: current.state, previous: result.prefixScore,
                        delta: contribution, score: transitionScore }] }];
                result.reason = 'Remaining prefix ' + format(result.prefixScore) + ' + aligned suffix ' +
                    format(result.suffixScore) + ' = ' + format(engine.score) + '.';
                if (engine.config.gapModel === 'affine' && !engine.equal(transitionScore,
                    engine.cell(destination.x, destination.y).score)) {
                    result.reason += ' This traceback keeps its gap-state history even where that state is below the displayed cell maximum.';
                }
                if (step === path.length - 1) {
                    result.description = 'Reached the origin. Both complete sequences are now aligned, with score ' + format(engine.score) + '.';
                }
            }
            return result;
        }
        return { total: total, fillCount: fillCount, rank: rank, frame: frame, cellAt: cellAt, cellIndex: cellIndex };
    }
    return { create: create };
}());
if (typeof module !== 'undefined' && module.exports) { module.exports = AlignmentMovie; }
