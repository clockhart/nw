# Needleman-Wunsch

An interactive global-alignment demo adapted from [drdrsh/Needleman-Wunsch](https://github.com/drdrsh/Needleman-Wunsch) by Chris Lockhart for GMU course BINF 401.

Run locally with `python3 -m http.server 8765`, then open <http://localhost:8765/>. No build step is required.

## Scoring

**Scoring function** toggles a floating live panel on the right, with independent choices for letter pairs and gaps. Opening and closing it preserves the workspace's size, position, and scroll offsets. The panel uses the empty margin when available and stays within the viewport on smaller screens.

- Letter pairs: simple match/mismatch values or protein substitution matrices. The BLOSUM family includes 45, 50, 62, 80, and 90; the PAM family includes 30, 70, and 250.
- Gaps: one simple score per gap character, or affine gap creation and extension scores. A run of length `n` scores `creation + (n - 1) * extension`, using the convention described in the [Biopython alignment documentation](https://biopython.org/docs/latest/Tutorial/chapter_pairwise.html#affine-gap-scores).

Valid edits update the matrix, alignment, and optimal-alignment count immediately. Numeric typing has a short delay; incomplete numbers or unsupported symbols retain the last valid scoring settings with inline feedback. Closing the panel (or pressing Escape within it) keeps valid changes. Matrix and alignment scroll positions, and any manually selected path, are preserved while scores change. The defaults remain match `+1`, mismatch `-1`, and simple gap `-2`.

## Traceback and alternatives

The grid displays the maximum of the paired-letter, gap-in-Sequence-1, and gap-in-Sequence-2 states. Affine traceback retains the state history, including when an optimal complete path passes through a state below that cell's displayed maximum. Hover explanations distinguish these cases and show gap opening versus extension.

If more than one complete optimal alignment exists, the Alignment header shows **Next alignment**, a previous control, and an index/count. Counts use `BigInt`; selecting another alignment follows the counted traceback branches directly without enumerating every alignment. Large counts are abbreviated visually, with the exact count in the control's accessible label and title. Ties outside optimal complete tracebacks do not enable the controls.

**Clear path** starts manual path building. The selected path is scored with the same substitution and gap rules, and a partial path charges its first selected gap as a creation. **Compute** restores the first optimal alignment. Alternative controls remain hidden while a manual path is being edited.

Opposite gap directions may occur consecutively; changing direction starts a new gap. This preserves the original linear Needleman–Wunsch behavior when affine creation and extension scores are equal. Floating-point tie comparisons use a tolerance of `1e-9`. Computing and rendering the full grid grows with the product of the sequence lengths.

## Substitution matrix data

The following standard tables are bundled in [SubstitutionMatrices.js](SubstitutionMatrices.js), with the source headers retained as metadata:

- BLOSUM: [45](https://github.com/biopython/biopython/blob/master/Bio/Align/substitution_matrices/data/BLOSUM45), [50](https://github.com/biopython/biopython/blob/master/Bio/Align/substitution_matrices/data/BLOSUM50), [62](https://github.com/biopython/biopython/blob/master/Bio/Align/substitution_matrices/data/BLOSUM62), [80](https://github.com/biopython/biopython/blob/master/Bio/Align/substitution_matrices/data/BLOSUM80), [90](https://github.com/biopython/biopython/blob/master/Bio/Align/substitution_matrices/data/BLOSUM90).
- PAM: [30](https://github.com/biopython/biopython/blob/master/Bio/Align/substitution_matrices/data/PAM30), [70](https://github.com/biopython/biopython/blob/master/Bio/Align/substitution_matrices/data/PAM70), [250](https://github.com/biopython/biopython/blob/master/Bio/Align/substitution_matrices/data/PAM250).

These files come from the official Biopython repository. Its source license is included in [third_party/BIOPYTHON_LICENSE.rst](third_party/BIOPYTHON_LICENSE.rst). Scoring does not fetch matrix data at runtime. The page retains its existing jQuery CDN dependency.

## Verification

Run `node --test tests/alignment-engine.test.js`.

The tests compare scores, counts, and every optimal traceback against direct exhaustive enumeration for short sequences under simple, affine, matrix, fractional, zero, and positive gap scores. They also check large exact counts, direct alignment selection, matrix orientation, and invalid alphabets. Browser verification covers live input validation, all scoring combinations, alternate navigation, manual paths, scrolling, hover explanations, and phone layouts.

