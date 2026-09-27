import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function useCountUp(target: number, ms = 900): number {
  const [v, setV] = useState(0);
  const cur = useRef(0);
  useEffect(() => {
    if (!Number.isFinite(target)) return;
    if (reduced()) { cur.current = target; setV(target); return; }
    const from = cur.current, start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      cur.current = from + (target - from) * (1 - (1 - p) ** 4);
      setV(cur.current);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

export function useFlip<T extends HTMLElement>(trigger: unknown) {
  const els = useRef(new Map<string, T>());
  const prev = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const next = new Map<string, number>();
    const skip = reduced();
    els.current.forEach((el, k) => {
      const top = el.offsetTop;
      next.set(k, top);
      const old = prev.current.get(k);
      if (!skip && old != null && old !== top) {
        el.animate([{ transform: `translateY(${old - top}px)` }, { transform: 'none' }], { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
    });
    prev.current = next;
  }, [trigger]);
  return (k: string) => (el: T | null) => { if (el) els.current.set(k, el); else els.current.delete(k); };
}

export function spot(e: PointerEvent<HTMLElement>) {
  const el = e.currentTarget, r = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${e.clientX - r.left}px`);
  el.style.setProperty('--my', `${e.clientY - r.top}px`);
}
