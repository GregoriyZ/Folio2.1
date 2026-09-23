/*
 * Categorisation tests. Run with: node api/_lib/categorise.test.js
 *
 * These exist because categorisation errors are silent: a misfiled transaction
 * still shows a correct total, it just sits under the wrong heading, and a
 * savings/investment misfire actively removes money from your spending figures.
 * Every case below is a real Australian bank descriptor shape.
 */

// Internal-transfer detection reads FOLIO_OWN_NAME at load time, so it is set
// before the module is required. The suite pins a known value rather than
// depending on whatever the environment happens to hold.
process.env.FOLIO_OWN_NAME = 'Hryhorii Zherebylo';
const { categorise } = require('./categorise');

const cases = [
  // [description, note, txType, expectedType, expectedCategory]

  // --- the account-name bug: note carries the account name, and must never
  // --- promote an expense to savings ---
  ['RENT PAYMENT', 'ubank Save Account • transfer', 'expense', 'expense', 'housing'],
  ['WOOLWORTHS 1234', 'Savings Maximiser • groceries', 'expense', 'expense', 'food'],
  ['AGL ENERGY', 'House Deposit Saver', 'expense', 'expense', 'utilities'],

  // --- payment processor prefixes ---
  ['PAYPAL *SPOTIFY', null, 'expense', 'expense', 'streaming'],
  ['SQ *SEVEN SEEDS', null, 'expense', 'expense', 'coffee'],
  ['VISA PURCHASE BP CONNECT MELBOURNE', null, 'expense', 'expense', 'fuel'],
  ['EFTPOS COLES 4821', null, 'expense', 'expense', 'food'],
  ['AFTERPAY *THE ICONIC', null, 'expense', 'expense', 'clothing'],

  // --- ambiguous merchants: supermarket-branded fuel must be fuel ---
  ['WOOLWORTHS PETROL RICHMOND', null, 'expense', 'expense', 'fuel'],
  ['COLES EXPRESS 5567', null, 'expense', 'expense', 'fuel'],
  ['WOOLWORTHS METRO', null, 'expense', 'expense', 'food'],

  // --- motoring club runs both insurance and holiday parks ---
  ['NRMA INSURANCE PREMIUM', null, 'expense', 'expense', 'insurance'],
  ['NRMA PARKS AND RESORTS', null, 'expense', 'expense', 'travel'],

  // --- savings routed to the right bucket ---
  ['TRANSFER TO SAVINGS', null, 'expense', 'savings', 'gen-savings'],
  ['EMERGENCY FUND TRANSFER', null, 'expense', 'savings', 'emergency'],
  ['HOUSE DEPOSIT', null, 'expense', 'savings', 'house'],
  ['HOLIDAY FUND TRANSFER', null, 'expense', 'savings', 'holiday'],

  // --- investments routed to the right bucket ---
  ['VANGUARD PERSONAL INVESTOR', null, 'expense', 'investment', 'stocks'],
  ['PEARLER INVEST', null, 'expense', 'investment', 'stocks'],
  ['COINSPOT PTY LTD', null, 'expense', 'investment', 'crypto'],
  ['SWYFTX', null, 'expense', 'investment', 'crypto'],

  // --- income ---
  ['SALARY ACME PTY LTD', null, 'income', 'income', 'salary'],
  ['CENTRELINK PAYMENT', null, 'income', 'income', 'govt'],
  ['ATO TAX REFUND', null, 'income', 'income', 'govt'],
  ['VANGUARD DISTRIBUTION', null, 'income', 'income', 'dividends'],
  ['UBER DRIVER PAYOUT', null, 'income', 'income', 'side-hustle'],

  // --- everyday expenses ---
  ['UBER EATS', null, 'expense', 'expense', 'dining'],
  ['UBER TRIP HELP.UBER.COM', null, 'expense', 'expense', 'transport'],
  ['NETFLIX.COM', null, 'expense', 'expense', 'streaming'],
  ['MYKI TOP UP', null, 'expense', 'expense', 'transport'],
  // Chemist Warehouse sells both pharmacy and general goods. Healthcare is the
  // more useful default; recategorise by hand if you mostly buy toiletries.
  ['CHEMIST WAREHOUSE', null, 'expense', 'expense', 'health'],
  ['DAN MURPHYS', null, 'expense', 'expense', 'alcohol'],
  ['MONASH UNIVERSITY', null, 'expense', 'expense', 'education'],
  ['ANYTIME FITNESS', null, 'expense', 'expense', 'gym'],
  ['STEAM GAMES', null, 'expense', 'expense', 'gaming'],

  // ── Real descriptors from a live ANZ/ubank/NAB feed ──────────────────
  // Internal transfers: counted as BOTH income and expense before this,
  // double-counting every move between the user's own accounts.
  ['Transfer\\nxxxx0955|xxxxx3137|SAV', null, 'expense', 'transfer', 'misc-exp'],
  ['Transfer\\nxxxx7974|xxxxx3137', null, 'income', 'transfer', 'misc-exp'],
  ['Osko payment From MR HRYHORII ZHEREBYLO Ref#xxxxx2474', null, 'income', 'transfer', 'misc-exp'],
  ['Payment to Hryhorii Zherebylo #506699', null, 'expense', 'transfer', 'misc-exp'],
  ['Osko payment From ZHEREBYLO H Ref#xxxxx3645', null, 'income', 'transfer', 'misc-exp'],
  ['Starting Balance', null, 'income', 'transfer', 'misc-exp'],

  // A relative sharing the surname must NOT be treated as an own-account move.
  ['VLADYSLAV ZHEREBYLO W6682637796', null, 'expense', 'expense', 'misc-exp'],

  // Bank mis-signs some card purchases as credits; a club is not paying you.
  ['9 McKinnon Basketb Zherebylo. Hryho', null, 'income', 'expense', 'sport'],
  ['SQ *SOUTHERN BASKETBALL ACheltenham   AU', null, 'expense', 'expense', 'sport'],

  ['Direct Debit SHANNONS INSUR - SCMxxxxx4069', null, 'expense', 'expense', 'insurance'],
  ['BPAY Payment to VICROADS\\nVICROADS|216291', null, 'expense', 'expense', 'transport'],
  ['Apple (App Store)', null, 'expense', 'expense', 'streaming'],
  ['GOOGLE*WORKSPACE SKALE   CC GOOGLE.COMAU', null, 'expense', 'expense', 'streaming'],
  ['POST ELSTERNWICK POST    ELSTERNWICK  AU', null, 'expense', 'expense', 'shopping'],
  ['SQ *MAVI TAKEAWAY        Dromana      AU', null, 'expense', 'expense', 'dining'],
  ['Tasty Wok Pty Ltd        Clayton      AU', null, 'expense', 'expense', 'dining'],
  ['Credit interest paid', null, 'income', 'income', 'dividends'],
  ['Direct Credit Superhero - T9584362-198833', null, 'income', 'income', 'refund'],

  // Genuine third-party payments stay real income/expense.
  ['Payment from T J Krause', null, 'income', 'income', 'misc-inc'],
  ['Osko payment To K MARTINOV Ref#xxxxx6790', null, 'expense', 'expense', 'misc-exp'],
];

let pass = 0;
const failures = [];

for (const [description, note, txType, wantType, wantCat] of cases) {
  const got = categorise({ description, note, type: txType });
  if (got.type === wantType && got.category === wantCat) {
    pass++;
  } else {
    failures.push(
      `  ${description}\n` +
      `    note:     ${note || '(none)'}\n` +
      `    expected: ${wantType}/${wantCat}\n` +
      `    got:      ${got.type}/${got.category}`
    );
  }
}

console.log(`categorise: ${pass}/${cases.length} passed`);
if (failures.length) {
  console.log('\nFailures:\n' + failures.join('\n\n'));
  process.exit(1);
}
