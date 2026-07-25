// @ts-check
import { assert, test } from './harness.js';
import {
  givenNameCode,
  matchNameToCodiceFiscale,
  nameCode,
  normalisePersonName,
  surnameCode,
} from '../src/core/person-name.js';

/** Real name/code pairs, one per payslip layout seen in practice. */
const PAIRS = [
  ['FORMICA FEDERICO', 'FRMFRC91P22D086S'],
  ['MAURO MARCO ANTONIO', 'MRAMCN90E04D086C'],
  ['CONIGLIO VINCENZO', 'CNGVCN87D10C352W'],
  ['RINALDI DONATELLA', 'RNLDTL96B41F915U'],
  ['CONIGLIO ROBERT', 'CNGRRT82H17D976X'],
  ['VACCARO LORENZO', 'VCCLNZ00R24F839L'],
  ['PASQUALETTI DANIELE', 'PSQDNL94B18H769B'],
  ['CALCAGNILE SARA', 'CLCSRA94H67C978F'],
  ['SERGIO PASQUALE', 'SRGPQL94P07D086S'],
  ['IMPROTA MARCELLINO', 'MPRMCL93S28A512P'],
  ['CUNDARI PAOLO', 'CNDPLA95M03D086S'],
  ['PANAIA VINCENZO', 'PNAVCN92P20C352A'],
  ['ROSSI MARIO', 'RSSMRA80A01H501U'],
];

test('normalisePersonName folds accents and separators', () => {
  assert.equal(normalisePersonName('Nicolò Àngelo'), 'NICOLO ANGELO');
  assert.equal(normalisePersonName("D'Alessio Maria"), 'D ALESSIO MARIA');
  assert.equal(normalisePersonName('DE-LUCA  ANNA'), 'DE LUCA ANNA');
  assert.equal(normalisePersonName('rossi mario'), 'ROSSI MARIO');
});

test('surnameCode takes consonants, then vowels, then padding', () => {
  assert.equal(surnameCode('ROSSI'), 'RSS');
  assert.equal(surnameCode('PANAIA'), 'PNA', 'only two consonants, a vowel completes it');
  assert.equal(surnameCode('AIELLO'), 'LLA', 'consonants first even when the name starts with vowels');
  assert.equal(surnameCode('FO'), 'FOX', 'padded with X when too short');
});

test('givenNameCode skips the second consonant when there are four or more', () => {
  assert.equal(givenNameCode('MARIO'), 'MRA', 'three consonants: all of them');
  assert.equal(givenNameCode('FEDERICO'), 'FRC', 'F-D-R-C -> first, third, fourth');
  assert.equal(givenNameCode('MARCELLINO'), 'MCL', 'M-R-C-L-L-N -> M, C, L');
  assert.equal(givenNameCode('PAOLO'), 'PLA');
  assert.equal(givenNameCode('LI'), 'LIX');
});

test('nameCode reproduces the first six characters of real codes', () => {
  for (const [name, codiceFiscale] of PAIRS) {
    const [surname, ...given] = name.split(' ');
    // Multi-word given names are the common case here.
    const derived = nameCode(surname, given.join(' '));
    assert.equal(derived, codiceFiscale.slice(0, 6), `${name} -> ${derived}`);
  }
});

test('matchNameToCodiceFiscale confirms every real pair', () => {
  for (const [name, codiceFiscale] of PAIRS) {
    const match = matchNameToCodiceFiscale(name, codiceFiscale);
    assert.ok(match !== null, `no match for ${name}`);
    assert.equal(match?.fullName, name);
  }
});

test('matchNameToCodiceFiscale finds the right split in a multi-word name', () => {
  const match = matchNameToCodiceFiscale('MAURO MARCO ANTONIO', 'MRAMCN90E04D086C');
  assert.equal(match?.surname, 'MAURO');
  assert.equal(match?.givenName, 'MARCO ANTONIO');
});

test('matchNameToCodiceFiscale handles a two-word surname', () => {
  // DE LUCA ANNA: the surname is the first two tokens.
  const codiceFiscale = `${nameCode('DE LUCA', 'ANNA')}80A01H501X`;
  const match = matchNameToCodiceFiscale('DE LUCA ANNA', codiceFiscale);
  assert.equal(match?.surname, 'DE LUCA');
  assert.equal(match?.givenName, 'ANNA');
});

test('matchNameToCodiceFiscale rejects text that is not this person', () => {
  assert.equal(matchNameToCodiceFiscale('RED YARD RESEARCH', 'RSSMRA80A01H501U'), null);
  assert.equal(matchNameToCodiceFiscale('VIA ROMA 12', 'RSSMRA80A01H501U'), null);
  assert.equal(matchNameToCodiceFiscale('IMPIEGATO LIVELLO', 'RSSMRA80A01H501U'), null);
  assert.equal(matchNameToCodiceFiscale('ROSSI MARIO', 'FRMFRC91P22D086S'), null, 'right shape, wrong person');
});

test('matchNameToCodiceFiscale needs at least two words', () => {
  assert.equal(matchNameToCodiceFiscale('ROSSI', 'RSSMRA80A01H501U'), null);
  assert.equal(matchNameToCodiceFiscale('', 'RSSMRA80A01H501U'), null);
  assert.equal(matchNameToCodiceFiscale('R M', 'RSSMRA80A01H501U'), null, 'initials are not a name');
});

test('matchNameToCodiceFiscale needs a codice fiscale', () => {
  assert.equal(matchNameToCodiceFiscale('ROSSI MARIO', null), null);
  assert.equal(matchNameToCodiceFiscale('ROSSI MARIO', 'RSS'), null);
});

test('matchNameToCodiceFiscale strips honorifics', () => {
  assert.ok(matchNameToCodiceFiscale('SIG. ROSSI MARIO', 'RSSMRA80A01H501U') !== null);
  assert.ok(matchNameToCodiceFiscale('DOTT ROSSI MARIO', 'RSSMRA80A01H501U') !== null);
});

test('matchNameToCodiceFiscale accepts an accented name', () => {
  const codiceFiscale = `${nameCode('BRUNO', 'NICOLO')}80A01H501X`;
  assert.ok(matchNameToCodiceFiscale('Bruno Nicolò', codiceFiscale) !== null);
});
