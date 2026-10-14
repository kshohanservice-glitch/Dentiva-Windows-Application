import React, { useEffect, useId, useMemo, useState } from 'react';
import {
  DOCUMENT_SECTIONS, DOCUMENT_SECTION_LABELS, DOCUMENT_TYPE_DEFS, documentTypeDef,
  countDocumentOverrides, propDef, resetAllDocuments, resetDocument, resetElement, resetSection,
  styleOverride,
  type CustomizableDocumentType, type DocumentElementStyle, type DocumentSection, type DocumentStyleMap,
  type DocumentStylePropKey,
} from '../../shared/document-styles';
import type { ClinicSettings, SettingsDTO } from '../../shared/types';
import { Badge, Button, Card, Tabs, useToast } from './primitives';
import { Select } from './forms';
import { DocumentPreview, sampleDocumentNode } from '../documents/document-preview';

/**
 * Settings → Customize Documents.
 *
 * Every control here writes to one typed configuration map
 * (`DocumentStyleMap`). Nothing is applied to a document until it is rendered,
 * so a change to one line of one document cannot leak into another document or
 * into any ordinary application screen.
 *
 * The preview uses the real document builders with realistic sample content,
 * which is why the preview and the printed page agree.
 */
export function CustomizeDocumentsPanel(props: {
  value: DocumentStyleMap;
  onChange: (next: DocumentStyleMap) => void;
  clinic?: ClinicSettings | null;
  settings?: SettingsDTO | null;
}) {
  const toast = useToast();
  const [docType, setDocType] = useState<CustomizableDocumentType>('prescription');
  const [section, setSection] = useState<DocumentSection>('header');
  const [elementId, setElementId] = useState<string>('');

  const typeDef = documentTypeDef(docType);
  const sectionElements = useMemo(
    () => typeDef.elements.filter((e) => e.section === section),
    [typeDef, section],
  );

  // Keep the selected element valid when the document or section changes.
  useEffect(() => {
    if (!sectionElements.some((e) => e.id === elementId)) {
      setElementId(sectionElements[0]?.id ?? '');
    }
  }, [sectionElements, elementId]);

  const element = typeDef.elements.find((e) => e.id === elementId) ?? sectionElements[0];
  const elementStyle: DocumentElementStyle = (element && styleOverride(props.value, docType, element.id)) || {};

  const preview = useMemo(
    () => sampleDocumentNode(docType, { clinic: props.clinic ?? undefined, settings: props.settings ?? undefined }),
    [docType, props.clinic, props.settings],
  );

  const setProp = (key: DocumentStylePropKey, value: unknown): void => {
    if (!element) return;
    const next: DocumentStyleMap = {
      ...props.value,
      [docType]: { ...(props.value[docType] ?? {}), [element.id]: { ...elementStyle, [key]: value } },
    };
    props.onChange(next);
  };

  const clearProp = (key: DocumentStylePropKey): void => {
    if (!element) return;
    const style: DocumentElementStyle = { ...elementStyle };
    delete style[key];
    const forDoc = { ...(props.value[docType] ?? {}) };
    if (Object.keys(style).length === 0) delete forDoc[element.id];
    else forDoc[element.id] = style;
    const next: DocumentStyleMap = { ...props.value };
    if (Object.keys(forDoc).length === 0) delete next[docType];
    else next[docType] = forDoc;
    props.onChange(next);
  };

  const customisedElements = countDocumentOverrides(props.value, docType);
  const customisedDocs = DOCUMENT_TYPE_DEFS.filter((d) => countDocumentOverrides(props.value, d.type) > 0).length;

  return (
    <div className="col gap-4">
      <Card title="Customize documents" actions={<Badge tone={customisedDocs > 0 ? 'info' : 'neutral'}>{customisedDocs} of {DOCUMENT_TYPE_DEFS.length} documents customized</Badge>}>
        <p className="small muted" style={{ marginTop: 0 }}>
          Documents print with their original design until you change something here. Changing one line changes only
          that line: colours, sizes, spacing and borders are stored per document and per element. Printing, the print
          preview and “Save PDF” all use these settings, and resetting restores the original design.
        </p>
        <div className="form-grid">
          <Select
            value={docType}
            onChange={(v) => { setDocType(v as CustomizableDocumentType); setSection('header'); }}
            options={DOCUMENT_TYPE_DEFS.map((d) => ({ value: d.type, label: d.label }))}
          />
          <div className="row gap-2 wrap" style={{ alignItems: 'center' }}>
            <span className="xsmall muted">{typeDef.description}</span>
          </div>
        </div>
        <div className="row gap-2 mt-4 wrap">
          <Button
            size="sm" variant="secondary"
            disabled={customisedElements === 0}
            onClick={() => { props.onChange(resetDocument(props.value, docType)); toast.success('Document reset to the original design', typeDef.label); }}
          >
            Reset this document
          </Button>
          <Button
            size="sm" variant="secondary"
            disabled={customisedElements === 0}
            onClick={() => { props.onChange(resetSection(props.value, docType, section)); toast.success(`${DOCUMENT_SECTION_LABELS[section]} reset`, typeDef.label); }}
          >
            Reset {DOCUMENT_SECTION_LABELS[section].toLowerCase()}
          </Button>
          <Button
            size="sm" variant="danger"
            disabled={customisedDocs === 0}
            onClick={() => { props.onChange(resetAllDocuments()); toast.success('All document customizations removed'); }}
          >
            Reset every document
          </Button>
        </div>
      </Card>

      <div className="customize-grid">
        <Card title="Elements" className="customize-elements">
          <Tabs
            tabs={DOCUMENT_SECTIONS.map((s) => ({ key: s, label: DOCUMENT_SECTION_LABELS[s] }))}
            active={section}
            onChange={(s) => setSection(s)}
          />
          <div className="list mt-4">
            {sectionElements.length === 0 && <p className="small muted">This document has no {DOCUMENT_SECTION_LABELS[section].toLowerCase()} elements.</p>}
            {sectionElements.map((e) => {
              const customised = !!props.value[docType]?.[e.id];
              const active = e.id === element?.id;
              return (
                <button
                  key={e.id}
                  type="button"
                  className={`list-row clickable ${active ? 'active' : ''}`}
                  onClick={() => setElementId(e.id)}
                  style={{ width: '100%', textAlign: 'left' }}
                >
                  <span className="flex-1">
                    <strong className="small">{e.label}</strong>
                    {e.hint && <div className="xsmall muted">{e.hint}</div>}
                  </span>
                  {customised && <Badge tone="info">edited</Badge>}
                </button>
              );
            })}
          </div>
        </Card>

        <Card
          title={element ? element.label : 'Element'}
          actions={element && props.value[docType]?.[element.id]
            ? <Button size="sm" variant="ghost" onClick={() => { props.onChange(resetElement(props.value, docType, element.id)); toast.success('Element reset'); }}>Reset element</Button>
            : undefined}
          className="customize-controls"
        >
          {!element && <p className="small muted">Select an element to customize.</p>}
          {element && (
            <div className="col gap-4">
              <p className="xsmall muted" style={{ margin: 0 }}>
                {element.id} · any property left untouched keeps the original document value.
              </p>
              <div className="style-controls">
                {element.props.map((key) => (
                  <StyleControl
                    key={key}
                    propKey={key}
                    elementOptional={!!element.optional}
                    value={elementStyle[key]}
                    onSet={(v) => setProp(key, v)}
                    onClear={() => clearProp(key)}
                  />
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card title="Preview" actions={<span className="xsmall muted">Real document renderer · sample content</span>}>
        <DocumentPreview styles={props.value} zoom={0.72}>{preview}</DocumentPreview>
      </Card>
    </div>
  );
}

/* --------------------------------------------------------------- controls */

function StyleControl(props: {
  propKey: DocumentStylePropKey;
  elementOptional: boolean;
  value: unknown;
  onSet: (value: unknown) => void;
  onClear: () => void;
}): React.ReactElement {
  const def = propDef(props.propKey);
  // The label and its control are always associated, so the panel is navigable
  // by keyboard and screen reader like the rest of the application.
  const fieldId = useId();
  const set = props.value !== undefined && props.value !== null;
  const label = (
    <span className="row gap-2" style={{ alignItems: 'center' }}>
      {def.label}
      {set && <button type="button" className="btn btn-ghost btn-sm" title="Use the original value" onClick={props.onClear}>↺</button>}
    </span>
  );

  if (def.control === 'toggle') {
    return (
      <label className="checkbox style-control">
        <input
          type="checkbox"
          checked={props.value === false}
          onChange={(e) => (e.target.checked ? props.onSet(false) : props.onClear())}
        />
        <span>{def.label}{props.elementOptional ? ' (hide this element)' : ''}</span>
      </label>
    );
  }

  if (def.control === 'select') {
    return (
      <div className="field style-control">
        <label htmlFor={fieldId}>{label}</label>
        <Select
          id={fieldId}
          value={typeof props.value === 'string' ? props.value : ''}
          onChange={(v) => (v ? props.onSet(v) : props.onClear())}
          placeholder="Original"
          options={[{ value: '', label: 'Original' }, ...(def.options ?? [])]}
        />
      </div>
    );
  }

  if (def.control === 'color') {
    return (
      <div className="field style-control">
        <label htmlFor={fieldId}>{label}</label>
        <div className="row gap-2">
          <input
            id={fieldId}
            type="color"
            className="input style-color"
            value={typeof props.value === 'string' ? props.value : '#000000'}
            onChange={(e) => props.onSet(e.target.value)}
          />
          <code className="xsmall muted">{set ? String(props.value) : 'original'}</code>
        </div>
      </div>
    );
  }

  return (
    <div className="field style-control">
      <label htmlFor={fieldId}>{label}</label>
      <StyleNumberInput
        id={fieldId}
        value={typeof props.value === 'number' ? props.value : null}
        min={def.min ?? 0}
        max={def.max ?? 100}
        step={def.step ?? 1}
        onCommit={props.onSet}
        onClear={props.onClear}
      />
    </div>
  );
}

/** Number input that commits on blur/Enter and clamps to the documented range. */
function StyleNumberInput(props: {
  id?: string;
  value: number | null;
  min: number; max: number; step: number;
  onCommit: (value: number) => void;
  onClear: () => void;
}): React.ReactElement {
  const [text, setText] = useState(props.value === null ? '' : String(props.value));
  useEffect(() => { setText(props.value === null ? '' : String(props.value)); }, [props.value]);

  const commit = (): void => {
    if (text.trim() === '') { props.onClear(); return; }
    const n = Number(text);
    if (!Number.isFinite(n)) { setText(props.value === null ? '' : String(props.value)); return; }
    const clamped = Math.max(props.min, Math.min(props.max, n));
    props.onCommit(clamped);
    setText(String(clamped));
  };

  return (
    <div className="row gap-2" style={{ alignItems: 'center' }}>
      <input
        id={props.id}
        className="input"
        style={{ width: 104 }}
        inputMode="decimal"
        value={text}
        placeholder="original"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
      />
      <span className="xsmall muted">{props.min}–{props.max}</span>
    </div>
  );
}
