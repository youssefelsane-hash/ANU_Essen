/**
 * "Collect ELSANE" (الصانع): five different letters — E, L, S, A, N — spell the word; the first and last
 * tiles are both E, so one E lights both. One letter per completed order, never a repeat.
 */
export const ELSANE_WORD = 'ELSANE';
export const ELSANE_LETTERS = ['E', 'L', 'S', 'A', 'N'] as const;
/** The six tiles of the word, in order. */
export const ELSANE_TILES = ELSANE_WORD.split('');
