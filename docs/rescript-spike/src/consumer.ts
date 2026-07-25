// A still-TypeScript module consuming a converted ReScript module.
import { isValidIban, parseItalianDecimal } from './Domain.gen.ts';

export function summarise(iban: string, amount: string): string {
  const parsed = parseItalianDecimal(amount);
  // `parsed` is `number | undefined`: TS forces the check, because ReScript's
  // option<float> crossed the boundary as a real optional.
  if (parsed === undefined) return 'importo non valido';
  return `${isValidIban(iban) ? 'ok' : 'IBAN non valido'} ${parsed.toFixed(2)}`;
}

// To confirm the boundary is genuinely checked and not silently `any`, add:
//   export const broken: number = isValidIban('IT60');
// and typecheck — it must fail with
//   TS2322: Type 'boolean' is not assignable to type 'number'.
//
//   npx tsc --ignoreConfig --noEmit --strict --target es2023 --module esnext \
//     --moduleResolution bundler --allowImportingTsExtensions \
//     src/consumer.ts src/rescript-shims.d.ts

