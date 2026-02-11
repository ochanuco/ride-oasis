const PREFECTURES = [
  { code: '01', en: 'hokkaido', ja: '北海道' },
  { code: '02', en: 'aomori', ja: '青森県' },
  { code: '03', en: 'iwate', ja: '岩手県' },
  { code: '04', en: 'miyagi', ja: '宮城県' },
  { code: '05', en: 'akita', ja: '秋田県' },
  { code: '06', en: 'yamagata', ja: '山形県' },
  { code: '07', en: 'fukushima', ja: '福島県' },
  { code: '08', en: 'ibaraki', ja: '茨城県' },
  { code: '09', en: 'tochigi', ja: '栃木県' },
  { code: '10', en: 'gunma', ja: '群馬県' },
  { code: '11', en: 'saitama', ja: '埼玉県' },
  { code: '12', en: 'chiba', ja: '千葉県' },
  { code: '13', en: 'tokyo', ja: '東京都' },
  { code: '14', en: 'kanagawa', ja: '神奈川県' },
  { code: '15', en: 'niigata', ja: '新潟県' },
  { code: '16', en: 'toyama', ja: '富山県' },
  { code: '17', en: 'ishikawa', ja: '石川県' },
  { code: '18', en: 'fukui', ja: '福井県' },
  { code: '19', en: 'yamanashi', ja: '山梨県' },
  { code: '20', en: 'nagano', ja: '長野県' },
  { code: '21', en: 'gifu', ja: '岐阜県' },
  { code: '22', en: 'shizuoka', ja: '静岡県' },
  { code: '23', en: 'aichi', ja: '愛知県' },
  { code: '24', en: 'mie', ja: '三重県' },
  { code: '25', en: 'shiga', ja: '滋賀県' },
  { code: '26', en: 'kyoto', ja: '京都府' },
  { code: '27', en: 'osaka', ja: '大阪府' },
  { code: '28', en: 'hyogo', ja: '兵庫県' },
  { code: '29', en: 'nara', ja: '奈良県' },
  { code: '30', en: 'wakayama', ja: '和歌山県' },
  { code: '31', en: 'tottori', ja: '鳥取県' },
  { code: '32', en: 'shimane', ja: '島根県' },
  { code: '33', en: 'okayama', ja: '岡山県' },
  { code: '34', en: 'hiroshima', ja: '広島県' },
  { code: '35', en: 'yamaguchi', ja: '山口県' },
  { code: '36', en: 'tokushima', ja: '徳島県' },
  { code: '37', en: 'kagawa', ja: '香川県' },
  { code: '38', en: 'ehime', ja: '愛媛県' },
  { code: '39', en: 'kochi', ja: '高知県' },
  { code: '40', en: 'fukuoka', ja: '福岡県' },
  { code: '41', en: 'saga', ja: '佐賀県' },
  { code: '42', en: 'nagasaki', ja: '長崎県' },
  { code: '43', en: 'kumamoto', ja: '熊本県' },
  { code: '44', en: 'oita', ja: '大分県' },
  { code: '45', en: 'miyazaki', ja: '宮崎県' },
  { code: '46', en: 'kagoshima', ja: '鹿児島県' },
  { code: '47', en: 'okinawa', ja: '沖縄県' }
];

function normalizePrefToken(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[ 　_-]+/g, '');
}

function addAlias(map, alias, code) {
  if (!alias) return;
  map.set(normalizePrefToken(alias), code);
}

const EN_ALIAS_TO_STANDARD_CODE = new Map();
const JA_ALIAS_TO_STANDARD_CODE = new Map();
const NUM_ALIAS_TO_STANDARD_CODE = new Map();
for (const pref of PREFECTURES) {
  addAlias(NUM_ALIAS_TO_STANDARD_CODE, pref.code, pref.code);
  addAlias(NUM_ALIAS_TO_STANDARD_CODE, String(Number(pref.code)), pref.code);
  addAlias(EN_ALIAS_TO_STANDARD_CODE, pref.en, pref.code);
  addAlias(JA_ALIAS_TO_STANDARD_CODE, pref.ja, pref.code);

  const jaBare = pref.ja.replace(/[都道府県]$/u, '');
  addAlias(JA_ALIAS_TO_STANDARD_CODE, jaBare, pref.code);

  if (pref.ja.endsWith('都')) addAlias(JA_ALIAS_TO_STANDARD_CODE, `${pref.en}to`, pref.code);
  if (pref.ja.endsWith('道')) addAlias(JA_ALIAS_TO_STANDARD_CODE, `${pref.en}do`, pref.code);
  if (pref.ja.endsWith('府')) addAlias(JA_ALIAS_TO_STANDARD_CODE, `${pref.en}fu`, pref.code);
  if (pref.ja.endsWith('県')) addAlias(JA_ALIAS_TO_STANDARD_CODE, `${pref.en}ken`, pref.code);
}

function parsePrefArg(options = {}) {
  const argv = options.argv || process.argv;
  const flag = options.flag || '--pref';
  const allowedCodes = options.allowedCodes || [];
  const fromStandardCode = options.fromStandardCode || ((code) => code);
  const allowEnglish = options.allowEnglish !== false;
  const allowJapanese = options.allowJapanese !== false;
  const allowNumeric = options.allowNumeric !== false;
  const allowAll = options.allowAll !== false;
  const allowedSet = new Set(allowedCodes);

  const idx = argv.indexOf(flag);
  if (idx === -1) return null;

  const raw = argv[idx + 1];
  if (!raw) return null;
  const value = String(raw).trim();
  if (!value) return null;

  const normalized = normalizePrefToken(value);
  if (allowAll && normalized === 'all') {
    return null;
  }
  let standardCode = null;

  if (allowNumeric) {
    standardCode = NUM_ALIAS_TO_STANDARD_CODE.get(normalized) || null;
  }
  if (!standardCode && allowEnglish) {
    standardCode = EN_ALIAS_TO_STANDARD_CODE.get(normalized) || null;
  }
  if (!standardCode && allowJapanese) {
    standardCode = JA_ALIAS_TO_STANDARD_CODE.get(normalized) || null;
  }

  if (standardCode) {
    const mappedCode = fromStandardCode(standardCode);
    if (allowedSet.has(mappedCode)) return mappedCode;
  }

  throw new Error(`invalid pref: ${raw}`);
}

function hasPrefListArg(options = {}) {
  const argv = options.argv || process.argv;
  const flag = options.flag || '--pref-list';
  return argv.includes(flag);
}

function getPrefList(options = {}) {
  const allowedCodes = options.allowedCodes || PREFECTURES.map((p) => p.code);
  const toStandardCode = options.toStandardCode || ((code) => code);
  const allowedStandard = new Set();

  for (const code of allowedCodes) {
    const mapped = toStandardCode(code);
    if (!mapped) continue;
    const norm = String(mapped).padStart(2, '0');
    if (/^(0[1-9]|[1-3][0-9]|4[0-7])$/.test(norm)) {
      allowedStandard.add(norm);
    }
  }

  return PREFECTURES
    .filter((pref) => allowedStandard.has(pref.code))
    .map((pref) => pref.en);
}

function printPrefList(options = {}) {
  const list = getPrefList(options);
  const logger = options.logger || console.log;
  logger(list.join('\n'));
}

module.exports = {
  parsePrefArg,
  hasPrefListArg,
  getPrefList,
  printPrefList
};
