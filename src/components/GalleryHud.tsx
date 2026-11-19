import { useEffect, useRef, useState } from 'react';
import manifest from '../data/splat-manifest.json';
import type { SplatEntry } from '../types/manifest';
import { useBoardStore } from '../hooks/useBoardStore';
import { galleryFx, useGalleryStore } from '../lib/galleryFx';
import { galleryPieces } from '../lib/galleryLayout';
import { MOBILE_BREAKPOINT_PX } from '../config/board';
import { setFocusView } from '../lib/focus';

const entries = manifest as SplatEntry[];
const pad2 = (n: number) => String(n).padStart(2, '0');
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

function formatHeight(cm: number): string {
  const totalIn = Math.round(cm / 2.54);
  return `${cm} cm (${Math.floor(totalIn / 12)}′${totalIn % 12}″)`;
}

/**
 * Gallery chrome: the exhibition card, a museum wall label beside the
 * piece in front of you (its room, the look, the model's details), the
 * walk navigator, the Details | Gallery switch and the way out. The label tracks its frame from galleryFx in
 * a rAF loop — no React render per frame.
 */
export default function GalleryHud() {
  const selectedId = useBoardStore((s) => s.selectedId);
  const view = useBoardStore((s) => s.view);
  const index = useGalleryStore((s) => s.index);
  const count = useGalleryStore((s) => s.count);
  const entry = view === 'gallery' ? entries.find((e) => e.id === selectedId) : undefined;

  // keep the last model so the chrome fades out with content
  const [last, setLast] = useState<SplatEntry | undefined>(entry);
  if (entry && entry !== last) setLast(entry);
  const shown = entry ?? last;
  const meta = shown?.meta;
  const pieces = shown ? galleryPieces(shown) : [];
  const piece = pieces[Math.min(index, pieces.length - 1)];

  const close = () => {
    const store = useBoardStore.getState();
    store.setSelected(null);
    store.setPanTarget(null);
  };

  // keys: ← → walk, Esc steps back to the details
  useEffect(() => {
    if (!entry) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'ArrowRight') useGalleryStore.getState().step(1);
      else if (e.key === 'ArrowLeft') useGalleryStore.getState().step(-1);
      else if (e.key === 'Escape') setFocusView('details');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [entry]);

  // the wall label follows its frame
  const label = useRef<HTMLElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!entry) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = label.current;
      if (!el) return;
      const l = galleryFx.label;
      const mobile = window.innerWidth <= MOBILE_BREAKPOINT_PX;
      const x = mobile ? (window.innerWidth - el.offsetWidth) / 2 : l.x;
      const y = mobile ? l.below + 14 : l.y + 6;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      el.classList.toggle('on', l.visible);
      // house lights down: the chrome recedes, the label catches the beam
      root.current?.classList.toggle('spotlit', galleryFx.spot > 0.5);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [entry]);

  const open = !!entry;
  const dark = !!piece?.style.dark;
  return (
    <div
      ref={root}
      className={`gallery-hud${open ? ' open' : ''}${dark ? ' dark' : ''}`}
      aria-hidden={!open}
    >
      {meta && piece && (
        <>
          <header className="exhibition">
            <p className="kicker">Model Canvas · Gallery</p>
            <h1>{meta.name}</h1>
            <p className="show">
              Selected Looks, 2026 · {count} {count === 1 ? 'work' : 'works'}
            </p>
            <p className="intro">{meta.bio}</p>
          </header>

          <article className="wall-label" ref={label} aria-live="polite">
            <div className="label-body" key={`${shown!.id}:${index}`}>
              <p className="room">
                Room {ROMAN[index] ?? index + 1} · {piece.style.room}
              </p>
              <p className="artist">
                {meta.name}
                <span>
                  {meta.agency}, {meta.city}
                </span>
              </p>
              <p className="title">
                <em>{piece.title}</em>, 2026
              </p>
              <p className="medium">
                {shown!.fullSplatUrl
                  ? 'Gaussian splat at source quality, view-dependent colour'
                  : 'Gaussian splat'}
                {piece.note ? `; ${piece.note.toLowerCase()}` : ''}
              </p>
              <p className="dims">
                {formatHeight(meta.heightCm)} · {meta.bustCm} / {meta.waistCm} / {meta.hipsCm} cm
              </p>
              <p className="facts">
                {meta.weightKg} kg · Shoe EU {meta.shoeEu} · Hair {meta.hair} · Eyes {meta.eyes}
              </p>
              <p className="credit">
                Look {pad2(index + 1)} of {pad2(count)}
              </p>
            </div>
          </article>

          {count > 1 && (
            <nav className="walk" aria-label="Walk the gallery">
              <button
                className="arrow"
                aria-label="Previous work"
                disabled={index === 0}
                onClick={() => useGalleryStore.getState().step(-1)}
              >
                ←
              </button>
              <ol>
                {pieces.map((p, i) => (
                  <li key={i}>
                    <button
                      className={i === index ? 'on' : ''}
                      aria-label={`Look ${i + 1}: ${p.title}`}
                      aria-current={i === index}
                      title={p.title}
                      onClick={() => useGalleryStore.getState().go(i)}
                    />
                  </li>
                ))}
              </ol>
              <button
                className="arrow"
                aria-label="Next work"
                disabled={index === count - 1}
                onClick={() => useGalleryStore.getState().step(1)}
              >
                →
              </button>
              <span className="count">
                {pad2(index + 1)} / {pad2(count)}
              </span>
            </nav>
          )}
          {count > 1 && <p className="walk-hint">Drag, scroll or use ← → to walk the gallery</p>}

          <div className="view-switch" role="tablist" aria-label="Model sections">
            <button role="tab" aria-selected={false} onClick={() => setFocusView('details')}>
              Details
            </button>
            <button role="tab" aria-selected className="on">
              Gallery
            </button>
            <button className="close" onClick={close} aria-label="Close model">
              ✕
            </button>
          </div>
        </>
      )}
    </div>
  );
}
