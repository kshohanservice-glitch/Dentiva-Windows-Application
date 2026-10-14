import type { DB } from '../database';
import { migration001 } from './001_init';
import { migration002 } from './002_allow_explicit_financial_delete';
import { migration003 } from './003_retire_queue';
import { migration004 } from './004_appointment_lifecycle';
import { migration005 } from './005_clinical_templates';
import { migration006 } from './006_whatsapp';
import { migration007 } from './007_prescription_medicine_instruction';

export interface Migration {
  version: number;
  name: string;
  up: (db: DB) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    version: migration001.version,
    name: migration001.name,
    up(db: DB) {
      db.exec(migration001.ddl);
      migration001.seed(db);
    },
  },
  {
    version: migration002.version,
    name: migration002.name,
    up: migration002.up,
  },
  {
    version: migration003.version,
    name: migration003.name,
    up: migration003.up,
  },
  {
    version: migration004.version,
    name: migration004.name,
    up: migration004.up,
  },
  {
    version: migration005.version,
    name: migration005.name,
    up: migration005.up,
  },
  {
    version: migration006.version,
    name: migration006.name,
    up: migration006.up,
  },
  {
    version: migration007.version,
    name: migration007.name,
    up: migration007.up,
  },
];
