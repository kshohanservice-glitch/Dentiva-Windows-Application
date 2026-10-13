import { Money } from './money';
import type { SearchHit } from '../../shared/types';

/**
 * Human-readable category labels for global search results.
 *
 * Every supported kind gets its own label; the row renders the label in a
 * fixed-width grid column so it can never overlap or intrude into the result
 * title, whatever the label length.
 */
export const SEARCH_KIND_LABELS: Record<SearchHit['kind'], string> = {
  patient: 'Patient',
  appointment: 'Appointment',
  invoice: 'Invoice',
  payment: 'Payment',
  prescription: 'Prescription',
  treatment: 'Treatment',
  staff: 'Staff',
  dentist: 'Dentist',
  inventory: 'Inventory',
  expense: 'Expense',
  visit: 'Visit',
};

export function searchKindLabel(kind: SearchHit['kind']): string {
  return SEARCH_KIND_LABELS[kind] ?? 'Result';
}

/**
 * One global-search result row.
 *
 * Layout is two dedicated grid columns (see `.search-hit` in styles/global.css):
 * the category label and the result content. Long titles and subtitles are
 * constrained with a controlled ellipsis inside their own column and carry a
 * native tooltip with the full value.
 */
export function SearchHitRow(props: { hit: SearchHit; selected: boolean; onOpen: (hit: SearchHit) => void }) {
  const { hit, selected, onOpen } = props;
  return (
    <button
      className={selected ? 'search-hit selected' : 'search-hit'}
      onClick={() => onOpen(hit)}
      type="button"
    >
      <span className="kind">{searchKindLabel(hit.kind)}</span>
      <span className="hit-body">
        <span className="title" title={hit.title}>{hit.title}</span>
        <span className="sub">
          {hit.subtitle}{hit.meta ? ` · ${hit.meta}` : ''}
          {hit.amountPaisa !== undefined && <> · <Money paisa={hit.amountPaisa} noToggle /></>}
        </span>
      </span>
    </button>
  );
}
