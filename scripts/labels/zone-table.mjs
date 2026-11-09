// Which Natural Earth features become zone labels, what kind they are, and
// their Russian names. Natural Earth ships NAME_RU for almost everything, but a
// fair share of those come from Wikidata and are wrong or awkward for a map
// ("Sea Islands" -> "гора Скотт", "Tatra" -> "Кшемёнки-Закшувские"), so every
// feature that survives the filter was reviewed by hand; corrections live here.
//
// Keys are normalised English names (see keyOf): diacritics and punctuation
// dropped, lower case, so "Yam Alin’ Range" -> "yamalinrange".

export function keyOf(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ø/g, 'o')
    .replace(/[^a-z0-9]/g, '');
}

// ------------------------------------------------------------------ land (ne_10m_geography_regions_polys)
// FEATURECLA -> kind. null = never labelled (no countries, islands, coasts, continents).
export const LAND_CLASS = {
  'Range/mtn': 'range',
  'Desert': 'desert',
  'Plateau': 'plateau',
  'Basin': 'basin',
  'Depression': 'basin',
  'Plain': 'plain',
  'Lowland': 'lowland',
  'Tundra': 'tundra',
  'Pen/cape': 'peninsula',
  'Peninsula': 'peninsula',
  'Valley': 'valley',
  'Gorge': 'valley',
  'Delta': 'delta',
  'Wetlands': 'other',
  'Foothills': 'other',
  'Geoarea': null,        // only the natural ones listed in GEOAREA_ALLOW
  'Island': null,
  'Island group': null,
  'Coast': null,
  'Continent': null,
  'Isthmus': null,
  'Lake': null,
  'Dragons-be-here': null,
};

// "Geoarea" mixes natural regions with historical/administrative ones; keep only natural ones.
export const GEOAREA_ALLOW = {
  sudd: 'other',
  finnishlakeregion: 'other',
  hexicorridor: 'valley',
  mesopotamia: 'plain',
  anatolia: 'peninsula',
  patagonia: 'other',
  riverina: 'plain',
  dampierland: 'peninsula',
  elgezira: 'plain',
  jutland: 'peninsula',
  eastantarctica: 'other',
  westantarctica: 'other',
};

// Features of an otherwise accepted class that are not natural zones (capes are points, Entre Rios is a province).
export const SKIP = new Set([
  'capezhelaniya', 'capechelyuskin', 'camaupoint', 'entrerios',
]);

// Capes and points are not zones — but "Cape York Peninsula" is a peninsula, not a cape.
export function isCapePoint(name) {
  const s = String(name ?? '');
  return /^(cape|point|cabo|pointe)\b/i.test(s) && !/\b(pen\.?|peninsula|península|péninsule)(\s|$)/i.test(s);
}

export const KIND_OVERRIDE = {
  hardangervidda: 'plateau',
  vatnajokull: 'other',
  jabalassawda: 'range',
  jabalnafusah: 'range',
  leslaurentides: 'range',
  ethiopianhighlands: 'plateau',
  guianahighlands: 'plateau',
  punjab: 'plain',
  caatingas: 'other',
  canadianshield: 'other',
  peninsulaiberica: 'peninsula',
  arnhemland: 'peninsula',
  pantanal: 'lowland',
  sundarbans: 'delta',
  salardeuyuni: 'other',
  makgadikgadipan: 'other',
  etoshapan: 'other',
};

// Two features describe the same range on both sides of the antimeridian under different spellings.
export const ALIAS = {
  queenmaudemountains: 'queenmaudmountains',
};

// ------------------------------------------------------------------ marine (ne_10m_geography_marine_polys)
export const MARINE_CLASS = {
  ocean: 'ocean',
  sea: 'sea',
  gulf: 'gulf',
  bay: 'bay',
  strait: 'strait',
  channel: 'strait',
  sound: 'sound',     // resolved to strait/bay by the Russian name
  fjord: 'bay',
  lagoon: 'bay',
  inlet: 'bay',
  reef: 'other',
  generic: null,      // unnamed polygons
  river: null,        // river mouths, the rivers module draws those
};
export const MARINE_SKIP = new Set(['saintlawrenceriver']);
// Natural Earth files the Skagerrak as a fjord; it is a strait between the North Sea and the Kattegat.
export const MARINE_KIND_OVERRIDE = {
  skagerrak: 'strait',
};

// ------------------------------------------------------------------ Russian names (hand-checked)
export const RU = {
  // ranges
  jabalbinghunaymah: 'Джебель-бин-Гунайма',
  ruwenzorirange: 'Рувензори',
  jabalassawda: 'Джебель-эс-Сауда',
  blackrockdesert: 'пустыня Блэк-Рок',
  khomashighland: 'нагорье Хомас',
  ennediplat: 'плато Эннеди',
  josplateau: 'плато Джос',
  mayamts: 'горы Майя',
  bitterrootrange: 'хребет Биттеррут',
  wasatchrange: 'хребет Уосатч',
  hardangervidda: 'Хардангервидда',
  chainedesmongos: 'массив Бонго',
  grootkarasberge: 'горы Большой Карас',
  marrahmts: 'горы Марра',
  aljabalalakhdar: 'Джебель-Ахдар',
  inyangamts: 'горы Иньянга',
  flindersranges: 'хребет Флиндерс',
  gregoryra: 'хребет Грегори',
  macdonnellranges: 'хребты Макдоннелл',
  darlingrange: 'хребет Дарлинг',
  hentiynmts: 'Хэнтэй',
  chukchirange: 'Чукотское нагорье',
  suntarkhayatarange: 'хребет Сунтар-Хаята',
  dzhugdzhurrange: 'хребет Джугджур',
  karataurange: 'хребет Каратау',
  arvallira: 'хребет Аравалли',
  kirthara: 'хребет Киртхар',
  kirtharra: 'хребет Киртхар',
  centralmakran: 'Центральный Макран',
  kopetdagmts: 'Копетдаг',
  taurusmts: 'Тавр',
  tatramts: 'Татры',
  calabria: 'Калабрийские Апеннины',
  vatnajokull: 'Ватнайёкюдль',
  ogilviemts: 'горы Огилви',
  wrangellmts: 'горы Врангеля',
  klamathmts: 'горы Кламат',
  ouachitamts: 'горы Уошито',
  sdopiaui: 'Серра-ду-Пиауи',
  serradaibiapaba: 'Серра-да-Ибиапаба',
  serraacarai: 'Серра-Акараи',
  serradecurupira: 'Серра-ду-Курупира',
  sdocachimbo: 'Серра-ду-Кашимбу',
  sdourada: 'Серра-Доурада',
  sdosgradaus: 'Серра-дус-Градаус',
  serradoespinhaco: 'Серра-ду-Эспиньясу',
  sdepakaraima: 'горы Пакарайма',
  wilhelminagebergte: 'горы Вильгельмина',
  serradomar: 'Серра-ду-Мар',
  serrageral: 'Серра-Жерал',
  serradamantiqueira: 'Серра-да-Мантикейра',
  guianashield: 'Гвианский щит',
  selwynmts: 'горы Селуин',
  torngatmts: 'горы Торнгат',
  cherskiyrange: 'хребет Черского',
  luliangmts: 'Люйляншань',
  dangrekra: 'горы Дангрэк',
  southernghats: 'Южные Гхаты',
  satpurarange: 'хребет Сатпура',
  kuhrudmountains: 'горы Кухруд',
  crystalmountains: 'Хрустальные горы',
  tibestimts: 'нагорье Тибести',
  airmts: 'нагорье Аир',
  centralhighlands: 'плато Тэйнгуен',
  easternsayanmts: 'Восточный Саян',
  dabiemts: 'горы Дабешань',
  nanlingmts: 'Наньлин',
  vindhyarange: 'горы Виндхья',
  hejazmts: 'горы Хиджаз',
  elburzmts: 'Эльбурс',
  appennini: 'Апеннины',
  mackenziemts: 'горы Маккензи',
  cordcentral: 'Центральная Кордильера',
  cordilleraoriental: 'Восточная Кордильера',
  altaymountains: 'Алтай',
  brooksrange: 'хребет Брукса',
  caucasusmts: 'Большой Кавказ',
  leslaurentides: 'Лаврентийские горы',
  jabalnafusah: 'горы Нафуса',
  // plateaus, uplands
  greatkarroo: 'Большое Кару',
  northernkarroo: 'Северное Кару',
  tagant: 'плато Тагант',
  bucklandtableland: 'плато Бакленд',
  athertontableland: 'плато Атертон',
  barklytableland: 'плато Баркли',
  okhotskkolymaupland: 'Охотско-Колымское нагорье',
  chotanagpurplateau: 'плато Чхота-Нагпур',
  adamawaplateau: 'плато Адамава',
  ozarkplateau: 'плато Озарк',
  edwardsplateau: 'плато Эдуардс',
  fraserplateau: 'плато Фрейзер',
  ustyurtplateau: 'плато Устюрт',
  putoranaplateau: 'плато Путорана',
  khoratplat: 'плато Корат',
  coloradoplateau: 'плато Колорадо',
  cumberlandplat: 'плато Камберленд',
  planaltocentral: 'Центральное плато',
  campossertao: 'Кампус-Сертан',
  nivolcanicplateau: 'Вулканическое плато',
  // deserts
  salardeuyuni: 'солончак Уюни',
  wahibasands: 'пески Вахиба',
  danakil: 'пустыня Данакиль',
  chalbidesert: 'пустыня Чалби',
  easterndesert: 'Восточная пустыня',
  negevdesert: 'пустыня Негев',
  hamadadetinrhert: 'Хамада-Тинрерт',
  strzeleckidesert: 'пустыня Стшелецкого',
  simpsondesert: 'пустыня Симпсон',
  tanamidesert: 'пустыня Танами',
  annafuddesert: 'Большой Нефуд',
  hamadadudraa: 'Хамада-дю-Дра',
  tassiliouanahaggar: 'Тассили-ва-н-Ахаггар',
  sarirkalanshiyuarramlialkabi: 'пески Каланшо',
  chihuahuandesert: 'пустыня Чиуауа',
  sonorandesert: 'пустыня Сонора',
  muusdesert: 'пустыня Муус',
  thardesert: 'пустыня Тар',
  desiertodeatacama: 'пустыня Атакама',
  caatingas: 'Каатинга',
  // plains, lowlands, basins, valleys
  serengetiplains: 'равнины Серенгети',
  masaisteppe: 'степь Масаи',
  darlingdowns: 'Дарлинг-Даунс',
  tihamah: 'Тихама',
  bodeledepression: 'впадина Боделе',
  sundarbans: 'Сундарбан',
  elgezira: 'Гезира',
  finnishlakeregion: 'Финское Поозерье',
  yukonflats: 'Юкон-Флэтс',
  nullarborplain: 'равнина Налларбор',
  centrallowland: 'Центральные равнины',
  sahel: 'Сахель',
  punjab: 'Пенджаб',
  greatplains: 'Великие равнины',
  junggarbasin: 'Джунгарская равнина',
  qaidambasin: 'Цайдамская котловина',
  kolymalowland: 'Колымская низменность',
  murraydarlingbasin: 'бассейн Муррея',
  congobasin: 'впадина Конго',
  hexicorridor: 'коридор Хэси',
  vallelongitudinal: 'Центральная долина',
  tsangpogorge: 'каньон Цангпо',
  selvas: 'Сельва',
  // peninsulas
  peninsuladetaitao: 'полуостров Тайтао',
  notopen: 'полуостров Ното',
  wilsonspromontory: 'Уилсонс-Промонтори',
  datupen: 'полуостров Дату',
  taygonospen: 'полуостров Тайгонос',
  boothiapeninsula: 'полуостров Бутия',
  foxepen: 'полуостров Фокс',
  metaincognitapen: 'полуостров Мета-Инкогнита',
  kenaipeninsula: 'полуостров Кенай',
  sewardpeninsula: 'полуостров Сьюард',
  melvillepeninsula: 'полуостров Мелвилл',
  gaspepeninsula: 'полуостров Гаспе',
  kathiawarpen: 'полуостров Катхиявар',
  leizhoupen: 'полуостров Лэйчжоу',
  capeyorkpen: 'полуостров Кейп-Йорк',
  arnhemland: 'Арнемленд',
  bajacalifornia: 'полуостров Калифорния',
  pendeyucatan: 'полуостров Юкатан',
  alaskapeninsula: 'полуостров Аляска',
  florida: 'полуостров Флорида',
  peninsulavaldes: 'полуостров Вальдес',
  taymyrpeninsula: 'полуостров Таймыр',
  yamalpeninsula: 'полуостров Ямал',
  kamchatkapeninsula: 'полуостров Камчатка',
  malaypeninsula: 'полуостров Малакка',
  somalipeninsula: 'полуостров Сомали',
  india: 'Индостан',
  scandinavia: 'Скандинавский полуостров',
  peninsulaiberica: 'Пиренейский полуостров',
  bankspen: 'полуостров Банкс',
  coromandel: 'полуостров Коромандел',
  otagopen: 'полуостров Отаго',
  dampierland: 'Земля Дампира',
  // Antarctica
  queenalexandrarange: 'хребет Королевы Александры',
  kemppeninsula: 'полуостров Кемп',
  floodrange: 'хребет Флад',
  fordranges: 'хребты Форда',
  edwardviipeninsula: 'полуостров Эдуарда VII',
  queenmaudmountains: 'горы Королевы Мод',
  rockefellerplateau: 'плато Рокфеллера',
  executivecommitteerange: 'хребет Исполнительного Комитета',
  princecharlesmountains: 'горы Принс-Чарльз',
  scottmountains: 'горы Скотт',
  shackletonrange: 'хребет Шеклтона',
  domeccharlie: 'купол Конкордия',
  domeaargus: 'купол Аргус',
  pensacolamountains: 'горы Пенсакола',
  ellsworthmountains: 'горы Элсуорт',
  martinpeninsula: 'полуостров Мартин',

  // ---------------------------------------------------------------- marine
  celebessea: 'море Сулавеси',
  bahiadecampeche: 'залив Кампече',
  jamesbay: 'залив Джеймс',
  gulfofcarpentaria: 'залив Карпентария',
  bayofplenty: 'залив Пленти',
  gulfoftonkin: 'Тонкинский залив',
  bayoffundy: 'залив Фанди',
  melvillebay: 'залив Мелвилл',
  gulfofmaine: 'залив Мэн',
  golfosanjorge: 'залив Сан-Хорхе',
  viscountmelvillesound: 'пролив Вайкаунт-Мелвилл',
  ungavabay: 'залив Унгава',
  mclurestrait: 'пролив Мак-Клур',
  golfosanmatias: 'залив Сан-Матиас',
  golfocorcovado: 'залив Корковадо',
  bransfieldstrait: 'пролив Брансфилд',
  mcmurdosound: 'пролив Мак-Мёрдо',
  baiadesaomarcos: 'залив Сан-Маркус',
  baiademarajo: 'залив Маражо',
  cumberlandsound: 'залив Камберленд',
  frobisherbay: 'залив Фробишер',
  diskobay: 'залив Диско',
  uchiurabay: 'залив Утиура',
  sharkbay: 'залив Шарк',
  gulfofgabes: 'залив Габес',
  mackenziebay: 'залив Маккензи',
  nortonsound: 'залив Нортон',
  kotzebuesound: 'залив Коцебу',
  gulfofboothia: 'залив Бутия',
  kanebasin: 'бассейн Кейна',
  foxebasin: 'бассейн Фокс',
  golfodetehuantepec: 'залив Теуантепек',
  golfodeguayaquil: 'залив Гуаякиль',
  qiongzhoustrait: 'Хайнаньский пролив',
  gulfofpapua: 'залив Папуа',
  gulfofsidra: 'залив Сидра',
  bightofbenin: 'Бенинский залив',
  bightofbiafra: 'залив Биафра',
  straitofbelleisle: 'пролив Белл-Айл',
  bahiablanca: 'залив Баия-Бланка',
  golfodepenas: 'залив Пеньяс',
  bahiagrande: 'залив Баия-Гранде',
  antongilabay: 'залив Антонжиль',
  hangzhoubay: 'залив Ханчжоувань',
  gulfstvincent: 'залив Сент-Винсент',
  golfodeuraba: 'залив Ураба',
  baiademaputo: 'залив Мапуту',
  sthelenabay: 'залив Святой Елены',
  josephbonapartegulf: 'залив Жозеф-Бонапарт',
  gulfofmartaban: 'Мартабанский залив',
  kangertittivaq: 'залив Скорсби',
  gulfofaqaba: 'залив Акаба',
  lagodemaracaibo: 'озеро Маракайбо',
  massachusettsbay: 'залив Массачусетс',
  longislandsound: 'пролив Лонг-Айленд',
  albemarlesound: 'залив Албемарл',
  pamlicosound: 'залив Памлико',
  lakepontchartrain: 'озеро Пончартрейн',
  huskylakes: 'озёра Хаски',
  stettinerhaff: 'Щецинский залив',
  hecatestrait: 'пролив Хекате',
  balisea: 'море Бали',
  davaogulf: 'залив Давао',
  sibuyansea: 'море Сибуян',
  selatdampier: 'пролив Дампир',
  boholsea: 'море Бохоль',
  surigaostrait: 'пролив Суригао',
  leytegulf: 'залив Лейте',
  furyandheclastrait: 'пролив Фьюри-энд-Хекла',
  jonessound: 'пролив Джонс',
  eclipsesound: 'пролив Эклипс',
  canalperigoso: 'канал Перигозу',
  canaldosul: 'Южный канал',
  canaldonorte: 'Северный канал',
  kaliningrad: 'Калининградский залив',
  sanfranciscobay: 'залив Сан-Франциско',
  montereybay: 'залив Монтерей',
  bismarcksea: 'море Бисмарка',
  dixonentrance: 'пролив Диксон-Энтранс',
  karskiyestrait: 'пролив Карские Ворота',
  sognefjorden: 'Согнефьорд',
  trondheimsfjorden: 'Тронхеймсфьорд',
  boknafjorden: 'Бокнафьорд',
  princewilliamsound: 'залив Принс-Уильям',
  brasdorlake: 'озеро Бра-д’Ор',
  ozeromogotoyevo: 'озеро Моготоево',
  alboransea: 'море Альборан',
  // NAME_RU repeats the English generic word ("залив Дарнли-Бэй") or keeps "Seno" (= sound) as a name
  darnleybay: 'залив Дарнли',
  hadleybay: 'залив Хадли',
  cordovabay: 'залив Кордова',
  senootway: 'залив Отуэй',
  senodeskyring: 'залив Скайринг',
  oresund: 'пролив Эресунн',
};

// Leading generic words that Russian cartography writes in lower case ("море Лаптевых").
export const GENERIC_RU = [
  'Море', 'Залив', 'Пролив', 'Бухта', 'Губа', 'Пустыня', 'Полуостров', 'Хребет', 'Горы', 'Плато', 'Нагорье',
  'Бассейн', 'Впадина', 'Озеро', 'Степь', 'Равнина', 'Низменность', 'Дельта', 'Долина', 'Купол', 'Пески',
  'Солончак', 'Каньон', 'Массив', 'Земля',
];

// Clean up a Russian name: drop stress marks, normalise quotes/spaces, lower-case generic words.
export function cleanRu(s) {
  if (!s) return s;
  let t = String(s).normalize('NFC').replace(/[̀́]/g, '').replace(/\s+/g, ' ').trim();
  t = t.replace(/'/g, '’');
  for (const g of GENERIC_RU) {
    if (t.startsWith(g + ' ') && /^[A-ZА-ЯЁ]/u.test(t.slice(g.length + 1))) {
      // keep "Земля Франца-Иосифа"-type proper names capitalised; only the descriptive words go lower case
      if (g === 'Земля') break;
      t = g.toLowerCase() + t.slice(g.length);
      break;
    }
  }
  return t;
}

// ------------------------------------------------------------------ broken source polygons
// Natural Earth 1:10m ships these as tiny/degenerate polygons in the wrong place
// (Scotia Sea = an 8-vertex speck near Elephant Island, Luzon Strait = 4 vertices,
// Drake Passage = slivers). Hand-placed label lines [lon, lat], west -> east.
// The second group are coast-tracing slivers whose vertex axis runs ACROSS the strait from shore
// to shore (ends on land); their lines follow the water passage instead. Every point was checked
// to lie on water in the game's own grid (public/assets/map/cells.bin.gz).
export const MANUAL_PATH = {
  scotiasea: [[-56.0, -57.0], [-46.0, -57.6], [-36.0, -57.2]],
  drakepassage: [[-68.5, -57.8], [-63.5, -58.7], [-58.5, -59.4]],
  luzonstrait: [[119.9, 20.3], [121.0, 20.45], [122.1, 20.5]],
  // Soya / La Pérouse: Sea of Japan -> Sea of Okhotsk between Cape Soya and Cape Crillon
  laperousestrait: [[141.45, 45.71], [141.95, 45.73], [142.45, 45.71]],
  // Bab-el-Mandeb: Red Sea -> Gulf of Aden, along the channel
  babelmandeb: [[42.9, 13.15], [43.27, 12.72], [43.7, 12.45]],
  // Kara Gates: Pechora Sea -> Kara Sea between Vaygach and Novaya Zemlya
  karskiyestrait: [[57.3, 70.38], [58.15, 70.56], [59.0, 70.73]],
  // St Helena Bay: the bay between Cape Columbine and Elands Bay (the sliver ran 120 km up the coast)
  sthelenabay: [[17.97, -32.66], [18.1, -32.5], [18.24, -32.33]],
};

// English names where Natural Earth's NAME_EN points at the wrong thing.
export const EN = {
  cordcentral: 'Cordillera Central',
  grampianmts: 'Grampian Mountains',
  sdopiaui: 'Serra do Piauí',
  inyangamts: 'Inyanga Mountains',
  balticplains: 'Baltic Plains',
  southernghats: 'Southern Ghats',
  campossertao: 'Campos Sertão',
  planaltocentral: 'Planalto Central',
  cookinlet: 'Cook Inlet',
  muusdesert: 'Mu Us Desert',
  northernkarroo: 'Northern Karoo',
  somalipeninsula: 'Somali Peninsula',
  nigerdelta: 'Niger Delta',                       // NAME_EN: "Enugu Nigeria"
  peninsuladetaitao: 'Taitao Peninsula',           // "Taitailei"
  ahaggarmts: 'Ahaggar Mountains',                 // "Ahag"
  appennini: 'Apennines',                          // "Appennino Ligure" (only one section of the range)
  serradoespinhaco: 'Serra do Espinhaço',          // "Serra do Espinho"
  serradamantiqueira: 'Serra da Mantiqueira',      // "Serra da Mantiquiera"
  nullarborplain: 'Nullarbor Plain',               // "Nullabor Plain"
  selwynra: 'Selwyn Range',                        // Queensland; "Selwyn Mountains" is the Yukon range
  okhotskkolymaupland: 'Okhotsk-Kolyma Upland',    // "Kolyma Mountains" (= the KOLYMA RANGE feature)
  stanovoyupland: 'Stanovoy Highlands',            // "Stanovoy Range" (= the STANOVOY RANGE feature)
  guianashield: 'Guiana Shield',                   // "Guiana Highlands" (= the GUIANA HIGHLANDS feature)
  crystalmountains: 'Crystal Mountains',
  kolapeninsula: 'Kola Peninsula',
};
