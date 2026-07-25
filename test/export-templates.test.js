// @ts-check
import { assert, test } from './harness.js';
import { parseCsv } from '../src/core/csv.js';
import {
  formatConfigJson,
  renderPaymentsCsv,
  templateById,
  validateTemplateConfig,
  valueForColumn,
} from '../src/core/export-templates.js';

/** @type {import('../src/core/payment-rows.js').PaymentRow} */
const PAYMENT = {
  codiceFiscale: 'FRMFRC91P22D086S',
  beneficiaryName: 'FORMICA FEDERICO',
  recipientType: 'INDIVIDUAL',
  email: 'federico@example.com',
  iban: 'IT60X0542811101000000123456',
  amount: 205600,
  period: '202606',
  remittanceInformation: 'Stipendio 202606',
  sourcePage: 1,
};

/** @param {unknown[]} columns */
const configWith = (columns) => ({
  schemaVersion: 1,
  templates: [{ id: 'test', label: 'Test', columns }],
});

test('validateTemplateConfig accepts a minimal configuration', () => {
  const config = validateTemplateConfig(configWith([{ header: 'IBAN', source: 'iban' }]));
  assert.equal(config.schemaVersion, 1);
  assert.equal(config.templates[0].columns[0].source, 'iban');
  assert.equal(config.templates[0].delimiter, ',', 'defaults to comma');
});

test('validateTemplateConfig rejects an unknown source', () => {
  // The bug this design exists to prevent: a typo must not become an empty column.
  assert.throws(
    () => validateTemplateConfig(configWith([{ header: 'IBAN', source: 'ibann' }])),
    /non riconosciuta/,
  );
});

test('validateTemplateConfig rejects an unknown amount format', () => {
  assert.throws(
    () => validateTemplateConfig(configWith([{ header: 'Importo', source: 'amount', format: 'euro' }])),
    /"format" non riconosciuto/,
  );
});

test('validateTemplateConfig requires exactly one of source and fixed', () => {
  assert.throws(() => validateTemplateConfig(configWith([{ header: 'X' }])), /"source" oppure "fixed"/);
  assert.throws(
    () => validateTemplateConfig(configWith([{ header: 'X', source: 'iban', fixed: 'y' }])),
    /"source" oppure "fixed"/,
  );
});

test('validateTemplateConfig requires headers, ids and labels', () => {
  assert.throws(() => validateTemplateConfig(configWith([{ source: 'iban' }])), /manca "header"/);
  assert.throws(
    () => validateTemplateConfig({ templates: [{ label: 'X', columns: [{ header: 'a', source: 'iban' }] }] }),
    /manca "id"/,
  );
  assert.throws(
    () => validateTemplateConfig({ templates: [{ id: 'x', columns: [{ header: 'a', source: 'iban' }] }] }),
    /manca "label"/,
  );
});

test('validateTemplateConfig rejects empty and malformed input', () => {
  assert.throws(() => validateTemplateConfig(null), /oggetto JSON/);
  assert.throws(() => validateTemplateConfig([]), /oggetto JSON/);
  assert.throws(() => validateTemplateConfig({ templates: [] }), /non vuoto/);
  assert.throws(() => validateTemplateConfig({ templates: [{ id: 'a', label: 'A', columns: [] }] }), /"columns"/);
});

test('validateTemplateConfig rejects duplicate ids', () => {
  const columns = [{ header: 'IBAN', source: 'iban' }];
  assert.throws(
    () =>
      validateTemplateConfig({
        templates: [
          { id: 'same', label: 'One', columns },
          { id: 'same', label: 'Two', columns },
        ],
      }),
    /duplicato/,
  );
});

test('validateTemplateConfig names the offending template and column', () => {
  try {
    validateTemplateConfig({
      templates: [
        { id: 'ok', label: 'Ok', columns: [{ header: 'IBAN', source: 'iban' }] },
        { id: 'broken', label: 'Broken', columns: [{ header: 'Boom', source: 'nope' }] },
      ],
    });
    assert.ok(false, 'should have thrown');
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    assert.ok(message.includes('broken'), message);
    assert.ok(message.includes('Boom'), message);
  }
});

test('a boolean fixed value becomes TRUE or FALSE', () => {
  const config = validateTemplateConfig(configWith([{ header: 'Salary', fixed: true }]));
  assert.equal(config.templates[0].columns[0].fixed, 'TRUE');
});

test('validateTemplateConfig checks the delimiter', () => {
  const columns = [{ header: 'IBAN', source: 'iban' }];
  assert.equal(
    validateTemplateConfig({ templates: [{ id: 'a', label: 'A', delimiter: ';', columns }] }).templates[0]
      .delimiter,
    ';',
  );
  assert.throws(
    () => validateTemplateConfig({ templates: [{ id: 'a', label: 'A', delimiter: '|', columns }] }),
    /"delimiter"/,
  );
});

test('valueForColumn reads every source', () => {
  /** @type {Array<[import('../src/core/export-templates.js').CsvSource, string]>} */
  const expectations = [
    ['beneficiaryName', 'FORMICA FEDERICO'],
    ['recipientType', 'INDIVIDUAL'],
    ['email', 'federico@example.com'],
    ['codiceFiscale', 'FRMFRC91P22D086S'],
    ['iban', 'IT60X0542811101000000123456'],
    ['recipientBankCountry', 'IT'],
    ['currency', 'EUR'],
    ['period', '202606'],
    ['remittanceInformation', 'Stipendio 202606'],
    ['sourcePage', '1'],
  ];
  for (const [source, expected] of expectations) {
    assert.equal(valueForColumn(PAYMENT, { header: source, source }), expected, source);
  }
});

test('valueForColumn writes amounts in each format', () => {
  const amount = /** @type {const} */ ('amount');
  assert.equal(valueForColumn(PAYMENT, { header: 'a', source: amount, format: 'decimal-dot' }), '2056.00');
  assert.equal(valueForColumn(PAYMENT, { header: 'a', source: amount, format: 'decimal-comma' }), '2056,00');
  assert.equal(valueForColumn(PAYMENT, { header: 'a', source: amount, format: 'italian' }), '2.056,00');
  assert.equal(valueForColumn(PAYMENT, { header: 'a', source: amount, format: 'integer' }), '2056');
  assert.equal(valueForColumn(PAYMENT, { header: 'a', source: amount }), '2056.00', 'defaults to decimal-dot');
});

test('renderPaymentsCsv lays out the columns as configured', () => {
  const config = validateTemplateConfig(
    configWith([
      { header: 'Nome', source: 'beneficiaryName' },
      { header: 'IBAN', source: 'iban' },
      { header: 'Importo', source: 'amount', format: 'decimal-comma' },
      { header: 'Salary', fixed: 'TRUE' },
    ]),
  );
  const csv = renderPaymentsCsv([PAYMENT], config.templates[0]);
  assert.deepEqual(parseCsv(csv), [
    ['Nome', 'IBAN', 'Importo', 'Salary'],
    ['FORMICA FEDERICO', 'IT60X0542811101000000123456', '2056,00', 'TRUE'],
  ]);
});

test('a comma decimal is quoted so the file stays readable', () => {
  const config = validateTemplateConfig(
    configWith([{ header: 'Importo', source: 'amount', format: 'decimal-comma' }]),
  );
  const csv = renderPaymentsCsv([PAYMENT], config.templates[0]);
  assert.ok(csv.includes('"2056,00"'), csv);
  assert.deepEqual(parseCsv(csv)[1], ['2056,00'], 'and reads back as one field');
});

test('renderPaymentsCsv honours a semicolon delimiter', () => {
  const config = validateTemplateConfig({
    templates: [
      {
        id: 'semi',
        label: 'Semi',
        delimiter: ';',
        columns: [
          { header: 'IBAN', source: 'iban' },
          { header: 'Importo', source: 'amount', format: 'decimal-comma' },
        ],
      },
    ],
  });
  const csv = renderPaymentsCsv([PAYMENT], config.templates[0]);
  assert.ok(csv.startsWith('IBAN;Importo'));
  assert.deepEqual(parseCsv(csv)[1], ['IT60X0542811101000000123456', '2056,00']);
});

test('renderPaymentsCsv with no payments is a header', () => {
  const config = validateTemplateConfig(configWith([{ header: 'IBAN', source: 'iban' }]));
  assert.equal(renderPaymentsCsv([], config.templates[0]), 'IBAN\n');
});

test('templateById falls back to the first template', () => {
  const config = validateTemplateConfig({
    templates: [
      { id: 'first', label: 'First', columns: [{ header: 'IBAN', source: 'iban' }] },
      { id: 'second', label: 'Second', columns: [{ header: 'IBAN', source: 'iban' }] },
    ],
  });
  assert.equal(templateById(config, 'second')?.id, 'second');
  assert.equal(templateById(config, 'nope')?.id, 'first');
  assert.equal(templateById(config, undefined)?.id, 'first');
});

test('formatConfigJson round-trips through validation', () => {
  const config = validateTemplateConfig(configWith([{ header: 'IBAN', source: 'iban' }]));
  const json = formatConfigJson(config);
  assert.ok(json.endsWith('\n'));
  assert.deepEqual(validateTemplateConfig(JSON.parse(json)), config);
});

test('the shipped default configuration is valid and renders', async () => {
  const { readRepoFile } = await import('./read-file.js');
  const config = validateTemplateConfig(
    JSON.parse(await readRepoFile('config/export-templates.default.json')),
  );
  assert.ok(config.templates.length >= 1);
  for (const template of config.templates) {
    const csv = renderPaymentsCsv([PAYMENT], template);
    const rows = parseCsv(csv);
    assert.equal(rows.length, 2, `${template.id} should render a header and one row`);
    assert.equal(rows[0].length, template.columns.length, `${template.id} header width`);
    assert.equal(rows[1].length, template.columns.length, `${template.id} row width`);
    assert.ok(
      rows[1].some((cell) => cell.includes('2056') || cell.includes('2.056')),
      `${template.id} should carry the amount`,
    );
  }
});
