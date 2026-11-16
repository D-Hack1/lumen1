// Owner: Abhinav
// Interim glossary used until Gowri's public/content/glossary.json lands (it is `{}` today). Text is taken from the
// locked spec only — PLAN_FINAL §8.10 (formula + plain-English impact), §5.5 (link rules) and R3 D-10 (ops
// elevation). No source citations or σ values are invented here: entries are marked `pending` so the tooltip shows a
// "draft" tag. When glossary.json provides an id, its entry replaces the one below; the aliases stay so badges that
// pass a visible label ("Sun elevation", "Window link") keep resolving.
export interface GlossarySeed {
  id: string;
  label: string;
  formula?: string;
  impact?: string;
  source?: string;
  /** Visible labels / alternative keys that should resolve to this entry. */
  aliases?: string[];
}

const SPEC = 'PLAN §8.10 (draft until glossary.json)';

export const GLOSSARY_FALLBACK: GlossarySeed[] = [
  {
    id: 'sun_elevation',
    label: 'Sun elevation',
    formula: 'angle of Sun centre above the local horizontal plane',
    impact: 'How high the Sun is. At the pole it never gets more than a few degrees up.',
    aliases: ['Sun el'],
  },
  {
    id: 'sun_available',
    label: 'Sun available',
    formula: 'disk fraction above the effective mask ≥ threshold (and Sun elevation ≥ ops minimum when set)',
    impact: 'Whether the panels can use the Sun right now, by the rules in the Definitions Bar.',
    source: 'PLAN §5.4, R3 D-10',
    aliases: ['Sun now', 'Sun up', 'sun_disk_threshold', 'Sun disk threshold'],
  },
  {
    id: 'sun_clearance',
    label: 'Sun clearance / disk %',
    formula: 'elevation − effective mask; chord-quadrature disk fraction',
    impact: 'How far above the ridge the Sun is, and how much of it you can see.',
    aliases: ['Clearance / disk', 'Sun clearance', 'disk %'],
  },
  {
    id: 'earth_link',
    label: 'Earth visible / link',
    formula:
      'Earth disk ≥ threshold and DTE margin ≥ threshold; DSN-aware: also ≥ 1 DSN complex sees the Moon above its mask',
    impact: 'Whether you can phone home right now.',
    source: 'PLAN §5.5',
    aliases: ['Earth now', 'Link', 'Earth visible', 'dte_disk_threshold', 'DTE disk threshold'],
  },
  {
    id: 'window_sunlit',
    label: 'Sunlit % (window)',
    formula: 'time with Sun available ÷ window length; [low–high] from the mask ± σ',
    impact: 'How much of the mission the Sun is usable.',
    aliases: ['Window sunlit', 'Sunlit %', 'Time in sunlight', 'Sunlight over the mission'],
  },
  {
    id: 'window_link',
    label: 'Link % (window)',
    formula: 'time with link available ÷ window length; [low–high] from the mask ± σ',
    impact: 'How much of the mission you can talk to Earth.',
    aliases: ['Window link', 'Link %', 'Time in radio contact', 'Radio contact over the mission'],
  },
  {
    id: 'libration',
    label: 'Libration',
    formula: 'sub-Earth point oscillates ~±6.7° lat / ±7.9° lon',
    impact: 'Earth slowly rises and sets near the pole roughly every two weeks.',
  },
  {
    id: 'cosine_loss',
    label: 'Vertical Array Cosine Loss',
    formula: 'cos i = n_panel · ŝ; upright panel facing α: cos(el)·cos(az − α); loss = 1 − cos i',
    impact: 'A panel facing 40° away from the Sun loses about a quarter of its power.',
  },
  {
    id: 'dte_margin',
    label: 'DTE Margin',
    formula: 'Earth centre elevation − effective horizon at Earth’s azimuth',
    impact: 'How much clear sky the radio link has above the terrain.',
    aliases: ['Earth el / margin', 'Earth margin', 'earth_margin'],
  },
  {
    id: 'dsn_visibility',
    label: 'DSN visibility',
    formula: 'Moon elevation at Goldstone/Canberra/Madrid ≥ mask',
    impact: 'Someone on Earth must be facing the Moon to listen.',
    aliases: ['DSN', 'DSN mask', 'dsn_mask', 'DSN mode'],
  },
  {
    id: 'range_light_time',
    label: 'Range & light time',
    formula: '‖Earth − site‖; range ÷ c',
    impact: 'How far the signal travels: about 1.3 seconds each way.',
    aliases: ['Range', 'Light time'],
  },
  {
    id: 'tier',
    label: 'Fidelity Tier A/B/C',
    formula: 'PLAN §4.2 fidelity tiers',
    impact: 'How much to trust shadow timings here.',
    aliases: ['Tier', 'Fidelity tier'],
  },
  {
    id: 'uncertainty',
    label: 'Uncertainty (±)',
    formula: 'δt = σ_h ÷ |d(clearance)/dt|; bounds from mask ± σ',
    impact: 'Our best time and how far off it could plausibly be. Near the pole this can be hours.',
    aliases: ['±', 'Uncertainty'],
  },
  {
    id: 'grazing',
    label: 'Grazing event',
    formula: 'clearance rate below floor or δt > 12 h',
    impact: 'The Sun is skimming the ridge; the exact moment is hard to pin down.',
    aliases: ['Grazing'],
  },
  {
    id: 'shadow_exit',
    label: 'Shadow exit',
    formula: 'next time disk ≥ 50% after being blocked',
    impact: 'When the lander comes back into sunlight.',
    aliases: ['Sunrise (Shadow Exit)'],
  },
  {
    id: 'longest_night',
    label: 'Longest night',
    formula: 'longest run of power below profile minimum',
    impact: 'How long the battery must keep you alive.',
    aliases: ['Longest dark spell'],
  },
  {
    id: 'comm_gap',
    label: 'Comm gap',
    formula: 'longest run with no link in the window',
    impact: 'The longest stretch without talking to Earth.',
    aliases: ['Longest radio silence'],
  },
  {
    id: 'ops_hours',
    label: 'Ops hours',
    formula: 'power-positive AND link',
    impact: 'Time you can both work and phone home.',
  },
  {
    id: 'min_sun_elevation_ops',
    label: 'Minimum Sun elevation (ops)',
    formula:
      'when > 0: Sun available also needs Sun elevation ≥ this value (geometric elevation above the local horizontal)',
    impact: 'Some landers can only work once the Sun is high enough — e.g. 6° for ISRO’s Vikram ops.',
    source: 'R3 D-10 · ISRO mission team statement as reported',
    aliases: ['minSunElevationOps', 'Ops elevation', 'Below ops elevation', 'Sun too low'],
  },
  {
    id: 'earth_referenced_azimuth',
    label: 'Earth-referenced azimuth',
    formula: 'PLAN §5.1 site frame, azimuth measured from the Earth direction',
    impact: 'At the pole “north” is everywhere, so we measure direction from Earth.',
    aliases: ['Azimuth'],
  },
  {
    id: 'slope_aspect',
    label: 'Slope / aspect / uphill',
    formula: 'θ; downhill_aspect; uphill_az = (downhill_aspect + 180°) mod 360°',
    impact: 'How steep the ground is and which way it tilts the lander.',
    aliases: ['Slope', 'Pad slope', 'Aspect'],
  },
  {
    id: 'slope_plane_occluder',
    label: 'Slope-plane occluder',
    formula: 'PLAN §5.6 / R3 D-9 near-zone rule',
    impact: 'Rising ground right beside the lander can hide a low Sun.',
    aliases: ['Near-zone occluder'],
  },
  {
    id: 'mast_height',
    label: 'Mast height',
    formula: 'horizon from raised observer; dip √(2h/R)',
    impact: 'Raising panels a few metres can buy hours of sunlight.',
    aliases: ['Observer height', 'Height', 'observer_height'],
  },
  {
    id: 'psr_distance',
    label: 'Distance to PSR',
    formula: 'distance to nearest 0%-average-illumination pixel (derived PSR ≥ 0.1 km²)',
    impact: 'How far the science (ice in permanent shadow) is from the sunlight you need for power.',
    aliases: ['PSR distance', 'PSR'],
  },
  {
    id: 'earth_twin',
    label: 'Earth Twin',
    formula: 'terrestrial solar position at same latitude',
    impact: 'What the same Sun would do on Earth, with an atmosphere and a 24-hour day.',
  },
  {
    id: 'verdict',
    label: 'Viability Index / Verdict',
    formula: 'PLAN §5.7 — GO needs every hard threshold on the conservative bound',
    impact: 'Go, borderline or no-go for your mission profile, judged conservatively.',
    aliases: ['Viability Index', 'Verdict'],
  },
].map((e) => ({ ...e, source: e.source ?? SPEC }));
