// Owner: Ebin
// Latitude of the selected site or custom point (south negative); −90 until the catalogue loads.
import { useCatalog } from '../../engine/hooks';
import { useScenario } from '../../state/scenarioStore';

export function useSiteLat(): number {
  const { sites } = useCatalog();
  const site = useScenario((s) => s.site);
  return site.kind === 'point' ? site.lat : (sites.find((x) => x.id === site.id)?.lat ?? -90);
}
