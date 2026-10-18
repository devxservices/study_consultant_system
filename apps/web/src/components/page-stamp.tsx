import { renderClock } from '@/lib/render-clock';
import { RenderStamp } from './freshness';

/**
 * For pages that do not render a PageHeader (which carries its own stamp):
 * marks the page with its render's clock, so a copy the browser keeps is
 * checked for changes before it is trusted. See components/freshness.tsx.
 */
export function PageStamp() {
  return <RenderStamp {...renderClock()} />;
}
