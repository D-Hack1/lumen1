// Owner: Abhinav
import type { Route } from './Shell';

/** Navigate to a page (hash route). */
export const go = (route: Route): void => {
  window.location.hash = `#${route}`;
};
