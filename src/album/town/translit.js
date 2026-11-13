// Place names into Russian, by the rules of practical transcription — for the names the data has in the local
// language only (the owner reads Russian; the lead session, 13.11.2026: «все названия поселений на карте и в панели
// района по-русски… практическая транскрипция по правилам, один раз при подготовке данных, не на лету; исходное
// название в данных сохранить»).
//
// This is used when the data is prepared (scripts/album/russify-names.mjs, scripts/album/bake-sites.mjs), never by the
// page. A name that already has a Russian form in the data keeps it; a well-known name is taken from EXONYMS; any
// other is transcribed word by word by the rules of its language:
//   es Spanish · gl Galician · ast Asturian · eu Basque · ca Catalan · pt Portuguese · fr French ·
//   ar the Latin spelling of Arabic and Berber names of the Maghreb (it follows French habits)
// The words of a name are joined with hyphens, as Russian maps write foreign names (Ла-Пуэбла-де-Альфинден); articles
// and prepositions inside a name are written small.
// The rules are those of the reference tables of practical transcription, simplified where a rule needs the stress
// or the etymology of a word: the result is a readable Russian name, not always the one an atlas would print.
// Plain JavaScript, no imports.

const S = '(?<![^])', E = '(?![^])';                                // the start and the end of a word
// a word through a list of rules: [pattern at this place, what to write]; a letter no rule knows goes through PLAIN
const PLAIN = { a: 'а', b: 'б', c: 'к', d: 'д', e: 'е', f: 'ф', g: 'г', h: '', i: 'и', j: 'х', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', q: 'к', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', w: 'в', x: 'кс', y: 'и', z: 'з',
  á: 'а', à: 'а', â: 'а', ä: 'а', ã: 'а', é: 'е', è: 'е', ê: 'е', ë: 'е', í: 'и', ì: 'и', î: 'и', ï: 'и', ó: 'о', ò: 'о', ô: 'о', ö: 'о', õ: 'о', ú: 'у', ù: 'у', û: 'у', ü: 'у', ñ: 'нь', ç: 'с', œ: 'ё', ə: '' };
const compile = rules => rules.map(([p, out]) => [new RegExp(p, 'yu'), out]);
function run(word, rules) {
  let out = '';
  for (let i = 0; i < word.length;) {
    let hit = false;
    for (const [re, to] of rules) { re.lastIndex = i; const m = re.exec(word); if (m && m[0].length) { out += typeof to === 'function' ? to(m, word) : to; i += m[0].length; hit = true; break; } }
    if (!hit) { out += PLAIN[word[i]] ?? ''; i++; }
  }
  return out;
}
// «ль» and «нь» before a vowel: Sevilla → Севилья, Logroño → Логроньо
const soft = (letters, vowels) => [[`${letters}[${vowels.a}]`, 'я'], [`${letters}[${vowels.e}]`, 'е'], [`${letters}[${vowels.i}]`, 'и'], [`${letters}[${vowels.o}]`, 'о'], [`${letters}[${vowels.u}]`, 'ю']];
const softened = (letters, sign, vowels) => [...soft(letters, vowels).map(([p, v]) => [p, sign + 'ь' + v]), [letters, sign + 'ь']];

// ---- Spanish; Galician, Asturian and Basque differ from it in a few letters
const EV = 'aeiouáéíóúü', EC = `[^${EV}]`, ESV = { a: 'aá', e: 'eé', i: 'ií', o: 'oó', u: 'uú' };
const ES_CORE = [
  [`${S}guad(?=[${EV}])`, 'гвад'],                                   // Guadalajara, Guadalupe, Guadiana
  ['ch', 'ч'], ...softened('ll', 'л', ESV), ...softened('ñ', 'н', ESV),
  ['qu[eé]', 'ке'], ['qu[ií]', 'ки'], ['qu', 'ку'], ['gü', 'гу'], ['gu[eé]', 'ге'], ['gu[ií]', 'ги'], ['g(?=[eéií])', 'х'],
  ['cc(?=[eéií])', 'кс'], ['c(?=[eéií])', 'с'], ['rr', 'рр'], ['z', 'с'], [`x(?=${EC})`, 'с'],
  [`${S}y${E}`, 'и'], ['y[aá]', 'я'], [`(?<=[${EV}])y[eé]`, 'йе'], ['y[eé]', 'е'], ['y[oó]', 'йо'], ['y[uú]', 'ю'], [`(?<=[${EV}])y`, 'й'],
  // i before a vowel: in the middle of a word it softens (Oviedo → Овьедо), at its end it stays (Soria → Сория)
  ['(?<=[bcdfgkpt][rl])i(?=[aáeéoóuú])', 'и'],                        // after two consonants it stays: Friol → Фриоль, Priego → Приего
  ['í[aá]', 'ия'], [`(?<=${EC})i[aá]${E}`, 'ия'], [`(?<=${EC})i[aá]s${E}`, 'иас'], [`(?<=${EC})i[aá]`, 'ья'],
  [`(?<=${EC})i[eé]${E}`, 'ие'], [`(?<=${EC})i[eé]`, 'ье'], [`(?<=${EC})i[oó]s?${E}`, m => (m[0].endsWith('s') ? 'иос' : 'ио')], [`(?<=${EC})i[oó]`, 'ьо'], [`(?<=${EC})i[uú]`, 'ью'],
  ['(?<=[aeouáéóú])i', 'й'],
  [`${S}[eé]`, 'э'], ['(?<=[aeouáéóú])[eé]', 'э'],
  [`l(?=${EC})`, 'ль'], [`l${E}`, 'ль'],
];
const ES = compile(ES_CORE), GL = compile([['x', 'ш'], ['nh', 'н'], ...ES_CORE]);
const EU = compile([['tx', 'ч'], ['tz', 'ц'], ['ts', 'ц'], ['x', 'ш'], ['g(?=[eéií])', 'г'], ...ES_CORE]);
const ES_SMALL = { de: 'де', del: 'дель', la: 'ла', las: 'лас', los: 'лос', el: 'эль', lo: 'ло', y: 'и', e: 'э', en: 'эн', a: 'а', al: 'аль', con: 'кон' };
const GL_SMALL = { ...ES_SMALL, o: 'о', os: 'ос', as: 'ас', do: 'до', da: 'да', dos: 'дос', das: 'дас' };

// ---- Catalan
const CV = 'aeiouàèéíïòóúü', CC = `[^${CV}]`, CAV = { a: 'aà', e: 'eèé', i: 'ií', o: 'oòó', u: 'uú' };
const CA = compile([
  ['l·l', 'лл'], ...softened('ll', 'л', CAV), ...softened('ny', 'н', CAV),
  ['tx', 'ч'], ['t[gj]', 'дж'], [`(?<=[${CV}])ig(?=${CC}|${E})`, 'ч'], [`(?<=[${CV}])ix`, 'ш'], [`${S}ex(?=[${CV}])`, 'экз'], ['x', 'ш'],
  ['cc(?=[eèéií])', 'кс'], ['c(?=[eèéií])', 'с'], [`(?<=n)c${E}`, ''],
  ['qü', 'ку'], ['qu[eèé]', 'ке'], ['qu[ií]', 'ки'], ['qu', 'ку'], ['gü', 'гу'], ['gu[eèé]', 'ге'], ['gu[ií]', 'ги'], ['g(?=[eèéií])', 'ж'],
  ['j', 'ж'], ['ss', 'с'], ['tz', 'дз'], ['ts', 'ц'], ['rr', 'рр'],
  [`${S}mont(?=[^${CV}s])`, 'мон'],                                  // Montcada → Монкада; Montseny keeps its т
  ['(?<=[aeouàèéòóú])[iï]', 'й'], [`(?<=${CC})i[aà]${E}`, 'ия'],
  [`${S}[eèé]`, 'э'], ['(?<=[aouàòóú])[eèé]', 'э'],
  [`l(?=${CC})`, 'ль'], [`l${E}`, 'ль'],
]);
const CA_SMALL = { de: 'де', del: 'дель', dels: 'дельс', la: 'ла', les: 'лес', el: 'эль', els: 'эльс', i: 'и', a: 'а', en: 'эн', sa: 'са', ses: 'сес', es: 'эс', na: 'на' };

// ---- Portuguese (of Portugal)
const PV = 'aeiouáâãàéêíóôõú', PC = `[^${PV}]`;
const ptSoft = (d, sign) => [[`${d}ã[o]?`, sign + 'ьян'], [`${d}[aá]`, sign + 'ья'], [`${d}[eéê]`, sign + 'ье'], [`${d}[ií]`, sign + 'ьи'], [`${d}o(?=s?${E})`, sign + 'ью'], [`${d}[oóô]`, sign + 'ьо'], [`${d}[uú]`, sign + 'ью'], [d, sign + 'ь']];
const PT = compile([
  ['ões', 'ойнш'], ['ães', 'айнш'], ['oão', 'уан'], ['ão', 'ан'], ['ã', 'ан'], ['õe', 'ойн'],
  ...ptSoft('lh', 'л'), ...ptSoft('nh', 'н'),
  ['ch', 'ш'], ['ss', 'с'], ['rr', 'рр'], ['ph', 'ф'],
  [`que${E}`, 'ки'], [`gue${E}`, 'ги'], ['qu[eéê]', 'ке'], ['qu[ií]', 'ки'], ['qu[aá]', 'ква'], ['qu', 'ку'],
  ['gu[eéê]', 'ге'], ['gu[ií]', 'ги'], ['g(?=[eéêií])', 'ж'], ['j', 'ж'], ['x', 'ш'], ['c(?=[eéêií])', 'с'],
  // s and z by what stands next to them
  [`${S}s`, 'с'], [`(?<=[${PV}])s(?=[${PV}])`, 'з'], ['s(?=[bdgjlmnrvz])', 'ж'], ['s(?=[cfkpqt])', 'ш'], [`s${E}`, 'ш'],
  [`z${E}`, 'ш'], ['z(?=[cfkpqt])', 'ш'],
  ['[eé]m' + E, 'ен'], ['[ií]m' + E, 'ин'], ['[uú]m' + E, 'ун'], ['[oó]m' + E, 'он'], ['[aá]m' + E, 'ан'], ['m' + E, 'н'],
  ['ou', 'о'], ['ai(?=nh)', 'аи'], [`(?<=[${PV}])i(?=[mn]${PC})`, 'и'],
  ['(?<=[aeouáâéêóôú])i[aá]', 'я'], ['(?<=[aeouáâéêóôú])i', 'й'], [`(?<=${PC})i[aá]${E}`, 'ия'],
  [`oa${E}`, (m, w) => (/[áâéêíóôú]/.test(w) ? 'уа' : 'оа')],        // Póvoa → Повуа, Lagoa → Лагоа
  [`os${E}`, 'уш'], [`o${E}`, 'у'], [`es${E}`, 'иш'], [`e${E}`, 'и'],
  [`${S}[eéê]`, 'э'], ['(?<=[aouáâóôú])[eéê]', 'э'],
]);
const PT_SMALL = { de: 'ди', do: 'ду', da: 'да', dos: 'душ', das: 'даш', e: 'и', o: 'у', a: 'а', os: 'уш', as: 'аш', em: 'эн', no: 'ну', na: 'на', ao: 'ау' };

// ---- French. The mute ends of a word are taken off first (frEnd); «ə» stands for a mute e that still softens the
// consonant before it (Orange → Оранж)
const FV = 'aeiouyàâéèêëîïôùûüœə', FC = `[^${FV}]`;
function frEnd(w) {
  let s = w.replace(/iers?$/, 'ié').replace(/(?<=[gq]u)es?$/, 'ə').replace(new RegExp(`(?<=${FC})es?$`, 'u'), 'ə');
  for (let n = 0; n < 2; n++) s = s.replace(/(?<=[aeiouyàâéêîïôùûüœnrl])[stdxg]$/, '');   // Tarbes, Bordeaux, Muret, Gard, Bourg; Alès keeps its s
  return s;
}
const FR = compile([
  ['ə', ''], ['vill[eə]', 'виль'], ['isl[eə]', 'иль'], [`${S}mont(?=${FC})`, 'мон'], ['tion', 'сьон'],
  ['ouill', 'уй'], ['euill', 'ёй'], ['aill', 'ай'], ['eill', 'ей'], [`(?<=[${FV}])il${E}`, 'й'], ['ill(?=ə)', 'иль'], [`(?<=${FC})ill(?=[${FV}])`, 'ий'],
  ['eau', 'о'], ['au', 'о'], [`oin(?![${FV}n])`, 'уэн'], ['oi', 'уа'], [`oy(?=[${FV}])`, 'уай'], ['o[uù]', 'у'],
  // nasal vowels: before a consonant or at the end of the word
  [`a[iy]n(?![${FV}nm])|ein(?![${FV}nm])|aim(?![${FV}nm])`, 'ен'], ['(?<=r)ien', 'иен'], [`(?<=${FC})ien(?![${FV}n])`, 'ьен'],
  [`en${E}`, 'ен'], [`[ae][nm](?![${FV}nm])`, 'ан'], [`[iy][nm](?![${FV}nm])`, 'ен'], [`o[nm](?![${FV}nm])`, 'он'], [`u[nm](?![${FV}nm])`, 'ён'],
  [`ay${E}`, 'е'], [`ay(?=[${FV}])`, 'ай'], [`${S}a[iî]|${S}ei`, 'э'], ['a[iî]|ei', 'е'], [`${S}eu|${S}œu?`, 'э'], ['eu|œu?', 'ё'],
  ['ch', 'ш'], ['ph', 'ф'], ['th', 'т'], ['gn', 'нь'], ['qu', 'к'], ['gu(?=[eéèêiyə])', 'г'], ['ge(?=[aoàâô])', 'ж'], ['g(?=[eéèêiyə])', 'ж'],
  ['cc(?=[eéèiy])', 'кс'], ['c(?=[eéèêiyə])', 'с'], ['j', 'ж'], ['ss', 'с'], [`(?<=[${FV}])s(?=[${FV}])`, 'з'],
  ['ll(?=ə)', 'ль'], [`ll(?=${FC}|${E})`, 'ль'], ['ll', 'л'], [`l(?=ə?${E})`, 'ль'], [`l(?=${FC})`, 'ль'],
  [`rr(?=ə?${E})`, 'р'], ['nn', 'н'], ['mm', 'м'], ['pp', 'п'], ['tt', 'т'], ['ff', 'ф'],
  [`(?<=[${FV}])y(?=[${FV}])`, 'й'], [`(?<=${FC})ieu`, 'ьё'], [`(?<=${FC})i[aàâ]`, 'ья'], [`(?<=${FC})i[eéèê]`, 'ье'], [`(?<=${FC})io`, 'ьо'],
  [`${S}[eéèê]`, 'э'], ['(?<=ou)[eéè]', 'э'], ['[uûü]', 'ю'],
]);
const FR_SMALL = { de: 'де', du: 'дю', des: 'де', le: 'ле', la: 'ла', les: 'ле', sur: 'сюр', sous: 'су', en: 'ан', et: 'э', lès: 'ле', lez: 'ле', aux: 'о', au: 'о', à: 'а' };
const frWord = w => run(frEnd(w), FR).replace(/ьа/g, 'ья').replace(/ьу/g, 'ью').replace(/айа/g, 'айя');

// ---- the Latin spelling of the names of the Maghreb
const AV = 'aeiouyàâéèêîïôû';
const AR = compile([
  ['tch', 'ч'], ['ch', 'ш'], ['sh', 'ш'], ['dj', 'дж'], ['kh', 'х'], ['gh', 'г'], ['th', 'т'], ['ph', 'ф'], ['dh', 'д'],
  ['gu[eéè]', 'ге'], ['gui', 'ги'], ['ou', 'у'], ['a[ïiy]', 'ай'], ['e[ïiy]', 'ей'], ['o[ïi]', 'ой'],
  ['c(?=[eéèi])', 'с'], ['g(?=[eéèi])', 'ж'], ['j', 'ж'], ['h', 'х'], ['w', 'у'],
  ['y[aà]', 'я'], ['you', 'ю'], [`y(?=[${AV}])`, 'й'], [`(?<=[^${AV}])i[aà]${E}`, 'ия'],
  [`${S}[eéè]`, 'э'], ['(?<=[aou])[eéè]', 'э'],
]);
const AR_SMALL = { el: 'эль', al: 'эль', bel: 'бель', ben: 'бен', bou: 'бу', de: 'де', ou: 'у', ed: 'эд', ech: 'эш', es: 'эс', ez: 'эз', er: 'эр', et: 'эт' };
const arWord = w => run(w.replace(new RegExp(`(?<=[^${AV}])e$`, 'u'), ''), AR);

const LANGS = {
  // (a mute h at the head of a word is dropped; inside a word it stays to keep two vowels apart: Lahiguera → Лаигера)
  es: { word: w => run(w.replace(/^h/, ''), ES), small: ES_SMALL },
  ast: { word: w => run(w.replace(/^h/, ''), GL), small: ES_SMALL },
  gl: { word: w => run(w.replace(/^h/, ''), GL), small: GL_SMALL },
  eu: { word: w => run(w.replace(/^h/, ''), EU), small: ES_SMALL },
  ca: { word: w => run(w.replace(/h/g, ''), CA), small: CA_SMALL },
  pt: { word: w => run(w, PT), small: PT_SMALL },
  fr: { word: frWord, small: FR_SMALL },
  ar: { word: arWord, small: AR_SMALL },
};
export const LANG_IDS = Object.keys(LANGS);

// ---- names that have a Russian form of their own (where the data has none): the key is the name without its accents
export const EXONYMS = { algiers: 'Алжир', alger: 'Алжир', oran: 'Оран', blida: 'Блида', chlef: 'Эш-Шелифф', granada: 'Гранада', 'ksar el kebir': 'Ксар-эль-Кебир', tlimcen: 'Тлемсен', tlemcen: 'Тлемсен',
  'sidi bel abbes': 'Сиди-Бель-Аббес', mostaganem: 'Мостаганем', marbella: 'Марбелья', tiarat: 'Тиарет', tiaret: 'Тиарет', mataro: 'Матаро', castello: 'Кастельон-де-ла-Плана', "m'sila": 'Мсила', medea: 'Медеа',
  biarritz: 'Биарриц', 'tizi-ouzou': 'Тизи-Узу', 'tizi ouzou': 'Тизи-Узу', saida: 'Саида', melilla: 'Мелилья', 'bordj bou arreridj': 'Бордж-Бу-Арреридж', larache: 'Лараш', algeciras: 'Альхесирас', bouira: 'Буира',
  mascara: 'Маскара', lorca: 'Лорка', guadalajara: 'Гвадалахара', ouezzane: 'Уэззан', linares: 'Линарес', brive: 'Брив-ла-Гайярд', 'brive-la-gaillarde': 'Брив-ла-Гайярд', 'viana do castelo': 'Виана-ду-Каштелу',
  lisboa: 'Лиссабон', lisbon: 'Лиссабон', sevilla: 'Севилья', cordoba: 'Кордова', cadiz: 'Кадис', 'a coruna': 'Ла-Корунья', 'la coruna': 'Ла-Корунья', zaragoza: 'Сарагоса', toulouse: 'Тулуза', marseille: 'Марсель',
  'aix-en-provence': 'Экс-ан-Прованс', dax: 'Дакс', bejaia: 'Беджая', tanger: 'Танжер', tangier: 'Танжер', tetouan: 'Тетуан', fes: 'Фес', meknes: 'Мекнес', oujda: 'Уджда', gibraltar: 'Гибралтар', ceuta: 'Сеута',
  eivissa: 'Ивиса', ibiza: 'Ивиса', elx: 'Эльче', elche: 'Эльче', alacant: 'Аликанте', alicante: 'Аликанте', 'donostia': 'Сан-Себастьян', pamplona: 'Памплона', iruna: 'Памплона', bilbo: 'Бильбао', bilbao: 'Бильбао',
  'vitoria-gasteiz': 'Витория', gasteiz: 'Витория', andorra: 'Андорра', 'andorra la vella': 'Андорра-ла-Велья', lleida: 'Льейда', girona: 'Жирона', perpignan: 'Перпиньян', bayonne: 'Байонна', rodez: 'Родез', foix: 'Фуа',
  apt: 'Апт', gap: 'Гап', 'saint-gaudens': 'Сен-Годенс', pezenas: 'Пезенас', lisle: 'Лиль' };
// names the data has in Arabic letters only (transcribed by hand)
const ARABIC = { 'عزيز': 'Азиз', 'حاسي فدول': 'Хасси-Фдуль', 'الزبيرية': 'Эз-Зубейрия', 'سغوان': 'Сегуан', 'مجبر': 'Меджбер', 'بوجبهة البرج': 'Буджебха-эль-Бордж', 'سيدي زيان': 'Сиди-Зиян' };
const AR_LETTERS = { 'ا': 'а', 'أ': 'а', 'إ': 'и', 'آ': 'а', 'ب': 'б', 'ت': 'т', 'ث': 'с', 'ج': 'дж', 'ح': 'х', 'خ': 'х', 'د': 'д', 'ذ': 'з', 'ر': 'р', 'ز': 'з', 'س': 'с', 'ش': 'ш', 'ص': 'с', 'ض': 'д', 'ط': 'т', 'ظ': 'з', 'ع': 'а',
  'غ': 'г', 'ف': 'ф', 'ق': 'к', 'ك': 'к', 'ل': 'л', 'م': 'м', 'ن': 'н', 'ه': 'х', 'ة': 'а', 'و': 'у', 'ي': 'и', 'ى': 'а', 'ء': '', 'ئ': 'и', 'ؤ': 'у' };

const LOOKALIKE = { A: 'А', a: 'а', B: 'В', C: 'С', c: 'с', E: 'Е', e: 'е', H: 'Н', K: 'К', M: 'М', O: 'О', o: 'о', P: 'Р', p: 'р', T: 'Т', X: 'Х', x: 'х', y: 'у' };
const bare = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
export const hasLatin = s => /[A-Za-zÀ-ɏ]/.test(s);
export const hasCyrillic = s => /[Ѐ-ӿ]/.test(s);
// the one name of a place the data gives several of: the first of «A / B», without what stands in brackets and
// without the same name in other letters
export function cleanName(name) {
  let s = String(name || '').replace(/[‎‏]/g, '').replace(/\s*\([^)]*\)/g, '').split(/\s+\/\s+|\/|\s+-\s+|\s+—\s+/)[0].trim();
  if (hasLatin(s)) s = s.replace(/[؀-ۿݐ-ݿⴰ-⵿]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s;
}
// The language a name is written in, where the place alone does not tell: the Valencian land writes its names in
// Catalan or in Spanish, the Basque land and Navarre in Basque or in Spanish
export function guessLang(lang, name) {
  const s = cleanName(name).toLowerCase();
  if (lang === 'va') return /ny|ç|tx|l·l|[àèò]|ig$|^x|(^| )(i|els|les|dels)( |$)|[dl]'/.test(s) ? 'ca' : /ñ|ch|[áéíóú]|(^| )(y|del|los|las)( |$)|j|ue|ie/.test(s) ? 'es' : 'ca';
  if (lang === 'nav') return /tx|tz|ts|k|x|rr.*a$|eta$|aga$/.test(s) && !/ñ|ll|[áéíóú]|(^| )(de|del|la|el)( |$)/.test(s) ? 'eu' : 'es';
  return lang;
}

// A name in Russian. lang: one of LANG_IDS (or 'va', 'nav': see guessLang). A name already in Russian letters is
// returned as it is.
export function toRussian(name, lang = 'es') {
  const raw = String(name || '').replace(/[‎‏]/g, '').trim();
  // (a Russian name of the data with a stray Latin letter in it: «A Корунья»)
  if (hasCyrillic(raw)) return hasLatin(raw) ? raw.replace(/[A-Za-z]/g, c => LOOKALIKE[c] ?? c).replace(/^А[- ]Корунья$/, 'Ла-Корунья') : raw;
  if (!raw) return raw;
  if (ARABIC[raw]) return ARABIC[raw];
  const clean = cleanName(raw);
  if (!hasLatin(clean)) return cap([...clean].map(c => (c === ' ' ? '-' : AR_LETTERS[c] ?? '')).join('').replace(/-+/g, '-').replace(/^-|-$/g, ''));
  const known = EXONYMS[bare(clean)]; if (known) return known;
  const L = LANGS[guessLang(lang, clean)] || LANGS.es, id = guessLang(lang, clean);
  // the words: «d'», «l'» stay with the word they belong to
  const words = clean.toLowerCase().replace(/[’`´]/g, "'").split(/[\s\-–]+/).filter(Boolean), out = [];
  words.forEach((w, n) => {
    const next = words[n + 1] || '', first = n === 0;
    const m = /^([dlsnmt])'(.+)$/.exec(w);
    if (m) { const letter = { d: 'д', l: 'л', s: 'с', n: 'н', m: 'м', t: 'т' }[m[1]]; out.push((first ? letter.toUpperCase() : letter) + '’' + cap(L.word(m[2]))); return; }
    if (!/\p{L}/u.test(w)) { out.push(w); return; }                  // a number
    // the saints: Sant Cugat → Сан-Кугат, Sant Andreu → Сант-Андреу; Saint-Jean → Сен-Жан, Saint-Étienne → Сент-Этьен
    const vowelNext = /^[aeiouhàáâèéêíòóôúü]/.test(next);
    if (id === 'ca' && w === 'sant') { out.push(vowelNext ? 'Сант' : 'Сан'); return; }
    if (id === 'fr' && (w === 'saint' || w === 'st')) { out.push(vowelNext ? 'Сент' : 'Сен'); return; }
    if (id === 'fr' && (w === 'sainte' || w === 'saintes' || w === 'ste')) { out.push('Сент'); return; }
    if (id === 'pt' && w === 'são') { out.push('Сан'); return; }
    const small = L.small[w];
    if (small !== undefined) { out.push(first ? cap(small) : small); return; }
    out.push(cap(L.word(w)));
  });
  return out.join('-');
}

// ---- the language of a place from the modern unit it lies in (public/assets/album/division/admin.json: the key of a
// unit is «ESP-5827», its country and its number in Natural Earth)
const COUNTRY = { ESP: 'es', PRT: 'pt', FRA: 'fr', AND: 'ca', MAR: 'ar', DZA: 'ar', GIB: 'es' };
const SPAIN = { 5827: 'gl', 5832: 'gl', 5838: 'gl', 5840: 'gl', 5805: 'ast', 5809: 'ca', 5820: 'ca', 5831: 'ca', 5846: 'ca', 5808: 'ca', 5814: 'va', 5849: 'va', 5803: 'va', 5823: 'nav', 5851: 'nav', 5801: 'nav', 5837: 'nav' };
export const langOfUnit = id => { const [c, n] = String(id || '').split('-'); return (c === 'ESP' && SPAIN[n]) || COUNTRY[c] || 'es'; };
// units: admin.json's { id: { rings: [[[lon, lat] …] …] } } → (lon, lat) → the id of the unit the point lies in; a
// point in none (a place on the very shore) takes the unit whose outline comes nearest
export function unitFinder(units) {
  const list = Object.entries(units).map(([id, u]) => { let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const r of u.rings) for (const [x, y] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return { id, rings: u.rings, x0, x1, y0, y1 }; });
  const inside = (x, y, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > y) !== (r[j][1] > y) && x < (r[j][0] - r[i][0]) * (y - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; return c; };
  return (lon, lat) => {
    for (const u of list) if (lon >= u.x0 && lon <= u.x1 && lat >= u.y0 && lat <= u.y1 && u.rings.some(r => inside(lon, lat, r))) return u.id;
    let best = null, bd = Infinity;
    for (const u of list) { if (lon < u.x0 - 1 || lon > u.x1 + 1 || lat < u.y0 - 1 || lat > u.y1 + 1) continue; for (const r of u.rings) for (let i = 0, step = r.length > 60 ? 3 : 1; i < r.length; i += step) { const d = (r[i][0] - lon) ** 2 + (r[i][1] - lat) ** 2; if (d < bd) { bd = d; best = u.id; } } }
    return best;
  };
}

// The records of the list of sites (town/sites.js: [lon × 1e4, lat × 1e4, people, kind, name]) with their names in
// Russian: a record whose name was transcribed keeps the name of the data as its sixth number.
//   units: admin.json's units → [records, { byLang: { es: n … }, kept: names that were Russian already }].
// Done twice it changes nothing.
export function russifySites(sites, units) {
  const unitAt = unitFinder(units), byLang = {}; let kept = 0;
  const out = sites.map(s => {
    const name = s[5] || s[4] || '';                               // (a record transcribed before is transcribed anew from the name it kept)
    if (!name || (hasCyrillic(name) && !hasLatin(name))) { kept++; return s.slice(0, 5); }
    const lang = guessLang(langOfUnit(unitAt(s[0] / 1e4, s[1] / 1e4)), name);
    byLang[lang] = (byLang[lang] || 0) + 1;
    return [s[0], s[1], s[2], s[3], toRussian(name, lang), name];
  });
  return [out, { byLang, kept }];
}
