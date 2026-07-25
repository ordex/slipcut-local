// @ts-check
/**
 * The payments about to be sent to the bank, and what could not be sent.
 *
 * IBANs are shown masked. The full number is in the file being downloaded, so
 * putting it on screen adds nothing except something to read over a shoulder.
 */

import { maskIban } from '../../core/iban.js';
import { formatEuro } from '../../core/money.js';
import { emptyRow, h, replaceChildren } from '../dom.js';

/** @typedef {import('../../core/payment-rows.js').PaymentRow} PaymentRow */
/** @typedef {import('../../core/payment-rows.js').Problem} Problem */

const COLUMN_COUNT = 7;

/** @type {Record<PaymentRow['recipientType'], string>} */
const TYPE_LABELS = {
  INDIVIDUAL: 'Persona',
  BUSINESS: 'Azienda',
};

/**
 * @param {HTMLElement} tbody
 * @param {PaymentRow[]} payments
 */
export function renderPaymentsTable(tbody, payments) {
  if (payments.length === 0) {
    replaceChildren(tbody, [emptyRow(COLUMN_COUNT, 'Nessun pagamento preparato.')]);
    return;
  }

  replaceChildren(
    tbody,
    payments.map((payment) =>
      h('tr', {}, [
        h('td', { className: 'numeric', textContent: String(payment.sourcePage) }),
        h('td', { textContent: payment.beneficiaryName }),
        h('td', { textContent: TYPE_LABELS[payment.recipientType] }),
        h('td', {}, [h('code', { textContent: maskIban(payment.iban) })]),
        h('td', { textContent: payment.email || '—' }),
        h('td', { className: 'numeric', textContent: formatEuro(payment.amount) }),
        h('td', { className: 'wrap-cell', textContent: payment.remittanceInformation }),
      ]),
    ),
  );
}

/**
 * The line above the table: how much is going out, and what is not.
 *
 * @param {HTMLElement} container
 * @param {object} result
 * @param {PaymentRow[]} result.payments
 * @param {Problem[]} result.problems
 * @param {import('../../core/money.js').Cents} result.total
 */
export function renderPaymentMessages(container, { payments, problems, total }) {
  const count =
    payments.length === 1 ? '1 pagamento pronto' : `${payments.length} pagamenti pronti`;

  /** @type {Array<Node>} */
  const children = [
    h('p', { className: 'summary-line' }, [
      h('strong', { textContent: count }),
      ` · totale ${formatEuro(total)}`,
    ]),
  ];

  if (problems.length > 0) {
    children.push(
      h(
        'ul',
        {},
        problems.map((problem) => h('li', { textContent: problem.message })),
      ),
    );
  } else if (payments.length > 0) {
    children.push(h('p', { className: 'status ok', textContent: 'Nessun beneficiario da sistemare.' }));
  }

  replaceChildren(container, children);
}
