import { describe, expect, it } from 'vitest';
import { hasTemplateDraftContent } from '../../src/shared/clinical-templates';

describe('applying shared templates to unsaved drafts', () => {
  it('does not prompt for empty clinical or default invoice fields', () => {
    expect(hasTemplateDraftContent({ treatmentPlan: '', notes: '  ' })).toBe(false);
    expect(hasTemplateDraftContent({ items: [{ description: '', qty: 1, unitPricePaisa: 0, treatmentId: null }] })).toBe(false);
  });
  it('requires a confirmation before overwriting any typed text or amount', () => {
    expect(hasTemplateDraftContent({ treatmentPlan: 'Plan A' })).toBe(true);
    expect(hasTemplateDraftContent({ items: [{ description: '', qty: 1, unitPricePaisa: 12500, treatmentId: null }] })).toBe(true);
    expect(hasTemplateDraftContent({ items: [{ description: 'Exam', qty: 1, unitPricePaisa: 0, treatmentId: null }] })).toBe(true);
  });
});
