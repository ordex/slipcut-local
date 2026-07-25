// @ts-check
import { assert, test } from './harness.js';
import { ibanCountry, isValidIban, maskIban, normaliseIban } from '../src/core/iban.js';

test('normaliseIban strips printed grouping', () => {
  assert.equal(normaliseIban('it60 x054 2811 1010 0000 0123 456'), 'IT60X0542811101000000123456');
  assert.equal(normaliseIban(''), '');
});

test('isValidIban accepts well-formed IBANs', () => {
  assert.equal(isValidIban('IT60X0542811101000000123456'), true);
  assert.equal(isValidIban('IT60 X054 2811 1010 0000 0123 456'), true, 'spaces are tolerated');
  assert.equal(isValidIban('DE89370400440532013000'), true);
  assert.equal(isValidIban('GB82WEST12345698765432'), true);
  assert.equal(isValidIban('FR1420041010050500013M02606'), true, 'letters inside the BBAN');
});

test('isValidIban rejects a wrong check digit', () => {
  assert.equal(isValidIban('IT61X0542811101000000123456'), false);
  assert.equal(isValidIban('DE89370400440532013001'), false);
});

test('isValidIban rejects malformed input', () => {
  assert.equal(isValidIban(''), false);
  assert.equal(isValidIban('NOTANIBAN'), false);
  assert.equal(isValidIban('IT60'), false, 'too short');
  assert.equal(isValidIban('6060X0542811101000000123456'), false, 'country code must be letters');
  assert.equal(isValidIban('ITAAX0542811101000000123456'), false, 'check digits must be digits');
  assert.equal(isValidIban('IT60X05428111010000001234567890123456789012'), false, 'too long');
});

test('ibanCountry reads the country from the IBAN', () => {
  assert.equal(ibanCountry('IT60X0542811101000000123456'), 'IT');
  assert.equal(ibanCountry('de89370400440532013000'), 'DE');
  assert.equal(ibanCountry(''), '');
});

test('maskIban keeps only the ends', () => {
  assert.equal(maskIban('IT60X0542811101000000123456'), 'IT60…3456');
  assert.equal(maskIban('IT60X054'), 'IT60X054', 'nothing to hide in a short string');
  assert.equal(maskIban(''), '');
});
