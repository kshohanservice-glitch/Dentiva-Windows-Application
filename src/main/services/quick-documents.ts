/**
 * Walk-in / Quick Documents — transient document store.
 *
 * A quick document exists only in the main process's memory while its print
 * window is open. Deliberately:
 *
 *   - **No patient row is created.** The payload carries customer details, not
 *     a patient id, so this path cannot insert, update or link a patient.
 *   - **Nothing is written to the database** except one audit entry recording
 *     that a document was prepared (kind + reference, no clinical content).
 *   - **The payload is validated here**, in the main process, with the same
 *     shared validator the form uses — the renderer is never trusted.
 *
 * Draft state therefore stays separate from registered-patient records, as
 * required for data integrity.
 */
import type { Ctx } from '../core/context';
import { audit, requirePermission } from '../core/context';
import { validation } from '../errors';
import {
  QUICK_DOCUMENT_DEFS, validateQuickDocumentInput,
  type QuickDocumentInput, type QuickPrescriptionPayload,
} from '../../shared/quick-documents';
import type { QuickDocumentDTO } from '../../shared/ipc';
import type { DentistDTO } from '../../shared/types';
import { getDentist } from './staff';

/** A prepared document stays printable for two hours (covers a clinic session). */
const TTL_MS = 2 * 60 * 60 * 1000;
/** Bounded memory: at most this many prepared documents are kept. */
const MAX_DOCUMENTS = 24;

interface Entry {
  at: number;
  doc: QuickDocumentDTO;
}

const store = new Map<string, Entry>();
let sequence = 0;

function purge(now = Date.now()): void {
  for (const [token, entry] of store) {
    if (now - entry.at > TTL_MS) store.delete(token);
  }
  while (store.size >= MAX_DOCUMENTS) {
    let oldestToken: string | null = null;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [token, entry] of store) {
      if (entry.at < oldestAt) { oldestAt = entry.at; oldestToken = token; }
    }
    if (!oldestToken) break;
    store.delete(oldestToken);
  }
}

/**
 * Dentist credentials for the header come from the clinic's own dentist record —
 * a selected dentist is always resolved from the database rather than trusted
 * from the renderer, so a prescription can never print invented credentials.
 */
function resolveDentist(ctx: Ctx, input: QuickDocumentInput): DentistDTO | null {
  if (input.kind !== 'prescription') return null;
  const payload = input.payload as QuickPrescriptionPayload;
  if (!payload.dentistId) return null;
  const dentist = getDentist(ctx, payload.dentistId);
  if (!dentist) throw validation('The selected dentist no longer exists. Choose another dentist or type the name.');
  // Signature and photo files are never part of a quick document.
  return { ...dentist, signaturePath: null, photoPath: null };
}

/** Validate and hold a quick document, returning the token used by the print window. */
export function prepareQuickDocument(ctx: Ctx, raw: unknown): { token: string; reference: string } {
  const { input, errors } = validateQuickDocumentInput(raw);
  if (!input) throw validation(errors[0] ?? 'This quick document is not complete.');
  const def = QUICK_DOCUMENT_DEFS[input.kind];
  // Creating the document and printing it are separate rights; require both so
  // the quick path cannot be used to bypass the ordinary print permission.
  requirePermission(ctx, def.permission);
  requirePermission(ctx, def.printPermission);

  purge();
  const token = `qd-${Date.now().toString(36)}-${(++sequence).toString(36)}`;
  store.set(token, {
    at: Date.now(),
    doc: {
      kind: input.kind,
      payload: input.payload,
      dentist: resolveDentist(ctx, input),
      createdAt: new Date().toISOString(),
    },
  });
  audit(ctx, {
    action: 'document.quick.prepare',
    entityType: 'quick_document',
    entityId: null,
    summary: `${def.label} prepared for printing (reference ${input.payload.reference})`,
  });
  return { token, reference: input.payload.reference };
}

/** Read a prepared document (the print window calls this). Expired tokens fail loudly. */
export function readQuickDocument(ctx: Ctx, rawToken: unknown): QuickDocumentDTO {
  const token = typeof rawToken === 'string' ? rawToken.trim() : '';
  if (!token) throw validation('Missing quick-document reference.');
  purge();
  const entry = store.get(token);
  if (!entry) {
    throw validation('This quick document has expired. Prepare it again from Walk-in / Quick Documents.');
  }
  requirePermission(ctx, QUICK_DOCUMENT_DEFS[entry.doc.kind].printPermission);
  return entry.doc;
}

/** Test helper: drop every prepared document. */
export function clearQuickDocuments(): void {
  store.clear();
}

/** Number of prepared documents currently held (test/observability helper). */
export function quickDocumentCount(): number {
  return store.size;
}
