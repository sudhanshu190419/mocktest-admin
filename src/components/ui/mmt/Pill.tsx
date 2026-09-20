import { cn } from '@/lib/cn';

export type PillTone = 'sky' | 'mint' | 'apricot' | 'lilac' | 'sand' | 'neutral';

const tones: Record<PillTone, string> = {
  sky: 'bg-sky-tint text-sky-ink',
  mint: 'bg-mint text-mint-ink',
  apricot: 'bg-apricot text-apricot-ink',
  lilac: 'bg-lilac text-lilac-ink',
  sand: 'bg-sand text-sand-ink',
  neutral: 'bg-paper text-ink-secondary border border-line',
};

export interface PillProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: PillTone;
}

/** Status/label pill — 12px floor, sentence case per microcopy glossary. */
export function Pill({ tone = 'neutral', className, ...rest }: PillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-semibold',
        tones[tone],
        className
      )}
      {...rest}
    />
  );
}
