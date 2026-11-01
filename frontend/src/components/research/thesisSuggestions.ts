import type { ThesisCondition } from '../../api/researchDossiers';
/** Suggestions only: explicit percentages from the user's own prose, never inferred targets. */
export function thesisSuggestions(text: string): Array<{ label: string; metric: string; operator: ThesisCondition['operator']; threshold: string; unit: string; period: string }> {
  const metrics = ['operating margin', 'revenue growth', 'order book growth', 'customer concentration'];
  const operators: Record<string, ThesisCondition['operator']> = { 'at least': 'gte', 'above': 'gt', 'greater than': 'gt', 'at most': 'lte', 'below': 'lt', 'less than': 'lt', '>=': 'gte', '<=': 'lte', '≥': 'gte', '≤': 'lte', '>': 'gt', '<': 'lt' };
  return metrics.flatMap(metric => {
    const match = text.match(new RegExp(`\\b${metric}\\s+(?:(?:stays?|remains?)\\s+)?(at least|above|greater than|at most|below|less than|>=|<=|≥|≤|>|<)\\s*(-?\\d+(?:\\.\\d+)?)\\s*%`, 'i'));
    return match ? [{ label: match[0], metric: metric.replace(/ /g, '_'), operator: operators[match[1].toLowerCase()], threshold: match[2], unit: '%', period: '' }] : [];
  });
}
