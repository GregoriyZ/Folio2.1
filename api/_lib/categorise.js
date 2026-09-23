/*
 * Auto-categoriser — maps a bank transaction description to a Folio category id.
 * Keeps synced rows useful out of the box; anything you re-categorise by hand
 * is preserved by the merge step, so manual edits always win.
 */

const EXPENSE_RULES = [
  /* Precedence block. Some merchants are ambiguous by name: supermarket
     brands also run petrol stations, and motoring clubs also run holiday
     parks. These specific patterns must be tested before the generic brand
     rules below, otherwise fuel gets filed as groceries. */
  ['fuel', /(woolworth|coles|ampol)\w*\s*(petrol|express|fuel|servo)|petrol station/i],
  ['travel', /nrma\s*(parks|holiday|resort)|racv\s*(resort|club|park)/i],
  ['transport', /(city of|council)[^a-z]*.*parking|parking (meter|station|fee)/i],

  ['food', /woolworth|\bwoolies\b|coles|aldi|\biga\b|foodworks|costco|grocer|harris farm|supabarn|drakes|spudshed|butcher|greengrocer|fruit\s*&?\s*veg|market\s*fresh|night owl|friendly grocer/i],
  ['dining', /mcdonald|\bmcd\b|kfc|hungry jack|guzman|nando|domino|pizza|sushi|noodle|restaurant|bistro|kebab|grill|uber\s*eats|ubereats|doordash|menulog|deliveroo|hello ?fresh|marley spoon|youfoodz|bakery|baker|thai|ramen|burger|schnitz|zambrero|betty.?s burgers|grill.?d|oporto|red rooster|subway|taco|dumpling|pho\b|curry|indian|chinese|vietnamese|japanese|korean|canteen|food court|diner|eatery|takeaway|take ?away|fish\s*&?\s*chip|\bwok\b|charc(oal)?\b|\bbbq\b|chicken|souvlaki|gelato|ice ?cream|dessert|\bpho\b|\byum cha\b|hotpot|\bsteak|seafood|oyster|tapas|\bdeli\b/i],
  ['coffee', /coffee|cafe|café|starbucks|gloria jean|\bboost juice\b|chatime|gong cha|espresso|roaster|roastery|\bbrew\b|barista|seven seeds|industry beans|st ?ali|campos|toby.?s estate|the grounds|degani|muffin break|donut king|krispy kreme|bubble tea|\bkoi\b|sharetea/i],
  ['fuel', /\bbp\b|shell|caltex|ampol|7-eleven|united petro|mobil|petrol|fuel|servo|liberty fuel|metro petroleum|puma energy|vibe petroleum|on the run|\botr\b|coles express|woolworths petrol|ev charg|chargefox|evie network/i],
  ['transport', /uber(?!\s*eats)|didi|\bola\b|taxi|13cabs|silver top|opal|myki|translink|go card|smartrider|metrocard|\bptv\b|transport for nsw|\btfnsw\b|metro\b|train|tram|\bbus\b|ferry|parking|wilson park|secure park|care park|ace park|\btoll\b|linkt|e-?toll|eastlink|citylink|\bgo via\b|transurban|car ?share|\bgogetd?\b|car next door|lime\b|neuron|beam\b/i],
  ['housing', /\brent\b|rental payment|mortgage|home loan|real estate|property manage|\bstrata\b|body corp|owners corp|ray white|\blj hooker\b|barry plant|jellis craig|nelson alexander|harcourts|first national|bond\b/i],
  ['utilities', /\bagl\b|origin energy|energy australia|energyaustralia|alinta|red energy|simply energy|powershop|momentum energy|lumo|dodo power|tango energy|\bynergy\b|water corp|sydney water|sa water|unitywater|yarra valley|south east water|greater western water|icon water|electric|\bgas\b(?!oline)|council rates|\bcity of\b|shire council|\bcouncil\b/i],
  ['internet', /telstra|optus.*(nbn|internet)|aussie broadband|superloop|\btpg\b|iinet|launtel|\bnbn\b|exetel|leaptel|more telecom|dodo internet|starlink/i],
  ['phone', /amaysim|boost mobile|kogan mobile|felix mobile|belong|catch connect|mobile plan|prepaid recharge|vodafone|\btelstra mobile\b|optus mobile|aldi mobile|lebara|lycamobile|circles\.?life|moose mobile|superloop mobile/i],
  ['streaming', /netflix|spotify|disney|\bstan\b|\bbinge\b|kayo|foxtel|amazon prime|prime video|youtube ?premium|youtube ?music|apple\.?com\/bill|apple music|\bitunes\b|icloud|patreon|audible|paramount|crunchyroll|adobe|microsoft ?365|office ?365|chatgpt|openai|claude|anthropic|github|notion|canva|dropbox|google ?one|\bgsuite\b|figma|linkedin premium|duolingo|strava|headspace|calm\b|nordvpn|expressvpn|\bmubi\b|\bcuriosity\b|docusign|zoom\.us|slack|substack|medium\.com/i],
  ['streaming', /apple\s*\(app store\)|app ?store|google\*|google ?workspace|play ?store/i],
  ['health', /chemist|pharmacy|priceline|terry white|amcal|\bblooms\b|\bmedical\b|doctor|\bgp\b|clinic|pathology|physio|chiro|osteo|psycholog|psychiatr|hospital|medicare|healthscope|sonic health|dorevitch|melbourne path|\bqml\b|4cyte|radiolog|imaging|\bivf\b/i],
  ['medical', /dental|dentist|orthodont|endodont|optical|\bopsm\b|specsavers|bailey nelson|oscar wylee|laubman|optometr/i],
  ['gym', /\bgym\b|fitness|anytime|\bf45\b|goodlife|plus fitness|snap fitness|jetts|crossfit|pilates|yoga|\bbarre\b|climbing|bouldering|swim|aquatic|\bymca\b|genesis health|fernwood|club lime|body fit/i],
  ['insurance', /insurance|\bnrma\b|\bracv\b|\bracq\b|\braa\b|\baami\b|budget direct|allianz|\bqbe\b|suncorp|\bgio\b|youi|bingle|bupa|medibank|\bahm\b|\bhcf\b|\bnib\b|frank health|australian unity|\bhbf\b|real insurance|petsure|trupanion/i],
  ['insurance', /shannons/i],
  // VicRoads/Service NSW registration and licence fees.
  ['transport', /vicroads|service ?nsw|\bvic ?roads\b|rego\b|registration renewal|transport ?dept/i],
  // Australia Post retail outlets appear as "POST <SUBURB> POST".
  ['shopping', /^post\s+.*post\b|\bpost office\b/i],
  ['education', /universit|monash|unimelb|\busyd\b|\bunsw\b|\brmit\b|deakin|swinburne|\bqut\b|griffith|macquarie|\butas\b|\banu\b|\btafe\b|coursera|udemy|edx\b|skillshare|masterclass|textbook|booktopia|student servic|amenities fee|\bssaf\b|\bhecs\b|help debt|tuition|school fee|\bexam\b/i],
  ['clothing', /uniqlo|h ?& ?m|\bzara\b|cotton on|country road|\bseed\b|witchery|sportsgirl|glassons|universal store|general pants|\bmyer\b|david jones|\basos\b|the iconic|\bshein\b|\bnike\b|adidas|new balance|\bvans\b|converse|dr\.? ?martens|sneaker|\bshoe|platypus|hype ?dc|\brm williams\b|lorna jane|lululemon/i],
  ['shopping', /kmart|target|big ?w|amazon|\bebay\b|\btemu\b|\bcatch\b|officework|jb ?hi-? ?fi|\bthe good guys\b|harvey norman|bunnings|mitre ?10|\bbcf\b|supercheap|repco|autobarn|australia ?post|auspost|chemist warehouse|daiso|\bmuji\b|typo\b|smiggle|dusk\b|\bebay\b|marketplace purchase/i],
  ['beauty', /barber|\bhair\b|salon|\bnails?\b|sephora|\bmecca\b|beauty|skincare|\bspa\b|waxing|laser clinic|brows|lashes|massage|\bulta\b|priceline.*cosmetic/i],
  ['alcohol', /dan murphy|\bbws\b|liquorland|liquor|cellarbrations|vintage cellars|brewery|brewing|bottle ?shop|bottle-?o|first choice liquor|\bwinery\b|\bcellar\b|aldi liquor|\bpub\b|tavern|hotel bar|\bbar\b(?!ber)|distiller/i],
  ['entertainment', /cinema|hoyts|village cinema|event cinema|\bimax\b|palace cinema|nova cinema|reading cinema|ticketek|ticketmaster|eventbrite|\bmoshtix\b|oztix|humanitix|concert|festival|theatre|comedy|museum|gallery|\bzoo\b|aquarium|bowling|escape room|mini golf|arcade|karaoke|luna park|theme park/i],
  ['gaming', /steam(?!\s*clean)|steamgames|playstation|\bpsn\b|\bxbox\b|nintendo|epic ?games|riot ?games|blizzard|battle\.net|roblox|twitch|\beb games\b|jb.*games|humble ?bundle|\bgog\.com\b|ubisoft|\bea\b ?(games|play)|minecraft|discord nitro/i],
  ['travel', /qantas|jetstar|virgin australia|\brex\b|bonza|air ?new zealand|singapore air|emirates|cathay|scoot|airasia|airbnb|booking\.?com|expedia|agoda|\bhotels?\.com\b|trivago|wotif|stayz|\bhotel\b|motel|hostel|resort|flight cent|webjet|skyscanner|trip\.com|\bklook\b|get ?your ?guide|travel ?insurance|passport|visa applic|\bdfat\b|duty ?free|\bhertz\b|avis|budget ?car|thrifty|europcar|\bsixt\b|jucy|apollo camper|caravan park|\bbig4\b|nrma park/i],
  ['pets', /petbarn|pet ?stock|petco|\bvet\b|veterinar|greencross|pet ?circle|budget ?pet|animal hospital|\brspca\b|groomer|doggy ?day/i],
  ['sport', /\bsport\b|\bgolf\b|tennis|\bsurf\b|\bski\b|snowboard|rebel ?sport|decathlon|anaconda|kathmandu|macpac|paddy pallin|\bamart sport\b|cricket|football|soccer|netball|basketb|\bafl\b|\bnrl\b|club membership|season pass|\bmcc\b|\bmcg\b|stadium|leisure centre|rec ?centre/i],
  ['gifts', /gift ?card|gift ?voucher|\bflower|florist|\bbloom|hamper|\begift\b|prezzee|\bedible blooms\b/i],
  ['charity', /donation|donate|charity|unicef|red cross|oxfam|\bwwf\b|rspca donat|fundraise|gofundme|\bgivit\b|salvation army|\bvinnies\b|beyond blue|cancer council|smith family|world vision/i],
  ['home', /\bikea\b|freedom furn|fantastic furn|\bamart\b|nick scali|king living|nursery|\bgarden\b|\bplant\b|spotlight|adairs|sheridan|temple.*webster|\bpillow talk\b|house\b|kitchenware|\bhowards storage\b|beacon light|reece plumb|\bstratco\b|cleaner|cleaning service/i],
  ['childcare', /childcare|daycare|kindergarten|early learning|goodstart/i],
  ['tax', /\bato\b|tax office|account keeping fee|monthly fee|overdrawn fee|dishonour|late fee|interest charged|foreign (transaction|currency) fee|atm fee/i],
];

/* Card networks and wallets prefix the real merchant, e.g.
   "PAYPAL *SPOTIFY", "SQ *SEVEN SEEDS", "SP THE ICONIC". Strip the wrapper so
   the merchant rules below see the name they are written against. Also collapse
   the trailing noise AU banks append: card numbers, city, state, "AUS". */
function normalise(text) {
  return String(text || '')
    .replace(/\b(paypal|sq|sp|sumup|zip|afterpay|klarna|humm)\s*\*\s*/gi, ' ')
    .replace(/\bvisa purchase|eftpos|direct debit|card\s*x?\d{3,}/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const INCOME_RULES = [
  // Order matters: government and refunds are checked before the generic
  // salary patterns, because an ATO refund also contains pay-like words.
  ['govt', /centrelink|services australia|austudy|abstudy|youth allowance|jobseeker|family tax|\bftb\b|rent assistance|\bato\b.*refund|tax refund|department of|medicare benefit|\bdva\b/i],
  ['refund', /refund|reversal|chargeback|\breturn\b|credit adjustment|price protection/i],
  // Money coming back out of a broker or a university is a return of your own
  // funds, not earnings.
  ['refund', /direct credit\s+(superhero|selfwealth|stake|pearler|commsec)|universit|monash|unimelb|\brmit\b/i],
  ['dividends', /dividend|distribution|franking|vanguard|betashares|commsec|selfwealth|\bstake\b|pearler|computershare|link market|\bdrp\b|interest paid|credit interest|bonus interest/i],
  ['salary', /salary|payroll|wages|\bpay ?run\b|employer|\bpayg\b|fortnightly pay|weekly pay|\bpay\b.*(pty|ltd)|(pty|ltd).*\bpay\b|\bwage\b|remuneration|timesheet/i],
  ['rental', /rent received|rental income|tenant|property manage.*(disburse|credit)/i],
  ['side-hustle', /uber (driver|partner|trip)|doordash driver|menulog courier|airtasker|\betsy\b|gumtree|marketplace|\bfiverr\b|upwork|redbubble|\btwitch\b.*payout|youtube.*payout|stripe payout|square payout/i],
  ['freelance', /invoice|freelance|contract(or)?\b|consult/i],
  ['gift-in', /\bgift\b|birthday|from mum|from dad|christmas|\bxmas\b/i],
];

const SAVINGS_RE = /savings? (transfer|deposit|contribution)|emergency fund|rainy day|house deposit|home deposit|holiday fund|travel fund|car fund|\bsinking fund\b|save(r)? account|to savings|savings goal|\bnest egg\b|term deposit|high interest saver/i;

/* ── Internal transfers ──────────────────────────────────────────────────
   Moving money between your own accounts is not income and not spending, but
   a CDR feed reports each leg separately: the debit side looks like an
   expense, the credit side like income. Left alone, every transfer inflates
   BOTH totals by the same amount and the ledger silently double-counts.

   Set FOLIO_OWN_NAME (e.g. "Hryhorii Zherebylo") so payments to and from
   yourself are recognised. Multiple names can be comma-separated. */
const OWN_NAME_RE = (() => {
  const raw = (process.env.FOLIO_OWN_NAME || '').trim();
  if (!raw) return null;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = [];
  for (const name of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    parts.push(esc(name).replace(/\s+/g, '\\s+'));
    // Banks also render a name surname-first and abbreviate the given name,
    // e.g. "Hryhorii Zherebylo" arrives as "ZHEREBYLO H".
    const words = name.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      const last = words[words.length - 1];
      const firstInitial = words[0][0];
      parts.push(esc(last) + '\\s+' + esc(firstInitial) + '\\b');
      // Deliberately NOT matching the surname alone: relatives share it, and
      // treating their payments as your own transfers would erase real
      // income and spending.
    }
  }
  return parts.length ? new RegExp(parts.join('|'), 'i') : null;
})();

/* Structural transfer markers that do not depend on knowing your name:
   ubank/NAB "Transfer\nxxxx1234|xxxx5678" between your own account numbers,
   and the opening balance row a bank emits when a feed starts. */
const TRANSFER_RE = /^transfer\b.*\|/i;
const OPENING_RE = /^(starting|opening) balance$/i;

function isInternalTransfer(text) {
  if (TRANSFER_RE.test(text) || OPENING_RE.test(text)) return true;
  if (!OWN_NAME_RE || !OWN_NAME_RE.test(text)) return false;
  // Your name appearing in a merchant string is not a transfer; require it to
  // look like a person-to-person payment or a bare name.
  return /osko|payid|payment (to|from)|transfer|^[a-z\s.'-]+\s*[a-z]?\d{6,}$|^[a-z\s.'-]+$/i.test(text);
}

const INVEST_RE = /vanguard|betashares|\bvdhg\b|\bvas\b|\bvgs\b|\bivv\b|\bndq\b|\ba200\b|commsec|comm sec|selfwealth|\bstake\b|pearler|spaceship|\braiz\b|sharesies|superhero|\bsyfe\b|interactive broker|\bibkr\b|\bcmc market\b|nabtrade|\bbell direct\b|coinbase|binance|swyftx|coinspot|kraken|independent reserve|\bbtc markets\b|digital surge|\betfs?\b|share purchase|share trade|brokerage|dividend reinvest|\bdrp\b|managed fund|\bsuper contribution\b|salary sacrifice/i;

/* Once a row is known to be savings or investment, pick the specific bucket
   rather than dumping everything into General Savings / Stocks. */
const SAVINGS_BUCKETS = [
  ['emergency', /emergency|rainy day|buffer/i],
  ['house', /house|home ?deposit|property|mortgage ?offset/i],
  ['holiday', /holiday|travel|\btrip\b|vacation/i],
  ['car', /\bcar\b|vehicle|motorbike/i],
  ['retirement', /super|pension|retire/i],
];

const INVEST_BUCKETS = [
  ['crypto', /coinbase|binance|swyftx|coinspot|kraken|independent reserve|btc markets|digital surge|bitcoin|\bbtc\b|ethereum|\beth\b|crypto/i],
  ['super', /super contribution|salary sacrifice|\bsuper\b|\bsmsf\b/i],
  ['realestate', /real ?estate|property trust|\breit\b/i],
  ['bonds', /\bbond|fixed income|treasury/i],
];

function pick(rules, text, fallback) {
  for (const [id, re] of rules) if (re.test(text)) return id;
  return fallback;
}

/* Returns { type, category } — the type can be upgraded from a plain expense
   to 'savings'/'investment' when the description clearly says so, so money you
   move into savings or ETFs is not counted as spending. */
function categorise(tx) {
  const text = normalise([tx.description, tx.note].filter(Boolean).join(' '));
  // Savings/investment promotion looks at the description ONLY. The note
  // carries the account name, so an account called "ubank Save Account" would
  // otherwise reclassify every expense on it as savings and quietly drop it
  // out of your spending totals.
  const desc = normalise(tx.description);
  const type = tx.type === 'income' ? 'income' : 'expense';
  if (!text) return { type, category: type === 'income' ? 'misc-inc' : 'misc-exp' };

  // Checked first: an internal transfer is neither income nor spending, and
  // misreading one inflates both totals at once.
  if (isInternalTransfer(desc)) return { type: 'transfer', category: 'misc-exp' };

  if (type === 'income') {
    for (const [id, re] of INCOME_RULES) if (re.test(text)) return { type, category: id };
    // Some feeds mis-sign card purchases at clubs and venues as credits. If a
    // row the bank called income matches a clear merchant rule and no income
    // rule at all, trust the merchant: a basketball club is not paying you.
    for (const [id, re] of EXPENSE_RULES) {
      if (re.test(text)) return { type: 'expense', category: id };
    }
    return { type, category: 'misc-inc' };
  }

  if (INVEST_RE.test(desc)) return { type: 'investment', category: pick(INVEST_BUCKETS, desc, 'stocks') };
  if (SAVINGS_RE.test(desc)) return { type: 'savings', category: pick(SAVINGS_BUCKETS, desc, 'gen-savings') };
  for (const [id, re] of EXPENSE_RULES) if (re.test(text)) return { type, category: id };
  return { type, category: 'misc-exp' };
}

module.exports = { categorise };
