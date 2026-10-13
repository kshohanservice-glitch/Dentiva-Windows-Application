# Queue subsystem removal (Dentiva Pro 3.1)

The patient queue (waiting list, call/start/complete, queue numbers) was removed
from the product. Appointments are now a reminder-only schedule.

## What was removed
- Service: `src/main/services/queue.ts`
- Screen: `src/renderer/pages/Queue.tsx` and its navigation entry
- IPC channels, shared types, permission keys (`queue.view`, `queue.manage`),
  dashboard "waiting in queue" card, and the appointment "Arrive → queue" action.
- Tests that exercised queue behaviour were removed or rewritten for appointments.

## What was preserved (never dropped)
- The `queue_entries` table is kept as a dormant archive. Nothing reads or writes it.
  Rows remain available to a future export tool.
- Existing appointment rows are not rewritten. Legacy statuses `arrived`,
  `in_queue`, `in_treatment` and `rescheduled` keep their stored value.
  They are read as open for expiry and visibility and are never written again.
- Visits, invoices and payments are not affected by the queue removal.

## Migration
- `003_retire_queue` (schema version 3): deletes only `permissions`, `role_permissions`
  and `user_permission_overrides` rows whose key starts with `queue.`, and writes
  one audit row stating how many queue rows were archived.
- The migration runs in a transaction and is covered by
  `tests/integration/migration-v303.test.ts` against the released v3.0.3 database.

## Rollback
Downgrades are not supported (the app refuses databases with a newer schema
version). To recover queue history, restore a v3.0.3 backup into a v3.0.3 build.
