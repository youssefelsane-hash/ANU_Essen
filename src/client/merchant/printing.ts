import type { OrderSnapshot } from '@/lib/types';

/**
 * Printing integration layer. Today: the browser print dialog with thermal (80/58mm) CSS.
 * Silent auto-printing is impossible from a normal browser page (browser security), so for that
 * plug a driver here that talks to QZ Tray / PrintNode / a local print bridge using `receiptText()` —
 * the order system does not change.
 */
export interface PrintDriver {
  readonly name: string;
  print(order: OrderSnapshot): Promise<void>;
}

export type PaperWidth = '80' | '58';
const WIDTH_KEY = 'receipt:width';

export function getPaperWidth(): PaperWidth {
  try {
    return localStorage.getItem(WIDTH_KEY) === '58' ? '58' : '80';
  } catch {
    return '80';
  }
}

export function setPaperWidth(w: PaperWidth) {
  try {
    localStorage.setItem(WIDTH_KEY, w);
  } catch {
    /* ignore */
  }
}
