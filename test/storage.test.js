// @ts-check
import { assert, test } from './harness.js';
import { decodeSettings, emptySettings } from '../src/ui/storage.js';

test('decodeSettings reads a full record', () => {
  const stored = {
    debtorName: 'Red Yard Research SRL',
    debtorIban: 'IT60X0542811101000000123456',
    debtorBic: 'UNCRITMM',
    debtorAbi: '03069',
    debtorCuc: 'ABC1234567',
    remittanceTemplate: 'Compenso {period}',
    csvTemplateId: 'generic-bulk-transfer',
    xmlProfileId: 'cbi-pain001-v9',
  };
  assert.deepEqual(decodeSettings(JSON.stringify(stored)), stored);
});

test('decodeSettings ignores fields of the wrong type', () => {
  const settings = decodeSettings(JSON.stringify({ debtorName: 42, debtorIban: null }));
  assert.equal(settings?.debtorName, '');
  assert.equal(settings?.debtorIban, '');
});

test('decodeSettings ignores fields it does not know', () => {
  const settings = decodeSettings(JSON.stringify({ debtorName: 'X', surprise: { a: 1 } }));
  assert.deepEqual(Object.keys(settings ?? {}).sort(), Object.keys(emptySettings()).sort());
});

test('decodeSettings falls back for the remittance template', () => {
  assert.equal(decodeSettings('{}')?.remittanceTemplate, 'Stipendio {period}');
});

test('decodeSettings rejects an unknown XML profile', () => {
  assert.equal(decodeSettings(JSON.stringify({ xmlProfileId: 'pain001-v42' }))?.xmlProfileId, 'pain001-v3');
  assert.equal(decodeSettings(JSON.stringify({ xmlProfileId: 'pain001-v9' }))?.xmlProfileId, 'pain001-v9');
});

test('decodeSettings returns null for nothing usable', () => {
  assert.equal(decodeSettings(null), null);
  assert.equal(decodeSettings(''), null);
  assert.equal(decodeSettings('not json'), null);
  assert.equal(decodeSettings('[]'), null, 'an array is not a settings record');
  assert.equal(decodeSettings('"text"'), null);
  assert.equal(decodeSettings('null'), null);
});

test('emptySettings is a complete record', () => {
  const settings = emptySettings();
  assert.equal(settings.remittanceTemplate, 'Stipendio {period}');
  assert.equal(settings.xmlProfileId, 'pain001-v3');
  assert.equal(
    Object.values(settings).every((value) => typeof value === 'string'),
    true,
  );
});
