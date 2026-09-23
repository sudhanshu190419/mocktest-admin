'use client';

import { useRef, useState, useEffect, useCallback } from 'react';

/**
 * Hook to manage horizontal carousel state for the homepage collections.
 * - Tracks scroll position to dynamically disable prev/next arrows.
 * - Slides smoothly by one card width (including gap) per arrow click.
 * - Auto-resets to the beginning when items change (e.g. goal switch).
 */
export function useStoreCarousel(itemCount: number) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isAtStart, setIsAtStart] = useState(true);
  const [isAtEnd, setIsAtEnd] = useState(false);

  const checkScroll = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const tolerance = 6;
    const atStart = el.scrollLeft <= tolerance;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - tolerance;
    setIsAtStart(atStart);
    setIsAtEnd(atEnd);
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    checkScroll();
    el.addEventListener('scroll', checkScroll, { passive: true });
    window.addEventListener('resize', checkScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', checkScroll);
      window.removeEventListener('resize', checkScroll);
    };
  }, [checkScroll, itemCount]);

  // Reset scroll position when items/count change (e.g. user toggles goal)
  useEffect(() => {
    if (trackRef.current) {
      trackRef.current.scrollTo({ left: 0, behavior: 'instant' as any });
      setIsAtStart(true);
      setIsAtEnd(itemCount <= 3);
    }
  }, [itemCount]);

  const scrollPrev = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const item = el.querySelector<HTMLElement>('.store-carousel-slide-item');
    const scrollDistance = item ? item.offsetWidth + 26 : el.clientWidth * 0.75;
    el.scrollBy({ left: -scrollDistance, behavior: 'smooth' });
  }, []);

  const scrollNext = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const item = el.querySelector<HTMLElement>('.store-carousel-slide-item');
    const scrollDistance = item ? item.offsetWidth + 26 : el.clientWidth * 0.75;
    el.scrollBy({ left: scrollDistance, behavior: 'smooth' });
  }, []);

  return {
    trackRef,
    isAtStart,
    isAtEnd,
    scrollPrev,
    scrollNext,
    showControls: itemCount > 3,
  };
}
