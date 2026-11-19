import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { animate, createTimeline, stagger, svg, type JSAnimation } from 'animejs';
import manifest from '../data/splat-manifest.json';
import type { SplatEntry } from '../types/manifest';
import { useBoardStore } from '../hooks/useBoardStore';
import { useLookStore } from '../hooks/useLookStore';
import { useEditorialStore } from '../lib/editorialFx';
import { editorialPage } from '../lib/editorial';
import { galleryPieces } from '../lib/galleryLayout';
import { setFocusView } from '../lib/focus';

const entries = manifest as SplatEntry[];
const pad2 = (n: number) => String(n).padStart(2, '0');
/** The charge takes this long to run once round the frame (ms) … */
const SPARK_LAP_MS = 9000;
/** … and is this long (CSS px). */
const SPARK_PX = 72;

/** Letters set one by one behind a clipping edge, so they can rise into
 *  place (anime.js moves the inner <i>). */
function Chars({ text }: { text: string }) {
  return (
    <>
      {[...text].map((c, i) => (
        <span className="ch" key={i}>
          <i>{c === ' ' ? ' ' : c}</i>
        </span>
      ))}
    </>
  );
}

/** A figure that counts up to its value on entrance. */
function Count({ to, pad }: { to: number; pad?: boolean }) {
  return (
    <span data-count={to} data-pad={pad ? 2 : undefined}>
      {pad ? pad2(to) : to}
    </span>
  );
}

/**
 * A charge running round the frame for as long as the page is open: one
 * short dash per side, each crossing its own side in turn. They are Web
 * Animations on `transform` only, so they run on the compositor and stay
 * smooth while the splat streams in or the model is being turned.
 */
function runSpark(frame: HTMLElement) {
  const sides = [...frame.querySelectorAll<HTMLElement>('.ed-spark-side > i')];
  let running: Animation[] = [];
  const lay = () => {
    running.forEach((a) => a.cancel());
    const w = frame.clientWidth;
    const h = frame.clientHeight;
    const lap = 2 * (w + h);
    if (!lap || sides.length < 4) return;
    let at = 0; // distance along the lap where this side starts
    running = sides.map((el, i) => {
      const len = i % 2 ? h : w;
      const axis = i % 2 ? 'Y' : 'X';
      // top and right run forward (→ ↓), bottom and left run back (← ↑)
      const from = i < 2 ? -SPARK_PX : len;
      const to = i < 2 ? len : -SPARK_PX;
      const anim = el.animate(
        [
          { transform: `translate${axis}(${from}px)`, offset: 0 },
          { transform: `translate${axis}(${to}px)`, offset: (len + SPARK_PX) / lap },
          { transform: `translate${axis}(${to}px)`, offset: 1 },
        ],
        { duration: SPARK_LAP_MS, delay: (at / lap) * SPARK_LAP_MS, iterations: Infinity }
      );
      at += len;
      return anim;
    });
  };
  lay();
  const ro = new ResizeObserver(lay);
  ro.observe(frame);
  return () => {
    ro.disconnect();
    running.forEach((a) => a.cancel());
  };
}

/**
 * The cover view — what opens when a model is clicked. The page is laid out
 * like a magazine cover around the figure: a masthead behind the model's
 * head, one block of electric blue at their back, the look and what is worn
 * in the margins, measurements at the foot. A model with several captures
 * (a lookbook) changes looks from here; the gallery of its looks is one step
 * away. Everything is set in place by one anime.js timeline; the model's own
 * entrance is EditorialDriver's.
 *
 * Two layers, because the canvas sits between them: `.ed-back` under it
 * (paper, block, masthead — the splat overlaps the type) and `.ed-front`
 * over it (frame, copy, controls). Styles: styles/editorial.css.
 */
export default function EditorialView() {
  const selectedId = useBoardStore((s) => s.selectedId);
  const view = useBoardStore((s) => s.view);
  const revealed = useEditorialStore((s) => s.revealed);
  const look = useLookStore((s) => s.look);
  const wantLook = useLookStore((s) => s.wantLook);
  const swap = useLookStore((s) => s.swap);
  const entry = entries.find((e) => e.id === selectedId);
  const open = !!entry?.meta && view === 'details';

  // keep the last model (and the look it was in) on the page while it fades out
  const [last, setLast] = useState<{ entry: SplatEntry; look: number } | undefined>(
    open ? { entry: entry!, look: wantLook } : undefined
  );
  if (open && (entry !== last?.entry || wantLook !== last?.look)) {
    setLast({ entry: entry!, look: wantLook });
  }
  const shown = last?.entry;
  const shownLook = last?.look ?? 0;
  const meta = shown?.meta;
  const page = shown ? editorialPage(shown, shownLook) : null;
  const looks = shown?.looks && shown.looks.length > 1 ? shown.looks : undefined;
  const hasGallery = shown ? galleryPieces(shown).length > 1 : false;

  const back = useRef<HTMLDivElement>(null);
  const front = useRef<HTMLDivElement>(null);
  const leaving = useRef<JSAnimation | null>(null);
  /** Animations a change of look added to the page since it was set. */
  const changes = useRef<JSAnimation[]>([]);
  /** Look the page's copy was last animated in for. */
  const setFor = useRef(-1);

  const shownId = shown?.id;
  useEffect(() => {
    if (!open || !back.current || !front.current) return;
    // a previous exit still fading: let it finish (and tidy up) first
    leaving.current?.complete();

    const roots = [back.current, front.current];
    const all = <T extends Element>(sel: string) =>
      roots.flatMap((r) => [...r.querySelectorAll<T>(sel)]);
    const rise = { opacity: [0, 1], translateY: [16, 0], duration: 900 };
    setFor.current = useLookStore.getState().wantLook;

    const tl = createTimeline({ defaults: { ease: 'outExpo', duration: 1000 } })
      // the page: paper, the block of colour, the masthead
      .add(roots, { opacity: [0, 1], duration: 420, ease: 'linear' }, 0)
      .add(all('.ed-block'), { scaleY: [0, 1], duration: 1100, ease: 'inOutQuart' }, 100)
      .add(
        all('.ed-mast .ch > i'),
        { translateY: ['110%', '0%'], duration: 1300, delay: stagger(80) },
        250
      )
      // the frame draws itself round the page
      .add(all('.ed-frame'), { opacity: [0, 1], duration: 200, ease: 'linear' }, 300)
      .add(
        svg.createDrawable(all<SVGGeometryElement>('.ed-frame-line')),
        { draw: ['0 0', '0 1'], duration: 1900, ease: 'inOutQuart' },
        300
      )
      .add(all('.ed-top > *'), { opacity: [0, 1], translateY: [-10, 0], delay: stagger(90) }, 500)
      // the look
      .add(all('.ed-look .ed-rise'), { ...rise, delay: stagger(110) }, 650)
      .add(
        all('.ed-title .ch > i'),
        { translateY: ['110%', '0%'], duration: 1000, delay: stagger(32) },
        800
      )
      // what is worn: each rule rules itself, its line follows
      .add(all('.ed-worn .ed-rise'), rise, 850)
      .add(
        all('.ed-rule'),
        { scaleX: [0, 1], duration: 900, ease: 'inOutQuart', delay: stagger(120) },
        900
      )
      .add(all('.ed-piece-txt'), { ...rise, delay: stagger(120) }, 1050)
      // the model's card
      .add(all('.ed-id'), rise, 1250)
      .add(all('.ed-stat'), { ...rise, duration: 800, delay: stagger(55) }, 1300)
      .add(all('.ed-spark'), { opacity: [0, 1], duration: 600, ease: 'linear' }, 1900)
      .add(all('.ed-hint'), { opacity: [0, 1], duration: 700, ease: 'linear' }, 2800)
      .add(all('.ed-hint'), { opacity: 0, duration: 900, ease: 'linear' }, 9500);

    // figures count up to their values
    for (const el of all<HTMLElement>('[data-count]')) {
      const to = Number(el.dataset.count);
      const show = (v: number) => {
        el.textContent = el.dataset.pad ? pad2(v) : String(v);
      };
      const n = { v: 0 };
      tl.add(n, { v: to, duration: 1500, onUpdate: () => show(Math.round(n.v)) }, 900);
    }

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const stopSpark = reduced ? () => {} : runSpark(front.current);
    if (reduced) tl.complete();

    return () => {
      tl.pause();
      leaving.current = animate(roots, {
        opacity: 0,
        duration: 380,
        ease: 'outQuad',
        onComplete: () => {
          // back to the stylesheet's hidden states, ready for the next entrance
          tl.revert();
          changes.current.forEach((a) => a.revert());
          changes.current = [];
          stopSpark();
          leaving.current = null;
        },
      });
    };
  }, [open, shownId]);

  // a change of look: its number, name and pieces are new on the page (they
  // are keyed by look), so set just those
  useEffect(() => {
    if (!open || !front.current || setFor.current === shownLook) return;
    setFor.current = shownLook;
    const all = (sel: string) => [...front.current!.querySelectorAll(sel)];
    const opts = { ease: 'outExpo' as const };
    const rise = { opacity: [0, 1], translateY: [16, 0], duration: 800, ...opts };
    changes.current.push(
      animate(all('.ed-look-copy .ed-rise'), { ...rise, delay: stagger(90) }),
      animate(all('.ed-title .ch > i'), {
        translateY: ['110%', '0%'],
        duration: 900,
        delay: stagger(30, { start: 80 }),
        ...opts,
      }),
      animate(all('.ed-worn ol .ed-rule'), {
        scaleX: [0, 1],
        duration: 800,
        ease: 'inOutQuart',
        delay: stagger(100),
      }),
      animate(all('.ed-worn ol .ed-piece-txt'), { ...rise, delay: stagger(100, { start: 120 }) })
    );
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      changes.current.forEach((a) => a.complete());
    }
  }, [open, shownLook]);

  // keys: Esc closes, ← → change looks
  const lookCount = looks?.length ?? 0;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') return close();
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!step || lookCount < 2) return;
      e.preventDefault();
      const { wantLook: from, pickLook } = useLookStore.getState();
      pickLook((from + step + lookCount) % lookCount);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, lookCount]);

  if (!meta || !page) return null;
  // the model is behind the curtain: stepping out, or between two looks
  const waiting = open && (!revealed || swap === 'out' || swap === 'load');
  const stats: [string, number | string, string?][] = meta.stats ?? [
    ['Height', meta.heightCm, 'cm'],
    ['Bust', meta.bustCm],
    ['Waist', meta.waistCm],
    ['Hips', meta.hipsCm],
    ['Shoe', meta.shoeEu, 'eu'],
    ['Hair', meta.hair],
    ['Eyes', meta.eyes],
  ];

  return (
    <>
      <div className="ed-back" ref={back} aria-hidden>
        <div className="ed-block" />
        <p className="ed-mast" style={{ '--n': page.masthead.length } as CSSProperties}>
          <Chars text={page.masthead} />
        </p>
      </div>

      <div
        className={`ed-front${open ? ' open' : ''}${waiting ? ' waiting' : ''}`}
        ref={front}
        aria-hidden={!open}
        key={shown!.id}
      >
        <svg className="ed-frame" aria-hidden>
          <rect className="ed-frame-line" width="100%" height="100%" />
        </svg>
        <div className="ed-spark" aria-hidden>
          {['top', 'right', 'bottom', 'left'].map((side) => (
            <span className={`ed-spark-side ${side}`} key={side}>
              <i />
            </span>
          ))}
        </div>

        <header className="ed-top">
          <p>
            Model Canvas<i className="ed-dot" aria-hidden />
            <span>The Runway Edit</span>
          </p>
          <p className="ed-season">{page.season}</p>
          {hasGallery && (
            <button
              className="ed-link"
              onClick={() => setFocusView('gallery')}
              tabIndex={open ? 0 : -1}
            >
              Gallery
            </button>
          )}
          <button className="ed-close" onClick={close} tabIndex={open ? 0 : -1}>
            Close
            <span aria-hidden>✕</span>
          </button>
        </header>

        <div className="ed-info">
          <section className="ed-look" aria-label={`Look ${page.look}: ${page.title}`}>
            <p className="ed-kicker ed-rise">
              Look
              {page.of > 1 && (
                <em>
                  {pad2(page.look)} / {pad2(page.of)}
                </em>
              )}
            </p>
            <div className="ed-look-copy" key={shownLook}>
              <p className="ed-num ed-rise">
                <Count to={page.look} pad />
              </p>
              <h2 className="ed-title" aria-label={page.title}>
                <Chars text={page.title} />
              </h2>
              <p className="ed-stand ed-rise">{page.standfirst}</p>
            </div>
            {looks && (
              <nav className="ed-looks ed-rise" aria-label="Looks">
                {looks.map((l, i) => {
                  const on = i === wantLook;
                  const busy = on && (i !== look || swap === 'load');
                  return (
                    <button
                      key={l.capture}
                      className={`${on ? 'on' : ''}${busy ? ' busy' : ''}`}
                      style={{ '--swatch': l.swatch } as CSSProperties}
                      aria-current={on}
                      aria-label={`Look ${i + 1}: ${l.name}`}
                      tabIndex={open ? 0 : -1}
                      onClick={() => useLookStore.getState().pickLook(i)}
                    >
                      <b>{pad2(i + 1)}</b>
                      <span>
                        <i aria-hidden />
                        {l.name}
                      </span>
                    </button>
                  );
                })}
              </nav>
            )}
          </section>

          {page.pieces.length > 0 && (
            <section className="ed-worn" aria-label="Worn">
              <p className="ed-kicker ed-rise">
                Worn
                <em>
                  {pad2(page.pieces.length)} {page.pieces.length === 1 ? 'piece' : 'pieces'}
                </em>
              </p>
              <ol key={shownLook}>
                {page.pieces.map((p, i) => (
                  <li className="ed-piece" key={p.name}>
                    <i className="ed-rule" aria-hidden />
                    <span className="ed-piece-txt">
                      <small>
                        {pad2(i + 1)} · {p.label}
                      </small>
                      <b>{p.name}</b>
                      <span>{p.detail}</span>
                    </span>
                  </li>
                ))}
                <li className="ed-piece end" aria-hidden>
                  <i className="ed-rule" />
                </li>
              </ol>
            </section>
          )}

          <div className="ed-id">
            <b>{meta.name}</b>
            <span>
              {meta.agency} · {meta.city}
            </span>
          </div>
          <dl className={`ed-stats${meta.stats ? ' card' : ''}`} aria-label="Measurements">
            {stats.map(([label, value, unit]) => (
              <div className="ed-stat" key={label}>
                <dt>{label}</dt>
                <dd>
                  {typeof value === 'number' ? <Count to={value} /> : value}
                  {unit && <small>{unit}</small>}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="ed-arriving" aria-hidden>
          {revealed ? `Look ${pad2(page.look)}` : 'Stepping out'}
        </p>
        <p className="ed-hint" aria-hidden>
          Drag to turn · Scroll to zoom
        </p>
      </div>
    </>
  );
}

function close() {
  const store = useBoardStore.getState();
  store.setSelected(null);
  store.setPanTarget(null);
}
