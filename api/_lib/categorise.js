/*
 * Auto-categoriser — maps a bank transaction description to a Folio category id.
 * Keeps synced rows useful out of the box; anything you re-categorise by hand
 * is preserved by the merge step, so manual edits always win.
 */

const EXPENSE_RULES = [
  ['food', /woolworth|coles|aldi|iga|foodworks|costco|grocer|harris farm|supabarn/i],
  ['dining', /mcdonald|kfc|hungry jack|guzman|nando|domino|pizza|sushi|noodle|restaurant|bistro|kebab|grill|uber\s*eats|doordash|menulog|deliveroo|bakery|thai|ramen|burger/i],
  ['coffee', /coffee|cafe|café|starbucks|gloria jean|boost juice|chatime|gong cha|espresso|roaster/i],
  ['fuel', /bp\b|shell|caltex|ampol|7-eleven|united petro|mobil|petrol|fuel/i],
  ['transport', /uber(?!\s*eats)|didi|ola\b|taxi|13cabs|opal|myki|translink|go card|metro|train|tram|bus\b|parking|wilson park|secure park|toll|linkt|e-?toll/i],
  ['housing', /rent\b|rental payment|mortgage|real estate|property manage|strata|body corp/i],
  ['utilities', /agl\b|origin energy|energy australia|alinta|red energy|simply energy|powershop|water corp|sydney water|yarra valley|electric|\bgas\b(?!oline)|council rates/i],
  ['internet', /telstra|optus.*(nbn|internet)|aussie broadband|superloop|tpg|iinet|launtel|nbn\b|exetel/i],
  ['phone', /amaysim|boost mobile|kogan mobile|felix mobile|belong|catch connect|mobile plan|prepaid recharge|vodafone/i],
  ['streaming', /netflix|spotify|disney|stan\b|binge|kayo|amazon prime|youtube premium|apple\.?com\/bill|icloud|patreon|audible|paramount|crunchyroll|adobe|microsoft 365|chatgpt|openai|claude|anthropic|github|notion|canva/i],
  ['health', /chemist|pharmacy|priceline|terry white|amcal|medical|doctor|gp\b|clinic|pathology|physio|hospital|medicare/i],
  ['medical', /dental|dentist|optical|opsm|specsavers|orthodont/i],
  ['gym', /gym|fitness|anytime|f45|goodlife|plus fitness|snap fitness|crossfit|pilates|yoga/i],
  ['insurance', /insurance|nrma|racv|racq|aami|budget direct|allianz|bupa|medibank|hcf\b|nib\b/i],
  ['education', /university|monash|unimelb|usyd|unsw|rmit|tafe|coursera|udemy|textbook|student servic|amenities fee|hecs|help debt/i],
  ['clothing', /uniqlo|h&m|zara|cotton on|kmart.*cloth|myer|david jones|asos|the iconic|nike|adidas|sneaker|shoe/i],
  ['shopping', /kmart|target|big w|amazon|ebay|temu|shein|officework|jb hi-?fi|harvey norman|bunnings|catch\.com|australia post|auspost/i],
  ['beauty', /barber|hair|salon|nail|sephora|mecca|beauty|skincare|spa\b/i],
  ['alcohol', /dan murphy|bws|liquorland|liquor|cellarbrations|vintage cellars|brewery|bottle shop|first choice liquor/i],
  ['entertainment', /cinema|hoyts|village cinemas|event cinemas|imax|ticketek|ticketmaster|eventbrite|concert|theatre|museum|zoo|aquarium|bowling|escape room/i],
  ['gaming', /steam(?!\s*clean)|playstation|xbox|nintendo|epic games|riot games|blizzard|roblox|twitch/i],
  ['travel', /qantas|jetstar|virgin australia|rex airlines|airbnb|booking\.com|expedia|agoda|hotel|motel|hostel|flight cent|webjet|skyscanner|trip\.com/i],
  ['pets', /petbarn|pet ?stock|petco|vet\b|veterinar|greencross|pet circle/i],
  ['sport', /sport|golf|tennis|surf|ski\b|snowboard|rebel sport|decathlon|anaconda|bcf\b/i],
  ['gifts', /gift card|flower|florist|bloom|hamper/i],
  ['charity', /donation|donate|charity|unicef|red cross|oxfam|fundraise|gofundme/i],
  ['home', /ikea|freedom furn|fantastic furn|amart|nursery|garden|plant|spotlight|adairs|temple.*webster/i],
  ['childcare', /childcare|daycare|kindergarten|early learning|goodstart/i],
  ['tax', /\bato\b|tax office|account keeping fee|monthly fee|overdrawn fee|dishonour|late fee|interest charged|foreign (transaction|currency) fee|atm fee/i],
];

const INCOME_RULES = [
  ['salary', /salary|payroll|wages|pay run|employer|\bpay\b.*(pty|ltd)/i],
  ['govt', /centrelink|services australia|austudy|youth allowance|\bato\b.*refund|tax refund|department of/i],
  ['dividends', /dividend|distribution|franking|vanguard|betashares|commsec|selfwealth|stake\b/i],
  ['refund', /refund|reversal|chargeback|return\b/i],
  ['freelance', /invoice|freelance|contract|consult/i],
  ['rental', /rent received|rental income|tenant/i],
  ['gift-in', /gift|birthday|from mum|from dad/i],
  ['side-hustle', /uber (driver|partner)|doordash driver|menulog courier|airtasker|etsy|gumtree|marketplace/i],
];

const SAVINGS_RE = /savings? (transfer|deposit)|emergency fund|house deposit|holiday fund|save(r)? account|to savings/i;
const INVEST_RE = /vanguard|betashares|commsec|selfwealth|\bstake\b|pearler|spaceship|\braiz\b|coinbase|binance|swyftx|coinspot|independent reserve|\betfs?\b|share purchase/i;

/* Returns { type, category } — the type can be upgraded from a plain expense
   to 'savings'/'investment' when the description clearly says so, so money you
   move into savings or ETFs is not counted as spending. */
function categorise(tx) {
  const text = [tx.description, tx.note].filter(Boolean).join(' ');
  const type = tx.type === 'income' ? 'income' : 'expense';
  if (!text) return { type, category: type === 'income' ? 'misc-inc' : 'misc-exp' };

  if (type === 'income') {
    for (const [id, re] of INCOME_RULES) if (re.test(text)) return { type, category: id };
    return { type, category: 'misc-inc' };
  }

  if (INVEST_RE.test(text)) return { type: 'investment', category: 'stocks' };
  if (SAVINGS_RE.test(text)) return { type: 'savings', category: 'gen-savings' };
  for (const [id, re] of EXPENSE_RULES) if (re.test(text)) return { type, category: id };
  return { type, category: 'misc-exp' };
}

module.exports = { categorise };
