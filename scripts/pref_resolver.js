const PREFECTURES = [
  { code: '01', en: 'hokkaido' },
  { code: '02', en: 'aomori' },
  { code: '03', en: 'iwate' },
  { code: '04', en: 'miyagi' },
  { code: '05', en: 'akita' },
  { code: '06', en: 'yamagata' },
  { code: '07', en: 'fukushima' },
  { code: '08', en: 'ibaraki' },
  { code: '09', en: 'tochigi' },
  { code: '10', en: 'gunma' },
  { code: '11', en: 'saitama' },
  { code: '12', en: 'chiba' },
  { code: '13', en: 'tokyo' },
  { code: '14', en: 'kanagawa' },
  { code: '15', en: 'niigata' },
  { code: '16', en: 'toyama' },
  { code: '17', en: 'ishikawa' },
  { code: '18', en: 'fukui' },
  { code: '19', en: 'yamanashi' },
  { code: '20', en: 'nagano' },
  { code: '21', en: 'gifu' },
  { code: '22', en: 'shizuoka' },
  { code: '23', en: 'aichi' },
  { code: '24', en: 'mie' },
  { code: '25', en: 'shiga' },
  { code: '26', en: 'kyoto' },
  { code: '27', en: 'osaka' },
  { code: '28', en: 'hyogo' },
  { code: '29', en: 'nara' },
  { code: '30', en: 'wakayama' },
  { code: '31', en: 'tottori' },
  { code: '32', en: 'shimane' },
  { code: '33', en: 'okayama' },
  { code: '34', en: 'hiroshima' },
  { code: '35', en: 'yamaguchi' },
  { code: '36', en: 'tokushima' },
  { code: '37', en: 'kagawa' },
  { code: '38', en: 'ehime' },
  { code: '39', en: 'kochi' },
  { code: '40', en: 'fukuoka' },
  { code: '41', en: 'saga' },
  { code: '42', en: 'nagasaki' },
  { code: '43', en: 'kumamoto' },
  { code: '44', en: 'oita' },
  { code: '45', en: 'miyazaki' },
  { code: '46', en: 'kagoshima' },
  { code: '47', en: 'okinawa' }
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
for (const pref of PREFECTURES) {
  addAlias(EN_ALIAS_TO_STANDARD_CODE, pref.en, pref.code);
}

function parsePrefArg(options = {}) {
  const argv = options.argv || process.argv;
  const flag = options.flag || '--pref';
  const allowedCodes = options.allowedCodes || [];
  const fromStandardCode = options.fromStandardCode || ((code) => code);
  const allowAll = options.allowAll !== false;
  const allowedSet = new Set(allowedCodes);

  const idx = argv.indexOf(flag);
  // `null` means "no prefecture filter" and callers interpret it as "all prefectures".
  if (idx === -1) return null;

  const raw = argv[idx + 1];
  if (!raw || String(raw).startsWith('-')) {
    throw new Error(`${flag} requires a value (e.g. tokyo, all)`);
  }
  const value = String(raw).trim();
  if (!value) {
    throw new Error(`${flag} requires a non-empty value (e.g. tokyo, all)`);
  }

  const normalized = normalizePrefToken(value);
  if (allowAll && normalized === 'all') {
    // Explicit `--pref all` is normalized to the same sentinel (`null`).
    return null;
  }
  const standardCode = EN_ALIAS_TO_STANDARD_CODE.get(normalized) || null;
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
