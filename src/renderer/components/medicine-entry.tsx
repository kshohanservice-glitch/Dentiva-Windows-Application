import React, { useState } from 'react';
import { Button, ConfirmDialog } from './primitives';
import { Field, Input, Select } from './forms';
import { DOSAGE_FORM_OPTIONS, MEDICINE_INSTRUCTION_EXAMPLE } from '../../shared/clinical';

/**
 * Shared medicine-row editor.
 *
 * One implementation is used by **both** prescription workflows — the stored
 * prescription form (`Patients.tsx → RxFormModal`) and the walk-in / quick
 * prescription (`QuickDocuments.tsx → PrescriptionFields`) — so the two screens
 * cannot drift apart again. Before v4.1.3 the walk-in rows carried placeholders
 * only (no labels at all) in a 116 px grid, which is where operators were left
 * guessing what a clipped `F…` or `3…` column meant.
 *
 * Rules encoded here:
 *   - every field has a visible, persistent label (never placeholder-only);
 *   - every ambiguous field explains itself (unit, format, example) in a hint;
 *   - the grid is responsive and the name / instruction fields are wider;
 *   - adding a row never touches existing rows and removing a row that has
 *     content asks first, so nothing is lost by accident;
 *   - the same nine values are offered in both modules; a module that does not
 *     persist one of them simply hides it with `fields`.
 */

export interface MedicineDraft {
  medicineName: string;
  form: string;
  strength: string;
  generic: string;
  dosage: string;
  frequency: string;
  duration: string;
  qty: string;
  instruction: string;
}

export type MedicineFieldKey = keyof MedicineDraft;

export function emptyMedicineDraft(): MedicineDraft {
  return {
    medicineName: '', form: '', strength: '', generic: '',
    dosage: '', frequency: '', duration: '', qty: '', instruction: '',
  };
}

/** Coerce untrusted input (a saved template, a stored row) into a draft row. */
export function toMedicineDraft(raw: unknown): MedicineDraft {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const text = (key: MedicineFieldKey): string => {
    const value = source[key];
    return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
  };
  return {
    medicineName: text('medicineName'), form: text('form'), strength: text('strength'),
    generic: text('generic'), dosage: text('dosage'), frequency: text('frequency'),
    duration: text('duration'), qty: text('qty'), instruction: text('instruction'),
  };
}

/** Draft rows from a saved medicine template (never throws on a malformed body). */
export function medicineDraftsFromTemplate(items: unknown): MedicineDraft[] {
  if (!Array.isArray(items)) return [];
  return items.map(toMedicineDraft).filter((row) => row.medicineName.trim() !== '');
}

export function isMedicineDraftEmpty(row: MedicineDraft): boolean {
  return Object.values(row).every((value) => !String(value ?? '').trim());
}

/** Rows the service will store: a row without a medicine name is a drafting leftover. */
export function medicineDraftsToInput(rows: MedicineDraft[]): MedicineDraft[] {
  return rows.filter((row) => row.medicineName.trim() !== '');
}

const ALL_FIELDS: MedicineFieldKey[] = ['medicineName', 'form', 'strength', 'generic', 'dosage', 'frequency', 'duration', 'qty', 'instruction'];

export function MedicineRowsEditor(props: {
  rows: MedicineDraft[];
  onChange: (next: MedicineDraft[]) => void;
  /** Fields to render. Omit to render all nine. */
  fields?: MedicineFieldKey[];
  /** List-level validation message (e.g. “every row needs a name”). */
  listError?: string | null;
  /** Highlight empty medicine-name fields (used after a failed submit). */
  markMissingNames?: boolean;
  addLabel?: string;
  max?: number;
  /** Rendered between the heading and the rows (templates, hints…). */
  before?: React.ReactNode;
}) {
  const fields = props.fields ?? ALL_FIELDS;
  const keep = (key: MedicineFieldKey) => fields.includes(key);
  const [pendingRemove, setPendingRemove] = useState<number | null>(null);

  const addRow = () => props.onChange([...props.rows, emptyMedicineDraft()]);
  const removeRow = (index: number) => props.onChange(props.rows.filter((_, i) => i !== index));
  const setRow = (index: number, patch: Partial<MedicineDraft>) =>
    props.onChange(props.rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const askRemove = (index: number) => {
    if (isMedicineDraftEmpty(props.rows[index])) removeRow(index);
    else setPendingRemove(index);
  };

  const overLimit = props.max !== undefined && props.rows.length >= props.max;

  return (
    <div className="medicine-editor">
      <div className="row between wrap gap-2 medicine-editor-head">
        <div>
          <h4 style={{ margin: 0 }}>Medicines</h4>
          <p className="xsmall muted" style={{ margin: '2px 0 0' }}>
            Fill the fields you need — every field except the medicine name is optional.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={addRow}
          disabled={overLimit}
          title={overLimit ? `A prescription can hold at most ${props.max} medicines.` : 'Add another medicine row'}
        >
          {props.addLabel ?? '+ Add medicine'}
        </Button>
      </div>

      {props.before}

      {props.listError && <div className="error mt-2" role="alert">{props.listError}</div>}
      {overLimit && (
        <div className="hint mt-2">Maximum of {props.max} medicines reached for one prescription.</div>
      )}

      <div className="mt-2">
        {props.rows.map((row, index) => (
          <div className="rx-item" key={index}>
            <div className="row between wrap gap-2 mb-2">
              <strong className="small">Medicine {index + 1}</strong>
              {props.rows.length > 1 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => askRemove(index)}
                  aria-label={`Remove medicine ${index + 1}`}
                  title={`Remove medicine ${index + 1}`}
                >
                  Remove
                </Button>
              )}
            </div>
            <div className="rx-grid">
              {keep('medicineName') && (
                <Field
                  label="Medicine name"
                  required
                  className="span-2"
                  hint="Brand or generic name exactly as it should print."
                >
                  {(id) => (
                    <Input
                      id={id}
                      value={row.medicineName}
                      onChange={(v) => setRow(index, { medicineName: v })}
                      placeholder="e.g. Amoxicillin"
                      invalid={props.markMissingNames && !row.medicineName.trim()}
                    />
                  )}
                </Field>
              )}
              {keep('form') && (
                <Field label="Dosage form" hint="Printed in front of the name (e.g. “Tab Amoxicillin”).">
                  {(id) => (
                    <Select
                      id={id}
                      value={row.form}
                      onChange={(v) => setRow(index, { form: v })}
                      options={DOSAGE_FORM_OPTIONS}
                    />
                  )}
                </Field>
              )}
              {keep('strength') && (
                <Field label="Strength" hint="Amount of drug per unit, e.g. 500mg.">
                  {(id) => (
                    <Input
                      id={id}
                      value={row.strength}
                      onChange={(v) => setRow(index, { strength: v })}
                      placeholder="500mg"
                    />
                  )}
                </Field>
              )}
              {keep('generic') && (
                <Field label="Generic name" hint="Molecule / generic name (optional).">
                  {(id) => (
                    <Input
                      id={id}
                      value={row.generic}
                      onChange={(v) => setRow(index, { generic: v })}
                      placeholder="e.g. Amoxicillin trihydrate"
                    />
                  )}
                </Field>
              )}
              {keep('dosage') && (
                <Field label="Dosage per dose" hint="How much is taken at one time.">
                  {(id) => (
                    <Input
                      id={id}
                      value={row.dosage}
                      onChange={(v) => setRow(index, { dosage: v })}
                      placeholder="1 tablet"
                    />
                  )}
                </Field>
              )}
              {keep('frequency') && (
                <Field label="Frequency" hint="e.g. 1+0+1 (morning + night) or “thrice daily”.">
                  {(id) => (
                    <Input
                      id={id}
                      value={row.frequency}
                      onChange={(v) => setRow(index, { frequency: v })}
                      placeholder="1+0+1"
                    />
                  )}
                </Field>
              )}
              {keep('duration') && (
                <Field label="Duration" hint="How long the medicine is continued.">
                  {(id) => (
                    <Input
                      id={id}
                      value={row.duration}
                      onChange={(v) => setRow(index, { duration: v })}
                      placeholder="7 days"
                    />
                  )}
                </Field>
              )}
              {keep('qty') && (
                <Field label="Quantity to dispense" hint="Total units handed to the patient, e.g. 14 tablets.">
                  {(id) => (
                    <Input
                      id={id}
                      value={row.qty}
                      onChange={(v) => setRow(index, { qty: v })}
                      placeholder="14 tablets"
                    />
                  )}
                </Field>
              )}
              {keep('instruction') && (
                <Field
                  label="Instruction for this medicine"
                  hint="Anything else the patient must know, e.g. “after meals”."
                  className="span-2"
                >
                  {(id) => (
                    <Input
                      id={id}
                      value={row.instruction}
                      onChange={(v) => setRow(index, { instruction: v })}
                      placeholder="after meals"
                    />
                  )}
                </Field>
              )}
            </div>
          </div>
        ))}
        {props.rows.length === 0 && (
          <p className="small muted" style={{ margin: 0 }}>
            No medicine rows yet. Use “{props.addLabel ?? '+ Add medicine'}” to add one.
          </p>
        )}
      </div>

      {pendingRemove !== null && (
        <ConfirmDialog
          title="Remove this medicine?"
          body={`Medicine ${pendingRemove + 1} already contains information. Removing the row discards it.`}
          confirmLabel="Remove medicine"
          danger
          onCancel={() => setPendingRemove(null)}
          onConfirm={() => { removeRow(pendingRemove); setPendingRemove(null); }}
        />
      )}
    </div>
  );
}

/**
 * Optional single-line medicine instruction.
 *
 * Additive to the structured rows above: a doctor who prefers one line can type
 * the whole instruction here, while a doctor who filled the structured rows can
 * leave it empty. The rule for the printed document is explicit — see
 * `medicineInstructionState()` in `shared/clinical.ts`:
 *
 *   structured rows → printed in the medicine list (unchanged)
 *   this line       → printed as its own labelled block
 *   both filled     → both print, and the form says so before saving
 *
 * The field is never auto-filled, never parsed into structured fields and never
 * replaces an entered value.
 */
export function MedicineInstructionField(props: {
  value: string;
  onChange: (value: string) => void;
  /** Number of structured rows that already carry a medicine name. */
  structuredCount: number;
  error?: string | null;
}) {
  const bothFilled = props.structuredCount > 0 && props.value.trim().length > 0;
  return (
    <div className="medicine-instruction">
      <Field
        label="Medicine instruction (optional)"
        hint={`One complete line per medicine, exactly as it should print — e.g. ${MEDICINE_INSTRUCTION_EXAMPLE}`}
        error={props.error ?? null}
      >
        {(id) => (
          <Input
            id={id}
            value={props.value}
            onChange={props.onChange}
            placeholder={MEDICINE_INSTRUCTION_EXAMPLE}
            invalid={!!props.error}
          />
        )}
      </Field>
      {bothFilled && (
        <div className="callout callout-info small" role="status">
          <strong>Both forms of entry are filled.</strong> The {props.structuredCount} structured medicine
          {props.structuredCount === 1 ? '' : 's'} above and this single-line instruction will <em>both</em> print,
          one after the other. Clear whichever one you do not want on the prescription.
        </div>
      )}
    </div>
  );
}
