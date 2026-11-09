// Russian names for natural districts: river dictionary, genitive declension,
// a Latin -> Cyrillic fallback transliteration, compass qualifiers and
// disambiguation of repeated names. Pure functions, no IO.

// English / local Natural Earth river names -> Russian. A string is the
// nominative (genitive derived by rules); an array is [nominative, genitive].
// Several NE spellings of one river map to the same Russian name on purpose.
export const RIVERS_RU = {
  'Irrawaddy Delta': 'Иравади', Irrawaddy: 'Иравади', Ayeyarwady: 'Иравади', Ucayali: 'Укаяли', Tuotuo: 'Тотохэ', Lena: 'Лена',
  Tongtian: 'Тунтяньхэ', 'Bahr el Jebel': 'Бахр-эль-Джебель', Jinsha: 'Цзиньшацзян', 'El Bahr el Abyad': 'Белый Нил',
  'Chang Jiang': 'Янцзы', Yangtze: 'Янцзы', 'Rosetta Branch': 'Розеттский рукав', 'Damietta Branch': 'Дамиеттский рукав',
  'Bykovskaya Protoka': 'Быковская протока', 'Olenekskaya Protoka': 'Оленёкская протока', 'Trofimovskaya Protoka': 'Трофимовская протока',
  'Tumatskaya Protoka': 'Туматская протока', 'St. Lawrence': ['река Святого Лаврентия', 'реки Святого Лаврентия'],
  'Saint Lawrence': ['река Святого Лаврентия', 'реки Святого Лаврентия'], Ob: 'Обь', Danube: 'Дунай', Donau: 'Дунай', Duna: 'Дунай',
  Dunarea: 'Дунай', 'Soroksari Duna': 'Шорокшарский Дунай', Ideriyn: 'Идэр', Selenga: 'Селенга', Ertis: 'Иртыш', Ertix: 'Иртыш', Irtysh: 'Иртыш',
  Maquan: 'Мацюаньхэ', Angara: 'Ангара', Peace: 'Пис', Mackenzie: 'Маккензи', Za: 'Дзачу', 'Paraná': 'Парана', Parana: 'Парана',
  Lualaba: 'Луалаба', Slave: 'Слейв', Lancang: 'Ланьцанцзян', Congo: 'Конго', Yarlung: 'Ярлунг-Цангпо', Mekong: 'Меконг',
  Dihang: 'Диханг', 'Bratul Chillia': 'Килийское гирло', 'Bratul Sfintu Gheorghe': 'Георгиевское гирло', 'Bratul Sulina': 'Сулинское гирло',
  Borcea: 'Борча', Brahmaputra: 'Брахмапутра', Yukon: 'Юкон', Murray: 'Муррей', Ganges: 'Ганг', Indus: 'Инд', Niger: 'Нигер',
  'Victoria Nile': 'Виктория-Нил', 'Albert Nile': 'Альберт-Нил', Nile: 'Нил', Kagera: 'Кагера', Ubangi: 'Убанги', Teslin: 'Теслин',
  Euphrates: 'Евфрат', Firat: 'Евфрат', 'Al Furat': 'Евфрат', Shiquan: 'Шицюаньхэ', Columbia: 'Колумбия', Huang: 'Хуанхэ',
  Abay: 'Аббай', 'El Bahr el Azraq': 'Голубой Нил', Volga: 'Волга', Zambezi: 'Замбези', Shire: 'Шире', Amur: 'Амур',
  'Heilong Jiang': 'Амур', Hailar: 'Хайлар', Orinoco: 'Ориноко', Weir: 'Уэйр', Grande: 'Риу-Гранди', Negro: 'Рио-Негро',
  Kibali: 'Кибали', Allegheny: 'Аллегейни', Kasai: 'Касаи', Barwon: 'Барвон', Uele: 'Уэле', 'Argun’': 'Аргунь', Argun: 'Аргунь',
  Darling: 'Дарлинг', 'Mamoré': 'Маморе', Niagara: 'Ниагара', 'St. Clair': 'Сент-Клэр', 'Guaporé': 'Гуапоре', Madeira: 'Мадейра',
  Ohio: 'Огайо', 'Shatt al Arab': 'Шатт-эль-Араб', Araguaia: 'Арагуая', Vaal: 'Вааль', Aldan: 'Алдан', Snake: 'Снейк',
  'São  Francisco': 'Сан-Франсиску', 'São Francisco': 'Сан-Франсиску', Rhein: 'Рейн', Rhine: 'Рейн', Rhin: 'Рейн',
  Nederrijn: 'Нижний Рейн', Lek: 'Лек', Waal: 'Ваал', IJssel: 'Эйссел', Sukhona: 'Сухона', 'Shishhid Gol': 'Шишхид-Гол',
  'Paranaíba': 'Паранаиба', 'La Grande': 'Ла-Гранд', 'Rio Grande': 'Рио-Гранде', Ural: 'Урал', Saskatchewan: 'Саскачеван',
  'North Saskatchewan': 'Северный Саскачеван', 'South Saskatchewan': 'Южный Саскачеван', Yenisey: 'Енисей', 'Malyy Yenisey': 'Малый Енисей',
  'Verkhniy Yenisey': 'Большой Енисей', 'Kyzyl-Khem': 'Кызыл-Хем', Tocantins: 'Токантинс', Dnipro: 'Днепр', Dnepre: 'Днепр',
  Dnieper: 'Днепр', Dnepr: 'Днепр', Bafing: 'Бафинг', 'Bénoué': 'Бенуэ', Benue: 'Бенуэ', Dicle: 'Тигр', Tigris: 'Тигр', Pechora: 'Печора',
  'Indaiá': 'Индая', Kolyma: 'Колыма', Nmai: 'Нмайка', Magdalena: 'Магдалена', 'Neuquén': 'Неукен', Nanpan: 'Наньпаньцзян',
  Seine: 'Сена', Oder: 'Одер', Odra: 'Одер', Arkansas: 'Арканзас', 'Sénégal': 'Сенегал', Senegal: 'Сенегал', Nu: 'Салуин', Salween: 'Салуин',
  'Severnaya Dvina': 'Северная Двина', Hongshui: 'Хуншуйхэ', Quan: 'Цюаньхэ', Xun: 'Сюньцзян', 'Braco Menor': 'Бразу-Менор',
  Nelson: 'Нельсон', Xi: 'Сицзян', Orange: 'Оранжевая', Ebro: 'Эбро', Mississippi: 'Миссисипи', Stikine: 'Стикин',
  'San Juan': 'Сан-Хуан', Elbe: 'Эльба', Labe: 'Эльба', Thelon: 'Телон', Colorado: 'Колорадо', Tajo: 'Тахо', Tejo: 'Тахо', Tagus: 'Тахо',
  Vistula: 'Висла', Wisla: 'Висла', 'Wisła': 'Висла', Sacramento: 'Сакраменто', Neva: 'Нева', Tennessee: 'Теннесси',
  'Syr  Darya': 'Сырдарья', 'Syr Darya': 'Сырдарья', Naryn: 'Нарын', Klamath: 'Кламат', Athabasca: 'Атабаска', Svir: 'Свирь',
  Mouhoun: 'Чёрная Вольта', Volta: 'Вольта', Culuene: 'Кулуэни', 'Godävari': 'Годавари', Godavari: 'Годавари', Tobol: 'Тобол',
  'Lower Tunguska': 'Нижняя Тунгуска', 'Podkamennaya Tunguska': 'Подкаменная Тунгуска', Daugava: 'Западная Двина',
  'Marañón': 'Мараньон', 'Caquetá': 'Какета', Holston: 'Холстон', Pamir: 'Памир', Fraser: 'Фрейзер', Indigirka: 'Индигирка',
  Sprague: 'Спрейг', Juruena: 'Журуэна', Vychegda: 'Вычегда', Chixoy: 'Чишой', 'Bío-Bío': 'Био-Био', Panj: 'Пяндж',
  'Santa Cruz': 'Санта-Крус', Xingu: 'Шингу', 'Amu  Darya': 'Амударья', 'Amu Darya': 'Амударья', 'Tapajós': 'Тапажос',
  'Japurá': 'Япура', Loire: 'Луара', 'R. des Outaouais': 'Оттава', Ottawa: 'Оттава', Kem: 'Кемь', Mur: 'Мур', Ishikari: 'Исикари',
  Kayan: 'Каян', Barito: 'Барито', Purari: 'Пурари', Indragi: 'Индрагири', Okavango: 'Окаванго', Cubango: 'Окаванго',
  Semliki: 'Семлики', Koukourou: 'Кукуру', Chari: 'Шари', Bamingui: 'Баминги', 'Dalälven': 'Дальэльвен', Jordan: 'Иордан',
  Dniester: 'Днестр', Nistru: 'Днестр', 'Ro Grande de Santiago': 'Рио-Гранде-де-Сантьяго', Kuskokwim: 'Кускоквим',
  'N. Fork Kuskokwim': 'Северный Кускоквим', Copper: 'Коппер', Susitna: 'Суситна', Tanana: 'Танана', Porcupine: 'Поркьюпайн',
  Koyukuk: 'Коюкук', Genale: 'Генале', Yarkant: 'Яркенд', Albany: 'Олбани', Churchill: 'Черчилл', Taz: 'Таз', Liao: 'Ляохэ',
  Yuan: 'Юаньцзян', Rupert: 'Руперт', 'San Joaquin': 'Сан-Хоакин', Chattahoochee: 'Чаттахучи', Alabama: 'Алабама', Tugaloo: 'Тугалу',
  Chattooga: 'Чаттуга', Savannah: 'Саванна', Rhne: 'Рона', 'Rhône': 'Рона', Rhone: 'Рона', Vuoksi: 'Вуокса', Ord: 'Орд', Sutlej: 'Сатледж',
  Coppermine: 'Коппермайн', Atbara: 'Атбара', Biya: 'Бия', Rainy: 'Рейни', Winnipeg: 'Виннипег', Back: 'Бак', 'Nakanbé': 'Белая Вольта',
  Kemijoki: 'Кемийоки', Vilyuy: 'Вилюй', Han: 'Ханьшуй', 'Mahäna Nadï': 'Маханади', Mahanadi: 'Маханади', Pit: 'Пит',
  Sassandra: 'Сасандра', Vorma: 'Ворма', Don: 'Дон', Gan: 'Ганьцзян', Krishna: 'Кришна', Skeena: 'Скина', Liard: 'Лиард',
  Kwango: 'Кванго', Kafue: 'Кафуэ', Jequitinhonha: 'Жекитиньонья', Chubut: 'Чубут', Mendoza: 'Мендоса', Salado: 'Саладо',
  Branco: 'Бранку', 'Purús': 'Пурус', Purus: 'Пурус', Meta: 'Мета', 'Madre de Dios': 'Мадре-де-Дьос', Paraiba: 'Параиба',
  Uruguay: 'Уругвай', Pilcomayo: 'Пилькомайо', Lom: 'Лом', Tshuapa: 'Чуапа', Omo: 'Омо', Mananantanana: 'Манантанана',
  Ouham: 'Уам', 'Kadéï': 'Кадеи', Ruvuma: 'Рувума', Thames: 'Темза', Drau: 'Драва', Drava: 'Драва', Duero: 'Дуэро', Douro: 'Дуэро',
  Helmand: 'Гильменд', Hong: 'Хонгха', Yamuna: 'Ямуна', Narmada: 'Нармада', Dadu: 'Дадухэ', 'Xar Moron': 'Шара-Мурэн',
  Kapuas: 'Капуас', Katherine: 'Кэтрин', Taritatu: 'Таритату', Mitchell: 'Митчелл', Chenab: 'Чинаб', 'Anadyr’': ['Анадырь', 'Анадыря'],
  'Olenëk': 'Оленёк', Olenek: 'Оленёк', 'Tom’': 'Томь', Kamchatka: 'Камчатка', Coco: 'Коко', 'Double Mountain Fork Brazos': 'Брасос',
  Beaver: 'Бивер', Finlay: 'Финли', Verde: 'Верде', 'S. Branch Potomac': 'Потомак', Hudson: 'Гудзон', Wabash: 'Уобаш',
  'Saint John': 'Сент-Джон', Yadkin: 'Ядкин', Fitzroy: 'Фицрой', Digul: 'Дигул', Willamette: 'Уилламетт', Gila: 'Хила',
  Limpopo: 'Лимпопо', Glomma: 'Гломма', Mangoky: 'Мангуки', Setit: 'Тэкэзе', Daly: 'Дейли', Mamberamo: 'Мамберамо', Kheta: 'Хета',
  Chulyshman: 'Чулышман', Brazos: 'Брасос', Pnuco: 'Пануко', 'Pánuco': 'Пануко', Konqi: 'Кончедарья', Tarim: 'Тарим', Trinity: 'Тринити',
  Desaguadero: 'Десагуадеро', 'Bahr el  Zeraf': 'Бахр-эз-Зераф', Sanaga: 'Санага', Busira: 'Бусира', Jubba: 'Джуба',
  'Gta lv': 'Гёта-Эльв', 'Göta älv': 'Гёта-Эльв', Xiliao: 'Силяохэ', Kokemenjoki: 'Кокемяэнйоки', 'Great Pee Dee': 'Пи-Ди',
  Tisa: 'Тиса', Tisza: 'Тиса', Sangha: 'Санга', Ruki: 'Руки', Songhua: 'Сунгари', Min: 'Миньцзян', Khatanga: 'Хатанга',
  'Pend Orielle': 'Пенд-Орей', Potomac: 'Потомак', Kama: 'Кама', 'Ariège': 'Арьеж', Garonne: 'Гаронна', Hawea: 'Хавеа',
  Kawarau: 'Каварау', Mataura: 'Матаура', Clutha: 'Клута', Whanganui: 'Уангануи', Taieri: 'Таиери', Rangitikei: 'Рангитикеи',
  Clarence: 'Кларенс', Oreti: 'Орети', Manawatu: 'Манавату', Buller: 'Буллер', Mohaka: 'Мохака', Wairau: 'Уаирау',
  Waimakariri: 'Ваймакарири', Waikato: 'Уаикато', Po: 'По', Weser: 'Везер', Main: 'Майн', Maas: 'Маас', Meuse: 'Маас',
  Mosel: 'Мозель', Moselle: 'Мозель', Neckar: 'Неккар', Inn: 'Инн', Sava: 'Сава', Prut: 'Прут', Desna: 'Десна', Oka: 'Ока',
  Vyatka: 'Вятка', Belaya: 'Белая', Severn: 'Северн', Shannon: 'Шаннон', Guadalquivir: 'Гвадалквивир', Guadiana: 'Гвадиана',
  Dordogne: 'Дордонь', Marne: 'Марна', 'Saône': 'Сона', 'Isère': 'Изер', Durance: 'Дюранс', Adige: 'Адидже', Tevere: 'Тибр',
  Tiber: 'Тибр', Arno: 'Арно', Vltava: 'Влтава', Morava: 'Морава', Warta: 'Варта', Bug: 'Западный Буг', Neman: 'Неман',
  Nemunas: 'Неман', Pripyat: 'Припять', 'Southern Bug': 'Южный Буг', 'Pivdennyy Buh': 'Южный Буг', 'Severskiy Donets': ['Северский Донец', 'Северского Донца'],
  Kuban: 'Кубань', Terek: 'Терек', Kura: 'Кура', Aras: 'Аракс', 'Kızılırmak': 'Кызылырмак', Sakarya: 'Сакарья', Mezen: 'Мезень',
  Onega: 'Онега', Chusovaya: 'Чусовая', Tura: 'Тура', Ishim: 'Ишим', Chulym: 'Чулым', Ket: 'Кеть', Vasyugan: 'Васюган',
  Vitim: 'Витим', Olekma: 'Олёкма', Yana: 'Яна', Zeya: 'Зея', Bureya: 'Бурея', Ussuri: 'Уссури', Shilka: 'Шилка', Onon: 'Онон',
  Kerulen: 'Керулен', Orkhon: 'Орхон', Ili: 'Или', Chu: 'Чу', Zeravshan: 'Зеравшан', Murghab: 'Мургаб', Kabul: 'Кабул',
  Jhelum: 'Джелам', Ravi: 'Рави', Beas: 'Биас', Ghaghara: 'Гхагхра', Gandak: 'Гандак', Kosi: 'Коси', Son: 'Сон', Chambal: 'Чамбал',
  Tapti: 'Тапти', Kaveri: 'Кавери', Tungabhadra: 'Тунгабхадра', 'Chao Phraya': 'Чао-Прая', Mun: 'Мун', Huai: 'Хуайхэ', Wei: 'Вэйхэ',
  Fen: 'Фэньхэ', Yalu: 'Ялуцзян', Nen: 'Нэньцзян', Murrumbidgee: 'Маррамбиджи', Lachlan: 'Лаклан', Diamantina: 'Диамантина',
  'Cooper Creek': 'Купер-Крик', Flinders: 'Флиндерс', Burdekin: 'Бердекин', Gascoyne: 'Гаскойн', Victoria: 'Виктория', Roper: 'Ропер',
  Sepik: 'Сепик', Fly: 'Флай', Mahakam: 'Махакам', Rajang: 'Раджанг', Musi: 'Муси', 'Batang Hari': 'Батангхари', Cagayan: 'Кагаян',
  'Ogooué': 'Огове', Cuanza: 'Кванза', Kunene: 'Кунене', Cunene: 'Кунене', Shebelle: 'Шебели', Awash: 'Аваш', Tana: 'Тана',
  Rufiji: 'Руфиджи', Sankuru: 'Санкуру', Lomami: 'Ломами', Aruwimi: 'Арувими', Gambia: 'Гамбия', 'Komoé': 'Комоэ', Bandama: 'Бандама',
  Logone: 'Логоне', Sokoto: 'Сокото', Kaduna: 'Кадуна', Draa: 'Дра', Moulouya: 'Мулуя', Platte: 'Платт', Missouri: 'Миссури',
  Yellowstone: 'Йеллоустон', Red: 'Ред-Ривер', Canadian: 'Канейдиан', Cimarron: 'Симаррон', Pecos: 'Пекос', Green: 'Грин',
  Humboldt: 'Гумбольдт', Illinois: 'Иллинойс', Wisconsin: 'Висконсин', Susquehanna: 'Саскуэханна', Delaware: 'Делавэр',
  Connecticut: 'Коннектикут', Mobile: 'Мобил', Tombigbee: 'Томбигби', Apalachicola: 'Апалачикола', Hayes: 'Хейс', Kazan: 'Казан',
  Dubawnt: 'Дубонт', Anderson: 'Андерсон', Pelly: 'Пелли', Stewart: 'Стьюарт', Nass: 'Насс', Thompson: 'Томпсон', Kootenay: 'Кутеней',
  Usumacinta: 'Усумасинта', Grijalva: 'Грихальва', Balsas: 'Бальсас', Lerma: 'Лерма', Yaqui: 'Яки', Fuerte: 'Фуэрте', Conchos: 'Кончос',
  Atrato: 'Атрато', Cauca: 'Каука', Guaviare: 'Гуавьяре', Apure: 'Апуре', 'Caroní': 'Карони', Essequibo: 'Эссекибо', 'Juruá': 'Журуа',
  Putumayo: 'Путумайо', 'Içá': 'Путумайо', Napo: 'Напо', Huallaga: 'Уальяга', Beni: 'Бени', Iriri: 'Ирири', 'Teles Pires': 'Телис-Пирис',
  Paraguay: 'Парагвай', Bermejo: 'Бермехо', 'Iguaçu': 'Игуасу', 'Iguazú': 'Игуасу', Paranapanema: 'Паранапанема', 'Tietê': 'Тиете',
  Limay: 'Лимай', Amazonas: 'Амазонка', Amazon: 'Амазонка', Solimões: 'Солимоэнс', 'Solimões': 'Солимоэнс', Mamore: 'Маморе',
  Tunguska: 'Тунгуска', Angren: 'Ангрен', Kolyma2: 'Колыма', Hari: 'Герируд', 'Hari Rud': 'Герируд', Tejen: 'Теджен', Atrek: 'Атрек',
  Karun: 'Карун', 'Little Zab': 'Малый Заб', 'Great Zab': 'Большой Заб', Khabur: 'Хабур', Orontes: 'Оронт', Asi: 'Оронт',
  Ceyhan: 'Джейхан', Seyhan: 'Сейхан', Maritsa: 'Марица', Evros: 'Марица', Struma: 'Струма', Vardar: 'Вардар', Iskar: 'Искыр',
  Olt: 'Олт', Siret: 'Сирет', Mures: 'Муреш', 'Mureș': 'Муреш', Somes: 'Сомеш', Bodrog: 'Бодрог', Hron: 'Грон', Vah: 'Ваг', 'Váh': 'Ваг',
  Narew: 'Нарев', Pregolya: 'Преголя', Venta: 'Вента', Lielupe: 'Лиелупе', Velikaya: 'Великая', Lovat: 'Ловать', Msta: 'Мста',
  Volkhov: 'Волхов', Sheksna: 'Шексна', Unzha: 'Унжа', Vetluga: 'Ветлуга', Sura: 'Сура', Moksha: 'Мокша', Tsna: 'Цна', Khoper: 'Хопёр',
  Medveditsa: 'Медведица', Manych: 'Маныч', Sal: 'Сал', Samara: 'Самара', Ufa: 'Уфа', Sylva: 'Сылва', Chepetsa: 'Чепца',
  Vym: 'Вымь', Usa: 'Уса', Izhma: 'Ижма', Pinega: 'Пинега', Vaga: 'Вага', Tavda: 'Тавда', Iset: 'Исеть', Konda: 'Конда',
  'Northern Sosva': 'Северная Сосьва', Pur: 'Пур', Nadym: 'Надым', Turukhan: 'Турухан', Chuya: 'Чуя', Katun: 'Катунь', Biya2: 'Бия',
  Chuna: 'Чуна', Oka2: 'Ока', Iya: 'Ия', Uda: 'Уда', Barguzin: 'Баргузин', Khilok: 'Хилок', Chikoy: 'Чикой', Ingoda: 'Ингода',
  Argun2: 'Аргунь', Maya: 'Мая', Uchur: 'Учур', Timpton: 'Тимптон', Vilyuy2: 'Вилюй', Markha: 'Марха', Anabar: 'Анабар',
  Popigay: 'Попигай', Kotuy: 'Котуй', Moyero: 'Мойеро', Omoloy: 'Омолой', Alazeya: 'Алазея', 'Bolshoy Anyuy': 'Большой Анюй',
  'Malyy Anyuy': 'Малый Анюй', Omolon: 'Омолон', Penzhina: 'Пенжина', Gizhiga: 'Гижига', Okhota: 'Охота', Amgun: 'Амгунь',
  'Malaya Ob': 'Малая Обь', 'Bolshaya Ob': 'Большая Обь', Gorin: 'Горин', Selemdzha: 'Селемджа', Tyrma: 'Тырма', Bikin: 'Бикин', Khor: 'Хор', Anyuy: 'Анюй',
  // Iceland (NE spellings with and without Icelandic letters)
  'Thjórsá': 'Тьоурсау', 'Þjórsá': 'Тьоурсау', 'Hvítá': 'Квитау', 'Ölfusá': 'Эльвюсау', 'Blanda': 'Бланда', 'Lagarfljót': 'Лагарфльоут',
  'Jökulsá á Fjöllum': 'Йёкюльсау-а-Фьёдлюм', 'Jökulsá í Fljótsdal': 'Йёкюльсау-и-Фльоутсдал', 'Skjálfandafljót': 'Скьяульвандафльоут',
};

// supplementary (NE regional river layers, which carry name_ru)
export function buildRiverNamer(extraPairs = new Map()) {
  const cache = new Map();
  return function riverName(en) {
    if (!en) return null;
    const raw = String(en).trim();
    if (!raw || /canal|csatorna|kanal|канал/i.test(raw)) return null;
    if (cache.has(raw)) return cache.get(raw);
    const plain = raw.replace(/\s+/g, ' ').replace(/[’'`ʼ]/g, '');
    let v = RIVERS_RU[raw] ?? RIVERS_RU[plain] ?? extraPairs.get(raw) ?? null;
    if (v == null) {
      // forks / branches take the parent river's name ("S. Fk. S. Br. Potomac" -> Potomac)
      const core = reduceRiverName(raw);
      v = RIVERS_RU[core] ?? extraPairs.get(core) ?? translitRiver(core);
    }
    const nom = Array.isArray(v) ? v[0] : v;
    const gen = Array.isArray(v) ? v[1] : genitive(nom);
    const out = { key: canonKey(nom), en: raw, ru: nom, gen };
    cache.set(raw, out);
    return out;
  };
}
const canonKey = s => s.toLowerCase().replace(/ё/g, 'е');

// ------------------------------------------------------------------ transliteration
const TR2 = [['shch', 'щ'], ['sch', 'ш'], ['tch', 'ч'], ['zh', 'ж'], ['kh', 'х'], ['ch', 'ч'], ['sh', 'ш'], ['ts', 'ц'], ['ya', 'я'],
  ['yu', 'ю'], ['yo', 'ё'], ['ye', 'е'], ['ou', 'у'], ['oo', 'у'], ['ee', 'и'], ['ph', 'ф'], ['th', 'т'], ['qu', 'кв'], ['gh', 'г'],
  ['ck', 'к'], ['dj', 'дж'], ['ia', 'ия'], ['ai', 'ай'], ['ei', 'ей'], ['oi', 'ой'], ['ui', 'уи'], ['ay', 'ай'], ['ey', 'ей'], ['oy', 'ой']];
const TR1 = { a: 'а', b: 'б', c: 'к', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'х', i: 'и', j: 'дж', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о',
  p: 'п', q: 'к', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', w: 'у', x: 'кс', y: 'и', z: 'з' };
// Strip the English generic parts of a river name: abbreviations (Fk., Br., Cr.),
// compass prefixes (N., S.W., Middle ...), "X Fork of the Y" -> Y (a fork takes the
// parent river's name), trailing Fork / Creek / River, notes in brackets.
export function reduceRiverName(raw) {
  let s = String(raw).split('/')[0].replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/\bFk\./g, 'Fork').replace(/\bBr\./g, 'Branch').replace(/\bCr\./g, 'Creek');
  for (let k = 0; k < 4; k++) {
    const m = /^(?:.*?\s)?(?:Fork|Branch|Prong)\s+(?:of\s+)?(?:the\s+)?(.+)$/i.exec(s);
    if (!m) break;
    s = m[1];
  }
  s = s.replace(/^(R\.|Rio|Río|Rivière|River)\s+/i, '');
  for (let k = 0; k < 3; k++) s = s.replace(/^(?:(?:North|South|East|West|Middle|Upper|Lower)\s+|(?:[NS]\.?[EW]\.|[NSEWM]\.)\s*)/i, '');
  s = s.replace(/\s+(Fork|Branch|Prong|Creek|River|Run|Brook|Wash)$/i, '').trim();
  return s || String(raw).trim();
}
// River names missing from the dictionaries: keep "Little / Big" as Малый / Большой,
// "St." as Сент-, transliterate the rest.
export function translitRiver(raw) {
  let s = reduceRiverName(raw);
  let prefix = '';
  const m = /^(Little|Big|Great|Grand)\s+(.+)$/i.exec(s);
  if (m) { prefix = /little/i.test(m[1]) ? 'Малый ' : 'Большой '; s = m[2]; }
  const st = /^(St\.?|Saint|Ste\.?|Sainte)[\s-]+(.+)$/i.exec(s);
  const t = st ? `Сент-${translit(st[2])}` : translit(s);
  return prefix ? [prefix + t, (prefix === 'Малый ' ? 'Малого ' : 'Большого ') + genitive(t)] : t;
}
export function translit(s) {
  const base = s.replace(/ı/g, 'y').replace(/ş/g, 'sh').replace(/Ş/g, 'Sh').replace(/ç/g, 'ch').replace(/Ç/g, 'Ch')
    .replace(/[ğĞ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').replace(/[øØ]/g, 'o').replace(/[æÆ]/g, 'e').replace(/ß/g, 'ss')
    .replace(/[đĐ]/g, 'd').replace(/[þÞ]/g, 'th')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    // Russian-style romanisation marks the soft sign with an apostrophe (Bol’shoy, Tom’)
    .replace(/([bcdfghjklmnpqrstvwxz])[’'`ʼ]/gi, '$1\u0001').replace(/[’'`ʼ]/g, '');
  // multi-word foreign names are hyphenated in Russian (Рио-Гранде-де-Сантьяго);
  // articles and prepositions stay lower case
  const words = base.replace(/\s+/g, ' ').trim().split(/(\s|-)/);
  const out = words.map((w, wi) => {
    if (w === ' ') return '-';
    if (!/[a-z]/i.test(w)) return w;
    const particle = wi > 0 && PARTICLES.has(w.toLowerCase());
    const lw = w.toLowerCase();
    let r = '';
    for (let i = 0; i < lw.length;) {
      let hit = false;
      for (const [k, v] of TR2) {
        if (!lw.startsWith(k, i)) continue;
        // 'ay'/'ey'/'oy' before a vowel: the y starts the next syllable (Malaya -> Малая)
        if (k.length === 2 && k[1] === 'y' && 'aeiou'.includes(lw[i + 2] || '')) continue;
        r += v; i += k.length; hit = true; break;
      }
      if (hit) continue;
      const ch = lw[i];
      if (ch === 'y' && i > 0 && !'aeiou'.includes(lw[i - 1]) && i + 1 < lw.length && !'aeiou'.includes(lw[i + 1])) r += 'ы';
      else if (ch === 'e' && i === 0) r += 'э';
      else if (ch === '\u0001') r += 'ь';
      else r += TR1[ch] ?? ch;
      i++;
    }
    return particle ? r : r.charAt(0).toUpperCase() + r.slice(1);
  });
  return out.join('').replace(/-{2,}/g, '-').replace(/^-|-$/g, '').replace(/[.]/g, '');
}
const PARTICLES = new Set(['de', 'del', 'des', 'du', 'la', 'le', 'les', 'da', 'do', 'dos', 'das', 'di', 'of', 'the', 'el', 'y', 'i', 'a', 'en', 'au', 'aux', 'von', 'van']);

// ------------------------------------------------------------------ declension
// Common geographic head nouns: genitive singular + grammatical gender.
const HEADS = {
  'море': ['моря', 'n'], 'залив': ['залива', 'm'], 'океан': ['океана', 'm'], 'пролив': ['пролива', 'm'], 'озеро': ['озера', 'n'],
  'бухта': ['бухты', 'f'], 'губа': ['губы', 'f'], 'река': ['реки', 'f'], 'протока': ['протоки', 'f'], 'рукав': ['рукава', 'm'],
  'гирло': ['гирла', 'n'], 'лагуна': ['лагуны', 'f'], 'водохранилище': ['водохранилища', 'n'], 'лиман': ['лимана', 'm'],
  'фьорд': ['фьорда', 'm'], 'фьерд': ['фьерда', 'm'], 'остров': ['острова', 'm'], 'острова': ['островов', 'p'],
  'полуостров': ['полуострова', 'm'], 'горы': ['гор', 'p'], 'хребет': ['хребта', 'm'], 'нагорье': ['нагорья', 'n'],
  'плато': ['плато', 'n'], 'пустыня': ['пустыни', 'f'], 'равнина': ['равнины', 'f'], 'низменность': ['низменности', 'f'],
  'долина': ['долины', 'f'], 'впадина': ['впадины', 'f'], 'бассейн': ['бассейна', 'm'], 'дельта': ['дельты', 'f'],
  'массив': ['массива', 'm'], 'плоскогорье': ['плоскогорья', 'n'], 'побережье': ['побережья', 'n'], 'берег': ['берега', 'm'],
  'архипелаг': ['архипелага', 'm'], 'кряж': ['кряжа', 'm'], 'гряда': ['гряды', 'f'], 'возвышенность': ['возвышенности', 'f'],
  'риф': ['рифа', 'm'], 'канал': ['канала', 'm'], 'гора': ['горы', 'f'], 'вулкан': ['вулкана', 'm'], 'междуречье': ['междуречья', 'n'],
  'пролив.': ['пролива', 'm'], 'саванна': ['саванны', 'f'], 'тундра': ['тундры', 'f'], 'степь': ['степи', 'f'], 'земля': ['земли', 'f'],
  'резерват': ['резервата', 'm'], 'нагорья': ['нагорий', 'p'], 'холмы': ['холмов', 'p'], 'плоскогорья': ['плоскогорий', 'p'],
  'атолл': ['атолла', 'm'], 'мыс': ['мыса', 'm'], 'перешеек': ['перешейка', 'm'], 'болота': ['болот', 'p'], 'пески': ['песков', 'p'],
  'ледник': ['ледника', 'm'], 'шельф': ['шельфа', 'm'], 'шхеры': ['шхер', 'p'], 'проход': ['прохода', 'm'], 'зунд': ['зунда', 'm'],
  'бугры': ['бугров', 'p'], 'кордильера': ['кордильеры', 'f'], 'сьерра': ['сьерры', 'f'],
  'устье': ['устья', 'n'], 'проливы': ['проливов', 'p'], 'озёра': ['озёр', 'p'], 'рифы': ['рифов', 'p'],
};
const VOWELS = 'аеёиоуыэюя';
function adjGen(w) {
  const lw = w.toLowerCase();
  const swap = (n, rep) => w.slice(0, w.length - n) + rep;
  if (/(ого|его|ой|ей|ых|их)$/.test(lw) && !/(ой)$/.test(lw)) return w; // already oblique
  if (lw.endsWith('ний') && !lw.endsWith('ский')) return swap(2, 'его');
  if (/[кгхжшчщ]ий$/.test(lw)) return swap(2, 'ого');
  if (lw.endsWith('ий') || lw.endsWith('ый') || lw.endsWith('ой')) return swap(2, 'ого');
  if (lw.endsWith('ее')) return swap(2, 'его');
  if (lw.endsWith('ье')) return swap(2, 'ьего');
  if (lw.endsWith('ое')) return swap(2, 'ого');
  if (lw.endsWith('яя')) return swap(2, 'ей');
  if (lw.endsWith('ая')) return swap(2, 'ой');
  if (lw.endsWith('ые')) return swap(2, 'ых');
  if (lw.endsWith('ие')) return swap(2, 'их');
  if (lw.endsWith('ово') || lw.endsWith('ево')) return swap(1, 'а');
  if (lw.endsWith('ова') || lw.endsWith('ева') || lw.endsWith('ина')) return swap(1, 'ой');
  if (lw.endsWith('ов') || lw.endsWith('ев') || lw.endsWith('ин')) return w + 'а';
  return w;
}
// Adjective test. A single-word name is an adjective only for the feminine
// river pattern (Белая, Чусовая); "-ой"/"-ий" single words are nouns (Омолой).
const CONS = 'бвгджзклмнпрстфхцчшщ';
const isAdjective = (w, single = false) => {
  if (w.length <= 3) return false;
  const lw = w.toLowerCase();
  const fem = (lw.endsWith('ая') || lw.endsWith('яя')) && CONS.includes(lw[lw.length - 3]);
  if (single) return fem;
  return fem || /(ый|ий|ой|ое|ее|ье|ые|ие|ово|ево|ова|ева)$/.test(lw);
};
function nounGen(w) {
  const lw = w.toLowerCase();
  const head = HEADS[lw];
  if (head) return w[0] === w[0].toUpperCase() ? cap(head[0]) : head[0];
  const last = lw[lw.length - 1];
  const prev = lw[lw.length - 2] || '';
  if (lw.endsWith('ия')) return w.slice(0, -1) + 'и';
  if (lw.endsWith('ья')) return w.slice(0, -1) + 'и';
  if (last === 'я') return w.slice(0, -1) + 'и';
  if (last === 'а') return w.slice(0, -1) + ('гкхжшщч'.includes(prev) ? 'и' : 'ы');
  if (last === 'ь') return w.slice(0, -1) + 'и';
  if (last === 'й') return w.slice(0, -1) + 'я';
  if (lw.endsWith('ец') && lw.length > 4) return w.slice(0, -2) + 'ца';
  if (VOWELS.includes(last)) return w; // indeclinable (По, Конго, Миссисипи, Янцзы ...)
  if (/[a-z]/i.test(last)) return w;
  return w + 'а';
}
// Genitive of a (possibly multi-word) Russian geographic name.
export function genitive(phrase) {
  if (!phrase) return phrase;
  const toks = phrase.split(' ');
  // a known head noun: decline adjectives before it and the head itself, keep the rest
  let h = toks.findIndex(t => HEADS[t.toLowerCase()]);
  if (h >= 0) {
    return toks.map((t, i) => i < h ? (isAdjective(t) ? adjGen(t) : t) : i === h ? nounGen(t) : t).join(' ');
  }
  // otherwise: leading adjectives + last word as a noun; hyphenated words decline at the end
  return toks.map((t, i) => {
    if (i === toks.length - 1) return toks.length === 1 && isAdjective(t, true) ? adjGen(t) : nounGen(t);
    return isAdjective(t) ? adjGen(t) : t;
  }).join(' ');
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const lowerFirst = s => s.charAt(0).toLowerCase() + s.slice(1);

// Grammatical gender of a name phrase: 'm' | 'f' | 'n' | 'p' (plural).
// The ending is ambiguous for "-ь" (Сибирь f, Куньлунь m) and for indeclinable
// foreign names in "-и/-у/-ю/-э" after a plain consonant (Калахари f, Гаити m,
// Тибести n, but Пиренеи / Аппалачи are plural). For those, fb = [gender for "-ь",
// gender for the vowel endings] decides (usually from the feature class).
export function genderOf(phrase, fb = null) {
  const toks = phrase.split(' ');
  for (const t of toks) { const hd = HEADS[t.toLowerCase()]; if (hd) return hd[1]; }
  const w = toks[toks.length - 1].toLowerCase();
  const last = w[w.length - 1], prev = w[w.length - 2] || '';
  if (last === 'ы') return 'p';
  if (last === 'и' && 'аеёиоуыэюяйгкхжшчщ'.includes(prev)) return 'p';
  if (last === 'ь') return fb ? fb[0] : 'f';
  if ('иуюэ'.includes(last)) return fb ? fb[1] : (last === 'и' ? 'p' : 'm');
  if (last === 'а' || last === 'я') return 'f';
  if (last === 'о' || last === 'е' || last === 'ё') return 'n';
  return 'm';
}
// Fallback genders by Natural Earth geography class: the generic noun the bare
// proper name stands for ([for "-ь", for indeclinable vowel endings]).
const CLASS_GENDER = {
  Island: ['m', 'm'], 'Island group': ['m', 'p'], 'Range/mtn': ['m', 'p'], Plateau: ['m', 'n'], Desert: ['m', 'f'],
  Plain: ['f', 'f'], Lowland: ['f', 'f'], Geoarea: ['f', 'f'], 'Pen/cape': ['m', 'm'], Peninsula: ['m', 'm'], Basin: ['m', 'm'],
  Depression: ['f', 'f'], Valley: ['f', 'f'], Delta: ['f', 'f'], Tundra: ['f', 'f'], Wetlands: ['p', 'p'], Foothills: ['p', 'p'],
};
export function featureGender(ru, cls) { return genderOf(ru, CLASS_GENDER[cls] || ['m', 'm']); }

// ------------------------------------------------------------------ qualifiers
const DIR_STEMS = { N: 'Северн', S: 'Южн', W: 'Западн', E: 'Восточн', C: 'Центральн', NW: 'Северо-Западн', NE: 'Северо-Восточн',
  SW: 'Юго-Западн', SE: 'Юго-Восточн' };
const ENDINGS = { m: 'ый', f: 'ая', n: 'ое', p: 'ые' };
export function dirAdjective(dir, gender) { return DIR_STEMS[dir] + ENDINGS[gender || 'm']; }

const DIR_NOUNS = { N: 'север', S: 'юг', W: 'запад', E: 'восток', C: 'центр', NW: 'северо-запад', NE: 'северо-восток',
  SW: 'юго-запад', SE: 'юго-восток' };
// a base that already starts with a compass adjective ("Западный Саян", "Восточная Антарктида")
const COMPASS_HEAD = /^((Северн|Южн|Западн|Восточн|Центральн)|((Северо|Юго)-(Западн|Восточн)))(ый|ий|ая|яя|ое|ее|ые|ие)\s/;

// "Долина Луары" + 'N' -> "Северная долина Луары"; "Альпы" + 'W' -> "Западные Альпы";
// "Западный Саян" + 'E' -> "Западный Саян (восток)" (never "Восточный Западный Саян").
export function qualify(base, dir, { gender, commonHead } = {}) {
  if (COMPASS_HEAD.test(base)) return `${base} (${DIR_NOUNS[dir]})`;
  const g = gender || genderOf(base);
  const firstTok = base.split(' ')[0];
  const isCommon = commonHead ?? !!HEADS[firstTok.toLowerCase()];
  return `${dirAdjective(dir, g)} ${isCommon ? lowerFirst(base) : base}`;
}

// Assign unique compass qualifiers to a group of items at (lon, lat). Returns an
// array of direction keys (null when the group has a single member) or null if
// the group should be numbered instead.
export function compassLabels(pts) {
  const n = pts.length;
  if (n === 1) return [null];
  if (n > 9) return null;
  // local tangent-plane offsets (km-ish, degrees scaled)
  let mx = 0, my = 0, mz = 0;
  for (const p of pts) { const c = Math.cos(p.lat * Math.PI / 180); mx += c * Math.sin(p.lon * Math.PI / 180); my += Math.sin(p.lat * Math.PI / 180); mz += c * Math.cos(p.lon * Math.PI / 180); }
  const lon0 = Math.atan2(mx, mz) * 180 / Math.PI;
  const lat0 = Math.atan2(my, Math.hypot(mx, mz)) * 180 / Math.PI;
  const off = pts.map(p => {
    let dl = p.lon - lon0; if (dl > 180) dl -= 360; if (dl < -180) dl += 360;
    return { e: dl * Math.cos(lat0 * Math.PI / 180), nn: p.lat - lat0 };
  });
  const vx = off.reduce((s, o) => s + o.e * o.e, 0), vy = off.reduce((s, o) => s + o.nn * o.nn, 0);
  if (n <= 3) {
    // along the dominant axis
    const ew = vx >= vy;
    const order = off.map((o, i) => [ew ? o.e : -o.nn, i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(a => a[1]);
    const labs = n === 2 ? (ew ? ['W', 'E'] : ['N', 'S']) : (ew ? ['W', 'C', 'E'] : ['N', 'C', 'S']);
    const out = new Array(n);
    order.forEach((idx, k) => { out[idx] = labs[k]; });
    return out;
  }
  // 4..9: one centre (closest to centroid, if n is odd or n >= 5) + 8 compass sectors
  const sx = Math.sqrt(vx / n) || 1, sy = Math.sqrt(vy / n) || 1;
  const norm = off.map(o => ({ e: o.e / sx, nn: o.nn / sy }));
  const out = new Array(n).fill(null);
  const free = new Set(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);
  const angOf = { E: 0, NE: 45, N: 90, NW: 135, W: 180, SW: 225, S: 270, SE: 315 };
  let centre = -1;
  if (n >= 5 || n % 2 === 1) {
    let best = Infinity;
    norm.forEach((o, i) => { const r = Math.hypot(o.e, o.nn); if (r < best) { best = r; centre = i; } });
    out[centre] = 'C';
  }
  const pairs = [];
  norm.forEach((o, i) => {
    if (i === centre) return;
    const a = (Math.atan2(o.nn, o.e) * 180 / Math.PI + 360) % 360;
    for (const d of free) { let da = Math.abs(a - angOf[d]); if (da > 180) da = 360 - da; pairs.push([da, i, d]); }
  });
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : 1));
  for (const [da, i, d] of pairs) {
    if (out[i] || !free.has(d) || da > 70) continue;
    out[i] = d; free.delete(d);
  }
  if (out.some(v => v === null)) return null;
  return out;
}

// Roman numerals (for small counts in archival style)
export function roman(n) {
  const map = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let s = '';
  for (const [v, r] of map) while (n >= v) { s += r; n -= v; }
  return s;
}

// Make names unique. items: [{ base, key, gender?, commonHead?, lon, lat }].
// Fills item.nameRu and item.nameKey. Groups by base; compass qualifiers for
// 2..9 members, "№k" (west -> east) for larger groups; a final pass numbers any
// remaining collisions.
export function disambiguate(items) {
  const groups = new Map();
  items.forEach((it, i) => { const g = groups.get(it.base); if (g) g.push(i); else groups.set(it.base, [i]); });
  for (const idxs of groups.values()) {
    const pts = idxs.map(i => items[i]);
    const labs = compassLabels(pts);
    if (labs) {
      idxs.forEach((i, k) => {
        const it = items[i];
        it.nameRu = labs[k] ? qualify(it.base, labs[k], { gender: it.gender, commonHead: it.commonHead }) : it.base;
        it.nameKey = labs[k] ? `${it.key}#${labs[k]}` : it.key;
      });
    } else {
      const order = idxs.slice().sort((a, b) => items[a].lon - items[b].lon || items[b].lat - items[a].lat || a - b);
      order.forEach((i, k) => { const it = items[i]; it.nameRu = `${it.base} №${k + 1}`; it.nameKey = `${it.key}#${k + 1}`; });
    }
  }
  return uniquify(items);
}

// Final collision pass over items that already have nameRu / nameKey: the first
// item keeps its name, later ones get a Roman numeral ("Северный остров (II)").
// Also used across kinds (land / lakes / seas) so every district name is unique.
export function uniquify(items) {
  const seen = new Map();
  for (const it of items) seen.set(it.nameRu, (seen.get(it.nameRu) || 0) + 1);
  const used = new Map();
  for (const it of items) {
    if (seen.get(it.nameRu) > 1) {
      const k = (used.get(it.nameRu) || 0) + 1;
      used.set(it.nameRu, k);
      if (k > 1) { it.nameRu = `${it.nameRu} (${roman(k)})`; it.nameKey = `${it.nameKey}~${k}`; }
    }
  }
  return items;
}

export { cap, lowerFirst };
