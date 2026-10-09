import { describe, expect, it } from 'vitest';
import { looksLikeUrl, slugify } from '@/lib/domain/misc';

describe('menu link name', () => {
  it('rejects pasted image or web addresses', () => {
    expect(looksLikeUrl('https://i.ibb.co/wNHF70G4/Whats-App-Image-2026-10-07.jpg')).toBe(true);
    expect(looksLikeUrl('www.example.com')).toBe(true);
    expect(looksLikeUrl('photo.png')).toBe(true);
    expect(looksLikeUrl('al-raya')).toBe(false);
    expect(looksLikeUrl('Al Raya Al Dimashqia')).toBe(false);
    expect(slugify('Al Raya')).toBe('al-raya');
  });
});
