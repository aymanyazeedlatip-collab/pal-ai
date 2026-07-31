// geo-data.js — Philippine Geographic Hierarchy
// Regions → Provinces → Municipalities → Sample Barangays

const PH_GEO = {
  1: {
    name: "Region I — Ilocos Region",
    lat: 17.5, lng: 120.4,
    provinces: {
      "Ilocos Norte": {
        municipalities: {
          "Laoag City": ["Barangay 1 - San Lorenzo", "Barangay 2 - San Pedro", "Barangay 3 - Santa Joaquina", "Barangay 4 - Santa Angela", "Nangalisan"],
          "Batac City": ["Ablan", "Baay", "Bani", "Buyon", "Camandingan"],
          "Paoay": ["Bacsil", "Callaguip", "Cayub", "Lacub", "Pajo"],
          "Pagudpud": ["Adams", "Baduang", "Caunayan", "Dampig", "Pasaleng"],
          "Vintar": ["Bago", "Bimmanga", "Cabaruan", "Cabusligan", "Capanickian"]
        }
      },
      "Ilocos Sur": {
        municipalities: {
          "Vigan City": ["Ayusan Norte", "Ayusan Sur", "Barraca", "Bonifacio", "Bulala"],
          "Candon City": ["Ag-aguman", "Amguid", "Balingaoan", "Bitalag", "Darapidap"],
          "Narvacan": ["Abuor", "Ambulogan", "Amutay", "Anduqui", "Aquib"],
          "Santa": ["Apatot", "Araceli", "Banaoang", "Bani", "Bao-as"],
          "Tagudin": ["Ambalayat", "Amboayao Norte", "Amboayao Sur", "Amontoc", "Ampalioc"]
        }
      },
      "La Union": {
        municipalities: {
          "San Fernando City": ["Abut", "Apaleng", "Bacsil", "Balang", "Balbaldez"],
          "Agoo": ["Ambitacay", "Balawarte", "Cataguingtingan", "Consolacion", "Macalva Norte"],
          "Bauang": ["Acao", "Baccuit Norte", "Baccuit Sur", "Bacqui", "Bagutot"],
          "Sto. Tomas": ["Aguioas", "Ambalite", "Ambayat I", "Ambayat II", "Apil"]
        }
      },
      "Pangasinan": {
        municipalities: {
          "Dagupan City": ["Bacayao Norte", "Bacayao Sur", "Barangay I", "Barangay II", "Bolosan"],
          "Urdaneta City": ["Anonas", "Bactad East", "Bayaoas", "Bolaoen", "Cabaruan"],
          "Lingayen": ["Aliwekwek", "Baay", "Balangobong", "Balococ", "Bantayan"],
          "Alaminos City": ["Alos", "Amandiego", "Amangbangan", "Balangobong", "Baleyadaan"]
        }
      }
    }
  },
  2: {
    name: "Region II — Cagayan Valley",
    lat: 17.6, lng: 121.7,
    provinces: {
      "Cagayan": {
        municipalities: {
          "Tuguegarao City": ["Alibago", "Annafunan East", "Annafunan West", "Atulayan Norte", "Atulayan Sur"],
          "Aparri": ["Backiling", "Bangag", "Centro East", "Centro West", "Dodan"],
          "Gonzaga": ["Alucao", "Baua", "Bagu", "Balagao", "Callao"],
          "Abulug": ["Alilinu", "Baliguian", "Gaddangan", "Kabudbudan", "Masi"]
        }
      },
      "Isabela": {
        municipalities: {
          "Ilagan City": ["Alibagu", "Allinguigan 1st", "Allinguigan 2nd", "Arusip", "Baculod"],
          "Cauayan City": ["Alinam", "Alinguigan", "Ambalatungan", "Anao", "Ania Sur"],
          "Santiago City": ["Abra", "Ambalatungan", "Balintocatoc", "Buenavista", "Calao East"],
          "Roxas": ["Angkasina", "Binguang", "Buenavista", "Caniao", "Capo"]
        }
      },
      "Nueva Vizcaya": {
        municipalities: {
          "Bayombong": ["Antonino", "Aquiangan", "Bitao", "Buag", "Bulucao"],
          "Solano": ["Bagawanan", "Bintawan Norte", "Bintawan Sur", "Bonifacio", "Cabuaan"]
        }
      },
      "Quirino": {
        municipalities: {
          "Cabarroguis": ["Banuar", "Bugnay", "Dibibi", "Dingasan", "Gobgob"],
          "Maddela": ["Abbag", "Balligui", "Buenavista", "Dagupan", "Duquiaon"]
        }
      }
    }
  },
  3: {
    name: "Region III — Central Luzon",
    lat: 15.5, lng: 120.9,
    provinces: {
      "Bulacan": {
        municipalities: {
          "Malolos City": ["Anilao", "Atlag", "Babatnin", "Bagna", "Balayong"],
          "Meycauayan City": ["Bagong Buhay", "Bancal", "Banga", "Bayugo", "Camalig"],
          "San Jose del Monte City": ["Assumption", "Bagong Buhay I", "Bagong Buhay II", "Bagong Buhay III", "Citrus"],
          "Obando": ["Catapusan", "Nag-sisi", "Paco", "San Pascual", "Tawiran"]
        }
      },
      "Pampanga": {
        municipalities: {
          "San Fernando City": ["Alasas", "Baliti", "Bulaon", "Calulut", "Del Carmen"],
          "Angeles City": ["Agapito del Rosario", "Amsic", "Anunas", "Balibago", "Capaya"],
          "Mabalacat City": ["Atlu-Bola", "Bical", "Buas", "Buhangin", "Bundagul"],
          "Guagua": ["Bancal", "Bignay 1st", "Bignay 2nd", "Bolobaло", "Bulac"]
        }
      },
      "Nueva Ecija": {
        municipalities: {
          "Palayan City": ["Atate", "Bagong Buhay", "Bantug Hacienda", "Bantug Norte", "Caalibangbangan"],
          "Cabanatuan City": ["Aduas Norte", "Aduas Sur", "Bagong Buhay", "Bagong Sikat", "Bakero"],
          "Gapan City": ["Balante", "Balutu", "Bulak", "Bungo", "Capalangan"]
        }
      },
      "Tarlac": {
        municipalities: {
          "Tarlac City": ["Aguso", "Alvindia Segundo", "Amucao", "Armenia", "Asturias"],
          "Capas": ["Aranguren", "Bueno", "Cubcub", "Dolores", "Lawy"],
          "Bamban": ["Anupul", "Bamban", "Pinatubo", "San Pedro", "Tarlac"]
        }
      }
    }
  },
  4: {
    name: "Region IV-A — CALABARZON",
    lat: 14.1, lng: 121.2,
    provinces: {
      "Cavite": {
        municipalities: {
          "Dasmarinas City": ["Burol I", "Burol II", "Burol III", "Paliparan I", "Paliparan II"],
          "Bacoor City": ["Aniban I", "Aniban II", "Aniban III", "Aniban IV", "Aniban V"],
          "Imus City": ["Alapan I-A", "Alapan I-B", "Alapan I-C", "Alapan II-A", "Alapan II-B"],
          "Tagaytay City": ["Asisan", "Bug-ong", "Calabuso", "Crisanto de los Reyes", "Guinhawa Norte"]
        }
      },
      "Laguna": {
        municipalities: {
          "Calamba City": ["Bagong Kalsada", "Banlic", "Barandal", "Batino", "Bubuyan"],
          "San Pablo City": ["Atisan", "Bagong Buhay", "Barangay I", "Barangay II", "Barangay III"],
          "Binan City": ["Binan", "Bungahan", "Canlalay", "Casile", "De La Paz"],
          "Santa Rosa City": ["Aplaya", "Balibago", "Caingin", "Dila", "Dita"]
        }
      },
      "Batangas": {
        municipalities: {
          "Batangas City": ["Alangilan", "Balagtas", "Balete", "Banaba Center", "Banaba East"],
          "Lipa City": ["Anilao-Labac", "Antipolo del Norte", "Antipolo del Sur", "Bagong Pook", "Balintawak"],
          "Tanauan City": ["Altura Bata", "Altura Matanda", "Altura South", "Ambulong", "Arnaldo"]
        }
      },
      "Rizal": {
        municipalities: {
          "Antipolo City": ["Bagong Nayon", "Beverly Hills", "Dalig", "dela Paz", "Inarawan"],
          "Cainta": ["Sto. Domingo", "San Andres", "San Juan", "San Roque", "Sta. Rosa"],
          "Taytay": ["Dolores", "Muzon", "San Isidro", "San Juan", "Santa Ana"]
        }
      },
      "Quezon": {
        municipalities: {
          "Lucena City": ["Barangay I", "Barangay II", "Barangay III", "Barangay IV", "Barangay V"],
          "Tayabas City": ["Alitao", "Aya", "Banilad", "Bukal Norte", "Bukal Sur"],
          "Candelaria": ["Buenavista Norte", "Buenavista Sur", "Masalukot I", "Masalukot II", "Masalukot III"]
        }
      }
    }
  },
  5: {
    name: "Region V — Bicol Region",
    lat: 13.5, lng: 123.3,
    provinces: {
      "Camarines Sur": {
        municipalities: {
          "Naga City": ["Abella", "Bagumbayan Norte", "Bagumbayan Sur", "Balatas", "Calauag"],
          "Iriga City": ["Antipolo", "Arimbay", "Batang", "Buhi", "Calzada"],
          "Goa": ["Bagumbayan", "Banadero", "Begajo Norte", "Begajo Sur", "Belen"]
        }
      },
      "Albay": {
        municipalities: {
          "Legazpi City": ["Bagacay", "Bigaa", "Bonga", "Bonot", "Buyuan"],
          "Tabaco City": ["Agnas", "Bantayan", "Baranghawon", "Basud", "Bogñabong"],
          "Ligao City": ["Asog", "Baligang", "Barayong", "Bigao", "Bololo"]
        }
      },
      "Sorsogon": {
        municipalities: {
          "Sorsogon City": ["Abuyog", "Anahao", "Bacon", "Balete", "Balogo"],
          "Bulusan": ["Bacolod", "Barcelona", "Begaso", "Bolos", "Buhang"],
          "Donsol": ["Abuyon", "Amoguis", "Banuang Gurang", "Banuang Daan", "Dancalan"]
        }
      },
      "Camarines Norte": {
        municipalities: {
          "Daet": ["Alawihao", "Awitan", "Bagasbas", "Barangay I", "Barangay II"],
          "Talisay": ["Aguit-It", "Bautista", "Binanuahan East", "Binanuahan West", "Buyo"]
        }
      }
    }
  },
  6: {
    name: "Region VI — Western Visayas",
    lat: 10.7, lng: 122.5,
    provinces: {
      "Iloilo": {
        municipalities: {
          "Iloilo City": ["Abeto Mirasol Taft South", "Aguinaldo", "Airport", "Arguelles", "Arsenal Aduana"],
          "Passi City": ["Agdahon", "Agsilab", "Ayuyan", "Bagumbayan", "Balabag"],
          "Oton": ["Baybay Norte", "Baybay Sur", "Botong", "Caboloan Norte", "Caboloan Sur"],
          "Pototan": ["Agbariran", "Agtabo", "Agusipan", "Ajuy", "Alacaygan"]
        }
      },
      "Negros Occidental": {
        municipalities: {
          "Bacolod City": ["Alangilan", "Alijis", "Banago", "Bata", "Cabug"],
          "Victorias City": ["Balaring", "Barangay I", "Barangay II", "Barangay III", "Barangay IV"],
          "Kabankalan City": ["Ayungon", "Bantayan", "Camansi", "Carolina", "Haba"],
          "Silay City": ["Bagtic", "Balintawak", "Binuangan", "Busilak", "E. R. Gustilo"]
        }
      },
      "Capiz": {
        municipalities: {
          "Roxas City": ["Adlawan", "Bago", "Balijuagan", "Banol", "Banica"],
          "Pontevedra": ["Agsirab", "Agustin", "Balucuan", "Banbanan", "Bato"]
        }
      },
      "Aklan": {
        municipalities: {
          "Kalibo": ["Andagao", "Barangay Andagao II", "Barangay I", "Barangay II", "Barangay III"],
          "Boracay / Malay": ["Barangay Manoc-Manoc", "Barangay Balabag", "Barangay Yapak", "Barangay Naasog", "Barangay Cagban"]
        }
      }
    }
  },
  7: {
    name: "Region VII — Central Visayas",
    lat: 10.3, lng: 123.9,
    provinces: {
      "Cebu": {
        municipalities: {
          "Cebu City": ["Adlaon", "Agsungot", "Apas", "Babag", "Bacayan"],
          "Mandaue City": ["Alang-Alang", "Bakilid", "Banilad", "Basak", "Cabancalan"],
          "Lapu-Lapu City": ["Agus", "Babag", "Bankal", "Baring", "Basak"],
          "Talisay City": ["Biasong", "Bulacao", "Cansojong", "Dumlog", "Jaclupan"],
          "Danao City": ["Abucayan", "Bayabas", "Binaliw", "Cabungahan", "Cagbuaya"]
        }
      },
      "Bohol": {
        municipalities: {
          "Tagbilaran City": ["Bool", "Booy", "Cogon", "Dampas", "Dao"],
          "Ubay": ["Achila", "Badiang", "Bahuyan", "Baletek", "Balili"],
          "Talibon": ["Bagacay", "Balintawak", "Burgos", "Calatagan", "Cahayag"]
        }
      },
      "Negros Oriental": {
        municipalities: {
          "Dumaguete City": ["Bagacay", "Bajumpandan", "Balugo", "Banilad", "Bantayan"],
          "Canlaon City": ["Bayog", "Cubcub", "Linothangan", "Lumapao", "Mailum"],
          "Bais City": ["Baras", "Biñohon", "Cabanlutan", "Calasga-an", "Cambagahan"]
        }
      },
      "Siquijor": {
        municipalities: {
          "Siquijor": ["Boho", "Caipilan", "Canasagan", "Candanay Norte", "Candanay Sur"],
          "Lazi": ["Campalanas", "Cangclaran", "Cansayang", "Caridad", "Lagtangon"]
        }
      }
    }
  },
  8: {
    name: "Region VIII — Eastern Visayas",
    lat: 11.2, lng: 124.9,
    provinces: {
      "Leyte": {
        municipalities: {
          "Tacloban City": ["Anibong", "Bagacay", "Baras-Baras", "Basper", "Buntay"],
          "Ormoc City": ["Alegria", "Alta Vista", "Bagong Buhay", "Bantigue", "Batuan"],
          "Baybay City": ["Amoyao", "Bato", "Binongto-an", "Bislig", "Bubon"]
        }
      },
      "Eastern Samar": {
        municipalities: {
          "Borongan City": ["Barangay 1", "Barangay 2", "Barangay 3", "Barangay 4", "Barangay 5"],
          "Guiuan": ["Ngolos", "Timala", "Campoyong", "Lugsongan", "Sulangan"]
        }
      },
      "Northern Samar": {
        municipalities: {
          "Catarman": ["Aportadera", "Bagumbayan", "Balowarte", "Barangay I", "Barangay II"],
          "Catubig": ["Alegria", "Bolodbolod", "Bugko", "Cabago", "Cagbabao"]
        }
      },
      "Samar": {
        municipalities: {
          "Catbalogan City": ["Albalate", "Awang", "Bagong Lungsod", "Bangon", "Barangay I"],
          "Calbayog City": ["Acedillo", "Bagacay", "Bayo", "Begaho", "Binongtu-an"]
        }
      }
    }
  },
  9: {
    name: "Region IX — Zamboanga Peninsula",
    lat: 7.8, lng: 123.0,
    provinces: {
      "Zamboanga del Norte": {
        municipalities: {
          "Dipolog City": ["Barra", "Biasong", "Cogon", "Dicayas", "Diwan"],
          "Dapitan City": ["Bagting", "Banbanan", "Banonong", "Barra", "Buenavista"],
          "Sindangan": ["Bacawan", "Bagong Silang", "Balok", "Bantayan", "Biao"]
        }
      },
      "Zamboanga del Sur": {
        municipalities: {
          "Pagadian City": ["Alegria", "Balangasan", "Balintawak", "Buenavista", "Bulatok"],
          "Molave": ["Balingasan", "Baluno", "Bayog", "Bulanit", "Dipolo"],
          "Zamboanga City": ["Arena Blanco", "Ayala", "Baliwasan", "Baluno", "Barreras"]
        }
      },
      "Zamboanga Sibugay": {
        municipalities: {
          "Ipil": ["Aurora", "Azpitia", "Baluran", "Bangkerohan", "Bayugo"],
          "Kabasalan": ["Balong-Balong", "Bucana Daku", "Bukid", "Caluma", "Candiis"]
        }
      }
    }
  },
  10: {
    name: "Region X — Northern Mindanao",
    lat: 8.5, lng: 124.6,
    provinces: {
      "Misamis Oriental": {
        municipalities: {
          "Cagayan de Oro City": ["Agusan", "Balubal", "Barangay 1", "Barangay 2", "Barangay 3", "Bayabas", "Bonbon", "Bugo", "Bulua", "Carmen", "Consolacion", "Canitoan", "Cugman", "Dansolihon", "El Salvador", "Gusa", "Indahag", "Iponan", "Kauswagan", "Lapasan", "Lumbia", "Macabalan", "Macasandig", "Mambuaya", "Nazareth", "Pagatpat", "Patag", "Puerto", "Puntod", "San Simon", "Taglimao", "Tignapoloan", "Tuburan"],
          "El Salvador City": ["Amoros", "Cogon", "Kalugmanan", "Langcao", "Molugan"],
          "Gingoog City": ["Agay-ayan", "Balingasag", "Bintana", "Blanco", "Bunacan"],
          "Jasaan": ["Aplaya", "Bobontugan", "Corrales", "Light of the Nations", "Luz Banzon"]
        }
      },
      "Bukidnon": {
        municipalities: {
          "Malaybalay City": ["Aglayan", "Bangcud", "Barangay 1", "Barangay 2", "Barangay 3", "Cabangahan", "Casisang", "Dalwangan", "Imbayao", "Kalasungay", "Laguitas", "Linabo", "Mambatangan", "Manalog", "Managok", "Mapayag", "Mapulo", "Muncon", "Patpat", "San Jose", "San Martin", "Santo Tomas", "Silae", "Simaya", "Sumpong", "Violeta"],
          "Valencia City": ["Bagontaas", "Banlag", "Barobo", "Batangan", "Catumbalon", "Colonia", "Concepcion", "Dagat-Kidaon", "Guinoyuran", "Hagkol", "Kahimunan", "Kalawaig", "Laligan", "Lilingayon", "Lumbayao", "Lumbo", "Malagos", "Managop", "Merangeran", "Nabago", "Piglawigan", "Pinamaloy", "Santo Rosario", "Sua", "Tongantongan"],
          "Impasugong": ["Alanib", "Dumalaguing", "Impalambong", "Kibangay", "Langaon", "Lupiagan", "Natulongan", "Patpat", "San Isidro", "Sayawan"]
        }
      },
      "Lanao del Norte": {
        municipalities: {
          "Iligan City": ["Abuno", "Acmac", "Bagong Silangan", "Buru-un", "Dalipuga", "Del Carmen", "Digkilaan", "Ditucalan", "Dulag", "Hinaplanon", "Hindang", "Kabacsanan", "Kalilangan", "Kiwalan", "Lanipao", "Luinab", "Mahayahay", "Mainit", "Mandulog", "Maria Cristina", "Pala-o", "Panoroganan", "Poblacion", "Puga-an", "Rogongon", "San Miguel", "San Roque", "Santa Elena", "Santa Filomena", "Santiago", "Saray", "Suayan", "Tambacan", "Tibanga", "Tipanoy", "Tominobo Lower", "Tominobo Upper", "Tubod", "Ubaldo Laya", "Upper Hinaplanon", "Villa Verde"]
        }
      },
      "Misamis Occidental": {
        municipalities: {
          "Oroquieta City": ["Apil", "Baybay", "Binuangan", "Bongbong", "Buruntay"],
          "Ozamiz City": ["Aguada", "Banadero", "Baybay", "Bongbong", "Calabayan"],
          "Tangub City": ["Antoon", "Aquino", "Bacolod", "Bagakay", "Balatacan"]
        }
      }
    }
  },
  11: {
    name: "Region XI — Davao Region",
    lat: 7.0, lng: 125.5,
    provinces: {
      "Davao del Sur": {
        municipalities: {
          "Davao City": ["Acacia", "Adam", "Agdao", "Alambre", "Alejandra Navarro", "Alfonso Angliongto Sr.", "Angalan", "Atan-Awe", "Baganihan", "Bago Aplaya", "Bago Gallera", "Bago Oshiro", "Baliok", "Bangkas Heights", "Baracatan", "Biao Escuela", "Biao Guianga", "Biao Joaquin", "Binugao", "Bocana", "Buda", "Bunawan", "Burol", "Cabantian", "Cadalian", "Calinan", "Callawa", "Catigan", "Catalunan Grande", "Catalunan Pequeño", "Communal", "Crossing Bayabas", "Dacudao", "Dalag", "Dalagdag", "Daliao", "Daliaon Plantation", "Datu Salumay", "Dominga", "Dumoy", "Eden", "Fatima", "Gatungan", "Gov. Paciano Bangoy", "Gov. Vicente Duterte", "Gumalang", "Gumitan", "Ilang", "Indangan", "Kap. Tomas Monteverde Sr.", "Kilate", "Lacson", "Lamanan", "Lampianao", "Langub", "Lapu-lapu", "Leon Garcia Sr.", "Lizada", "Los Amigos", "Lubogan", "Lumiad", "Ma-a", "Mabuhay", "Magsaysay", "Magtuod", "Mahayag", "Malabog", "Malagos", "Malamba", "Manambulan", "Mandug", "Manuel Guianga", "Mapula", "Marapangi", "Marilog", "Matina Aplaya", "Matina Crossing", "Matina Pangi", "Megkawayan", "Mintal", "Mudiang", "Mulig", "New Carmen", "New Valencia", "Pampanga", "Panacan", "Panacan 2", "Panalum", "Pandaitan", "Pangyan", "Paquibato", "Paradise Embak", "Rafael Castillo", "Riverside", "Salapawan", "Salaysay", "Saloy", "San Antonio", "San Isidro", "Santo Niño", "Sasa", "Sibulan", "Sirawan", "Sirib", "Subasta", "Sumimao", "Tacunan", "Tagurano", "Talandang", "Talomo", "Talomo River", "Tamayong", "Tambobong", "Tamugan", "Tapak", "Tawan-Tawan", "Tibuloy", "Tibungco", "Tigatto", "Toril", "Tugbok", "Tungkalan", "Ubalde", "Ulit", "Union", "Unitad", "Uyanguren", "Waan", "Wangan", "Wilfredo Aquino", "Wines"]
        }
      },
      "Davao de Oro": {
        municipalities: {
          "Nabunturan": ["Anislagan", "Anitapan", "Aurora", "Babag", "Binaton"],
          "Maco": ["Anibongan", "Arosip", "Elizalde", "Golden Valley", "Hijos"]
        }
      },
      "Davao del Norte": {
        municipalities: {
          "Tagum City": ["Apokon", "Bincungan", "Busaon", "Canocotan", "Cuambogan"],
          "Panabo City": ["A.O. Florentino", "Cagangohan", "Consolacion", "Dapco", "Gredu"]
        }
      }
    }
  },
  12: {
    name: "Region XII — SOCCSKSARGEN",
    lat: 6.7, lng: 124.9,
    provinces: {
      "South Cotabato": {
        municipalities: {
          "Koronadal City": ["Assumption", "Avanceña", "Calumpang", "Carpenter Hill", "Concepcion"],
          "General Santos City": ["Apopong", "Baluan", "Batomelong", "Buayan", "Bula"],
          "Polomolok": ["Bentung", "Cannery Site", "Kinilis", "Klinan 6", "Koronadal Proper"]
        }
      },
      "North Cotabato": {
        municipalities: {
          "Kidapawan City": ["Amas", "Arakan", "Balindog", "Benolho", "Besigan"],
          "Cotabato City": ["Bagua I", "Bagua II", "Bagua III", "Bagua IV", "Bagua V"],
          "Kabacan": ["Bannawag", "Buluan", "Cuyapon", "Dagupan", "Katidtuan"]
        }
      },
      "Sultan Kudarat": {
        municipalities: {
          "Tacurong City": ["Barangay I", "Barangay II", "Barangay III", "Barangay IV", "Griño"],
          "Isulan": ["Bambad", "Bual", "Dansuli", "Impao", "Kenram"]
        }
      },
      "Sarangani": {
        municipalities: {
          "Alabel": ["Alegria", "Baluntay", "Datal Anggas", "Domolok", "Kawas"],
          "Maasim": ["Kihan", "Kamanga", "Maitum", "Sapu Masla", "Tinoto"]
        }
      }
    }
  },
  13: {
    name: "Region XIII — Caraga",
    lat: 8.9, lng: 125.9,
    provinces: {
      "Agusan del Norte": {
        municipalities: {
          "Butuan City": ["Agao", "Bancasi", "Banza", "Buenavista", "Buhangin"],
          "Cabadbaran City": ["Calibunan", "Comagascas", "Del Pilar", "Katugasan", "Kinabutan"]
        }
      },
      "Surigao del Norte": {
        municipalities: {
          "Surigao City": ["Alegria", "Anao-on", "Balibayon", "Baybay", "Bilabid"],
          "Tandag City": ["Awasian", "Bago", "Bangcas A", "Bangcas B", "Bayabas"]
        }
      },
      "Surigao del Sur": {
        municipalities: {
          "Bislig City": ["Bagong Lungsod", "Bucto", "Burlon", "Cahayagan", "Coleto"],
          "Tandag City (Surigao del Sur)": ["Bato", "Bongtod", "Buenavista", "Dagocdoc", "Del Pilar"]
        }
      },
      "Agusan del Sur": {
        municipalities: {
          "Bayugan City": ["Barangay I", "Barangay II", "Barangay III", "Bayugan East", "Bayugan West"],
          "Prosperidad": ["Adgawan", "Afga", "Anahawan", "Anolingan", "Anottong"]
        }
      }
    }
  },
  14: {
    name: "NCR — National Capital Region",
    lat: 14.6, lng: 121.0,
    provinces: {
      "Metro Manila": {
        municipalities: {
          "Manila": ["Barangay 1", "Barangay 2", "Barangay 3", "Barangay 4", "Barangay 5", "Barangay 6", "Malate", "Paco", "Pandacan", "Port Area", "Quiapo", "Sampaloc", "San Andres", "San Miguel", "San Nicolas", "Santa Ana", "Santa Cruz", "Santa Mesa", "Tondo"],
          "Quezon City": ["Alicia", "Amihan", "Apolonio Samson", "Aurora", "Baesa", "Bagbag", "Bagong Ilog", "Bagong Lipunan ng Crame", "Bagong Pag-Asa", "Bagong Silangan", "Bahay Toro", "Balingasa", "Balintawak", "Banaba", "Batasan Hills", "Bayanihan", "Betterliving", "Blue Ridge A", "Blue Ridge B", "Bungad", "Claro", "Commonwealth", "Culiat", "Damayan", "Damayan Lagi", "Damar", "Don Manuel", "Doña Aurora", "Doña Imelda", "Doña Josefa", "Duyan-Duyan", "E. Rodriguez", "East Kamias", "Escopa I", "Escopa II", "Escopa III", "Escopa IV", "Fairview", "Holy Spirit", "Immaculate Concepcion", "Kaligayahan", "Kalusugan", "Kamuning", "Katipunan", "Kaunlaran", "Kristong Hari", "Krus na Ligas", "Laging Handa", "Libis", "Lourdes", "Loyola Heights", "Maharlika", "Malaya", "Mangga", "Manresa", "Mariana", "Matandang Balara", "Milagrosa", "New Era", "Novaliches Proper", "Obrero", "Old Capitol Site", "Paang Bundok", "Pag-Ibig sa Nayon", "Paligsahan", "Paltok", "Pansol", "Pasong Putik Proper", "Pasong Tamo", "Payatas", "Phil-Am", "Pinagkaisahan", "Pinyahan", "Project 6", "Project 7", "Project 8", "Quirino 2-A", "Quirino 2-B", "Quirino 2-C", "Quirino 3-A", "Roxas", "Sacred Heart", "Saint Ignatius", "Saint Peter", "Salvacion", "San Agustin", "San Antonio", "San Bartolome", "San Isidro Galas", "San Isidro Labrador", "San Jose", "San Martin de Porres", "San Roque", "Santa Cruz", "Santa Lucia", "Santa Monica", "Santa Teresita", "Santo Cristo", "Santo Domingo", "Santo Niño", "Santol", "Sauyo", "Sienna", "Silangan", "Socorro", "South Triangle", "Tagumpay", "Talayan", "Talipapa", "Tandang Sora", "Tatalon", "Teachers Village East", "Teachers Village West", "Ugong Norte", "Unang Sigaw", "UP Campus", "UP Village", "Valencia", "Vasra", "Veterans Village", "Villa Maria Clara", "West Kamias", "West Triangle", "White Plains"],
          "Makati": ["Bangkal", "Bel-Air", "Carmona", "Cembo", "Comembo", "Dasmariñas", "East Rembo", "Forbes Park", "Guadalupe Nuevo", "Guadalupe Viejo", "Kasilawan", "La Paz", "Magallanes", "Olympia", "Palanan", "Pembo", "Pinagkaisahan", "Pio del Pilar", "Pitogo", "Post Proper Northside", "Post Proper Southside", "Rizal", "Rockwell", "Singkamas", "South Cembo", "South Guadalupe", "Tejeros", "Urdaneta", "West Rembo"],
          "Pasig": ["Bagong Ilog", "Bagong Katipunan", "Bagumbayan", "Bagumpanahon", "Bambang", "Buting", "Caniogan", "Dela Paz", "Kalawaan", "Kapasigan", "Kapitolyo", "Malinao", "Manggahan", "Maybunga", "Oranbo", "Palatiw", "Pinagbuhatan", "Pineda", "Rosario", "Sagad", "San Antonio", "San Joaquin", "San Jose", "San Nicolas", "Santa Cruz", "Santa Lucia", "Santa Rosa", "Santo Tomas", "Santolan", "Sumilang", "Ugong"],
          "Pasay": ["Barangay 1", "Barangay 2", "Barangay 3", "Barangay 4", "Barangay 5", "Barangay 6", "Barangay 7", "Barangay 8", "Barangay 9", "Barangay 10", "Barangay 11", "Barangay 12", "Barangay 13", "Barangay 14", "Barangay 15", "Barangay 16", "Barangay 17", "Barangay 18", "Barangay 19", "Barangay 20", "Barangay 21", "Barangay 22", "Barangay 23", "Barangay 24", "Barangay 25", "Barangay 26", "Barangay 27", "Barangay 28", "Barangay 29", "Barangay 30", "Barangay 31", "Barangay 32", "Barangay 33", "Barangay 34", "Barangay 35", "Barangay 36", "Barangay 37", "Barangay 38", "Barangay 39", "Barangay 40", "Barangay 41", "Barangay 42", "Barangay 43", "Barangay 44", "Barangay 45", "Barangay 46", "Barangay 47", "Barangay 48", "Barangay 49", "Barangay 50", "Barangay 51", "Barangay 52", "Barangay 53", "Barangay 54", "Barangay 55", "Barangay 56", "Barangay 57", "Barangay 58", "Barangay 59", "Barangay 60", "Barangay 61", "Barangay 62", "Barangay 63", "Barangay 64", "Barangay 65", "Barangay 66", "Barangay 67", "Barangay 68", "Barangay 69", "Barangay 70", "Barangay 71", "Barangay 72", "Barangay 73", "Barangay 74", "Barangay 75", "Barangay 76", "Barangay 77", "Barangay 78", "Barangay 79", "Barangay 80", "Barangay 81", "Barangay 82", "Barangay 83", "Barangay 84", "Barangay 85", "Barangay 86", "Barangay 87", "Barangay 88", "Barangay 89", "Barangay 90", "Barangay 91", "Barangay 92", "Barangay 93", "Barangay 94", "Barangay 95", "Barangay 96", "Barangay 97", "Barangay 98", "Barangay 99", "Barangay 100", "Barangay 101", "Barangay 102", "Barangay 103", "Barangay 104", "Barangay 105", "Barangay 106", "Barangay 107", "Barangay 108", "Barangay 109", "Barangay 110", "Barangay 111", "Barangay 112", "Barangay 113", "Barangay 114", "Barangay 115", "Barangay 116", "Barangay 117", "Barangay 118", "Barangay 119", "Barangay 120", "Barangay 121", "Barangay 122", "Barangay 123", "Barangay 124", "Barangay 125", "Barangay 126", "Barangay 127", "Barangay 128", "Barangay 129", "Barangay 130", "Barangay 131", "Barangay 132", "Barangay 133", "Barangay 134", "Barangay 135", "Barangay 136", "Barangay 137", "Barangay 138", "Barangay 139", "Barangay 140", "Barangay 141", "Barangay 142", "Barangay 143", "Barangay 144", "Barangay 145", "Barangay 146", "Barangay 147", "Barangay 148", "Barangay 149", "Barangay 150", "Barangay 151", "Barangay 152", "Barangay 153", "Barangay 154", "Barangay 155", "Barangay 156", "Barangay 157", "Barangay 158", "Barangay 159", "Barangay 160", "Barangay 161", "Barangay 162", "Barangay 163", "Barangay 164", "Barangay 165", "Barangay 166", "Barangay 167", "Barangay 168", "Barangay 169", "Barangay 170", "Barangay 171", "Barangay 172", "Barangay 173", "Barangay 174", "Barangay 175", "Barangay 176", "Barangay 177", "Barangay 178", "Barangay 179", "Barangay 180", "Barangay 181", "Barangay 182", "Barangay 183", "Barangay 184", "Barangay 185", "Barangay 186", "Barangay 187", "Barangay 188", "Barangay 189", "Barangay 190", "Barangay 191", "Barangay 192", "Barangay 193", "Barangay 194", "Barangay 195", "Barangay 196", "Barangay 197", "Barangay 198", "Barangay 199", "Barangay 200"]
        }
      }
    }
  },
  15: {
    name: "CAR — Cordillera Administrative Region",
    lat: 17.4, lng: 121.2,
    provinces: {
      "Benguet": {
        municipalities: {
          "Baguio City": ["Abanao-Zandueta-Kayong-Chugum-Otek", "Alfonso Tabora", "Ambiong", "Andres Bonifacio", "Asin Road", "Aurora Hill Proper", "Bagong Lipunan ng Crame", "Bakakeng Norte", "Bakakeng Sur", "Balsigan", "Bancao-Bancao", "Bayan Park East", "Bayan Park Village", "Bayan Park West", "BGH Compound", "Campo Filipino", "City Camp Central", "City Camp Proper", "Country Club Village", "Dagsian, Lower", "Dagsian, Upper", "Dizon Subdivision", "Dominican Hill-Mirador", "Dontogan", "DPS Area", "Engineers Hill", "Fairview Village", "Fort del Pilar", "General Luna Road", "Gibraltar", "Greenwater Village", "Guisad Central", "Guisad Sorong", "Happy Hollow", "Happy Homes-Lucban", "Harrison Road", "Holy Ghost Extension", "Holy Ghost Proper", "Honeymoon (Honeymoon Road)", "IBB", "Imelda Marcos"],
          "La Trinidad": ["Alapay", "Balili", "Beckel", "Betag", "Bineng", "Cruz", "Lubas", "Pico", "Puguis", "Shilan", "Tawang", "Wangal"],
          "Itogon": ["Ampucao", "Dalupirip", "Gumatdang", "Loacan", "Poblacion", "Tinongdan", "Tuding", "Ucab", "Virac"]
        }
      },
      "Mountain Province": {
        municipalities: {
          "Bontoc": ["Alab Oriente", "Alab Proper", "Balili", "Bontoc Ilongot", "Caluttit", "Dalican", "Gonogon", "Guinaang", "Maligcong", "Mainit", "Poblacion", "Samoki", "Talubin", "Tucucan"],
          "Sagada": ["Aguid", "Antadao", "Balugan", "Bangaan", "Belbot", "Dagdag", "Demang", "Fidelisan", "Genugan", "Lake Danum", "Langtiw", "Latang", "Lufidan", "Madongo", "Nacagang", "Pide", "Pigsangdan", "Poblacion", "Suyo", "Taccong", "Tanulong", "Tetep-An"]
        }
      },
      "Ifugao": {
        municipalities: {
          "Lagawe": ["Boliwong", "Burnay", "Bitu", "Caba", "Camandag", "Hapao", "Ibung", "Mompolia", "Natal", "Pindongan", "Piwong", "Poblacion"],
          "Banaue": ["Amganad", "Anaba", "Batad", "Bocos", "Cambulo", "Ducligan", "Gohang", "Kinakin", "Ohaj", "Pula", "Tam-An", "View Point", "Poitan"]
        }
      },
      "Kalinga": {
        municipalities: {
          "Tabuk City": ["Bagumbayan", "Balawig", "Bulanao Norte", "Bulanao Sur", "Calaccad", "Casigayan", "Cudal", "Dagupan Centro", "Dagupan Weste", "Dupag", "Edades", "Gobgob", "Ipil", "Lucog", "Magnao", "Malagnat", "Malibu", "Malucsad", "Manuggal", "Pugong", "Tuga"]
        }
      }
    }
  },
  16: {
    name: "BARMM — Bangsamoro",
    lat: 6.5, lng: 124.2,
    provinces: {
      "Maguindanao del Norte": {
        municipalities: {
          "Cotabato City": ["Bagua I", "Bagua II", "Bagua III", "Bagua IV", "Bagua V", "Bagua VI", "Bagua VII", "Kalanganan I", "Kalanganan II", "Poblacion I", "Poblacion II", "Poblacion III", "Poblacion IV", "Poblacion V", "Poblacion VI", "Poblacion VII", "Poblacion VIII", "Poblacion IX"],
          "Parang": ["Calawag", "Damablac", "Ganasi", "Guiarong", "Kakar", "Liong", "Mompong", "Nabalawag", "Naupan", "Nuro", "Pagagawan", "Rebucon"]
        }
      },
      "Maguindanao del Sur": {
        municipalities: {
          "Buldon": ["Balibatuan", "Bitu", "Bugasan", "Daladap", "Guiawa", "Katidtuan", "Kilangan", "Lepak", "Lobo", "Lumbac", "Malagapao", "Mapandi", "Matanog", "Midpandacan", "Midsayap", "Paitan", "Pandi", "Rangayen", "Rangeban", "Rebucon", "Talayan", "Tamontaka", "Tumbao", "Upi"],
          "Shariff Aguak": ["Baguer", "Bialong", "Buayan", "Damalasak", "Dandaraan", "Gomabong", "Ibotegen", "Ilustre", "Karim", "Libungan", "Limpongo", "Madia", "Mangadeg", "Mao", "Marang", "Pagatin", "Penditen", "Pigcalagan", "Pigkawaran", "Pimbalakan", "Ramain", "Sarakan", "Semba", "Tagudua", "Tran", "Tubak", "Tugal"]
        }
      },
      "Lanao del Sur": {
        municipalities: {
          "Marawi City": ["Bacolod Chico Poblacion", "Bangon", "Basak Malutlut", "Bubong Madaya", "Bubonga Cadayonan", "Bubonga Lilod Madaya", "Bubonga Marinaut", "Bubonga Pagalamatan", "Cadayonan I", "Cadayonan II", "Calocan East", "Calocan West", "Camp Keithley", "Candidato", "Daguduban", "Dansalan", "Dulay", "East Basak", "Fort", "Gadongan", "Guimba", "Kapantaran", "Kilala", "Lilod Madaya", "Lilod Saduc", "Lomidong", "Lumbac Toros", "Lumbaca Madaya", "Lumbaca Toros", "Malimono", "Marinaut East", "Marinaut West", "Matampay", "Mipaga Proper", "Moncado Colony", "Moncado Kadingilan", "Moriatao-Lok Natangcopan", "Nawalwalan", "Papandayan", "Paridi", "Poblacion", "Polo", "Pugaan", "Rapasun MSU", "Raya Madaya I", "Raya Madaya II", "Raya Saduc", "Rorogagus East", "Rorogagus Proper", "Sabala Manao", "Saduc Proper", "Sagonsongan", "Sangkay", "South Madaya Proper", "Sugod Proper", "Tampilong", "Tuca", "Tucayo", "Tugaya", "Tuka", "Tumaguinting", "West Madaya Proper", "West Rorogagus"]
        }
      },
      "Basilan": {
        municipalities: {
          "Isabela City": ["Barangay I", "Barangay II", "Barangay III", "Barangay IV", "Barangay V", "Barangay VI", "Barangay VII", "Barangay VIII", "Barangay IX", "Barangay X", "Barangay XI", "Barangay XII"],
          "Lamitan City": ["Baungos", "Bohe-Languyan", "Bohelebung", "Boheyakan", "Bohe-Piang", "Bohe-Suyak", "Buawit", "Bud Bunga", "Bud Siden", "Bulingan", "Bunga", "Calang Canas", "Duga", "Gong", "Lahi", "Libug", "Limook", "Lumbaan Mahaba", "Lungan", "Malakit", "Marang", "Mebak", "Menzi", "Pisak-Pisak", "Rudang", "Semut", "Tabuk", "Tairan", "Tiom", "Tipo-Tipo", "Tuburan", "Tumahubong", "Tung-Bato"]
        }
      }
    }
  }
};

// Regional coordinates for map markers
const REGION_COORDS = {
  1: [17.5, 120.4], // Ilocos
  2: [17.6, 121.7], // Cagayan Valley
  3: [15.5, 120.9], // Central Luzon
  4: [14.1, 121.2], // CALABARZON
  5: [12.6, 121.0], // MIMAROPA
  6: [13.5, 123.3], // Bicol
  7: [10.7, 122.5], // Western Visayas
  8: [10.3, 123.9], // Central Visayas
  9: [11.2, 124.9], // Eastern Visayas
  10: [7.8, 123.0],  // Zamboanga Peninsula
  11: [8.5, 124.6],  // Northern Mindanao
  12: [7.0, 125.5],  // Davao Region
  13: [6.7, 124.9],  // SOCCSKSARGEN
  14: [8.9, 125.9],  // Caraga
  15: [17.4, 121.2], // CAR
  16: [6.5, 124.2]   // BARMM
};

// Approximate region boundaries for GPS matching
const REGION_BOUNDS = [
  { id: 1, lat: [15.5, 18.8], lng: [119.4, 121.2] },
  { id: 2, lat: [16.0, 18.8], lng: [121.0, 122.7] },
  { id: 3, lat: [14.4, 16.5], lng: [119.6, 121.5] },
  { id: 4, lat: [13.0, 14.8], lng: [120.4, 122.5] },
  { id: 5, lat: [8.2, 13.8], lng: [117.0, 122.3] },
  { id: 6, lat: [12.0, 14.5], lng: [122.5, 124.5] },
  { id: 7, lat: [9.5, 11.8], lng: [121.5, 123.3] },
  { id: 8, lat: [9.0, 11.3], lng: [123.0, 124.5] },
  { id: 9, lat: [10.0, 12.7], lng: [124.0, 126.0] },
  { id: 10, lat: [6.8, 8.8], lng: [121.5, 123.6] },
  { id: 11, lat: [7.5, 9.5], lng: [123.5, 125.6] },
  { id: 12, lat: [5.8, 7.8], lng: [125.0, 126.6] },
  { id: 13, lat: [6.0, 7.5], lng: [124.0, 125.5] },
  { id: 14, lat: [8.0, 10.5], lng: [125.2, 126.4] },
  { id: 15, lat: [16.0, 18.5], lng: [120.5, 121.8] },
  { id: 16, lat: [5.0, 8.0], lng: [119.8, 125.5] }
];
/* ════════════════════════════════════════
   PAL-AI REGION NUMBERING FIX
   Corrects mapping:
   5 = MIMAROPA
   6 = Bicol
   7 = Western Visayas
   8 = Central Visayas
   9 = Eastern Visayas
   10 = Zamboanga Peninsula
   11 = Northern Mindanao
   12 = Davao Region
   13 = SOCCSKSARGEN
   14 = Caraga
   15 = CAR
   16 = BARMM
   ════════════════════════════════════════ */

(function fixRegionNumbering() {
  const oldGeo = { ...PH_GEO };

  const MIMAROPA_GEO = {
    name: "Region IV-B — MIMAROPA",
    lat: 12.6,
    lng: 121.0,
    provinces: {
      "Occidental Mindoro": {
        municipalities: {
          "Mamburao": ["Balansay", "Fatima", "Payompon", "Poblacion 1", "Poblacion 2"],
          "San Jose": ["Ambulong", "Bagong Sikat", "Bubog", "Central", "Labangan"],
          "Sablayan": ["Buenavista", "Burgos", "Claudio Salgado", "General Emilio Aguinaldo", "Poblacion"]
        }
      },
      "Oriental Mindoro": {
        municipalities: {
          "Calapan City": ["Balite", "Baruyan", "Bayanan I", "Bayanan II", "Biga"],
          "Pinamalayan": ["Anoling", "Bacungan", "Bangbang", "Del Razon", "Marfrancisco"],
          "Roxas": ["Bagumbayan", "Cantil", "Dangay", "Happy Valley", "San Aquilino"]
        }
      },
      "Palawan": {
        municipalities: {
          "Puerto Princesa City": ["Bancao-Bancao", "Irawan", "Mandaragat", "San Jose", "San Manuel"],
          "Aborlan": ["Apurawan", "Barake", "Culandanum", "Gogognan", "Poblacion"],
          "Narra": ["Antipuluan", "Aramaywan", "Bato-Bato", "Dumagueña", "Poblacion"]
        }
      },
      "Marinduque": {
        municipalities: {
          "Boac": ["Agot", "Bantad", "Bantay", "Bunganay", "Caganhao"],
          "Mogpog": ["Anapog-Sibucao", "Balanacan", "Banto", "Bintakay", "Capayang"]
        }
      },
      "Romblon": {
        municipalities: {
          "Romblon": ["Agbaluto", "Agbudia", "Agnaga", "Agpanabat", "Agtongo"],
          "Odiongan": ["Amatong", "Anahao", "Bangon", "Bato", "Budiong"]
        }
      }
    }
  };

  PH_GEO[5] = MIMAROPA_GEO;
  PH_GEO[6] = oldGeo[5];   // old Bicol
  PH_GEO[7] = oldGeo[6];   // old Western Visayas
  PH_GEO[8] = oldGeo[7];   // old Central Visayas
  PH_GEO[9] = oldGeo[8];   // old Eastern Visayas
  PH_GEO[10] = oldGeo[9];  // old Zamboanga Peninsula
  PH_GEO[11] = oldGeo[10]; // old Northern Mindanao
  PH_GEO[12] = oldGeo[11]; // old Davao Region
  PH_GEO[13] = oldGeo[12]; // old SOCCSKSARGEN
  PH_GEO[14] = oldGeo[13]; // old Caraga
  PH_GEO[15] = oldGeo[15]; // CAR
  PH_GEO[16] = oldGeo[16]; // BARMM

  PH_GEO[6].name = "Region V — Bicol Region";
  PH_GEO[7].name = "Region VI — Western Visayas";
  PH_GEO[8].name = "Region VII — Central Visayas";
  PH_GEO[9].name = "Region VIII — Eastern Visayas";
  PH_GEO[10].name = "Region IX — Zamboanga Peninsula";
  PH_GEO[11].name = "Region X — Northern Mindanao";
  PH_GEO[12].name = "Region XI — Davao Region";
  PH_GEO[13].name = "Region XII — SOCCSKSARGEN";
  PH_GEO[14].name = "Region XIII — Caraga";

  // Remove old NCR data from usable geo object.
  delete PH_GEO.NCR;
})();