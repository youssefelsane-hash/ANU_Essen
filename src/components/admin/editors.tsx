'use client';

import { useMemo, useState, useId } from 'react';
import { useLanguage } from '@/components/language-provider';
import { labels, localizeMessage } from '@/lib/i18n';
import { WEEKDAY_NAMES_EN, WEEKDAY_NAMES_AR, type WeeklyHours } from '@/lib/domain/hours';
import { prepMinutesForLoad, loadLevel, queueConfigSchema, type QueueConfig } from '@/lib/domain/queue';

type Cell = string | number | boolean | undefined;
export type Row = Record<string, Cell>;
export interface Column {
  key: string;
  label: string;
  type: 'text' | 'number' | 'checkbox';
  placeholder?: string;
  dir?: 'ltr' | 'rtl';
  width?: string;
}

/** Editable table that submits its rows as JSON in a hidden field (used for variants / addons). */
export function RowsEditor({ name, columns, initial, blank, addLabel }: { name: string; columns: Column[]; initial: Row[]; blank: Row; addLabel?: string }) {
  const { t } = useLanguage();
  const [rows, setRows] = useState<Row[]>(initial);
  const update = (i: number, key: string, value: Cell) => setRows((r) => r.map((row, j) => (j === i ? { ...row, [key]: value } : row)));
  const move = (i: number, d: -1 | 1) =>
    setRows((r) => {
      const j = i + d;
      if (j < 0 || j >= r.length) return r;
      const copy = [...r];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  return (
    <div className="space-y-2">
      <input type="hidden" name={name} value={JSON.stringify(rows)} />
      {rows.length > 0 && (
        <div className="overflow-x-auto"><table className="table min-w-[480px]">
          <thead>
            <tr>
              {columns.map((c) => <th key={c.key} style={{ width: c.width }}>{c.label}</th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key}>
                    {c.type === 'checkbox' ? (
                      <input type="checkbox" aria-label={`${c.label} ${i + 1}`} checked={!!row[c.key]} onChange={(e) => update(i, c.key, e.target.checked)} />
                    ) : (
                      <input
                        className="input py-1"
                        aria-label={`${c.label} ${i + 1}`}
                        dir={c.dir}
                        inputMode={c.type === 'number' ? 'decimal' : undefined}
                        placeholder={c.placeholder}
                        value={String(row[c.key] ?? '')}
                        onChange={(e) => update(i, c.key, e.target.value)}
                      />
                    )}
                  </td>
                ))}
                <td className="whitespace-nowrap">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => move(i, -1)} aria-label={`${t('تحريك لأعلى', 'Move up')} ${i + 1}`}>↑</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => move(i, 1)} aria-label={`${t('تحريك لأسفل', 'Move down')} ${i + 1}`}>↓</button>
                  <button type="button" className="btn btn-ghost btn-sm text-red-600" onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>{t('حذف', 'Remove')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRows((r) => [...r, { ...blank }])}>+ {addLabel || t('إضافة صف', 'Add row')}</button>
    </div>
  );
}

export function HoursEditor({ name, initial }: { name: string; initial: WeeklyHours | null }) {
  const { locale, t } = useLanguage();
  const prefix = useId();
  const [alwaysOpen, setAlwaysOpen] = useState(initial === null);
  const [days, setDays] = useState<WeeklyHours>(initial ?? Array.from({ length: 7 }, () => ({ open: '10:00', close: '02:00' })));
  const value = alwaysOpen ? null : days;
  return (
    <div className="space-y-2">
      <input type="hidden" name={name} value={JSON.stringify(value)} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={alwaysOpen} onChange={(e) => setAlwaysOpen(e.target.checked)} />
        {t('بدون مواعيد محددة — افتح وأوقف الطلبات يدويًا', 'No schedule — open and pause ordering manually')}
      </label>
      {!alwaysOpen && (
        <div className="grid gap-1">
          {days.map((d, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-24 font-medium">{(locale === 'ar' ? WEEKDAY_NAMES_AR : WEEKDAY_NAMES_EN)[i]}</span>
              <label className="flex items-center gap-1">
                <input type="checkbox" aria-label={`${t('يعمل', 'Open')} — ${(locale === 'ar' ? WEEKDAY_NAMES_AR : WEEKDAY_NAMES_EN)[i]}`} checked={d !== null} onChange={(e) => setDays((all) => all.map((x, j) => (j === i ? (e.target.checked ? { open: '10:00', close: '02:00' } : null) : x)))} />
                {t('يعمل', 'Open')}
              </label>
              {d && (
                <>
                  <input id={`${prefix}-open-${i}`} aria-label={`${t("وقت الفتح", "Opening time")} ${(locale === "ar" ? WEEKDAY_NAMES_AR : WEEKDAY_NAMES_EN)[i]}`} type="time" className="input w-32 py-1" value={d.open} onChange={(e) => setDays((all) => all.map((x, j) => (j === i && x ? { ...x, open: e.target.value } : x)))} />
                  <span>→</span>
                  <input id={`${prefix}-close-${i}`} aria-label={`${t("وقت الإغلاق", "Closing time")} ${(locale === "ar" ? WEEKDAY_NAMES_AR : WEEKDAY_NAMES_EN)[i]}`} type="time" className="input w-32 py-1" value={d.close} onChange={(e) => setDays((all) => all.map((x, j) => (j === i && x ? { ...x, close: e.target.value } : x)))} />
                  {d.close <= d.open && <span className="text-xs text-gray-500">{t('(يغلق بعد منتصف الليل)', '(Closes after midnight)')}</span>}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const NUM_FIELDS: { key: keyof QueueConfig; ar: string; en: string; helpAr: string; helpEn: string; advanced?: boolean }[] = [
  { key: 'basePrepMinutes', ar: 'أقل وقت للتحضير — دقيقة', en: 'Minimum preparation — minutes', helpAr: 'الوقت الذي يحتاجه أي طلب', helpEn: 'Minimum time needed for an order' },
  { key: 'deliveryMinutes', ar: 'وقت التوصيل — دقيقة', en: 'Delivery time — minutes', helpAr: 'من المطعم إلى مكان الاستلام', helpEn: 'From the restaurant to pickup' },
  { key: 'maxActiveOrders', ar: 'أقصى طلبات في المطبخ', en: 'Maximum kitchen orders', helpAr: 'صفر يعني بلا حد', helpEn: 'Zero means unlimited' },
  { key: 'overflowStepUnits', ar: 'كل جهد إضافي قدره', en: 'Extra load step', helpAr: 'بعد آخر مستوى من الزحمة', helpEn: 'Beyond the last capacity rule', advanced: true },
  { key: 'overflowStepMinutes', ar: 'يزيد الوقت بمقدار — دقيقة', en: 'Add this many minutes', helpAr: 'لكل خطوة جهد إضافية', helpEn: 'For each extra load step', advanced: true },
  { key: 'busyAtLoad', ar: 'تظهر زحمة عند جهد', en: 'Show busy at load', helpAr: 'متى يرى العميل أن المطبخ مشغول', helpEn: 'When customers see the kitchen is busy', advanced: true },
  { key: 'heavyAtLoad', ar: 'تظهر زحمة شديدة عند جهد', en: 'Show heavy rush at load', helpAr: 'متى يرى العميل أن الضغط شديد', helpEn: 'When customers see a heavy rush', advanced: true },
  { key: 'maxAcceptedLoad', ar: 'أقصى جهد يقبله المطبخ', en: 'Maximum accepted load', helpAr: 'صفر يعني بلا حد', helpEn: 'Zero means unlimited', advanced: true },
];

/** Simple everyday inputs first, with the detailed capacity model available when needed. */
export function QueueEditor({ initial }: { initial: QueueConfig }) {
  const { locale, t } = useLanguage();
  const prefix = useId();
  const [cfg, setCfg] = useState<QueueConfig>(initial);
  const parsed = useMemo(() => queueConfigSchema.safeParse(cfg), [cfg]);
  const maxPreview = Math.max(100, ...cfg.capacityRules.map((r) => r.maxLoad + 20));
  const samples = Array.from({ length: 6 }, (_, i) => Math.round((maxPreview / 5) * i));
  const setNum = (key: keyof QueueConfig, v: string) => setCfg((c) => ({ ...c, [key]: Math.max(0, Math.trunc(Number(v) || 0)) }));
  const field = (f: typeof NUM_FIELDS[number]) => <label key={f.key} htmlFor={`${prefix}-${f.key}`}><span className="label">{t(f.ar, f.en)}</span><input id={`${prefix}-${f.key}`} className="input" inputMode="numeric" value={String(cfg[f.key])} onChange={(e) => setNum(f.key, e.target.value)} /><span className="mt-1 block text-xs text-gray-500">{t(f.helpAr, f.helpEn)}</span></label>;
  return <div className="space-y-5">
    <input type="hidden" name="config" value={JSON.stringify(cfg)} />
    <div className="grid gap-3 sm:grid-cols-3">{NUM_FIELDS.filter((f) => !f.advanced).map(field)}</div>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cfg.autoPause} onChange={(e) => setCfg((c) => ({ ...c, autoPause: e.target.checked }))} />{t('إيقاف الطلبات الجديدة تلقائيًا عندما يمتلئ المطبخ', 'Pause new orders automatically when the kitchen is full')}</label>
    <details className="admin-details admin-form-section">
      <summary>{t('إعدادات الزحمة المتقدمة', 'Advanced rush settings')}</summary>
      <div className="grid gap-6 pt-4 lg:grid-cols-2">
        <div className="space-y-5"><p className="text-xs leading-relaxed text-gray-500">{t('جهد التحضير هو مجموع جهد الأصناف في الطلبات المؤكدة أو التي تُحضر. مثلًا: ساندويتش = 1، وجبة = 2.', 'Kitchen load is the total preparation effort in confirmed and preparing orders. For example: sandwich = 1, meal = 2.')}</p>
          <div className="grid gap-3 sm:grid-cols-2">{NUM_FIELDS.filter((f) => f.advanced).map(field)}</div>
          <div><h3 className="mb-2 font-semibold">{t('الوقت حسب ضغط المطبخ', 'Time by kitchen load')}</h3><table className="table"><thead><tr><th>{t('الجهد حتى', 'Load up to')}</th><th>{t('دقائق التحضير', 'Prep minutes')}</th><th /></tr></thead><tbody>{cfg.capacityRules.map((r, i) => <tr key={i}>
            <td><input aria-label={`${t('الجهد للمستوى', 'Load for rule')} ${i + 1}`} className="input py-1" inputMode="numeric" value={r.maxLoad} onChange={(e) => setCfg((c) => ({ ...c, capacityRules: c.capacityRules.map((x, j) => j === i ? { ...x, maxLoad: Math.max(0, Math.trunc(Number(e.target.value) || 0)) } : x) }))} /></td>
            <td><input aria-label={`${t('دقائق المستوى', 'Minutes for rule')} ${i + 1}`} className="input py-1" inputMode="numeric" value={r.prepMinutes} onChange={(e) => setCfg((c) => ({ ...c, capacityRules: c.capacityRules.map((x, j) => j === i ? { ...x, prepMinutes: Math.max(0, Math.trunc(Number(e.target.value) || 0)) } : x) }))} /></td>
            <td><button type="button" className="btn btn-ghost btn-sm text-red-600" onClick={() => setCfg((c) => ({ ...c, capacityRules: c.capacityRules.filter((_, j) => j !== i) }))}>{t('حذف', 'Remove')}</button></td>
          </tr>)}</tbody></table><button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => setCfg((c) => { const last = c.capacityRules.at(-1); return { ...c, capacityRules: [...c.capacityRules, { maxLoad: (last?.maxLoad ?? 0) + 10, prepMinutes: (last?.prepMinutes ?? c.basePrepMinutes) + 2 }] }; })}>{t('+ إضافة مستوى', '+ Add rule')}</button></div>
        </div>
        <div><h3 className="mb-2 font-semibold">{t('معاينة وقت طلب جديد', 'Preview a new order time')}</h3><table className="table"><thead><tr><th>{t('الجهد الحالي', 'Active load')}</th><th>{t('تحضير', 'Prep')}</th><th>{t('الوقت للعميل', 'Customer time')}</th><th>{t('ضغط المطبخ', 'Kitchen level')}</th></tr></thead><tbody>{samples.map((load) => { const prep = prepMinutesForLoad(load + 1, cfg); return <tr key={load}><td>{load}</td><td>{prep} {t('دقيقة', 'min')}</td><td className="font-bold">{prep + cfg.deliveryMinutes} {t('دقيقة', 'min')}</td><td>{labels(locale).loadLevel[loadLevel(load, cfg)]}</td></tr>; })}</tbody></table></div>
      </div>
    </details>
    {!parsed.success && <p className="text-sm text-red-600" role="alert">{localizeMessage(parsed.error.issues[0]?.message || '', locale) === parsed.error.issues[0]?.message ? t('راجع القيم: رتب مستويات الضغط تصاعديًا واستخدم أرقامًا صحيحة.', 'Check the values: capacity rules must increase and use valid numbers.') : localizeMessage(parsed.error.issues[0]?.message || '', locale)}</p>}
  </div>;
}
