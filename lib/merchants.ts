/**
 * Slovak merchant catalogue.
 *
 * Card transactions arrive from a bank as noisy strings — "NAKUP KARTOU
 * 1234****5678 LIDL SK 1234 BRATISLAVA", "TESCO STORES SR A.S." — so matching
 * normalises away diacritics, case and punctuation before looking for a needle.
 *
 * This drives two things: automatic categorisation on CSV import, and merchant
 * suggestions in the transaction form.
 */

/** Category names used by the seed and by import auto-categorisation. */
export const SK_CATEGORIES = {
  groceries: "Potraviny",
  restaurants: "Reštaurácie",
  transport: "Doprava",
  fuel: "Palivo",
  housing: "Bývanie",
  utilities: "Energie a voda",
  telecom: "Telekom a internet",
  health: "Zdravie a lekáreň",
  drugstore: "Drogéria",
  clothing: "Oblečenie a obuv",
  electronics: "Elektronika",
  home: "Dom a záhrada",
  entertainment: "Zábava",
  sport: "Šport a fitness",
  beauty: "Kozmetika",
  pets: "Domáce zvieratá",
  kids: "Deti",
  insurance: "Poistenie",
  fees: "Bankové poplatky",
  gifts: "Darčeky",
  travel: "Cestovanie",
  education: "Vzdelávanie",
  salary: "Výplata",
  freelance: "Faktúry a brigády",
} as const;

export type SkCategoryKey = keyof typeof SK_CATEGORIES;

const KEY_BY_SK_NAME = new Map<string, SkCategoryKey>(
  (Object.entries(SK_CATEGORIES) as [SkCategoryKey, string][]).map(([key, name]) => [
    name.toLowerCase(),
    key,
  ]),
);

/**
 * The catalogue key behind a Slovak category name ("Potraviny" → groceries).
 *
 * The merchant matcher names categories in Slovak, but a household may show
 * them in another language (a Russian household stores «Продукты»). The key
 * doubles as the slug on shipped category rows, so resolving through it finds
 * the category whatever it is called now.
 */
export function skCategoryKeyForName(name: string): SkCategoryKey | null {
  return KEY_BY_SK_NAME.get(name.toLowerCase()) ?? null;
}

export interface MerchantRule {
  /** Canonical, human-readable name written into the transaction note. */
  readonly merchant: string;
  /** Category this merchant maps to. */
  readonly category: SkCategoryKey;
  /** Normalised needles searched for inside a statement description. */
  readonly match: readonly string[];
}

/**
 * Ordered most-specific first: "tesco mobile" must win over "tesco", and
 * "billa" must not be swallowed by a broader rule.
 */
export const MERCHANTS: readonly MerchantRule[] = [
  // --- telecom (before groceries: Tesco Mobile, Orange, O2) ---------------
  { merchant: "Tesco Mobile", category: "telecom", match: ["tesco mobile"] },
  { merchant: "Telekom", category: "telecom", match: ["slovak telekom", "telekom", "t-com", "t-mobile"] },
  { merchant: "Orange", category: "telecom", match: ["orange slovensko", "orange sk", "orange"] },
  { merchant: "O2", category: "telecom", match: ["o2 slovakia", "o2 sk", "o2 "] },
  { merchant: "4ka", category: "telecom", match: ["4ka", "swan mobile"] },
  { merchant: "Antik Telecom", category: "telecom", match: ["antik telecom", "antik"] },
  { merchant: "UPC / Vodafone", category: "telecom", match: ["upc broadband", "upc", "vodafone"] },

  // --- groceries ----------------------------------------------------------
  { merchant: "Lidl", category: "groceries", match: ["lidl"] },
  { merchant: "Kaufland", category: "groceries", match: ["kaufland"] },
  { merchant: "Tesco", category: "groceries", match: ["tesco stores", "tesco"] },
  { merchant: "Billa", category: "groceries", match: ["billa"] },
  { merchant: "COOP Jednota", category: "groceries", match: ["coop jednota", "coop"] },
  { merchant: "CBA", category: "groceries", match: ["cba slovakia", "cba potraviny"] },
  { merchant: "Terno", category: "groceries", match: ["terno"] },
  { merchant: "Fresh", category: "groceries", match: ["fresh potraviny"] },
  { merchant: "Yeme", category: "groceries", match: ["yeme"] },
  { merchant: "Metro", category: "groceries", match: ["metro cash", "makro"] },
  { merchant: "Milk-Agro", category: "groceries", match: ["milk-agro", "milk agro"] },
  { merchant: "Kraj", category: "groceries", match: ["kraj potraviny"] },
  { merchant: "Rohlík", category: "groceries", match: ["rohlik", "rohlík"] },

  // --- restaurants & delivery --------------------------------------------
  { merchant: "Wolt", category: "restaurants", match: ["wolt"] },
  { merchant: "Bolt Food", category: "restaurants", match: ["bolt food"] },
  { merchant: "Foodora", category: "restaurants", match: ["foodora", "dame jidlo", "dámejedlo"] },
  { merchant: "McDonald's", category: "restaurants", match: ["mcdonald", "mcdonalds"] },
  { merchant: "KFC", category: "restaurants", match: ["kfc"] },
  { merchant: "Burger King", category: "restaurants", match: ["burger king"] },
  { merchant: "Starbucks", category: "restaurants", match: ["starbucks"] },
  { merchant: "Costa Coffee", category: "restaurants", match: ["costa coffee"] },
  { merchant: "Bageteria Boulevard", category: "restaurants", match: ["bageteria"] },
  { merchant: "Panta Rhei Café", category: "restaurants", match: ["panta rhei"] },
  { merchant: "Reštaurácia", category: "restaurants", match: ["restauracia", "pizzeria", "pizza", "kaviaren", "bistro", "pub ", "krcma"] },

  // --- fuel ---------------------------------------------------------------
  { merchant: "Slovnaft", category: "fuel", match: ["slovnaft"] },
  { merchant: "OMV", category: "fuel", match: ["omv"] },
  { merchant: "Shell", category: "fuel", match: ["shell"] },
  { merchant: "MOL", category: "fuel", match: ["mol slovensko", "mol cerpacia"] },
  { merchant: "Jurki", category: "fuel", match: ["jurki"] },
  { merchant: "Lukoil", category: "fuel", match: ["lukoil"] },

  // --- transport ----------------------------------------------------------
  { merchant: "DPB", category: "transport", match: ["dopravny podnik bratislava", "dpb"] },
  { merchant: "DPMK Košice", category: "transport", match: ["dpmk", "dopravny podnik mesta kosice"] },
  { merchant: "ZSSK", category: "transport", match: ["zssk", "zeleznicna spolocnost"] },
  { merchant: "RegioJet", category: "transport", match: ["regiojet", "student agency"] },
  { merchant: "Slovak Lines", category: "transport", match: ["slovak lines"] },
  { merchant: "Arriva", category: "transport", match: ["arriva"] },
  { merchant: "Bolt", category: "transport", match: ["bolt.eu", "bolt operations", "bolt "] },
  { merchant: "Uber", category: "transport", match: ["uber"] },
  { merchant: "Hopin", category: "transport", match: ["hopin"] },
  { merchant: "Parkovanie", category: "transport", match: ["parkovanie", "parking", "paas"] },
  { merchant: "Diaľničná známka", category: "transport", match: ["dialnicna znamka", "eznamka", "znamka sk"] },

  // --- health & pharmacy --------------------------------------------------
  { merchant: "Dr. Max", category: "health", match: ["dr.max", "dr max", "drmax"] },
  { merchant: "BENU", category: "health", match: ["benu"] },
  { merchant: "Pilulka", category: "health", match: ["pilulka"] },
  { merchant: "Sunpharma", category: "health", match: ["sunpharma"] },
  { merchant: "Lekáreň", category: "health", match: ["lekaren", "lekáreň"] },
  { merchant: "Zubár", category: "health", match: ["zubna", "dental", "stomatolog"] },
  { merchant: "Poliklinika", category: "health", match: ["poliklinika", "nemocnica", "medicent"] },

  // --- drugstore ----------------------------------------------------------
  { merchant: "dm drogerie", category: "drugstore", match: ["dm drogerie", "dm filiale", "dm-drogerie"] },
  { merchant: "Rossmann", category: "drugstore", match: ["rossmann"] },
  { merchant: "TETA drogérie", category: "drugstore", match: ["teta drogerie", "teta "] },

  // --- clothing -----------------------------------------------------------
  { merchant: "Zara", category: "clothing", match: ["zara"] },
  { merchant: "H&M", category: "clothing", match: ["h&m", "h & m", "hennes"] },
  { merchant: "Reserved", category: "clothing", match: ["reserved"] },
  { merchant: "Sinsay", category: "clothing", match: ["sinsay"] },
  { merchant: "Cropp", category: "clothing", match: ["cropp"] },
  { merchant: "House", category: "clothing", match: ["house brand"] },
  { merchant: "Mohito", category: "clothing", match: ["mohito"] },
  { merchant: "New Yorker", category: "clothing", match: ["new yorker"] },
  { merchant: "C&A", category: "clothing", match: ["c&a"] },
  { merchant: "Primark", category: "clothing", match: ["primark"] },
  { merchant: "CCC", category: "clothing", match: ["ccc obuv", "ccc "] },
  { merchant: "Deichmann", category: "clothing", match: ["deichmann"] },
  { merchant: "Baťa", category: "clothing", match: ["bata ", "baťa"] },
  { merchant: "Zalando", category: "clothing", match: ["zalando"] },
  { merchant: "About You", category: "clothing", match: ["about you", "aboutyou"] },

  // --- electronics --------------------------------------------------------
  { merchant: "Alza", category: "electronics", match: ["alza"] },
  { merchant: "NAY", category: "electronics", match: ["nay elektrodom", "nay "] },
  { merchant: "Datart", category: "electronics", match: ["datart"] },
  { merchant: "Planeo Elektro", category: "electronics", match: ["planeo"] },
  { merchant: "Mall.sk", category: "electronics", match: ["mall.sk", "mall sk"] },
  { merchant: "iStores", category: "electronics", match: ["istores", "apple store", "apple.com"] },
  { merchant: "Andreas", category: "electronics", match: ["andreas sk"] },

  // --- home & DIY ---------------------------------------------------------
  { merchant: "IKEA", category: "home", match: ["ikea"] },
  { merchant: "JYSK", category: "home", match: ["jysk"] },
  { merchant: "Möbelix", category: "home", match: ["mobelix", "möbelix"] },
  { merchant: "KIKA", category: "home", match: ["kika"] },
  { merchant: "Hornbach", category: "home", match: ["hornbach"] },
  { merchant: "OBI", category: "home", match: ["obi "] },
  { merchant: "Bauhaus", category: "home", match: ["bauhaus"] },
  { merchant: "Merkury Market", category: "home", match: ["merkury market"] },
  { merchant: "Pepco", category: "home", match: ["pepco"] },
  { merchant: "Action", category: "home", match: ["action sk", "action retail"] },
  { merchant: "TEDi", category: "home", match: ["tedi"] },

  // --- entertainment ------------------------------------------------------
  { merchant: "CineMax", category: "entertainment", match: ["cinemax"] },
  { merchant: "Cinema City", category: "entertainment", match: ["cinema city"] },
  { merchant: "Netflix", category: "entertainment", match: ["netflix"] },
  { merchant: "Spotify", category: "entertainment", match: ["spotify"] },
  { merchant: "HBO Max", category: "entertainment", match: ["hbo max", "hbo "] },
  { merchant: "Disney+", category: "entertainment", match: ["disney plus", "disney+"] },
  { merchant: "Steam", category: "entertainment", match: ["steam games", "steampowered"] },
  { merchant: "PlayStation", category: "entertainment", match: ["playstation", "sony interactive"] },
  { merchant: "Predpredaj.sk", category: "entertainment", match: ["predpredaj", "ticketportal", "ticketlive"] },
  { merchant: "Panta Rhei", category: "entertainment", match: ["panta rhei knihy", "martinus"] },

  // --- sport --------------------------------------------------------------
  { merchant: "Decathlon", category: "sport", match: ["decathlon"] },
  { merchant: "Hervis", category: "sport", match: ["hervis"] },
  { merchant: "A3 Sport", category: "sport", match: ["a3 sport"] },
  { merchant: "Sportisimo", category: "sport", match: ["sportisimo"] },
  { merchant: "GymBeam", category: "sport", match: ["gymbeam"] },
  { merchant: "Fitness", category: "sport", match: ["fitness", "planet fitness", "citygym", "posilnovna"] },

  // --- beauty -------------------------------------------------------------
  { merchant: "Notino", category: "beauty", match: ["notino"] },
  { merchant: "Douglas", category: "beauty", match: ["douglas"] },
  { merchant: "Marionnaud", category: "beauty", match: ["marionnaud"] },
  { merchant: "Kaderníctvo", category: "beauty", match: ["kadernictvo", "barber", "salon krasy"] },

  // --- pets ---------------------------------------------------------------
  { merchant: "Pet Center", category: "pets", match: ["pet center", "petcenter"] },
  { merchant: "Super Zoo", category: "pets", match: ["super zoo", "superzoo"] },
  { merchant: "Veterinár", category: "pets", match: ["veterina", "veterinar"] },

  // --- utilities ----------------------------------------------------------
  { merchant: "ZSE Energia", category: "utilities", match: ["zse energia", "zse "] },
  { merchant: "SSE", category: "utilities", match: ["stredoslovenska energetika", "sse "] },
  { merchant: "VSE", category: "utilities", match: ["vychodoslovenska energetika", "vse "] },
  { merchant: "SPP", category: "utilities", match: ["slovensky plynarensky", "spp "] },
  { merchant: "BVS", category: "utilities", match: ["bratislavska vodarenska", "bvs "] },
  { merchant: "VVS", category: "utilities", match: ["vychodoslovenska vodarenska", "vvs "] },
  { merchant: "Veolia", category: "utilities", match: ["veolia"] },
  { merchant: "Správa bytov", category: "housing", match: ["spravca", "sprava bytov", "bytove druzstvo", "fond oprav", "najom", "nájom"] },

  // --- insurance ----------------------------------------------------------
  { merchant: "Allianz", category: "insurance", match: ["allianz"] },
  { merchant: "Generali", category: "insurance", match: ["generali"] },
  { merchant: "Union", category: "insurance", match: ["union poistovna", "union zp"] },
  { merchant: "Kooperativa", category: "insurance", match: ["kooperativa"] },
  { merchant: "Dôvera", category: "insurance", match: ["dovera", "dôvera"] },
  { merchant: "VšZP", category: "insurance", match: ["vszp", "vseobecna zdravotna"] },
  { merchant: "Sociálna poisťovňa", category: "insurance", match: ["socialna poistovna"] },

  // --- bank fees ----------------------------------------------------------
  { merchant: "Slovenská sporiteľňa", category: "fees", match: ["slovenska sporitelna", "slsp"] },
  { merchant: "VÚB", category: "fees", match: ["vub banka", "vub a.s."] },
  { merchant: "Tatra banka", category: "fees", match: ["tatra banka", "tatrabanka"] },
  { merchant: "365.bank", category: "fees", match: ["365.bank", "postova banka"] },
  { merchant: "mBank", category: "fees", match: ["mbank"] },
  { merchant: "Revolut", category: "fees", match: ["revolut"] },
  { merchant: "Poplatok", category: "fees", match: ["poplatok za", "bankovy poplatok"] },

  // --- income -------------------------------------------------------------
  { merchant: "Výplata", category: "salary", match: ["vyplata", "mzda", "plat za"] },
];

/** Shopping centres, offered as note suggestions rather than categorised. */
export const SK_MALLS: readonly string[] = [
  "Aupark Bratislava",
  "Eurovea",
  "Nivy Centrum",
  "Bory Mall",
  "Avion Shopping Park",
  "VIVO! Bratislava",
  "Central Bratislava",
  "Shopping Palace",
  "Danubia",
  "Atrium Optima Košice",
  "Aupark Košice",
  "Galéria Košice",
  "OC Mlyny Nitra",
  "Galéria Mlyny",
  "MAX Nitra",
  "MAX Trenčín",
  "MAX Poprad",
  "Laugaricio Trenčín",
  "Aupark Žilina",
  "Mirage Žilina",
  "Europa SC Banská Bystrica",
  "Korzo Prievidza",
  "Forum Poprad",
  "Retro Bratislava",
  "Cubicon",
];

/**
 * Strip diacritics and punctuation so "Reštaurácia" matches "RESTAURACIA" and
 * "DR.MAX" matches "dr max".
 */
export function normalizeDescription(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9&+ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface MerchantMatch {
  readonly merchant: string;
  readonly category: SkCategoryKey;
  readonly categoryName: string;
}

/**
 * Identify a merchant inside a bank statement description.
 *
 * Rules are checked in order, so the list's most-specific-first ordering is
 * load-bearing: "TESCO MOBILE" must resolve to telecom, not groceries.
 */
export function matchMerchant(description: string): MerchantMatch | null {
  const haystack = ` ${normalizeDescription(description)} `;

  for (const rule of MERCHANTS) {
    for (const needle of rule.match) {
      const normalized = normalizeDescription(needle);
      if (normalized.length === 0) continue;
      if (haystack.includes(normalized)) {
        return {
          merchant: rule.merchant,
          category: rule.category,
          categoryName: SK_CATEGORIES[rule.category],
        };
      }
    }
  }

  return null;
}

/** Every merchant name, for the transaction form's autocomplete. */
export const MERCHANT_NAMES: readonly string[] = [
  ...new Set(MERCHANTS.map((rule) => rule.merchant)),
].sort((a, b) => a.localeCompare(b, "sk"));

/**
 * Merchant name → category key, for the form's auto-select behaviour.
 *
 * A key rather than a display name: category names now follow the interface
 * language, so matching on the name would only ever work in Slovak.
 */
export const CATEGORY_BY_MERCHANT: ReadonlyMap<string, SkCategoryKey> = new Map(
  MERCHANTS.map((rule) => [rule.merchant, rule.category]),
);
