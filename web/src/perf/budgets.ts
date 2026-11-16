// Owner: Nived
// Gate G8 (PLAN_FINAL section 10) + G13 (R3 delta D-13): the performance budgets the HUD and the automated run check, in ms.
export const G8_BUDGETS_MS = {
  /** pointer event -> overlay drawn */
  hover: 4,
  /** frame time while dragging the slip bar */
  slipFrame: 16.7,
  /** Scan stage 1 */
  scanStage1: 100,
  /** Scan: first stage-2 (refined) row */
  scanFirstStage2: 300,
  quickAnswer: 150,
  siteSwitch: 100,
} as const;

export type BudgetedMetric = keyof typeof G8_BUDGETS_MS;
