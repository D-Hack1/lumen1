// Owner: Abhinav
// useCopy(key) / usePersona(): persona-aware strings for every component (WORK_DISTRIBUTION §5 integration model).
// Missing keys fall back Educator → Planner → the key itself (so a missing string is visible, never blank).
import { educator, planner } from '../content/personaCopy';
import { useScenario, type Persona } from './scenarioStore';

export function getCopy(key: string, persona: Persona): string {
  return (persona === 'educator' ? educator[key] : undefined) ?? planner[key] ?? key;
}

export function usePersona(): Persona {
  return useScenario((s) => s.persona);
}

export function useCopy(key: string): string {
  return getCopy(key, usePersona());
}

/** For components that need many keys: `const t = useCopyFn(); t('mb.share')`. */
export function useCopyFn(): (key: string) => string {
  const persona = usePersona();
  return (key: string) => getCopy(key, persona);
}
