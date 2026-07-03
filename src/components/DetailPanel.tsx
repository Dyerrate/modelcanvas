import { useEffect, useState } from 'react';
import manifest from '../data/splat-manifest.json';
import type { ModelMeta, SplatEntry } from '../types/manifest';
import { useBoardStore } from '../hooks/useBoardStore';

const entries = manifest as SplatEntry[];

function formatHeight(cm: number): string {
  const totalIn = Math.round(cm / 2.54); // round before splitting so 182cm → 6'0", not 5'12"
  const ft = Math.floor(totalIn / 12);
  const inches = totalIn % 12;
  return `${cm} cm / ${ft}'${inches}"`;
}

function formatWeight(kg: number): string {
  return `${kg} kg / ${Math.round(kg * 2.20462)} lb`;
}

export default function DetailPanel() {
  const selectedId = useBoardStore((s) => s.selectedId);
  const entry = entries.find((e) => e.id === selectedId);
  const meta = entry?.meta;

  // keep the last content mounted so the panel slides out full, not empty
  const [lastMeta, setLastMeta] = useState<ModelMeta | undefined>(meta);
  if (meta && meta !== lastMeta) setLastMeta(meta);
  const shown = meta ?? lastMeta;

  const close = () => {
    const store = useBoardStore.getState();
    store.setSelected(null);
    store.setPanTarget(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <style>{`
        .detail-panel {
          position: absolute;
          top: 0;
          right: 0;
          bottom: 0;
          z-index: 10;
          width: 360px;
          max-width: 90vw;
          box-sizing: border-box;
          background: rgba(255, 255, 255, 0.96);
          backdrop-filter: blur(8px);
          border-left: 1px solid #ececec;
          box-shadow: -12px 0 32px rgba(0, 0, 0, 0.06);
          padding: 28px;
          overflow-y: auto;
          transform: translateX(105%);
          transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
          color: #171717;
        }
        .detail-panel.open { transform: translateX(0); }
        .detail-panel .close {
          position: absolute;
          top: 16px;
          right: 16px;
          width: 32px;
          height: 32px;
          border: none;
          border-radius: 50%;
          background: #f2f2f2;
          color: #555;
          font-size: 16px;
          line-height: 1;
          cursor: pointer;
        }
        .detail-panel .close:hover { background: #e4e4e4; }
        .detail-panel h2 {
          margin: 4px 0 2px;
          font-size: 26px;
          font-weight: 650;
          letter-spacing: -0.02em;
        }
        .detail-panel .sub {
          margin: 0 0 20px;
          font-size: 13px;
          color: #8a8a8a;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .detail-panel .measurements {
          font-size: 20px;
          font-weight: 500;
          letter-spacing: 0.02em;
          margin-bottom: 4px;
        }
        .detail-panel .measurements-label {
          font-size: 11px;
          color: #a0a0a0;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          margin-bottom: 20px;
        }
        .detail-panel dl {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px 18px;
          margin: 0 0 22px;
          padding: 18px 0;
          border-top: 1px solid #ededed;
          border-bottom: 1px solid #ededed;
        }
        .detail-panel dt {
          font-size: 11px;
          color: #a0a0a0;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          margin-bottom: 3px;
        }
        .detail-panel dd { margin: 0; font-size: 15px; }
        .detail-panel .bio { font-size: 14px; line-height: 1.6; color: #4a4a4a; margin: 0; }
        @media (max-width: 768px) {
          .detail-panel {
            top: auto;
            left: 0;
            width: 100%;
            max-width: none;
            max-height: 55%;
            border-left: none;
            border-top: 1px solid #ececec;
            border-radius: 16px 16px 0 0;
            transform: translateY(105%);
          }
          .detail-panel.open { transform: translateY(0); }
        }
      `}</style>
      <aside className={`detail-panel${meta ? ' open' : ''}`} aria-hidden={!meta}>
        {shown && (
          <>
            <button className="close" onClick={close} aria-label="Close details">
              ✕
            </button>
            <h2>{shown.name}</h2>
            <p className="sub">
              {shown.agency} — {shown.city}
            </p>
            <div className="measurements">
              {shown.bustCm} · {shown.waistCm} · {shown.hipsCm}
            </div>
            <div className="measurements-label">Bust · Waist · Hips (cm)</div>
            <dl>
              <div>
                <dt>Height</dt>
                <dd>{formatHeight(shown.heightCm)}</dd>
              </div>
              <div>
                <dt>Weight</dt>
                <dd>{formatWeight(shown.weightKg)}</dd>
              </div>
              <div>
                <dt>Shoe</dt>
                <dd>EU {shown.shoeEu}</dd>
              </div>
              <div>
                <dt>Hair</dt>
                <dd>{shown.hair}</dd>
              </div>
              <div>
                <dt>Eyes</dt>
                <dd>{shown.eyes}</dd>
              </div>
            </dl>
            <p className="bio">{shown.bio}</p>
          </>
        )}
      </aside>
    </>
  );
}
