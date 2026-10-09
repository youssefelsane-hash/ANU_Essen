'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Copy, CheckCheck, Gift, Sparkles } from 'lucide-react';
import { useLanguage } from '@/components/language-provider';
import { MY_ORDERS_KEY, readJson, type SavedOrder } from '@/client/storage';
import { ELSANE_LETTERS, ELSANE_TILES } from '@/lib/domain/loyalty';
import { formatDateTime, formatMoney } from '@/lib/domain/misc';
import type { LoyaltyGame } from '@/lib/types';
import './elsane.css';

function lettersLeft(n: number, t: (ar: string, en: string) => string) {
  if (n <= 0) return t('الكلمة كاملة!', 'Word complete!');
  if (n === 1) return t('فاضلك حرف واحد بس!', 'Just one letter to go!');
  if (n === 2) return t('فاضلك حرفين.', 'Two letters to go.');
  return t(`فاضلك ${n} حروف.`, `${n} letters to go.`);
}

/** The six tiles of E-L-S-A-N-E; collected letters light up, the newest one flips in. */
export function ElsaneTiles({ letters, fresh, size = 'md' }: { letters: string[]; fresh?: string | null; size?: 'sm' | 'md' }) {
  const { t } = useLanguage();
  return (
    <div className={`elsane-tiles is-${size}`} dir="ltr" role="img" aria-label={t(`جمعت ${letters.length} من ${ELSANE_LETTERS.length} حروف`, `${letters.length} of ${ELSANE_LETTERS.length} letters collected`)}>
      {ELSANE_TILES.map((l, i) => {
        const on = letters.includes(l);
        return <span key={i} className={`elsane-tile ${on ? 'is-on' : ''} ${on && fresh === l ? 'is-fresh' : ''}`}>{on ? l : '?'}</span>;
      })}
    </div>
  );
}

function VoucherCode({ code, amount, expiresAt, slug }: { code: string; amount: number; expiresAt: number; slug?: string }) {
  const { t, locale } = useLanguage();
  const [copied, setCopied] = useState(false);
  return (
    <div className="elsane-voucher">
      <div>
        <small>{t('كود الخصم', 'Discount code')} · {formatMoney(amount, locale)}</small>
        <b dir="ltr">{code}</b>
        {expiresAt > 0 && <small>{t('صالح لحد ', 'Valid until ')}{formatDateTime(expiresAt, 'Africa/Cairo', locale)}</small>}
      </div>
      <div className="flex flex-col gap-2">
        <button type="button" className="btn btn-secondary btn-sm" onClick={async () => { try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* user can copy by hand */ } }}>
          {copied ? <CheckCheck size={14} /> : <Copy size={14} />}{copied ? t('اتنسخ', 'Copied') : t('نسخ', 'Copy')}
        </button>
        {slug && <Link href={`/s/${slug}/checkout`} className="btn btn-primary btn-sm">{t('استخدمه', 'Use it')}</Link>}
      </div>
    </div>
  );
}

/** Tracking page: what this order means for the customer's ELSANE card. */
export function ElsaneOrderCard({ game, slug }: { game: LoyaltyGame; slug: string }) {
  const { t, locale } = useLanguage();
  const reward = formatMoney(game.reward, locale);
  const voucher = game.vouchers[0];
  if (game.completedWord) {
    return (
      <section className="elsane-card is-win" aria-live="polite">
        <div className="elsane-confetti" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <span key={i} style={{ ['--i' as string]: i }} />)}</div>
        <p className="elsane-kicker"><Sparkles size={16} /> {t('جمعت الكلمة!', 'You spelled it!')}</p>
        <ElsaneTiles letters={[...ELSANE_LETTERS]} fresh={game.earned} />
        <h2>{t('مبروك! كسبت خصم ', 'Congrats! You won ')}{reward}{t('', ' off')}</h2>
        <p>{t('استخدم الكود في طلبك الجاي من المطعم ده بنفس رقم موبايلك.', 'Use the code on your next order from this restaurant with the same mobile number.')}</p>
        {voucher && <VoucherCode {...voucher} slug={slug} />}
      </section>
    );
  }
  if (!game.enabled && !game.earned) return null;
  return (
    <section className="elsane-card" aria-live="polite">
      <p className="elsane-kicker"><Gift size={16} /> {t('اجمع ELSANE', 'Collect ELSANE')}</p>
      <ElsaneTiles letters={game.letters} fresh={game.earned} />
      {game.earned
        ? <h2>{t('كسبت حرف ', 'You won the letter ')}<span dir="ltr" className="elsane-letter">{game.earned}</span>{t('!', '!')}</h2>
        : game.pending
          ? <h2>{t('الطلب ده هيكسبك حرف أول ما تستلمه 🎁', 'This order wins you a letter once you receive it 🎁')}</h2>
          : <h2>{t('اطلب من المطعم ده واجمع الحروف', 'Order from this restaurant to collect letters')}</h2>}
      <p>{lettersLeft(ELSANE_LETTERS.length - game.letters.length, t)}{t(' كل طلب بيوصلك = حرف جديد، والكلمة كاملة = خصم ', ' Every delivered order = a new letter; the full word = ')}{reward}{t('.', ' off.')}{game.minOrder > 0 ? t(` (للطلبات من ${formatMoney(game.minOrder, locale)})`, ` (orders from ${formatMoney(game.minOrder, locale)})`) : ''}</p>
      {voucher && <VoucherCode {...voucher} slug={slug} />}
    </section>
  );
}

/** Latest saved order of this restaurant on this phone: it proves who the customer is (bearer token). */
function useSavedGame(slug: string) {
  const [state, setState] = useState<LoyaltyGame | null>(null);
  useEffect(() => {
    const saved = readJson<SavedOrder[]>(MY_ORDERS_KEY, []);
    const latest = Array.isArray(saved) ? saved.find((o) => o?.slug === slug && /^[A-Za-z0-9_-]{16,64}$/.test(o.token ?? '')) : undefined;
    if (!latest) return;
    const ctrl = new AbortController();
    fetch(`/api/public/orders/${latest.token}/loyalty`, { cache: 'no-store', signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.loyalty) setState(data.loyalty as LoyaltyGame); })
      .catch(() => {});
    return () => ctrl.abort();
  }, [slug]);
  return state;
}

/** Menu banner: explains the game and shows this phone's progress / prize. */
export function ElsaneMenuBanner({ slug, reward, minOrder }: { slug: string; reward: number; minOrder: number }) {
  const { t, locale } = useLanguage();
  const game = useSavedGame(slug);
  const letters = game?.letters ?? [];
  const voucher = game?.vouchers[0];
  return (
    <section className="elsane-card is-banner">
      <div className="min-w-0 flex-1">
        <p className="elsane-kicker"><Gift size={16} /> {t('لعبة ELSANE', 'The ELSANE game')}</p>
        <h2>{voucher ? t('عندك خصم ', 'You have ') + formatMoney(voucher.amount, locale) + t(' مستنيك!', ' off waiting!') : t('اجمع حروف ELSANE واكسب خصم ', 'Collect E-L-S-A-N-E and win ') + formatMoney(reward, locale)}</h2>
        <p>{voucher ? t('هيتحط لك في صفحة الدفع بضغطة.', 'Apply it at checkout with one tap.') : t('كل طلب بيوصلك من المطعم ده = حرف. خمس حروف وتكسب.', 'Every delivered order here = one letter. Five letters and you win.')}{minOrder > 0 && !voucher ? t(` الطلب من ${formatMoney(minOrder, locale)} وأكتر.`, ` Orders from ${formatMoney(minOrder, locale)}.`) : ''}</p>
      </div>
      <ElsaneTiles letters={letters} size="sm" />
    </section>
  );
}

/** Checkout: offer the customer's own prize code. */
export function ElsaneCheckoutOffer({ slug, applied, onApply }: { slug: string; applied: string | null; onApply: (code: string) => void }) {
  const { t, locale } = useLanguage();
  const game = useSavedGame(slug);
  const voucher = game?.vouchers[0];
  if (!voucher || applied === voucher.code) return null;
  return (
    <div className="elsane-offer">
      <Gift size={18} aria-hidden="true" />
      <span className="flex-1">{t('عندك خصم ELSANE بـ ', 'You have an ELSANE discount of ')}<b>{formatMoney(voucher.amount, locale)}</b></span>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => onApply(voucher.code)}>{t('استخدمه', 'Use it')}</button>
    </div>
  );
}
