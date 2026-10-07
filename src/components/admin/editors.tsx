'use client';

import { useMemo, useState } from 'react';
import { WEEKDAY_NAMES_EN, type WeeklyHours } from '@/lib/domain/hours';
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
export function RowsEditor({ name, columns, initial, blank, addLabel = 'Add row' }: { name: string; columns: Column[]; initial: Row[]; blank: Row; addLabel?: string }) {
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
        <table className="table">
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
                      <input type="checkbox" checked={!!row[c.key]} onChange={(e) => update(i, c.key, e.target.checked)} />
                    ) : (
                      <input
                        className="input py-1"
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
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                  <button type="button" className="btn btn-ghost btn-sm text-red-600" onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRows((r) => [...r, { ...blank }])}>+ {addLabel}</button>
    </div>
  );
}

export function HoursEditor({ name, initial }: { name: string; initial: WeeklyHours | null }) {
  const [alwaysOpen, setAlwaysOpen] = useState(initial === null);
  const [days, setDays] = useState<WeeklyHours>(initial ?? Array.from({ length: 7 }, () => ({ open: '10:00', close: '02:00' })));
  const value = alwaysOpen ? null : days;
  return (
    <div className="space-y-2">
      <input type="hidden" name={name} value={JSON.stringify(value)} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={alwaysOpen} onChange={(e) => setAlwaysOpen(e.target.checked)} />
        No schedule (open whenever ordering status is OPEN)
      </label>
      {!alwaysOpen && (
        <div className="grid gap-1">
          {days.map((d, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-24 font-medium">{WEEKDAY_NAMES_EN[i]}</span>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={d !== null} onChange={(e) => setDays((all) => all.map((x, j) => (j === i ? (e.target.checked ? { open: '10:00', close: '02:00' } : null) : x)))} />
                open
              </label>
              {d && (
                <>
                  <input type="time" className="input w-32 py-1" value={d.open} onChange={(e) => setDays((all) => all.map((x, j) => (j === i && x ? { ...x, open: e.target.value } : x)))} />
                  <span>→</span>
                  <input type="time" className="input w-32 py-1" value={d.close} onChange={(e) => setDays((all) => all.map((x, j) => (j === i && x ? { ...x, close: e.target.value } : x)))} />
                  {d.close <= d.open && <span className="text-xs text-gray-500">(closes after midnight)</span>}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const NUM_FIELDS: { key: keyof QueueConfig; label: string; help: string }[] = [
  { key: 'basePrepMinutes', label: 'Base preparation (min)', help: 'Minimum prep time for any order' },
  { key: 'deliveryMinutes', label: 'Delivery to gate (min)', help: 'Shop → university gate' },
  { key: 'overflowStepUnits', label: 'Overflow step (load units)', help: 'Beyond the last rule, every N units…' },
  { key: 'overflowStepMinutes', label: 'Overflow step (+min)', help: '…adds this many minutes' },
  { key: 'busyAtLoad', label: 'Busy at load ≥', help: 'Shown as "Busy"' },
  { key: 'heavyAtLoad', label: 'Heavy rush at load ≥', help: 'Shown as "Heavy rush"' },
  { key: 'maxAcceptedLoad', label: 'Max accepted load (0 = ∞)', help: 'Pause new orders at this load' },
  { key: 'maxActiveOrders', label: 'Max kitchen orders (0 = ∞)', help: 'Pause new orders at this many orders' },
];

/** Queue / capacity configuration with a live preview of the ETA curve. */
export function QueueEditor({ initial }: { initial: QueueConfig }) {
  const [cfg, setCfg] = useState<QueueConfig>(initial);
  const parsed = useMemo(() => queueConfigSchema.safeParse(cfg), [cfg]);
  const maxPreview = Math.max(100, ...cfg.capacityRules.map((r) => r.maxLoad + 20));
  const samples = Array.from({ length: 11 }, (_, i) => Math.round((maxPreview / 10) * i));
  const setNum = (key: keyof QueueConfig, v: string) => setCfg((c) => ({ ...c, [key]: Math.max(0, Math.trunc(Number(v) || 0)) }));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <input type="hidden" name="config" value={JSON.stringify(cfg)} />
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {NUM_FIELDS.map((f) => (
            <div key={f.key}>
              <label className="label">{f.label}</label>
              <input className="input" inputMode="numeric" value={String(cfg[f.key])} onChange={(e) => setNum(f.key, e.target.value)} />
              <p className="mt-0.5 text-[11px] text-gray-500">{f.help}</p>
            </div>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={cfg.autoPause} onChange={(e) => setCfg((c) => ({ ...c, autoPause: e.target.checked }))} />
          Auto-pause new orders when a maximum is reached
        </label>
        <div>
          <h3 className="mb-2 font-semibold">Capacity rules</h3>
          <table className="table">
            <thead><tr><th>Load up to</th><th>Prep minutes</th><th /></tr></thead>
            <tbody>
              {cfg.capacityRules.map((r, i) => (
                <tr key={i}>
                  <td><input className="input py-1" inputMode="numeric" value={r.maxLoad} onChange={(e) => setCfg((c) => ({ ...c, capacityRules: c.capacityRules.map((x, j) => (j === i ? { ...x, maxLoad: Math.max(0, Math.trunc(Number(e.target.value) || 0)) } : x)) }))} /></td>
                  <td><input className="input py-1" inputMode="numeric" value={r.prepMinutes} onChange={(e) => setCfg((c) => ({ ...c, capacityRules: c.capacityRules.map((x, j) => (j === i ? { ...x, prepMinutes: Math.max(0, Math.trunc(Number(e.target.value) || 0)) } : x)) }))} /></td>
                  <td><button type="button" className="btn btn-ghost btn-sm text-red-600" onClick={() => setCfg((c) => ({ ...c, capacityRules: c.capacityRules.filter((_, j) => j !== i) }))}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            className="btn btn-secondary btn-sm mt-2"
            onClick={() =>
              setCfg((c) => {
                const last = c.capacityRules[c.capacityRules.length - 1];
                return { ...c, capacityRules: [...c.capacityRules, { maxLoad: (last?.maxLoad ?? 0) + 10, prepMinutes: (last?.prepMinutes ?? c.basePrepMinutes) + 2 }] };
              })
            }
          >
            + Add rule
          </button>
        </div>
        {!parsed.success && <p className="text-sm text-red-600">{parsed.error.issues[0]?.message}</p>}
      </div>
      <div>
        <h3 className="mb-2 font-semibold">Preview — ETA for a new 1-unit order</h3>
        <table className="table">
          <thead><tr><th>Active load</th><th>Prep</th><th>+ Delivery</th><th>Customer sees</th><th>Level</th></tr></thead>
          <tbody>
            {samples.map((load) => {
              const prep = prepMinutesForLoad(load + 1, cfg);
              return (
                <tr key={load}>
                  <td>{load}</td>
                  <td>{prep} min</td>
                  <td>{cfg.deliveryMinutes} min</td>
                  <td className="font-bold">{prep + cfg.deliveryMinutes} min</td>
                  <td>{loadLevel(load, cfg)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-gray-500">Active load = sum of load units of orders in CONFIRMED / PREPARING. Each product has its own load units (e.g. sandwich 1, meal 2).</p>
      </div>
    </div>
  );
}
