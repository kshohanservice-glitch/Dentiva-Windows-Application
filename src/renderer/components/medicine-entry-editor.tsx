import { Button } from './primitives';
import { Field, Input } from './forms';

/** Shared editable shape for both stored and walk-in prescription workflows. */
export interface MedicineEntryValues {
  medicineName: string;
  generic: string;
  form: string;
  strength: string;
  dosage: string;
  frequency: string;
  duration: string;
  qty: string;
  instruction: string;
  medicineInstruction: string;
}

export function MedicineEntryEditor(props: {
  items: readonly MedicineEntryValues[];
  onChange: (index: number, patch: Partial<MedicineEntryValues>) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  formError?: string | null;
  showNameErrors?: boolean;
  allowRemoveLast?: boolean;
}) {
  return (
    <section className="medicine-entry-editor" aria-label="Prescription medicines">
      <div className="row between mb-3">
        <h4 className="small" style={{ margin: 0 }}>Medicines</h4>
        <Button size="sm" variant="secondary" onClick={props.onAdd}>+ Add medicine</Button>
      </div>
      {props.formError && <div className="error mb-2" role="alert">{props.formError}</div>}
      <div className="col gap-3">
        {props.items.map((item, index) => {
          const hasStructuredDirections = [item.dosage, item.frequency, item.duration, item.qty, item.instruction]
            .some((value) => value.trim().length > 0);
          const oneLineInstruction = item.medicineInstruction.trim().length > 0;
          const showRemove = props.items.length > 1 || props.allowRemoveLast;
          return (
            <div className="medicine-entry-card" key={index}>
              <div className="row between medicine-entry-heading">
                <strong className="small">Medicine {index + 1}</strong>
                {showRemove && (
                  <Button
                    size="sm"
                    variant="ghost"
                    ariaLabel={`Remove medicine ${index + 1}`}
                    onClick={() => props.onRemove(index)}
                  >
                    Remove
                  </Button>
                )}
              </div>
              <div className="medicine-entry-grid">
                <Field label="Medicine name" required error={props.showNameErrors && !item.medicineName.trim() ? 'Enter a medicine name.' : null}>
                  {(id) => (
                    <Input
                      id={id}
                      value={item.medicineName}
                      onChange={(value) => props.onChange(index, { medicineName: value })}
                      placeholder="e.g. Amoxicillin"
                      invalid={!!props.showNameErrors && !item.medicineName.trim()}
                      required
                    />
                  )}
                </Field>
                <Field label="Generic name (optional)">
                  {(id) => <Input id={id} value={item.generic} onChange={(value) => props.onChange(index, { generic: value })} />}
                </Field>
                <Field label="Dosage form">
                  {(id) => <Input id={id} value={item.form} onChange={(value) => props.onChange(index, { form: value })} placeholder="e.g. Tablet" />}
                </Field>
                <Field label="Strength">
                  {(id) => <Input id={id} value={item.strength} onChange={(value) => props.onChange(index, { strength: value })} placeholder="e.g. 500 mg" />}
                </Field>
                <Field label="Dosage">
                  {(id) => <Input id={id} value={item.dosage} onChange={(value) => props.onChange(index, { dosage: value })} placeholder="e.g. 1 tablet" />}
                </Field>
                <Field label="Frequency">
                  {(id) => <Input id={id} value={item.frequency} onChange={(value) => props.onChange(index, { frequency: value })} placeholder="e.g. 3× daily" />}
                </Field>
                <Field label="Duration">
                  {(id) => <Input id={id} value={item.duration} onChange={(value) => props.onChange(index, { duration: value })} placeholder="e.g. 5 days" />}
                </Field>
                <Field label="Quantity">
                  {(id) => <Input id={id} value={item.qty} onChange={(value) => props.onChange(index, { qty: value })} placeholder="Optional" />}
                </Field>
                <Field label="Administration note" hint="Structured note, for example “after meals”.">
                  {(id) => <Input id={id} value={item.instruction} onChange={(value) => props.onChange(index, { instruction: value })} placeholder="e.g. after meals" />}
                </Field>
                <Field
                  label="One-line medicine instruction (optional)"
                  className="medicine-entry-full-instruction"
                  hint="Prints beneath the medicine name and replaces the structured dosage, frequency, duration, quantity and administration note. Those entries remain saved; they are not merged with this line."
                >
                  {(id) => (
                    <Input
                      id={id}
                      value={item.medicineInstruction}
                      onChange={(value) => props.onChange(index, { medicineInstruction: value })}
                      placeholder="Enter the instruction exactly as it should print"
                      maxLength={500}
                    />
                  )}
                </Field>
              </div>
              {oneLineInstruction && hasStructuredDirections && (
                <div className="callout callout-warning medicine-entry-conflict" role="note">
                  The one-line instruction replaces the structured dosing details in print. Remove this line to print the structured entries again.
                </div>
              )}
            </div>
          );
        })}
        {props.items.length === 0 && (
          <p className="small muted" style={{ margin: 0 }}>Add at least one medicine — a prescription cannot be printed empty.</p>
        )}
      </div>
    </section>
  );
}
