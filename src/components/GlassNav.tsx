import { useMemo, useRef, useState } from 'react';
import { useBoardStore, type TalentBoard } from '../hooks/useBoardStore';
import { boardEntries, computeGrid } from './Board';
import { focusPlacement } from '../lib/focus';

const MAX_RESULTS = 8;

const BOARDS: { id: TalentBoard; label: string }[] = [
  { id: 'female', label: 'Female' },
  { id: 'male', label: 'Male' },
];

/**
 * Floating glass navigation: brand, the Female/Male talent-board switch, and
 * a search box scoped to the names on the board currently in view. Picking a
 * result eases the camera onto that model and opens its panel.
 */
export default function GlassNav() {
  const board = useBoardStore((s) => s.board);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const roster = useMemo(() => boardEntries(board), [board]);
  const placements = useMemo(() => computeGrid(roster, board), [roster, board]);

  const q = query.trim().toLowerCase();
  // empty query while focused lists the whole roster — with small test
  // rosters the dropdown doubles as an index of the board
  const results = useMemo(
    () =>
      roster
        .filter((e) => (e.meta?.name ?? e.id).toLowerCase().includes(q))
        .slice(0, MAX_RESULTS),
    [roster, q]
  );

  const pick = (id: string) => {
    const p = placements.find((pl) => pl.entry.id === id);
    if (p) focusPlacement(id, p.x, p.y);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const switchBoard = (b: TalentBoard) => {
    useBoardStore.getState().setBoard(b);
    setQuery('');
    setOpen(false);
  };

  const nameOf = (id: string) => roster.find((e) => e.id === id)?.meta?.name ?? id;

  return (
    <>
      <style>{`
        .glass-nav {
          position: absolute;
          top: 14px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 20;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-wrap: wrap;
          gap: 10px;
          /* left: 50% would shrink-wrap the nav to half the window and wrap
             it onto two rows below ~1130px; size it to its content instead */
          width: max-content;
          max-width: calc(100vw - 24px);
          color: var(--ink);
        }
        .glass-nav .brand {
          display: flex;
          align-items: center;
          gap: 8px;
          border-radius: 999px;
          padding: 9px 18px 9px 12px;
          font-size: 13px;
          font-weight: 650;
          letter-spacing: 0.14em;
          white-space: nowrap;
        }
        .glass-nav .brand .dot {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background:
            radial-gradient(circle at 32% 28%, rgba(255, 255, 255, 0.95) 0 18%, transparent 45%),
            conic-gradient(from 210deg, #9fe0ff, #cfc2ff, #ffc4e5, #ffe9b8, #b9f3d8, #9fe0ff);
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.7), 0 2px 6px rgba(80, 90, 140, 0.25);
        }
        .glass-nav .tabs {
          display: flex;
          border-radius: 999px;
          padding: 4px;
          gap: 2px;
        }
        .glass-nav .tabs button {
          border: none;
          background: transparent;
          border-radius: 999px;
          padding: 7px 18px;
          font: inherit;
          font-size: 13px;
          font-weight: 550;
          color: var(--ink-soft);
          cursor: pointer;
          transition: color 0.18s, background 0.18s, box-shadow 0.18s;
        }
        .glass-nav .tabs button:hover { color: var(--ink); }
        .glass-nav .tabs button.active {
          color: var(--ink);
          background: rgba(255, 255, 255, 0.85);
          box-shadow: 0 3px 10px rgba(80, 90, 140, 0.18), inset 0 1px 0 rgba(255, 255, 255, 1);
        }
        .glass-nav .search {
          position: relative;
        }
        .glass-nav .search .field {
          display: flex;
          align-items: center;
          gap: 8px;
          border-radius: 999px;
          padding: 0 16px;
        }
        .glass-nav .search svg {
          flex: none;
          opacity: 0.55;
        }
        .glass-nav .search input {
          border: none;
          background: transparent;
          outline: none;
          font: inherit;
          font-size: 13px;
          color: var(--ink);
          padding: 10px 0;
          width: 150px;
          transition: width 0.22s ease;
        }
        .glass-nav .search input:focus { width: 200px; }
        .glass-nav .search input::placeholder { color: var(--ink-soft); }
        .glass-nav .results {
          position: absolute;
          top: calc(100% + 8px);
          left: 0;
          right: 0;
          border-radius: 20px;
          padding: 6px;
          max-height: 300px;
          overflow-y: auto;
        }
        .glass-nav .results button {
          display: block;
          width: 100%;
          text-align: left;
          border: none;
          background: transparent;
          border-radius: 14px;
          padding: 9px 12px;
          font: inherit;
          cursor: pointer;
        }
        .glass-nav .results button:hover { background: rgba(255, 255, 255, 0.75); }
        .glass-nav .results .name {
          display: block;
          font-size: 13px;
          font-weight: 600;
          color: var(--ink);
        }
        .glass-nav .results .sub {
          display: block;
          font-size: 11px;
          color: var(--ink-soft);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          margin-top: 1px;
        }
        .glass-nav .results .empty {
          padding: 12px;
          font-size: 13px;
          color: var(--ink-soft);
          text-align: center;
        }
        @media (max-width: 620px) {
          .glass-nav .brand span.label { display: none; }
          .glass-nav .brand { padding: 9px 12px; }
        }
      `}</style>
      <nav className="glass-nav" aria-label="Model Canvas">
        <div className="brand glass">
          <span className="dot" aria-hidden />
          <span className="label">MODEL CANVAS</span>
        </div>
        <div className="tabs glass" role="tablist" aria-label="Talent board">
          {BOARDS.map((b) => (
            <button
              key={b.id}
              role="tab"
              aria-selected={board === b.id}
              className={board === b.id ? 'active' : ''}
              onClick={() => switchBoard(b.id)}
            >
              {b.label}
            </button>
          ))}
        </div>
        <div className="search">
          <div className="field glass">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              ref={inputRef}
              type="search"
              placeholder={`Search ${board} talent…`}
              value={query}
              aria-label={`Search ${board} talent by name`}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => setOpen(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && results[0]) pick(results[0].id);
                if (e.key === 'Escape') {
                  setQuery('');
                  inputRef.current?.blur();
                }
              }}
            />
          </div>
          {open && (
            <div className="results glass" role="listbox">
              {results.map((e) => (
                <button
                  key={e.id}
                  role="option"
                  aria-selected={false}
                  // pointerdown so the pick lands before the input's blur
                  onPointerDown={(ev) => {
                    ev.preventDefault();
                    pick(e.id);
                  }}
                >
                  <span className="name">{nameOf(e.id)}</span>
                  {e.meta && <span className="sub">{e.meta.agency}</span>}
                </button>
              ))}
              {results.length === 0 && (
                <div className="empty">No {board} models match “{query.trim()}”</div>
              )}
            </div>
          )}
        </div>
      </nav>
    </>
  );
}
