// Russian user-facing names for hazard catalogues (bake-time only).
// Strategy: curated dictionaries for well-known names (volcanoes, cities, seas, Flinn–Engdahl
// regions) -> country names from public/assets/map/world.json -> rule-based transliteration
// of romanised names as a last resort. English originals are always kept next to them.

const VOLCANOES = {
  'Vesuvius': 'Везувий', 'Etna': 'Этна', 'Stromboli': 'Стромболи', 'Vulcano': 'Вулькано', 'Campi Flegrei': 'Флегрейские поля',
  'Ischia': 'Искья', 'Santorini': 'Санторин', 'Nisyros': 'Нисирос', 'Methana': 'Метана', 'Hekla': 'Гекла', 'Katla': 'Катла',
  'Eyjafjallajokull': 'Эйяфьядлайёкюдль', 'Grimsvotn': 'Гримсвётн', 'Askja': 'Аскья', 'Krafla': 'Крафла', 'Laki': 'Лаки',
  'Bardarbunga': 'Бардарбунга', 'Oraefajokull': 'Эрайвайёкюдль', 'Reykjanes': 'Рейкьянес', 'Fagradalsfjall': 'Фаградальсфьядль',
  'Vestmannaeyjar': 'Вестманнаэйяр', 'Jan Mayen': 'Ян-Майен', 'Teide': 'Тейде', 'Tenerife': 'Тенерифе', 'La Palma': 'Пальма',
  'Fogo': 'Фогу', 'Pico': 'Пику', 'Elbrus': 'Эльбрус', 'Kazbek': 'Казбек', 'Ararat': 'Арарат', 'Damavand': 'Демавенд',
  'Nemrut Dagi': 'Немрут', 'Erciyes Dagi': 'Эрджияс', 'Hasan Dagi': 'Хасандаг', 'Tendurek Dagi': 'Тендюрек',
  'Kilimanjaro': 'Килиманджаро', 'Nyiragongo': 'Ньирагонго', 'Nyamulagira': 'Ньямлагира', 'Ol Doinyo Lengai': 'Ол-Доиньо-Ленгаи',
  'Cameroon': 'Камерун', 'Karthala': 'Картала', 'Erta Ale': 'Эрта-Але', 'Dabbahu': 'Даббаху', 'Piton de la Fournaise': 'Питон-де-ла-Фурнез',
  'Fuji': 'Фудзи', 'Fujisan': 'Фудзи', 'Asosan': 'Асо', 'Aso': 'Асо', 'Sakurajima': 'Сакурадзима', 'Aira': 'Аира', 'Kikai': 'Кикай',
  'Unzendake': 'Ундзэн', 'Asamayama': 'Асама', 'Asama': 'Асама', 'Ontakesan': 'Онтакэ', 'Bandaisan': 'Бандай', 'Usuzan': 'Усу',
  'Tarumaesan': 'Тарумаэ', 'Komagatake': 'Комагатакэ', 'Kirishimayama': 'Кирисима', 'Towada': 'Товада', 'Izu-Oshima': 'Идзу-Осима',
  'Miyakejima': 'Миякэдзима', 'Hakoneyama': 'Хаконэ', 'Shiretoko-Iozan': 'Сиретоко-Иодзан', 'Changbaishan': 'Пэктусан',
  'Kliuchevskoi': 'Ключевская Сопка', 'Klyuchevskoy': 'Ключевская Сопка', 'Bezymianny': 'Безымянный', 'Shiveluch': 'Шивелуч',
  'Avachinsky': 'Авачинская Сопка', 'Koryaksky': 'Корякская Сопка', 'Tolbachik': 'Толбачик', 'Karymsky': 'Карымская Сопка',
  'Kronotsky': 'Кроноцкая Сопка', 'Ksudach': 'Ксудач', 'Kurile Lake': 'Курильское озеро', 'Ilyinsky': 'Ильинская Сопка',
  'Mutnovsky': 'Мутновская Сопка', 'Gorely': 'Горелый', 'Kambalny': 'Камбальный', 'Alaid': 'Алаид', 'Sarychev Peak': 'Пик Сарычева',
  'Ebeko': 'Эбеко', 'Tyatya': 'Тятя', 'Chikurachki': 'Чикурачки', 'Raikoke': 'Райкоке', 'Zheltovsky': 'Желтовский',
  'Krakatau': 'Кракатау', 'Tambora': 'Тамбора', 'Samalas': 'Самалас', 'Rinjani': 'Ринджани', 'Merapi': 'Мерапи', 'Kelud': 'Келуд',
  'Agung': 'Агунг', 'Batur': 'Батур', 'Semeru': 'Семеру', 'Bromo': 'Бромо', 'Tengger Caldera': 'Тенгер', 'Sinabung': 'Синабунг',
  'Toba': 'Тоба', 'Galunggung': 'Галунггунг', 'Papandayan': 'Папандаян', 'Lokon-Empung': 'Локон-Эмпунг', 'Awu': 'Аву',
  'Pinatubo': 'Пинатубо', 'Mayon': 'Майон', 'Taal': 'Таал', 'Kanlaon': 'Канлаон', 'Hibok-Hibok': 'Хибок-Хибок',
  'Rabaul': 'Рабаул', 'Lamington': 'Ламингтон', 'Manam': 'Манам', 'Bagana': 'Багана', 'Ulawun': 'Улавун', 'Long Island': 'Лонг-Айленд',
  'Ruapehu': 'Руапеху', 'Tongariro': 'Тонгариро', 'Taupo': 'Таупо', 'Okataina': 'Окатаина', 'Taranaki': 'Таранаки', 'White Island': 'Уайт-Айленд',
  'Whakaari/White Island': 'Факаари', 'Hunga Tonga-Hunga Ha\'apai': 'Хунга-Тонга — Хунга-Хаапай', 'Kuwae': 'Куваэ', 'Ambrym': 'Амбрим',
  'Yasur': 'Ясур', 'Erebus': 'Эребус', 'Deception Island': 'Десепшен',
  'Kilauea': 'Килауэа', 'Mauna Loa': 'Мауна-Лоа', 'Mauna Kea': 'Мауна-Кеа', 'Hualalai': 'Хуалалаи', 'Haleakala': 'Халеакала',
  'St. Helens': 'Сент-Хеленс', 'Rainier': 'Рейнир', 'Baker': 'Бейкер', 'Hood': 'Худ', 'Shasta': 'Шаста', 'Lassen Volcanic Center': 'Лассен',
  'Crater Lake': 'Крейтер-Лейк (Мазама)', 'Mazama': 'Мазама', 'Yellowstone': 'Йеллоустон', 'Long Valley': 'Лонг-Вэлли',
  'Katmai': 'Катмай', 'Novarupta': 'Новарупта', 'Augustine': 'Огастин', 'Redoubt': 'Редаут', 'Spurr': 'Спарр', 'Pavlof': 'Павлова',
  'Okmok': 'Окмок', 'Aniakchak': 'Аниакчак', 'Shishaldin': 'Шишалдин', 'Veniaminof': 'Вениаминова', 'Makushin': 'Макушина',
  'Popocatepetl': 'Попокатепетль', 'Colima': 'Колима', 'Paricutin': 'Парикутин', 'Michoacan-Guanajuato': 'Мичоакан-Гуанахуато',
  'El Chichon': 'Эль-Чичон', 'Pico de Orizaba': 'Орисаба', 'Citlaltepetl': 'Орисаба', 'Santa Maria': 'Санта-Мария', 'Fuego': 'Фуэго',
  'Pacaya': 'Пакая', 'Agua': 'Агуа', 'Tacana': 'Такана', 'Ilopango': 'Илопанго', 'Masaya': 'Масая', 'Cosiguina': 'Косигуина',
  'Momotombo': 'Момотомбо', 'Cerro Negro': 'Серро-Негро', 'Arenal': 'Ареналь', 'Irazu': 'Ирасу', 'Poas': 'Поас',
  'Pelee': 'Мон-Пеле', 'Soufriere St. Vincent': 'Суфриер (Сент-Винсент)', 'Soufriere Hills': 'Суфриер-Хиллс',
  'Soufriere Guadeloupe': 'Суфриер (Гваделупа)', 'Kick \'em Jenny': 'Кик-эм-Дженни',
  'Nevado del Ruiz': 'Невадо-дель-Руис', 'Galeras': 'Галерас', 'Cotopaxi': 'Котопахи', 'Tungurahua': 'Тунгурауа',
  'Chimborazo': 'Чимборасо', 'Pichincha': 'Пичинча', 'Guagua Pichincha': 'Гуагуа-Пичинча', 'Sangay': 'Сангай', 'Reventador': 'Ревентадор',
  'Huaynaputina': 'Уайнапутина', 'Misti, El': 'Эль-Мисти', 'Ubinas': 'Убинас', 'Sabancaya': 'Сабанкая',
  'Lascar': 'Ласкар', 'Villarrica': 'Вильяррика', 'Llaima': 'Льяйма', 'Calbuco': 'Кальбуко', 'Chaiten': 'Чайтен', 'Puyehue-Cordon Caulle': 'Пуйеуэ — Кордон-Каулье',
  'Hudson, Cerro': 'Серро-Хадсон', 'Quizapu': 'Кисапу', 'Cerro Azul': 'Серро-Асуль', 'Osorno': 'Осорно', 'Ojos del Salado, Nevados': 'Охос-дель-Саладо',
  'Cerro Blanco': 'Серро-Бланко', 'Llullaillaco': 'Льюльяйльяко', 'Tupungatito': 'Тупунгатито', 'Planchon-Peteroa': 'Планчон-Петероа',
  'Fernandina': 'Фернандина', 'Wolf': 'Вольф', 'Sierra Negra': 'Сьерра-Негра',
  'Tristan da Cunha': 'Тристан-да-Кунья', 'Heard': 'Херд', 'Ruang': 'Руанг', 'Karangetang': 'Карангетанг', 'Lewotobi': 'Левотоби',
  'Barren Island': 'Баррен', 'Dukono': 'Дуконо', 'Ibu': 'Ибу', 'Gamalama': 'Гамалама', 'Banda Api': 'Банда-Апи',
};

const CITIES = {
  'LISBON': 'Лиссабон', 'LISBOA': 'Лиссабон', 'TOKYO': 'Токио', 'EDO': 'Эдо', 'KANTO': 'Канто', 'KYOTO': 'Киото', 'OSAKA': 'Осака',
  'KOBE': 'Кобе', 'SENDAI': 'Сендай', 'SANRIKU': 'Санрику', 'HONSHU': 'Хонсю', 'HOKKAIDO': 'Хоккайдо', 'KYUSHU': 'Кюсю', 'SHIKOKU': 'Сикоку',
  'NAPLES': 'Неаполь', 'NAPOLI': 'Неаполь', 'ROME': 'Рим', 'MESSINA': 'Мессина', 'CALABRIA': 'Калабрия', 'SICILY': 'Сицилия',
  'CATANIA': 'Катания', 'POMPEII': 'Помпеи', 'ATHENS': 'Афины', 'CORINTH': 'Коринф', 'SPARTA': 'Спарта', 'CRETE': 'Крит',
  'RHODES': 'Родос', 'ANTIOCH': 'Антиохия', 'ALEPPO': 'Алеппо', 'DAMASCUS': 'Дамаск', 'CONSTANTINOPLE': 'Константинополь',
  'ISTANBUL': 'Стамбул', 'JERUSALEM': 'Иерусалим', 'JERICHO': 'Иерихон', 'ALEXANDRIA': 'Александрия', 'CAIRO': 'Каир',
  'BEIRUT': 'Бейрут', 'TYRE': 'Тир', 'SIDON': 'Сидон', 'UGARIT': 'Угарит', 'NICAEA': 'Никея', 'IZMIT': 'Измит', 'ERZINCAN': 'Эрзинджан',
  'TABRIZ': 'Тебриз', 'BAM': 'Бам', 'QUETTA': 'Кветта', 'KASHMIR': 'Кашмир', 'KATHMANDU': 'Катманду', 'TANGSHAN': 'Таншань',
  'SHAANXI': 'Шэньси', 'SHANXI': 'Шаньси', 'SICHUAN': 'Сычуань', 'GANSU': 'Ганьсу', 'NINGXIA': 'Нинся', 'HAIYUAN': 'Хайюань',
  'YUNNAN': 'Юньнань', 'XINJIANG': 'Синьцзян', 'TIBET': 'Тибет', 'XIZANG': 'Тибет', 'QINGHAI': 'Цинхай', 'BEIJING': 'Пекин',
  'TAIWAN': 'Тайвань', 'SUMATRA': 'Суматра', 'JAVA': 'Ява', 'BALI': 'Бали', 'SULAWESI': 'Сулавеси', 'ACEH': 'Ачех', 'BANDA ACEH': 'Банда-Ачех',
  'LUZON': 'Лусон', 'MINDANAO': 'Минданао', 'MANILA': 'Манила', 'KAMCHATKA': 'Камчатка', 'SAKHALIN': 'Сахалин', 'KURIL ISLANDS': 'Курильские острова',
  'ASHGABAT': 'Ашхабад', 'ASHKHABAD': 'Ашхабад', 'TASHKENT': 'Ташкент', 'SPITAK': 'Спитак', 'SHEMAKHA': 'Шемаха', 'BAKU': 'Баку',
  'TBILISI': 'Тбилиси', 'ALMATY': 'Алматы', 'VERNYI': 'Верный', 'GORKHA': 'Горкха', 'LIMA': 'Лима', 'CALLAO': 'Кальяо', 'AREQUIPA': 'Арекипа',
  'VALDIVIA': 'Вальдивия', 'SANTIAGO': 'Сантьяго', 'VALPARAISO': 'Вальпараисо', 'CONCEPCION': 'Консепсьон', 'CHILLAN': 'Чильян',
  'ARICA': 'Арика', 'MEXICO CITY': 'Мехико', 'GUATEMALA CITY': 'Гватемала', 'MANAGUA': 'Манагуа', 'CARACAS': 'Каракас', 'CUMANA': 'Кумана',
  'QUITO': 'Кито', 'AMBATO': 'Амбато', 'KINGSTON': 'Кингстон', 'PORT ROYAL': 'Порт-Ройал', 'PORT-AU-PRINCE': 'Порт-о-Пренс',
  'SAN FRANCISCO': 'Сан-Франциско', 'LOS ANGELES': 'Лос-Анджелес', 'CHARLESTON': 'Чарлстон', 'NEW MADRID': 'Нью-Мадрид',
  'ANCHORAGE': 'Анкоридж', 'VALDEZ': 'Валдиз', 'ALASKA': 'Аляска', 'HAWAII': 'Гавайи', 'CALIFORNIA': 'Калифорния',
  'AGADIR': 'Агадир', 'SKOPJE': 'Скопье', 'BUCHAREST': 'Бухарест', 'VRANCEA': 'Вранча', 'BASEL': 'Базель', 'ANTAKYA': 'Антакья',
  'KAHRAMANMARAS': 'Кахраманмараш', 'MARRAKESH': 'Марракеш', 'ALGIERS': 'Алжир', 'TEHRAN': 'Тегеран', 'NISHAPUR': 'Нишапур',
  'KRAKATAU': 'Кракатау', 'SANTORINI': 'Санторин', 'THERA': 'Тера',
};

const PHRASES = {
  'MID-ATLANTIC RIDGE': 'Срединно-Атлантический хребет', 'EAST PACIFIC RISE': 'Восточно-Тихоокеанское поднятие',
  'PACIFIC-ANTARCTIC RIDGE': 'Тихоокеанско-Антарктический хребет', 'MID-INDIAN RIDGE': 'Центрально-Индийский хребет',
  'SOUTHWEST INDIAN RIDGE': 'Юго-Западный Индийский хребет', 'SOUTHEAST INDIAN RIDGE': 'Юго-Восточный Индийский хребет',
  'INDIAN-ANTARCTIC RIDGE': 'Индийско-Антарктический хребет', 'CARLSBERG RIDGE': 'хребет Карлсберг', 'REYKJANES RIDGE': 'хребет Рейкьянес',
  'WEST CHILE RISE': 'Западно-Чилийское поднятие', 'OWEN FRACTURE ZONE': 'зона разломов Оуэн', 'DRAKE PASSAGE': 'пролив Дрейка',
  'SCOTIA SEA': 'море Скоша', 'BANDA SEA': 'море Банда', 'SEA OF OKHOTSK': 'Охотское море', 'SEA OF JAPAN': 'Японское море',
  'MOLUCCA SEA': 'Молуккское море', 'CELEBES SEA': 'море Сулавеси', 'FLORES SEA': 'море Флорес', 'BALI SEA': 'море Бали',
  'JAVA SEA': 'Яванское море', 'SOLOMON SEA': 'Соломоново море', 'TASMAN SEA': 'Тасманово море', 'CORAL SEA': 'Коралловое море',
  'BERING SEA': 'Берингово море', 'CARIBBEAN SEA': 'Карибское море', 'MEDITERRANEAN SEA': 'Средиземное море', 'MEDITERRANEAN': 'Средиземное море',
  'AEGEAN SEA': 'Эгейское море', 'IONIAN SEA': 'Ионическое море', 'ADRIATIC SEA': 'Адриатическое море', 'TYRRHENIAN SEA': 'Тирренское море',
  'BLACK SEA': 'Чёрное море', 'CASPIAN SEA': 'Каспийское море', 'RED SEA': 'Красное море', 'DEAD SEA': 'Мёртвое море',
  'ARABIAN SEA': 'Аравийское море', 'ANDAMAN SEA': 'Андаманское море', 'BALTIC SEA': 'Балтийское море', 'NORTH SEA': 'Северное море',
  'IRISH SEA': 'Ирландское море', 'EAST CHINA SEA': 'Восточно-Китайское море', 'SOUTH CHINA SEA': 'Южно-Китайское море',
  'PHILIPPINE SEA': 'Филиппинское море', 'GULF OF CALIFORNIA': 'Калифорнийский залив', 'GULF OF ALASKA': 'залив Аляска',
  'GULF OF ADEN': 'Аденский залив', 'PERSIAN GULF': 'Персидский залив', 'GULF OF MEXICO': 'Мексиканский залив',
  'ATLANTIC OCEAN': 'Атлантический океан', 'PACIFIC OCEAN': 'Тихий океан', 'INDIAN OCEAN': 'Индийский океан', 'ARCTIC OCEAN': 'Северный Ледовитый океан',
  'NORTH ATLANTIC OCEAN': 'север Атлантического океана', 'SOUTH ATLANTIC OCEAN': 'юг Атлантического океана',
  'NORTH PACIFIC OCEAN': 'север Тихого океана', 'SOUTH PACIFIC OCEAN': 'юг Тихого океана', 'SOUTHERN PACIFIC OCEAN': 'юг Тихого океана',
  'NORTHWEST PACIFIC OCEAN': 'северо-запад Тихого океана', 'SOUTH INDIAN OCEAN': 'юг Индийского океана',
  'KURIL ISLANDS': 'Курильские острова', 'SOUTH SANDWICH ISLANDS': 'Южные Сандвичевы острова', 'KERMADEC ISLANDS': 'острова Кермадек',
  'FIJI ISLANDS': 'острова Фиджи', 'LOYALTY ISLANDS': 'острова Луайоте', 'MACQUARIE ISLAND': 'остров Маккуори', 'EASTER ISLAND': 'остров Пасхи',
  'PRINCE EDWARD ISLANDS': 'острова Принс-Эдуард', 'MARIANA ISLANDS': 'Марианские острова', 'NORTHERN MARIANA ISLANDS': 'Северные Марианские острова',
  'BALLENY ISLANDS': 'острова Баллени', 'BOUVET ISLAND': 'остров Буве', 'ASCENSION ISLAND': 'остров Вознесения',
  'SOUTH SHETLAND ISLANDS': 'Южные Шетландские острова', 'CHAGOS ARCHIPELAGO': 'архипелаг Чагос', 'GALAPAGOS TRIPLE JUNCTION': 'тройное сочленение Галапагос',
  'GALAPAGOS ISLANDS': 'Галапагосские острова', 'REVILLA GIGEDO ISLANDS': 'острова Ревилья-Хихедо', 'MAURITIUS - REUNION': 'Маврикий — Реюньон',
  'ALEUTIAN ISLANDS': 'Алеутские острова', 'ANDREANOF ISLANDS': 'Андреяновские острова', 'RAT ISLANDS': 'Крысьи острова', 'FOX ISLANDS': 'Лисьи острова',
  'NEAR ISLANDS': 'Ближние острова', 'BONIN ISLANDS': 'острова Огасавара', 'RYUKYU ISLANDS': 'острова Рюкю', 'IZU ISLANDS': 'острова Идзу',
  'VOLCANO ISLANDS': 'острова Кадзан', 'ANDAMAN ISLANDS': 'Андаманские острова', 'NICOBAR ISLANDS': 'Никобарские острова',
  'SANTA CRUZ ISLANDS': 'острова Санта-Крус', 'SAMOA ISLANDS': 'острова Самоа', 'TONGA ISLANDS': 'острова Тонга', 'TONGA': 'Тонга',
  'NEW BRITAIN': 'Новая Британия', 'NEW IRELAND': 'Новая Ирландия', 'BOUGAINVILLE': 'Бугенвиль', 'ADMIRALTY ISLANDS': 'острова Адмиралтейства',
  'ALASKA PENINSULA': 'полуостров Аляска', 'KENAI PENINSULA': 'полуостров Кенай', 'KAMCHATKA PENINSULA': 'полуостров Камчатка',
  'CENTRAL AMERICA': 'Центральная Америка', 'NORTH ISLAND OF NEW ZEALAND': 'Северный остров Новой Зеландии',
  'SOUTH ISLAND OF NEW ZEALAND': 'Южный остров Новой Зеландии', 'HINDU KUSH': 'Гиндукуш', 'PHILIPPINE ISLANDS': 'Филиппинские острова',
  'MINAHASA PENINSULA': 'полуостров Минахаса', 'SVALBARD AND JAN MAYEN': 'Шпицберген и Ян-Майен', 'SVALBARD': 'Шпицберген',
  'AZORES': 'Азорские острова', 'CANARY ISLANDS': 'Канарские острова', 'CAPE VERDE ISLANDS': 'острова Зелёного Мыса',
  'IONIAN ISLANDS': 'Ионические острова', 'DODECANESE ISLANDS': 'Додеканес', 'CYCLADES ISLANDS': 'Киклады', 'HALMAHERA': 'Хальмахера',
  'TIMOR': 'Тимор', 'SERAM': 'Серам', 'BURU': 'Буру', 'MOLUCCAS': 'Молуккские острова', 'LESSER SUNDA IS': 'Малые Зондские острова',
  'LESSER SUNDA ISLANDS': 'Малые Зондские острова', 'NEW GUINEA': 'Новая Гвинея', 'HISPANIOLA': 'Гаити (остров)', 'LEEWARD ISLANDS': 'Подветренные острова',
  'WINDWARD ISLANDS': 'Наветренные острова', 'UNDERSEA FEATURES': 'подводные объекты', 'ALASKA': 'Аляска', 'CALIFORNIA': 'Калифорния',
  'HAWAII': 'Гавайи', 'OREGON': 'Орегон', 'WASHINGTON': 'Вашингтон', 'NEVADA': 'Невада', 'IDAHO': 'Айдахо', 'MONTANA': 'Монтана',
  'UTAH': 'Юта', 'WYOMING': 'Вайоминг', 'MISSOURI': 'Миссури', 'SOUTH CAROLINA': 'Южная Каролина', 'PUERTO RICO': 'Пуэрто-Рико',
  'AK': 'Аляска', 'CA': 'Калифорния', 'HI': 'Гавайи', 'WA': 'Вашингтон', 'OR': 'Орегон', 'NV': 'Невада', 'ID': 'Айдахо', 'MT': 'Монтана',
  'CENTRAL ALASKA': 'центральная Аляска', 'SOUTHERN ALASKA': 'южная Аляска', 'WESTERN XIZANG': 'западный Тибет', 'EASTERN XIZANG': 'восточный Тибет',
};

// Source-specific country spellings -> world.json nameEn (or direct Russian when absent there).
const COUNTRY_ALIASES = {
  'USA': 'United States of America', 'UNITED STATES': 'United States of America', 'US': 'United States of America',
  'UK': 'United Kingdom', 'MYANMAR (BURMA)': 'Myanmar', 'BURMA (MYANMAR)': 'Myanmar', 'BURMA': 'Myanmar', 'CZECH REPUBLIC': 'Czechia',
  'BOSNIA-HERZEGOVINA': 'Bosnia and Herz.', 'BOSNIA AND HERZEGOVINA': 'Bosnia and Herz.', 'CENTRAL AFRICAN REPUBLIC': 'Central African Rep.',
  'DOMINICAN REPUBLIC': 'Dominican Rep.', "COTE D'IVOIRE": "Côte d'Ivoire", 'MICRONESIA, FED. STATES OF': 'Micronesia',
  'FEDERATED STATES OF MICRONESIA': 'Micronesia', 'SOUTH SUDAN': 'S. Sudan', 'DR CONGO': 'Dem. Rep. Congo', 'DEMOCRATIC REPUBLIC OF THE CONGO': 'Dem. Rep. Congo',
  'SOLOMON ISLANDS': 'Solomon Is.', 'SAINT VINCENT AND THE GRENADINES': 'St. Vin. and Gren.', 'ANTIGUA AND BARBUDA': 'Antigua and Barb.',
  'SAINT KITTS AND NEVIS': 'St. Kitts and Nevis', 'BRITISH VIRGIN ISLANDS': 'British Virgin Is.', 'FRENCH POLYNESIA': 'Fr. Polynesia',
  'TURKIYE': 'Turkey', 'TIMOR LESTE': 'Timor-Leste', 'EAST TIMOR': 'Timor-Leste', 'UNION OF THE COMOROS': 'Comoros',
  'WALLIS AND FUTUNA (FRENCH TERRITORY)': 'Wallis and Futuna Is.', 'WALLIS AND FUTUNA': 'Wallis and Futuna Is.', 'MARSHALL ISLANDS, REP. OF': 'Marshall Is.',
  'MARSHALL ISLANDS': 'Marshall Is.', 'NAOERO': 'Nauru', 'HOLLAND': 'Netherlands', 'COOK ISLANDS': 'Cook Is.', 'EQUATORIAL GUINEA': 'Eq. Guinea',
  'NORTHERN MARIANA ISLANDS': 'N. Mariana Is.', 'SOUTH GEORGIA AND THE SOUTH SANDWICH ISLANDS': 'S. Geo. and the Is.', 'MX': 'Mexico',
  'CABO VERDE': 'Cabo Verde', 'CAPE VERDE': 'Cabo Verde', 'PAPUA NEW GUINEA': 'Papua New Guinea', 'TRINIDAD AND TOBAGO': 'Trinidad and Tobago',
  'NEW CALEDONIA': 'New Caledonia', 'CAYMAN ISLANDS': 'Cayman Is.', 'TURKS AND CAICOS ISLANDS': 'Turks and Caicos Is.', 'FALKLAND ISLANDS': 'Falkland Is.',
  'AMERICAN SAMOA': 'American Samoa', 'US VIRGIN ISLANDS': 'U.S. Virgin Is.', 'VIRGIN ISLANDS': 'U.S. Virgin Is.', 'SAO TOME AND PRINCIPE': 'São Tomé and Principe',
};
const COUNTRY_RU_DIRECT = {
  'USA TERRITORY': 'территории США', 'UK TERRITORY': 'британские территории', 'KOREA': 'Корея', 'SCOTLAND': 'Шотландия',
  'GUADELOUPE': 'Гваделупа', 'GUADELOUPE (FRENCH TERRITORY)': 'Гваделупа', 'MARTINIQUE': 'Мартиника', 'MARTINIQUE (FRENCH TERRITORY)': 'Мартиника',
  'FRENCH GUIANA': 'Французская Гвиана', 'REUNION': 'Реюньон', 'MAYOTTE': 'Майотта', 'AZORES (PORTUGAL)': 'Азорские острова (Португалия)',
  'MADEIRA ISLANDS (PORTUGAL)': 'Мадейра (Португалия)', 'KERMADEC ISLANDS (NEW ZEALAND)': 'острова Кермадек (Новая Зеландия)',
  'TIMOR-LESTE': 'Восточный Тимор', 'MARQUESAS ISLANDS': 'Маркизские острова',
};

// ------------------------------------------------------------------ transliteration
// Rule tables per source romanisation (longest match first). Not linguistically perfect,
// but readable; curated dictionaries above take precedence.
const RULES = {
  en: [['shch', 'щ'], ['sch', 'ш'], ['tch', 'ч'], ['sh', 'ш'], ['ch', 'ч'], ['kh', 'х'], ['zh', 'ж'], ['ts', 'ц'], ['tz', 'ц'],
    ['ya', 'я'], ['yo', 'ё'], ['yu', 'ю'], ['ye', 'е'], ['ph', 'ф'], ['th', 'т'], ['ck', 'к'], ['qu', 'кв'], ['oo', 'у'], ['ee', 'и'],
    ['ou', 'у'], ['gh', 'г'], ['dj', 'дж'], ['ae', 'е'], ['ny', 'нь'], ['ñ', 'нь'], ['new', 'нью'], ['ey', 'ей'], ['ay', 'ай']],
  es: [['ll', 'ль'], ['ñ', 'нь'], ['ch', 'ч'], ['qu', 'к'], ['gue', 'ге'], ['gui', 'ги'], ['güe', 'гуэ'], ['ge', 'хе'], ['gi', 'хи'],
    ['lh', 'ль'], ['nh', 'нь'], ['ão', 'ан'], ['ã', 'ан'], ['ya', 'я'], ['yo', 'йо'], ['yu', 'ю'], ['ye', 'е'], ['ia', 'ия'], ['io', 'ио'],
    ['j', 'х'], ['x', 'х'], ['z', 'с'], ['h', ''], ['ce', 'се'], ['ci', 'си'], ['c', 'к'], ['v', 'в'], ['y', 'и']],
  zh: [['zhuang', 'чжуан'], ['chuang', 'чуан'], ['shuang', 'шуан'], ['iang', 'ян'], ['iong', 'юн'], ['uang', 'уан'], ['yuan', 'юань'],
    ['yang', 'ян'], ['ying', 'ин'], ['yong', 'юн'], ['zh', 'чж'], ['ch', 'ч'], ['sh', 'ш'], ['uan', 'уань'], ['ian', 'янь'], ['iao', 'яо'],
    ['ang', 'ан'], ['eng', 'эн'], ['ing', 'ин'], ['ong', 'ун'], ['yan', 'янь'], ['yao', 'яо'], ['yin', 'инь'], ['you', 'ю'], ['yue', 'юэ'],
    ['yun', 'юнь'], ['wei', 'вэй'], ['wen', 'вэнь'], ['wang', 'ван'], ['wan', 'вань'], ['wai', 'вай'], ['uai', 'уай'], ['ui', 'уй'], ['uo', 'о'],
    ['ou', 'оу'], ['ai', 'ай'], ['ei', 'эй'], ['ao', 'ао'], ['an', 'ань'], ['en', 'энь'], ['in', 'инь'], ['un', 'унь'], ['ie', 'е'],
    ['iu', 'ю'], ['ia', 'я'], ['ue', 'юэ'], ['ya', 'я'], ['ye', 'е'], ['yi', 'и'], ['yu', 'юй'], ['wu', 'у'], ['wa', 'ва'], ['wo', 'во'],
    ['x', 'с'], ['q', 'ц'], ['j', 'цз'], ['z', 'цз'], ['c', 'ц'], ['r', 'ж'], ['e', 'э'], ['y', 'и'], ['w', 'в']],
  ja: [['shi', 'си'], ['chi', 'ти'], ['tsu', 'цу'], ['sha', 'ся'], ['shu', 'сю'], ['sho', 'сё'], ['cha', 'тя'], ['chu', 'тю'], ['cho', 'тё'],
    ['ja', 'дзя'], ['ju', 'дзю'], ['jo', 'дзё'], ['ji', 'дзи'], ['kya', 'кя'], ['kyu', 'кю'], ['kyo', 'кё'], ['ryu', 'рю'], ['ryo', 'рё'],
    ['nyu', 'ню'], ['hyo', 'хё'], ['gyo', 'гё'], ['ya', 'я'], ['yu', 'ю'], ['yo', 'ё'], ['ye', 'е'], ['ou', 'о'], ['oo', 'о'], ['uu', 'у'],
    ['ei', 'эй'], ['wa', 'ва'], ['fu', 'фу'], ['zu', 'дзу'], ['z', 'дз'], ['sh', 'с'], ['ch', 'т'], ['ts', 'ц'], ['j', 'дз'], ['e', 'э'],
    ['l', 'р']],
  id: [['sy', 'ш'], ['kh', 'х'], ['ng', 'нг'], ['ny', 'нь'], ['tj', 'ч'], ['dj', 'дж'], ['oe', 'у'], ['ya', 'я'], ['yu', 'ю'], ['yo', 'йо'],
    ['c', 'ч'], ['j', 'дж'], ['y', 'й']],
};
const SINGLE = {
  a: 'а', b: 'б', c: 'к', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'х', i: 'и', j: 'дж', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п',
  q: 'к', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', w: 'в', x: 'кс', y: 'и', z: 'з',
};
const VOWELS = new Set('aeiouy');
const stripAccents = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/ð/g, 'd').replace(/þ/g, 'th').replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/ß/g, 'ss').replace(/[’ʻ‘]/g, '');

function translitWord(word, lang = 'en') {
  const raw = word.toLowerCase();
  const w = lang === 'es'
    ? raw.replace(/[áàâä]/g, 'a').replace(/[éèêë]/g, 'e').replace(/[íìîï]/g, 'i').replace(/[óòôö]/g, 'o').replace(/[úùû]/g, 'u').replace(/ç/g, 's')
    : stripAccents(raw);
  const rules = RULES[lang] || RULES.en;
  let out = '';
  for (let i = 0; i < w.length;) {
    const ch = w[i];
    if (!/[a-zñãü]/.test(ch)) { out += ch; i++; continue; }
    let hit = null;
    for (const r of rules) if (w.startsWith(r[0], i)) { hit = r; break; }
    if (hit) { out += hit[1]; i += hit[0].length; continue; }
    const prev = w[i - 1], next = w[i + 1];
    if (ch === 'c' && next && 'eiy'.includes(next)) out += 'с';
    else if (ch === 'y') out += (prev && VOWELS.has(prev)) || (next && VOWELS.has(next)) ? 'й' : 'и';
    else if (ch === 'e' && lang !== 'zh' && (i === 0 || !/[a-z]/.test(prev))) out += 'э';
    else out += SINGLE[ch] ?? ch;
    i++;
  }
  return out;
}
function capitalise(s) { return s.replace(/(^|[\s(-])([а-яёa-z])/g, (m, a, b) => a + b.toUpperCase()); }
export function transliterate(text, lang = 'en') {
  if (!text) return '';
  return capitalise(String(text).split(/(\s+|-|,|\(|\)|\/|')/)
    .map(t => (/[A-Za-zÀ-ÿ]/.test(t) ? translitWord(t, lang) : (t === "'" ? '' : t))).join(''));
}

const LANG_BY_COUNTRY = {
  zh: ['CHINA', 'TAIWAN', 'HONG KONG', 'MACAO'],
  ja: ['JAPAN'],
  id: ['INDONESIA', 'MALAYSIA', 'BRUNEI', 'TIMOR-LESTE', 'EAST TIMOR'],
  es: ['MEXICO', 'GUATEMALA', 'EL SALVADOR', 'HONDURAS', 'NICARAGUA', 'COSTA RICA', 'PANAMA', 'COLOMBIA', 'VENEZUELA', 'ECUADOR', 'PERU',
    'BOLIVIA', 'CHILE', 'ARGENTINA', 'URUGUAY', 'PARAGUAY', 'CUBA', 'DOMINICAN REPUBLIC', 'SPAIN', 'PHILIPPINES', 'CANARY ISLANDS',
    'PORTUGAL', 'BRAZIL', 'AZORES (PORTUGAL)', 'AZORES', 'CABO VERDE', 'PUERTO RICO', 'MX'],
};
const langMap = new Map();
for (const [lang, list] of Object.entries(LANG_BY_COUNTRY)) for (const c of list) langMap.set(c, lang);
export const langOfCountry = c => {
  if (!c) return 'en';
  const k = stripAccents(String(c)).toUpperCase().trim();
  return langMap.get(k) || langMap.get(k.split(/[-,]/)[0].trim()) || 'en';
};

// ------------------------------------------------------------------ public API
const DIR_TOKENS = {
  N: 'север', S: 'юг', E: 'восток', W: 'запад', NE: 'северо-восток', NW: 'северо-запад', SE: 'юго-восток', SW: 'юго-запад',
  NNE: 'северо-восток', ENE: 'северо-восток', NNW: 'северо-запад', WNW: 'северо-запад', SSE: 'юго-восток', ESE: 'юго-восток',
  SSW: 'юго-запад', WSW: 'юго-запад', NORTH: 'север', SOUTH: 'юг', EAST: 'восток', WEST: 'запад', NORTHERN: 'север', SOUTHERN: 'юг',
  EASTERN: 'восток', WESTERN: 'запад', CENTRAL: 'центр', NORTHEAST: 'северо-восток', NORTHWEST: 'северо-запад', SOUTHEAST: 'юго-восток',
  SOUTHWEST: 'юго-запад', NORTHEASTERN: 'северо-восток', NORTHWESTERN: 'северо-запад', SOUTHEASTERN: 'юго-восток', SOUTHWESTERN: 'юго-запад',
  'NORTH-CENTRAL': 'север', 'SOUTH-CENTRAL': 'юг', 'EAST-CENTRAL': 'восток', 'WEST-CENTRAL': 'запад', MID: 'центр',
};
const DROP_WORDS = new Set(['PROVINCE', 'PROVINCES', 'PROV', 'PREFECTURE', 'PREF', 'DISTRICT', 'DEPARTMENT', 'DEPT', 'STATE', 'COUNTY',
  'AREA', 'REGION', 'CITY', 'MUNICIPALITY', 'GOVERNORATE', 'OBLAST', 'KRAI', 'TERRITORY', 'NEAR', 'OF', 'THE', 'AND', 'VOLCANO',
  'EARTHQUAKE', 'EARTHQUAKES']);
const WORDS = {
  VALLEY: 'долина', BAY: 'залив', LAKE: 'озеро', RIVER: 'река', MOUNT: 'гора', MT: 'гора', GULF: 'залив', STRAIT: 'пролив',
  PENINSULA: 'полуостров', ARCHIPELAGO: 'архипелаг', SEA: 'море', SOUND: 'пролив', HARBOR: 'гавань', HARBOUR: 'гавань', PORT: 'Порт',
  SAN: 'Сан', SANTA: 'Санта', NEW: 'Нью', ST: 'Сент', SAINT: 'Сент', FORT: 'Форт', LA: 'Ла', EL: 'Эль', DE: 'де', DEL: 'дель', DA: 'да', DO: 'ду',
};

export function createNamer(world) {
  const byEn = new Map();
  const norm = s => stripAccents(String(s)).toUpperCase().replace(/[.\s]+$/, '').replace(/\s+/g, ' ').trim();
  for (const c of world.countries) if (c.nameEn) byEn.set(norm(c.nameEn), c.name);
  const isCountry = raw => { const k = norm(raw); return !!(COUNTRY_RU_DIRECT[k] || byEn.has(k) || COUNTRY_ALIASES[k]); };
  const titleCase = s => String(s).toLowerCase().replace(/(^|[\s(-])([a-z])/g, (m, a, b) => a + b.toUpperCase());

  function country(raw) {
    if (!raw) return '';
    const k = norm(raw);
    if (COUNTRY_RU_DIRECT[k]) return COUNTRY_RU_DIRECT[k];
    if (byEn.has(k)) return byEn.get(k);
    const a = COUNTRY_ALIASES[k];
    if (a && byEn.has(norm(a))) return byEn.get(norm(a));
    if (PHRASES[k]) return PHRASES[k];
    if (CITIES[k]) return CITIES[k];
    if (/ - /.test(raw)) return country(raw.split(' - ')[0]);
    if (/-/.test(raw) && raw.split('-').every(p => isCountry(p))) return raw.split('-').map(p => country(p)).join(' — ');
    if (/\(.*\)/.test(raw)) return country(raw.replace(/\s*\(.*\)\s*/, ''));
    return transliterate(titleCase(raw));
  }

  // A single geographic name (no colon levels) -> {base, dir, coast}
  function parsePlace(raw, lang) {
    const s = String(raw).replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\s+/g, ' ').trim();
    const k0 = norm(s);
    if (!k0) return null;
    if (PHRASES[k0]) return { base: PHRASES[k0] };
    if (CITIES[k0]) return { base: CITIES[k0] };
    if (isCountry(s)) return { base: country(s), isCountry: true };
    const m = /^(.*) region$/i.exec(s);
    if (m) { const p = parsePlace(m[1], lang); return p && { ...p, dir: p.dir || 'район' }; }
    let toks = k0.replace(/\./g, ' ').split(' ').filter(Boolean);
    let dir = '', coast = false, island = 0;
    // leading / trailing direction tokens ("S OF JAVA", "S SUMATERA", "HONSHU S")
    while (toks.length > 1 && DIR_TOKENS[toks[0]]) { dir = DIR_TOKENS[toks[0]]; toks.shift(); }
    while (toks.length > 1 && DIR_TOKENS[toks[toks.length - 1]]) { dir = DIR_TOKENS[toks.pop()]; }
    if (toks.length === 1 && DIR_TOKENS[toks[0]]) return { base: '', dir: DIR_TOKENS[toks[0]] };
    toks = toks.filter(t => {
      if (t === 'OFF' || t === 'COAST' || t === 'COASTS' || t === 'COASTAL' || t === 'SHORE') { coast = true; return false; }
      if (t === 'ISLAND' || t === 'IS' || t === 'ISL' || t === 'PULAU') { island = island || 1; return false; }
      if (t === 'ISLANDS' || t === 'KEPULAUAN') { island = 2; return false; }
      return !DROP_WORDS.has(t);
    });
    if (!toks.length) return dir ? { base: '', dir, coast } : null;
    const k = toks.join(' ');
    let base = PHRASES[k] || CITIES[k] || (isCountry(k) ? country(k) : null);
    if (!base) {
      base = toks.map(t => WORDS[t] || CITIES[t] || transliterate(titleCase(t), lang)).join(' ').replace(/ - /g, '-');
      if (island) base = `${island === 2 ? 'острова' : 'остров'} ${base}`;
    }
    return { base, dir, coast };
  }
  const fmt = p => {
    if (!p) return '';
    const extra = [p.dir, p.coast ? 'побережье' : ''].filter(Boolean).join(', ');
    if (!p.base) return extra;
    return extra ? `${p.base}, ${extra}` : p.base;
  };

  function place(raw, lang = 'en') { return fmt(parsePlace(raw, lang)); }

  /** NCEI "COUNTRY:  REGION:  PLACE, PLACE" -> "Место, Регион (Страна)". */
  function nceiLocation(locationName, countryRaw) {
    const lang = langOfCountry(countryRaw);
    const segs = String(locationName || '').split(/[:;]/).map(s => s.trim()).filter(Boolean);
    const c = country(countryRaw || segs[0] || '');
    const parsed = [];
    for (const seg of segs) {
      if (isCountry(seg) || /^BALKANS/i.test(seg)) continue;
      const first = seg.split(',').map(s => s.trim()).filter(Boolean);
      const p = parsePlace(first[0] || '', lang);
      if (!p) continue;
      if (first[1]) { const p2 = parsePlace(first[1], lang); if (p2?.base && p.base && !p2.isCountry) p.base += `, ${p2.base}`; }
      parsed.push(p);
    }
    // most specific segment last; a pure direction ("S") qualifies the previous one
    let main = parsed.pop();
    while (main && !main.base && parsed.length) {
      const prev = parsed.pop();
      prev.dir = main.dir || prev.dir; prev.coast = prev.coast || main.coast; main = prev;
    }
    const region = parsed.length ? parsed[parsed.length - 1] : null;
    let name = fmt(main);
    if (region?.base && main?.base && region.base !== main.base && !region.isCountry) name = `${name}; ${region.base}`;
    if (!name || name === c) return c;
    return c ? `${name} (${c})` : name;
  }

  /** USGS "45 km SSE of Kokopo, Papua New Guinea" -> "Кокопо (Папуа — Новая Гвинея)". */
  function usgsPlace(p) {
    if (!p) return '';
    const s = String(p).replace(/^\d+(\.\d+)? ?km [NSEW]{1,3} of /, '').trim();
    const parts = s.split(', ');
    if (parts.length >= 2) {
      const ctyRaw = parts[parts.length - 1];
      const lang = langOfCountry(ctyRaw);
      const c = place(ctyRaw, lang);
      const loc = place(parts.slice(0, -1).join(' '), lang);
      return loc && loc !== c ? `${loc} (${c})` : c;
    }
    const m = /^(north|south|east|west|northeast|northwest|southeast|southwest) of (the )?(.*)$/i.exec(s);
    if (m) return `${place(m[3])}, ${DIR_TOKENS[m[1].toUpperCase()]}`;
    return place(s);
  }

  function volcano(name, countryRaw) {
    if (!name) return '';
    if (VOLCANOES[name]) return VOLCANOES[name];
    const lang = langOfCountry(countryRaw);
    let s = name.replace(/, The$/i, '');
    const m = /^([^,]+), ([^,]+)$/.exec(s);           // GVP inverted names: "Chichon, El", "Fournaise, Piton de la"
    if (m && m[2].split(" ").length <= 3) s = `${m[2]} ${m[1]}`;
    if (VOLCANOES[s]) return VOLCANOES[s];
    // generic landform words -> Russian, the proper name transliterated
    const KIND = [[/ Volcanic Field$/i, 'вулканическое поле'], [/ Volcanic Complex$/i, 'вулканический комплекс'], [/ Caldera$/i, 'кальдера'],
      [/ Seamounts?$/i, 'подводная гора'], [/ Islands$/i, 'острова'], [/ Island$/i, 'остров'], [/ Mountains?$/i, 'гора'], [/ Lake$/i, 'озеро'],
      [/ Depression$/i, 'впадина'], [/ Ridge$/i, 'хребет'], [/ Peak$/i, 'пик'], [/ Hills?$/i, 'холмы'], [/ Craters?$/i, 'кратер'],
      [/ Volcano$/i, 'вулкан'], [/ Lava Field$/i, 'лавовое поле'], [/ Cones?$/i, 'конус']];
    for (const [re, ru] of KIND) {
      if (re.test(s)) return `${ru} ${transliterate(s.replace(re, ''), lang)}`;
    }
    return transliterate(s, lang);
  }

  return { country, place, nceiLocation, usgsPlace, volcano, transliterate };
}

const VOLCANO_TYPES = {
  'stratovolcano': 'стратовулкан', 'caldera': 'кальдера', 'shield': 'щитовой вулкан', 'volcanic field': 'вулканическое поле',
  'lava dome': 'лавовый купол', 'complex': 'вулканический комплекс', 'compound': 'составной вулкан', 'pyroclastic cone': 'пирокластический конус',
  'fissure vent': 'трещинный вулкан', 'maar': 'маар', 'tuff cone': 'туфовый конус', 'tuff ring': 'туфовое кольцо', 'explosion crater': 'взрывной кратер',
  'lava cone': 'лавовый конус', 'cone': 'конус', 'crater rows': 'цепь кратеров', 'shield(pyroclastic)': 'пирокластический щит', 'submarine': 'подводный вулкан',
};
export function volcanoTypeRu(t) {
  if (!t) return 'вулкан';
  const k = t.toLowerCase().replace(/\((s|es)\)/g, '').replace(/\?/g, '').trim();
  return VOLCANO_TYPES[k] || VOLCANO_TYPES[k.replace(/s$/, '')] || 'вулкан';
}
