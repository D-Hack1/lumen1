// Owner: Abhinav
// Category filter chips (PLAN §8.4): All · Artemis III · Historical Landings · Published Targets · Contrast Sites ·
// Custom — single-select, with counts — plus the agency sub-filter (NASA/CLPS, ISRO, CNSA, JAXA, commercial).
// Fits two chip rows in the search slot at every density: full names at c1, short names (".long" in the tooltip and
// accessible name) at c2–c4. Chip toggle feedback is the kit's 120 ms transform/colour (emil).
import { useViewport } from '../../app/layout/viewport';
import { Chip } from '../../ui/Chip';
import { AGENCY_FILTERS, CATEGORY_FILTERS, type AgencyFilter, type CategoryFilter } from './siteModel';

type T = (key: string) => string;

export interface FilterChipsProps {
  value: CategoryFilter;
  onChange(c: CategoryFilter): void;
  counts: Record<CategoryFilter, number>;
  t: T;
}

export function FilterChips({ value, onChange, counts, t }: FilterChipsProps) {
  const { cols } = useViewport();
  const long = cols === 'c1';
  return (
    <div className="sb-chips" role="group" aria-label={t('sb.filter.group')}>
      {CATEGORY_FILTERS.map((c) => (
        <Chip
          key={c}
          selected={value === c}
          count={counts[c]}
          data-chip={c}
          title={t(`sb.cat.${c}.long`)}
          aria-label={`${t(`sb.cat.${c}.long`)} (${counts[c]})`}
          onChange={() => onChange(c === value && c !== 'all' ? 'all' : c)}
        >
          {t(long ? `sb.cat.${c}.long` : `sb.cat.${c}`)}
        </Chip>
      ))}
    </div>
  );
}

export interface AgencySelectProps {
  value: AgencyFilter;
  onChange(a: AgencyFilter): void;
  t: T;
}

export function AgencySelect({ value, onChange, t }: AgencySelectProps) {
  return (
    <select
      className="sb-agency"
      aria-label={t('sb.agency')}
      title={t('sb.agency')}
      value={value}
      data-active={value !== 'all' || undefined}
      onChange={(e) => onChange(e.target.value as AgencyFilter)}
    >
      {AGENCY_FILTERS.map((a) => (
        <option key={a} value={a}>
          {t(`sb.agency.${a}`)}
        </option>
      ))}
    </select>
  );
}
