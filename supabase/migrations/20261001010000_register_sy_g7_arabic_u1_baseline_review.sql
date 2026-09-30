-- Register Mohammad Grade 7 Arabic Unit 1 baseline/review package — 2026-10-01.
-- Operational academic content only: no platform behavior change.
-- Phase 1: Learning 20 questions (Set 1 = 10, Set 2 = 10) + Exam 20 distinct questions.
-- Source: AR-LUGATI-G7-T1, Syrian curriculum, Unit 1 PDF 5–34.
do $migration$
declare
  v_workspace uuid;
  v_curriculum uuid;
  v_arabic bigint;
  v_program uuid;
  v_program_subject uuid;
  v_book uuid;
  v_unit uuid;
  v_quiz uuid;
  v_version uuid;
  v_question uuid;
  v_concept uuid;
  v_item jsonb;
  v_option text;
  v_hint jsonb;
  v_i integer;
  v_items jsonb := $json$
[
  {
    "code": "MOH-AR7-U1-BL-20261001-L01",
    "pos": 1,
    "role": "core",
    "learning_set": 1,
    "page_start": 6,
    "page_end": 6,
    "concept": "sy-g7-ar-u1-flag-reading",
    "prompt": "وردت في مفردات «عَلَمُ بلادي» كلمة «العَبَق». ما معناها؟",
    "origin": "BOOK_DERIVED",
    "difficulty": 1,
    "source_ref": "AR-LUGATI-G7-T1-P006",
    "opts": [
      "الرائحة الطيبة",
      "الصوت المرتفع",
      "الطريق الطويل",
      "اللون الداكن"
    ],
    "correct": 1,
    "explain": "الإجابة الأنسب هي «الرائحة الطيبة»؛ فهي توافق معنى العبارة أو المفردة في النص ضمن هذا السياق.",
    "hints": [
      {
        "level": 1,
        "role": "nudge",
        "decomposable": false,
        "content": "تذكّر أن الكلمة جاءت في سياق وصف جميل ومحبّب."
      },
      {
        "level": 2,
        "role": "guide",
        "decomposable": false,
        "content": "ابحث عن معنى يرتبط بحاسة الشم لا السمع أو النظر."
      },
      {
        "level": 3,
        "role": "strong_guide",
        "decomposable": false,
        "content": "استبعد المعاني التي تصف صوتًا أو لونًا أو مكانًا؛ المطلوب وصف رائحة محببة."
      },
      {
        "level": 4,
        "role": "near_solution",
        "decomposable": false,
        "content": "اختر المعنى الذي يصف أثرًا عطريًا حسنًا دون أن يكون شيئًا مرئيًا."
      }
    ]
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-L02",
    "pos": 2,
    "role": "core",
    "learning_set": 1,
    "page_start": 12,
    "page_end": 12,
    "concept": "sy-g7-ar-u1-cooperation-reading",
    "prompt": "في البيت «فحضارةُ الإنسانِ فيضُ تعاونٍ بين الجميعِ على مدى السنوات»، ما العلاقة التي يقررها الشاعر؟",
    "origin": "BOOK_DERIVED",
    "difficulty": 1,
    "source_ref": "AR-LUGATI-G7-T1-P012",
    "opts": [
      "تقدّم المجتمع ثمرة تعاون أفراده",
      "الحضارة تقوم على عمل فرد واحد",
      "التعاون يمنع تطور المجتمع",
      "السنوات وحدها تصنع الحضارة"
    ],
    "correct": 1,
    "explain": "الإجابة الأنسب هي «تقدّم المجتمع ثمرة تعاون أفراده»؛ فهي توافق معنى العبارة أو المفردة في النص ضمن هذا السياق.",
    "hints": [
      {
        "level": 1,
        "role": "nudge",
        "decomposable": false,
        "content": "حدّد الكلمتين المحوريتين في البيت: الحضارة والتعاون."
      },
      {
        "level": 2,
        "role": "guide",
        "decomposable": false,
        "content": "اسأل: أيهما جعله الشاعر سببًا أو مصدرًا للآخر؟"
      },
      {
        "level": 3,
        "role": "strong_guide",
        "decomposable": false,
        "content": "كلمة «فيض» توحي بأن ما بعدها مصدر لما قبلها، فابحث عن علاقة السبب بالنتيجة."
      },
      {
        "level": 4,
        "role": "near_solution",
        "decomposable": false,
        "content": "اختر العبارة التي تجعل العمل المشترك بين الناس أساسًا لتقدّم المجتمع."
      }
    ]
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-L03",
    "pos": 3,
    "role": "core",
    "learning_set": 1,
    "page_start": 15,
    "page_end": 15,
    "concept": "sy-g7-ar-u1-sahih-mutal",
    "prompt": "الفعل «بَنى» من حيث موقع حرف العلة هو:",
    "origin": "GENERATED_SIMILAR",
    "difficulty": 1,
    "source_ref": "AR-LUGATI-G7-T1-P015",
    "opts": [
      "معتل ناقص",
      "معتل مثال",
      "معتل أجوف",
      "صحيح سالم"
    ],
    "correct": 1,
    "explain": "الإجابة الصحيحة هي «معتل ناقص»؛ ويُحدَّد النوع من وجود حرف العلة وموضعه أو من بنية الفعل الصحيح.",
    "hints": [
      {
        "level": 1,
        "role": "nudge",
        "decomposable": false,
        "content": "حدّد مكان حرف العلة في أصل الفعل."
      },
      {
        "level": 2,
        "role": "guide",
        "decomposable": false,
        "content": "أنواع المعتل تسمّى بحسب وقوع حرف العلة في الأول أو الوسط أو الآخر."
      },
      {
        "level": 3,
        "role": "strong_guide",
        "decomposable": false,
        "content": "الفعل هنا ينتهي بحرف علة، فلا تبحث عن النوع المرتبط ببداية الفعل أو وسطه."
      },
      {
        "level": 4,
        "role": "near_solution",
        "decomposable": false,
        "content": "اختر اسم النوع الذي يكون حرف العلة في آخر الفعل، بعد أن استبعدت الصحيح تمامًا."
      }
    ]
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-L04",
    "pos": 4,
    "role": "core",
    "learning_set": 1,
    "page_start": 29,
    "page_end": 29,
    "concept": "sy-g7-ar-u1-alif-layyina",
    "prompt": "الاسم الثلاثي «مُنى» تنتهي ألفه اللينة بصورة «ى». ما السبب؟",
    "origin": "BOOK_DERIVED",
    "difficulty": 1,
    "source_ref": "AR-LUGATI-G7-T1-P029",
    "opts": [
      "لأن أصل الألف ياء",
      "لأن أصل الألف واو",
      "لأن الكلمة أكثر من ثلاثة أحرف",
      "لأن الألف سبقتها ياء"
    ],
    "correct": 1,
    "explain": "الإجابة الصحيحة هي «لأن أصل الألف ياء»؛ وفق قاعدة رسم الألف اللينة وأصلها أو موقعها في الكلمة.",
    "hints": [
      {
        "level": 1,
        "role": "nudge",
        "decomposable": false,
        "content": "ابدأ بتحديد أن الكلمة اسم ثلاثي، لا كلمة فوق ثلاثة أحرف."
      },
      {
        "level": 2,
        "role": "guide",
        "decomposable": false,
        "content": "في الاسم الثلاثي يعتمد رسم الألف الأخيرة على أصلها: واو أم ياء."
      },
      {
        "level": 3,
        "role": "strong_guide",
        "decomposable": false,
        "content": "يمكن كشف الأصل برد الجمع إلى مفرده أو بتثنية الاسم؛ ركّز على الحرف الذي يظهر في الصيغة الأخرى."
      },
      {
        "level": 4,
        "role": "near_solution",
        "decomposable": false,
        "content": "اختر السبب الذي يوافق رسم الألف مقصورة في الاسم الثلاثي وفق قاعدة الأصل."
      }
    ]
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-L05",
    "pos": 5,
    "role": "core",
    "learning_set": 1,
    "page_start": 6,
    "page_end": 6,
    "concept": "sy-g7-ar-u1-flag-reading",
    "prompt": "في قول الشاعر «أنتَ في ذمّةِ أوفى الناس»، ما معنى «ذمّة»؟",
    "origin": "BOOK_DERIVED",
    "difficulty": 2,
    "source_ref": "AR-LUGATI-G7-T1-P006",
    "opts": [
      "عهد وأمان",
      "خصومة",
      "مسافة",
      "حيرة"
    ],
    "correct": 1,
    "explain": "الإجابة الأنسب هي «عهد وأمان»؛ فهي توافق معنى العبارة أو المفردة في النص ضمن هذا السياق.",
    "hints": [
      {
        "level": 1,
        "role": "nudge",
        "decomposable": false,
        "content": "استفد من وصف الناس بالوفاء."
      },
      {
        "level": 2,
        "role": "guide",
        "decomposable": false,
        "content": "الكلمة تدل على علاقة فيها التزام وحفظ ورعاية."
      },
      {
        "level": 3,
        "role": "strong_guide",
        "decomposable": false,
        "content": "استبعد المعاني التي تدل على نزاع أو بعد أو تردد."
      },
      {
        "level": 4,
        "role": "near_solution",
        "decomposable": false,
        "content": "اختر المعنى الذي يجمع الالتزام بالحفظ والوفاء."
      }
    ]
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-L06",
    "pos": 6,
    "role": "core",
    "learning_set": 1,
    "page_start": 9,
    "page_end": 9,
    "concept": "sy-g7-ar-u1-mujarrad-mazid",
    "prompt": "أيُّ زوجٍ يوضح فعلًا رباعيًا مجردًا ثم الفعل المزيد المشتق منه؟",
    "origin": "BOOK_DERIVED",
    "difficulty": 2,
    "source_ref": "AR-LUGATI-G7-T1-P009",
    "opts": [
      "طمأنَ — تطمأنَ",
      "كتبَ — قرأَ",
      "قالَ — باعَ",
      "سعى — رمى"
    ],
    "correct": 1,
    "explain": "الإجابة الصحيحة هي «طمأنَ — تطمأنَ»؛ بتحديد الحروف الأصلية ثم ملاحظة حروف الزيادة.",
    "hints": [
      {
        "level": 1,
        "role": "nudge",
        "decomposable": false,
        "content": "ابحث أولًا عن فعل أساس حروفه الأربعة أصلية."
      },
      {
        "level": 2,
        "role": "guide",
        "decomposable": false,
        "content": "الفعل الثاني في الزوج الصحيح يجب أن يحتفظ بحروف الأساس ويضيف إليها حرفًا."
      },
      {
        "level": 3,
        "role": "strong_guide",
        "decomposable": false,
        "content": "قارن كل زوج: هل الثاني مشتق من الأول بإضافة واضحة مع بقاء أصل الفعل؟"
      },
      {
        "level": 4,
        "role": "near_solution",
        "decomposable": false,
        "content": "اختر الزوج الذي يظهر فيه فعل رباعي أصلي ثم صيغة زيدت عليها تاء."
      }
    ]
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-L07",
    "pos": 7,
    "role": "core",
    "learning_set": 1,
    "page_start": 9,
    "page_end": 9,
    "concept": "sy-g7-ar-u1-mujarrad-mazid",
    "prompt": "أيُّ تعريفٍ يصف الفعل المزيد؟",
    "origin": "BOOK_DERIVED",
    "difficulty": 2,
    "source_ref": "AR-LUGATI-G7-T1-P009",
    "opts": [
      "ما زيد على حروفه الأصلية حرف أو أكثر",
      "ما كانت جميع حروفه أصلية دائمًا",
      "ما كان رباعيًا فقط",
      "ما انتهى بحرف علة"
    ],
    "correct": 1,
    "explain": "الإجابة الصحيحة هي «ما زيد على حروفه الأصلية حرف أو أكثر»؛ بتحديد الحروف الأصلية ثم ملاحظة حروف الزيادة.",
    "hints": [
      {
        "level": 1,
        "role": "nudge",
        "decomposable": false,
        "content": "قارن بين معنى «مجرّد» ومعنى «مزيد»."
      },
      {
        "level": 2,
        "role": "guide",
        "decomposable": false,
        "content": "السؤال يتعلق بما يحدث للحروف الأصلية عند بناء صيغة جديدة."
      },
      {
        "level": 3,
        "role": "strong_guide",
        "decomposable": false,
        "content": "لا تربط الزيادة بعدد ثابت من الحروف أو بحرف العلة؛ ركّز على إضافة شيء إلى الأصل."
      },
      {
        "level": 4,
        "role": "near_solution",
        "decomposable": false,
        "content": "اختر التعريف الذي يذكر وجود حرف زائد واحد أو أكثر فوق الحروف الأصلية."
      }
    ]
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-L08",
    "pos": 8,
    "role": "core",
    "learning_set": 1,
    "page_start": 13,
    "page_end": 13,
    "concept": "sy-g7-ar-u1-cooperation-reading",
    "prompt": "في البيت «فأنا وأنتَ وكلُّ فردٍ بيننا جزءٌ يُتمِّمُ لوحةَ النحّاتِ»، ما المعنى الذي يؤكده الشاعر؟",
    "origin": "BOOK_DERIVED",
    "difficulty": 2,
    "source_ref": "AR-LUGATI-G7-T1-P013",
    "opts": [
      "لكل فرد دورٌ يُكمل عمل الجماعة",
      "يكفي فردٌ واحد لإنجاز كل الأعمال",
      "يجب أن يعمل كل شخص بعيدًا عن الآخرين",
      "لا قيمة لاختلاف الأدوار بين الناس"
    ],
    "correct": 1,
    "explain": "الإجابة الأنسب هي «لكل فرد دورٌ يُكمل عمل الجماعة»؛ فهي توافق معنى العبارة أو المفردة في النص ضمن هذا السياق.",
    "hints": [
      {
        "level": 1,
        "role": "nudge",
        "decomposable": false,
        "content": "ركّز على العلاقة بين «الجزء» و«اللوحة»."
      },
      {
        "level": 2,
        "role": "guide",
        "decomposable": false,
        "content": "اللوحة تكتمل من أجزاء متعددة، والبيت يشبّه أفراد المجتمع بهذه الأجزاء."
      },
      {
        "level": 3,
        "role": "strong_guide",
        "decomposable": false,
        "content": "فكّر في جماعة يعمل أفرادها بأدوار مختلفة؛ قيمة كل دور تظهر حين يساهم في اكتمال العمل المشترك."
      },
      {
        "level": 4,
        "role": "near_solution",
        "decomposable": false,
        "content": "استبعد ما يدعو إلى الانفراد أو يلغي اختلاف الأدوار، واختر المعنى الذي يجمع بين مساهمة الفرد واكتمال عمل الجماعة."
      }
    ]
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-L09",
    "pos": 9,
    "role": "core",
    "learning_set": 1,
    "page_start": 12,
    "page_end": 12,
    "concept": "sy-g7-ar-u1-cooperation-reading",
    "prompt": "قال الشاعر: «والناسُ بحرٌ زاخرُ الموجات». ما الصورة التي قدّمها؟",
    "origin": "BOOK_DERIVED",
    "difficulty": 2,
    "source_ref": "AR-LUGATI-G7-T1-P012",
    "opts": [
      "شبّه الناس ببحر ممتلئ بالموج",
      "شبّه البحر بإنسان يتكلم",
      "شبّه الموج بالزهور",
      "وصف عدد الناس بحساب رياضي"
    ],
    "correct": 1,
    "explain": "الإجابة الأنسب هي «شبّه الناس ببحر ممتلئ بالموج»؛ فهي توافق معنى العبارة أو المفردة في النص ضمن هذا السياق.",
    "hints": [
      {
        "level": 1,
        "role": "nudge",
        "decomposable": false,
        "content": "لاحظ طرفي الصورة: الناس والبحر."
      },
      {
        "level": 2,
        "role": "guide",
        "decomposable": false,
        "content": "اسأل نفسك: ما الشيء الذي جُعل شبيهًا بشيء آخر؟"
      },
      {
        "level": 3,
        "role": "strong_guide",
        "decomposable": false,
        "content": "العبارة تنقل صفة الامتلاء والحركة من مشهد البحر إلى جماعة الناس."
      },
      {
        "level": 4,
        "role": "near_solution",
        "decomposable": false,
        "content": "اختر الوصف الذي يذكر التشبيه بين الناس والبحر مباشرة."
      }
    ]
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-L10",
    "pos": 10,
    "role": "core",
    "learning_set": 1,
    "page_start": 16,
    "page_end": 16,
    "concept": "sy-g7-ar-u1-sahih-mutal",
    "prompt": "الفعل «وَقَفَ» من حيث موقع حرف العلة هو:",
    "origin": "BOOK_DERIVED",
    "difficulty": 2,
    "source_ref": "AR-LUGATI-G7-T1-P016",
    "opts": [
      "معتل مثال",
      "معتل أجوف",
      "معتل ناقص",
      "صحيح مضعّف"
    ],
    "correct": 1,
    "explain": "الإجابة الصحيحة هي «معتل مثال»؛ ويُحدَّد النوع من وجود حرف العلة وموضعه أو من بنية الفعل الصحيح.",
    "hints": [
      {
        "level": 1,
        "role": "nudge",
        "decomposable": false,
        "content": "لاحظ أول حرف أصلي في الفعل."
      },
      {
        "level": 2,
        "role": "guide",
        "decomposable": false,
        "content": "إذا كان حرف العلة في أول الفعل فله اسم يختلف عن وجوده في الوسط أو الآخر."
      },
      {
        "level": 3,
        "role": "strong_guide",
        "decomposable": false,
        "content": "هنا الواو في البداية، لذلك استبعد الأجوف والناقص، كما أن الفعل ليس مضعفًا."
      },
      {
        "level": 4,
        "role": "near_solution",
        "decomposable": false,
        "content": "اختر اسم النوع الذي يطلق على المعتل إذا جاء حرف العلة في أوله."
      }
    ]
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-L11",
    "pos": 11,
    "role": "core",
    "learning_set": 2,
    "page_start": 16,
    "page_end": 16,
    "concept": "sy-g7-ar-u1-sahih-mutal",
    "prompt": "أيُّ وصفٍ صحيحٌ للفعل «قَرَأَ»؟",
    "origin": "GENERATED_SIMILAR",
    "difficulty": 2,
    "source_ref": "AR-LUGATI-G7-T1-P016",
    "opts": [
      "صحيح مهموز",
      "صحيح مضعّف",
      "معتل أجوف",
      "معتل ناقص"
    ],
    "correct": 1,
    "explain": "الإجابة الصحيحة هي «صحيح مهموز»؛ ويُحدَّد النوع من وجود حرف العلة وموضعه أو من بنية الفعل الصحيح.",
    "hints": [
      {
        "level": 1,
        "role": "nudge",
        "decomposable": false,
        "content": "افحص الحروف الأصلية وابحث عن همزة أو حرف علة أو تضعيف."
      },
      {
        "level": 2,
        "role": "guide",
        "decomposable": false,
        "content": "وجود الهمزة لا يجعل الفعل معتلاً؛ فهي تحدد نوعًا من أنواع الفعل الصحيح."
      },
      {
        "level": 3,
        "role": "strong_guide",
        "decomposable": false,
        "content": "الفعل ليس فيه حرف علة أصلي ولا حرف مضعف، لكنه يتضمن همزة أصلية."
      },
      {
        "level": 4,
        "role": "near_solution",
        "decomposable": false,
        "content": "اختر نوع الفعل الصحيح الذي يكون أحد حروفه الأصلية همزة."
      }
    ]
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-L12",
    "pos": 12,
    "role": "core",
    "learning_set": 2,
    "page_start": 19,
    "page_end": 19,
    "concept": "sy-g7-ar-u1-ya-sham",
    "prompt": "في مفردات «يا شام» ما معنى «الطَّيف»؟",
    "origin": "BOOK_DERIVED",
    "difficulty": 2,
    "source_ref": "AR-LUGATI-G7-T1-P019",
    "opts": [
      "الخيال",
      "السفر",
      "الطبيب",
      "الاجتماع"
    ],
    "correct": 1,
    "explain": "الإجابة الأنسب هي «الخيال»؛ فهي توافق معنى العبارة أو المفردة في النص ضمن هذا السياق.",
    "hints": [
      {
        "level": 1,
        "role": "nudge",
        "decomposable": false,
        "content": "فكّر في الشيء الذي قد يزور الإنسان في الذاكرة أو الحلم."
      },
      {
        "level": 2,
        "role": "guide",
        "decomposable": false,
        "content": "الكلمة مرتبطة بصورة ذهنية يمكن أن تحضر في الذاكرة أو الحلم، وليست شخصًا أو حركةً مادية."
      },
      {
        "level": 3,
        "role": "strong_guide",
        "decomposable": false,
        "content": "استبعد معاني المهنة والسفر والاجتماع، وفكّر في صورة غير مادية يستحضرها الذهن عند تذكّر شخص أو مكان."
      },
      {
        "level": 4,
        "role": "near_solution",
        "decomposable": false,
        "content": "المطلوب اسمٌ لما يتمثل للإنسان في ذهنه كصورة غير مادية، خصوصًا حين يستحضر مكانًا أو شخصًا في ذاكرته."
      }
    ]
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-L13",
    "pos": 13,
    "role": "core",
    "learning_set": 2,
    "page_start": 19,
    "page_end": 19,
    "concept": "sy-g7-ar-u1-ya-sham",
    "prompt": "في مطلع «يا شام» يقول الشاعر للمغترب: «حيّاكِ مغربٌ يا شامُ حيّيهِ، لا تتركيهِ يقاسي ما يقاسيهِ». ماذا يطلب الشاعر من الشام؟",
    "origin": "BOOK_DERIVED",
    "difficulty": 2,
    "source_ref": "AR-LUGATI-G7-T1-P019",
    "opts": [
      "أن تستقبل المغترب وتخفف عنه معاناة الغربة",
      "أن تدفعه إلى نسيان وطنه",
      "أن تمنعه من العودة إليها",
      "أن تطلب منه السفر إلى بلد آخر"
    ],
    "correct": 1,
    "explain": "الإجابة الأنسب هي «أن تستقبل المغترب وتخفف عنه معاناة الغربة»؛ فهي توافق معنى العبارة أو المفردة في النص ضمن هذا السياق.",
    "hints": [
      {
        "level": 1,
        "role": "nudge",
        "decomposable": false,
        "content": "حدّد المخاطَب في العبارة وما الفعل المطلوب منه."
      },
      {
        "level": 2,
        "role": "guide",
        "decomposable": false,
        "content": "كلمة «حيّيه» تحمل معنى الاستقبال والتقريب، و«لا تتركيه يقاسي» تشير إلى إزالة ألم."
      },
      {
        "level": 3,
        "role": "strong_guide",
        "decomposable": false,
        "content": "اجمع دلالة «حيّيه» مع دلالة «لا تتركيه يقاسي»: الأولى ترحيب وقرب، والثانية طلب تخفيف المعاناة التي يعيشها المغترب."
      },
      {
        "level": 4,
        "role": "near_solution",
        "decomposable": false,
        "content": "اختر العبارة التي تجمع الترحيب بالمغترب والتخفيف من ألم الغربة، لا النسيان أو الإبعاد."
      }
    ]
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-L14",
    "pos": 14,
    "role": "core",
    "learning_set": 2,
    "page_start": 22,
    "page_end": 22,
    "concept": "sy-g7-ar-u1-mizan-sarfi",
    "prompt": "في الميزان الصرفي للفعل الثلاثي المجرّد «فَعَلَ»، ماذا يُسمّى الحرف الثاني؟",
    "origin": "BOOK_DERIVED",
    "difficulty": 2,
    "source_ref": "AR-LUGATI-G7-T1-P022",
    "opts": [
      "فاء الفعل",
      "عين الفعل",
      "لام الفعل",
      "حرف الزيادة"
    ],
    "correct": 2,
    "explain": "الإجابة الصحيحة هي «عين الفعل»؛ لأن الوزن يحافظ على ترتيب الحروف الأصلية وما يطرأ عليها من زيادة.",
    "hints": [
      {
        "level": 1,
        "role": "nudge",
        "decomposable": false,
        "content": "تذكّر أن حروف الميزان الثلاثة تقابل ترتيب حروف الفعل."
      },
      {
        "level": 2,
        "role": "guide",
        "decomposable": false,
        "content": "الحرف الأول له اسم، والثاني له اسم آخر، والثالث له اسم ثالث."
      },
      {
        "level": 3,
        "role": "strong_guide",
        "decomposable": false,
        "content": "رتّب: الأول يقابل الفاء، والثالث يقابل اللام؛ فما الذي يبقى للثاني؟"
      },
      {
        "level": 4,
        "role": "near_solution",
        "decomposable": false,
        "content": "بعد ترتيب حروف الميزان «ف ع ل»، حدّد الاسم المقابل للحرف الواقع بين الأول والثالث، ثم اختره من البدائل."
      }
    ]
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-L15",
    "pos": 15,
    "role": "core",
    "learning_set": 2,
    "page_start": 26,
    "page_end": 26,
    "concept": "sy-g7-ar-u1-shaer-watan",
    "prompt": "قال نزار قباني إن الطلاب كانوا «أعظم سفرائي». ما المعنى الأقرب؟",
    "origin": "BOOK_DERIVED",
    "difficulty": 2,
    "source_ref": "AR-LUGATI-G7-T1-P026",
    "opts": [
      "كان الطلاب يحملون شعره ويحفظونه وينشرون أثره",
      "كان الطلاب يعملون في السفارات الرسمية",
      "كان الطلاب يمنعونه من كتابة الشعر",
      "كان يقصد السفر خارج سورية فقط"
    ],
    "correct": 1,
    "explain": "الإجابة الأنسب هي «كان الطلاب يحملون شعره ويحفظونه وينشرون أثره»؛ فهي توافق معنى العبارة أو المفردة في النص ضمن هذا السياق.",
    "hints": [
      {
        "level": 1,
        "role": "nudge",
        "decomposable": false,
        "content": "انتبه إلى أن العبارة مجازية وليست وظيفة رسمية."
      },
      {
        "level": 2,
        "role": "guide",
        "decomposable": false,
        "content": "اقرأ ما بعدها: الطلاب طبعوا القصائد في ذاكرتهم ونقشوها في مشاعرهم."
      },
      {
        "level": 3,
        "role": "strong_guide",
        "decomposable": false,
        "content": "السفير هنا من يحمل الأثر إلى الآخرين ويحفظه، لا موظفًا دبلوماسيًا."
      },
      {
        "level": 4,
        "role": "near_solution",
        "decomposable": false,
        "content": "اختر المعنى الذي يربط الطلاب بحفظ شعره وانتشار أثره."
      }
    ]
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-L16",
    "pos": 16,
    "role": "core",
    "learning_set": 2,
    "page_start": 34,
    "page_end": 34,
    "concept": "sy-g7-ar-u1-opinion",
    "prompt": "قال طالب: «أرى أن القراءة اليومية مفيدة؛ لأنني عندما أقرأ كل يوم أتعلم كلمات جديدة». أي جزء يمثّل البرهان؟",
    "origin": "GENERATED_SIMILAR",
    "difficulty": 2,
    "source_ref": "AR-LUGATI-G7-T1-P034",
    "opts": [
      "أرى أن القراءة اليومية مفيدة",
      "لأنني عندما أقرأ كل يوم أتعلم كلمات جديدة",
      "هذه عبارة قالها الطالب في بداية المثال",
      "القراءة اليومية هي موضوع الرأي فقط"
    ],
    "correct": 2,
    "explain": "الإجابة الصحيحة هي «لأنني عندما أقرأ كل يوم أتعلم كلمات جديدة»؛ لأنها تطبق خطوات إبداء الرأي والتحدث بوضوح.",
    "hints": [
      {
        "level": 1,
        "role": "nudge",
        "decomposable": false,
        "content": "ميّز بين الرأي نفسه وما يدعمه."
      },
      {
        "level": 2,
        "role": "guide",
        "decomposable": false,
        "content": "البرهان يجيب عن سؤال: لماذا أتبنى هذا الرأي؟"
      },
      {
        "level": 3,
        "role": "strong_guide",
        "decomposable": false,
        "content": "ابحث عن الجزء الذي يقدم سببًا أو دليلًا على الفائدة."
      },
      {
        "level": 4,
        "role": "near_solution",
        "decomposable": false,
        "content": "اختر العبارة التي تشرح نتيجة واقعية تدعم الرأي."
      }
    ]
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-L17",
    "pos": 17,
    "role": "core",
    "learning_set": 2,
    "page_start": 30,
    "page_end": 30,
    "concept": "sy-g7-ar-u1-alif-layyina",
    "prompt": "الفعل الثلاثي «دعا» تُكتب ألفه الأخيرة ممدودة. ما الدليل الأقوى على أن أصلها واو؟",
    "origin": "GENERATED_SIMILAR",
    "difficulty": 3,
    "source_ref": "AR-LUGATI-G7-T1-P030",
    "opts": [
      "مضارعه «يدعو»",
      "عدد حروفه ثلاثة",
      "يبدأ بحرف الدال",
      "معناه الطلب"
    ],
    "correct": 1,
    "explain": "الإجابة الصحيحة هي «مضارعه «يدعو»»؛ وفق قاعدة رسم الألف اللينة وأصلها أو موقعها في الكلمة.",
    "hints": [
      {
        "level": 1,
        "role": "nudge",
        "decomposable": false,
        "content": "استعمل الطريقة التي يذكرها الدرس للكشف عن أصل ألف الفعل الثلاثي."
      },
      {
        "level": 2,
        "role": "guide",
        "decomposable": false,
        "content": "استخدم إحدى طريقتي الدرس للكشف عن أصل ألف الفعل الثلاثي: صوغ المضارع أو إسناد الفعل إلى تاء متحركة."
      },
      {
        "level": 3,
        "role": "strong_guide",
        "decomposable": false,
        "content": "لا يكفي عدد الحروف أو معنى الفعل للكشف عن الأصل؛ حوّل الفعل إلى صيغة صرفية قريبة تُظهر حرف العلة الأصلي نفسه بوضوح."
      },
      {
        "level": 4,
        "role": "near_solution",
        "decomposable": false,
        "content": "اختر الدليل الصرفي الذي يحوّل الفعل إلى صيغة أخرى فتظهر فيها الواو أو الياء الأصلية بوضوح، لا مجرد معلومة عن المعنى أو عدد الحروف."
      }
    ]
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-L18",
    "pos": 18,
    "role": "core",
    "learning_set": 2,
    "page_start": 31,
    "page_end": 31,
    "concept": "sy-g7-ar-u1-alif-layyina",
    "prompt": "أيُّ كتابةٍ صحيحة للكلمة الآتية وفق قاعدة الألف اللينة في غير الثلاثي: «هدايـ…» بمعنى جمع هدية؟",
    "origin": "GENERATED_SIMILAR",
    "difficulty": 3,
    "source_ref": "AR-LUGATI-G7-T1-P031",
    "opts": [
      "هدايا",
      "هدايى",
      "هدايأ",
      "هدايي"
    ],
    "correct": 1,
    "explain": "الإجابة الصحيحة هي «هدايا»؛ وفق قاعدة رسم الألف اللينة وأصلها أو موقعها في الكلمة.",
    "hints": [
      {
        "level": 1,
        "role": "nudge",
        "decomposable": false,
        "content": "حدّد عدد أحرف الكلمة ولاحظ الحرف الذي يسبق الألف الأخيرة."
      },
      {
        "level": 2,
        "role": "guide",
        "decomposable": false,
        "content": "في غير الثلاثي تختلف الصورة بحسب سبق الألف بياء أو عدم سبقها."
      },
      {
        "level": 3,
        "role": "strong_guide",
        "decomposable": false,
        "content": "هنا يسبق الألف الأخيرة حرف الياء مباشرة، فطبّق الاستثناء المرتبط بذلك."
      },
      {
        "level": 4,
        "role": "near_solution",
        "decomposable": false,
        "content": "بما أن الكلمة أكثر من ثلاثة أحرف والحرف السابق للألف الأخيرة هو الياء، فابحث عن الرسم الذي تطبَّق فيه قاعدة ما بعد الياء في غير الثلاثي."
      }
    ]
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-L19",
    "pos": 19,
    "role": "core",
    "learning_set": 2,
    "page_start": 23,
    "page_end": 23,
    "concept": "sy-g7-ar-u1-mizan-sarfi",
    "prompt": "إذا كان وزن «زَلْزَلَ» هو «فَعْلَلَ»، فما وزن «تَزَلْزَلَ»؟",
    "origin": "BOOK_DERIVED",
    "difficulty": 3,
    "source_ref": "AR-LUGATI-G7-T1-P023",
    "opts": [
      "تَفَعْلَلَ",
      "اِسْتَفْعَلَ",
      "فَاعَلَ",
      "أَفْعَلَ"
    ],
    "correct": 1,
    "explain": "الإجابة الصحيحة هي «تَفَعْلَلَ»؛ لأن الوزن يحافظ على ترتيب الحروف الأصلية وما يطرأ عليها من زيادة.",
    "hints": [
      {
        "level": 1,
        "role": "nudge",
        "decomposable": false,
        "content": "انطلق من وزن الفعل الرباعي المجرد أولًا."
      },
      {
        "level": 2,
        "role": "guide",
        "decomposable": false,
        "content": "القاعدة: الحرف الزائد في الفعل يزاد مثله في الميزان."
      },
      {
        "level": 3,
        "role": "strong_guide",
        "decomposable": false,
        "content": "الفعل الجديد زيدت في أوله تاء على بنية رباعية."
      },
      {
        "level": 4,
        "role": "near_solution",
        "decomposable": false,
        "content": "أضف التاء في أول وزن «فعلل» مع الحفاظ على بقية البنية."
      }
    ]
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-L20",
    "pos": 20,
    "role": "core",
    "learning_set": 2,
    "page_start": 34,
    "page_end": 34,
    "concept": "sy-g7-ar-u1-opinion",
    "prompt": "أثناء عرض رأيه، وصل المتحدث إلى فكرة جديدة مهمة. أيُّ تصرفٍ أنسب ليوضح الانتقال للمستمعين؟",
    "origin": "GENERATED_SIMILAR",
    "difficulty": 3,
    "source_ref": "AR-LUGATI-G7-T1-P034",
    "opts": [
      "يتوقف وقفة قصيرة مناسبة ثم يتابع بنبرة تلائم المعنى",
      "يواصل بسرعة من دون أي وقفة",
      "يخفض صوته حتى لا يُسمع",
      "ينظر إلى الورقة فقط ويتجنب الجمهور"
    ],
    "correct": 1,
    "explain": "الإجابة الصحيحة هي «يتوقف وقفة قصيرة مناسبة ثم يتابع بنبرة تلائم المعنى»؛ لأنها تطبق خطوات إبداء الرأي والتحدث بوضوح.",
    "hints": [
      {
        "level": 1,
        "role": "nudge",
        "decomposable": false,
        "content": "ركّز على مهارة تنظيم الكلام عند الانتقال بين الأفكار."
      },
      {
        "level": 2,
        "role": "guide",
        "decomposable": false,
        "content": "من صفات المتحدث الناجح استعمال الوقف في المواضع السليمة مع ضبط الصوت."
      },
      {
        "level": 3,
        "role": "strong_guide",
        "decomposable": false,
        "content": "السرعة المستمرة أو تجنب الجمهور لا يساعدان المستمع على متابعة بنية الكلام."
      },
      {
        "level": 4,
        "role": "near_solution",
        "decomposable": false,
        "content": "اختر السلوك الذي يستخدم وقفة مناسبة ثم يعيد توجيه الصوت لخدمة الفكرة الجديدة."
      }
    ]
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-E01",
    "pos": 201,
    "role": "exam_pool",
    "learning_set": null,
    "page_start": 6,
    "page_end": 6,
    "concept": "sy-g7-ar-u1-flag-reading",
    "prompt": "ما معنى «أَمْرِعْهُ» في مفردات «عَلَمُ بلادي»؟",
    "origin": "BOOK_DERIVED",
    "difficulty": 1,
    "source_ref": "AR-LUGATI-G7-T1-P006",
    "opts": [
      "زِدْهُ",
      "أوقِفْهُ",
      "أخفِهِ",
      "أبعِدْهُ"
    ],
    "correct": 1,
    "explain": "الإجابة الأنسب هي «زِدْهُ»؛ فهي توافق معنى العبارة أو المفردة في النص ضمن هذا السياق.",
    "hints": []
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-E02",
    "pos": 202,
    "role": "exam_pool",
    "learning_set": null,
    "page_start": 6,
    "page_end": 6,
    "concept": "sy-g7-ar-u1-flag-reading",
    "prompt": "ما معنى الفعل «خَفَقَ» كما ورد في مفردات «عَلَمُ بلادي»؟",
    "origin": "BOOK_DERIVED",
    "difficulty": 2,
    "source_ref": "AR-LUGATI-G7-T1-P006",
    "opts": [
      "تحرّك واضطرب",
      "سكن وثبت",
      "ابتعد واختفى",
      "نام واستراح"
    ],
    "correct": 1,
    "explain": "الإجابة الأنسب هي «تحرّك واضطرب»؛ فهي توافق معنى العبارة أو المفردة في النص ضمن هذا السياق.",
    "hints": []
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-E03",
    "pos": 203,
    "role": "exam_pool",
    "learning_set": null,
    "page_start": 9,
    "page_end": 9,
    "concept": "sy-g7-ar-u1-mujarrad-mazid",
    "prompt": "أيُّ عبارةٍ تصف الفعل المجرّد وصفًا صحيحًا؟",
    "origin": "BOOK_DERIVED",
    "difficulty": 2,
    "source_ref": "AR-LUGATI-G7-T1-P009",
    "opts": [
      "جميع حروف ماضيه أصلية",
      "يبدأ دائمًا بألف",
      "لا يكون إلا رباعيًا",
      "يحوي دائمًا ثلاثة أحرف زائدة"
    ],
    "correct": 1,
    "explain": "الإجابة الصحيحة هي «جميع حروف ماضيه أصلية»؛ بتحديد الحروف الأصلية ثم ملاحظة حروف الزيادة.",
    "hints": []
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-E04",
    "pos": 204,
    "role": "exam_pool",
    "learning_set": null,
    "page_start": 10,
    "page_end": 10,
    "concept": "sy-g7-ar-u1-mujarrad-mazid",
    "prompt": "الفعل «أكرمَ» مشتق من «كَرُمَ». ما مقدار الزيادة فيه؟",
    "origin": "GENERATED_SIMILAR",
    "difficulty": 2,
    "source_ref": "AR-LUGATI-G7-T1-P010",
    "opts": [
      "حرف واحد",
      "حرفان",
      "ثلاثة أحرف",
      "أربعة أحرف"
    ],
    "correct": 1,
    "explain": "الإجابة الصحيحة هي «حرف واحد»؛ بتحديد الحروف الأصلية ثم ملاحظة حروف الزيادة.",
    "hints": []
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-E05",
    "pos": 205,
    "role": "exam_pool",
    "learning_set": null,
    "page_start": 10,
    "page_end": 10,
    "concept": "sy-g7-ar-u1-mujarrad-mazid",
    "prompt": "أيُّ تحليلٍ أدق للفعل «استخرجَ» من حيث المجرّد والمزيد؟",
    "origin": "GENERATED_SIMILAR",
    "difficulty": 3,
    "source_ref": "AR-LUGATI-G7-T1-P010",
    "opts": [
      "مزيد بثلاثة أحرف على «خرج»",
      "مجرّد رباعي",
      "مزيد بحرف واحد على «خرج»",
      "مزيد بحرفين على «خرج»"
    ],
    "correct": 1,
    "explain": "الإجابة الصحيحة هي «مزيد بثلاثة أحرف على «خرج»»؛ بتحديد الحروف الأصلية ثم ملاحظة حروف الزيادة.",
    "hints": []
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-E06",
    "pos": 206,
    "role": "exam_pool",
    "learning_set": null,
    "page_start": 12,
    "page_end": 12,
    "concept": "sy-g7-ar-u1-cooperation-reading",
    "prompt": "ما معنى «رَوْض» في مفردات نص «التعاون»؟",
    "origin": "BOOK_DERIVED",
    "difficulty": 1,
    "source_ref": "AR-LUGATI-G7-T1-P012",
    "opts": [
      "أرض معشبة",
      "بحر عميق",
      "بيت مرتفع",
      "طريق ضيق"
    ],
    "correct": 1,
    "explain": "الإجابة الأنسب هي «أرض معشبة»؛ فهي توافق معنى العبارة أو المفردة في النص ضمن هذا السياق.",
    "hints": []
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-E07",
    "pos": 207,
    "role": "exam_pool",
    "learning_set": null,
    "page_start": 13,
    "page_end": 13,
    "concept": "sy-g7-ar-u1-cooperation-reading",
    "prompt": "من معنى البيت «فحضارةُ الإنسانِ فيضُ تعاونٍ»، ما الذي يؤكده الشاعر؟",
    "origin": "BOOK_DERIVED",
    "difficulty": 2,
    "source_ref": "AR-LUGATI-G7-T1-P013",
    "opts": [
      "الحضارة ثمرة للعمل المشترك بين الناس",
      "الحضارة تقوم على عزلة الأفراد",
      "التعاون يقتصر على وقت الفراغ",
      "الحضارة لا علاقة لها بالإنسان"
    ],
    "correct": 1,
    "explain": "الإجابة الأنسب هي «الحضارة ثمرة للعمل المشترك بين الناس»؛ فهي توافق معنى العبارة أو المفردة في النص ضمن هذا السياق.",
    "hints": []
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-E08",
    "pos": 208,
    "role": "exam_pool",
    "learning_set": null,
    "page_start": 15,
    "page_end": 15,
    "concept": "sy-g7-ar-u1-sahih-mutal",
    "prompt": "أيُّ فعلٍ مما يأتي يُعدُّ فعلًا صحيحًا؟",
    "origin": "GENERATED_SIMILAR",
    "difficulty": 2,
    "source_ref": "AR-LUGATI-G7-T1-P015",
    "opts": [
      "كتبَ",
      "وعدَ",
      "قالَ",
      "سعى"
    ],
    "correct": 1,
    "explain": "الإجابة الصحيحة هي «كتبَ»؛ ويُحدَّد النوع من وجود حرف العلة وموضعه أو من بنية الفعل الصحيح.",
    "hints": []
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-E09",
    "pos": 209,
    "role": "exam_pool",
    "learning_set": null,
    "page_start": 16,
    "page_end": 16,
    "concept": "sy-g7-ar-u1-sahih-mutal",
    "prompt": "الفعل «سَقى» من حيث موقع حرف العلة هو:",
    "origin": "BOOK_DERIVED",
    "difficulty": 2,
    "source_ref": "AR-LUGATI-G7-T1-P016",
    "opts": [
      "معتل ناقص",
      "معتل مثال",
      "معتل أجوف",
      "صحيح سالم"
    ],
    "correct": 1,
    "explain": "الإجابة الصحيحة هي «معتل ناقص»؛ ويُحدَّد النوع من وجود حرف العلة وموضعه أو من بنية الفعل الصحيح.",
    "hints": []
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-E10",
    "pos": 210,
    "role": "exam_pool",
    "learning_set": null,
    "page_start": 15,
    "page_end": 15,
    "concept": "sy-g7-ar-u1-sahih-mutal",
    "prompt": "الفعل «عَمَّ» من أنواع الفعل الصحيح. ما نوعه؟",
    "origin": "BOOK_DERIVED",
    "difficulty": 3,
    "source_ref": "AR-LUGATI-G7-T1-P015",
    "opts": [
      "صحيح مضعّف",
      "صحيح مهموز",
      "معتل مثال",
      "معتل ناقص"
    ],
    "correct": 1,
    "explain": "الإجابة الصحيحة هي «صحيح مضعّف»؛ ويُحدَّد النوع من وجود حرف العلة وموضعه أو من بنية الفعل الصحيح.",
    "hints": []
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-E11",
    "pos": 211,
    "role": "exam_pool",
    "learning_set": null,
    "page_start": 19,
    "page_end": 19,
    "concept": "sy-g7-ar-u1-ya-sham",
    "prompt": "في مفردات «يا شام»، مَن المقصود بـ«الرّاقي»؟",
    "origin": "BOOK_DERIVED",
    "difficulty": 1,
    "source_ref": "AR-LUGATI-G7-T1-P019",
    "opts": [
      "الطبيب",
      "المسافر",
      "الشاعر",
      "المعلّم"
    ],
    "correct": 1,
    "explain": "الإجابة الأنسب هي «الطبيب»؛ فهي توافق معنى العبارة أو المفردة في النص ضمن هذا السياق.",
    "hints": []
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-E12",
    "pos": 212,
    "role": "exam_pool",
    "learning_set": null,
    "page_start": 19,
    "page_end": 19,
    "concept": "sy-g7-ar-u1-ya-sham",
    "prompt": "في قول الشاعر: «مَن قالَ: ينسى غريبُ الدارِ ناديهِ؟» ما الفكرة التي يستنكرها؟",
    "origin": "BOOK_DERIVED",
    "difficulty": 2,
    "source_ref": "AR-LUGATI-G7-T1-P019",
    "opts": [
      "أن المغترب ينسى أهله ووطنه",
      "أن الشاعر يحب دمشق",
      "أن الشعر يعبّر عن الشوق",
      "أن الوطن يخفف ألم الغربة"
    ],
    "correct": 1,
    "explain": "الإجابة الأنسب هي «أن المغترب ينسى أهله ووطنه»؛ فهي توافق معنى العبارة أو المفردة في النص ضمن هذا السياق.",
    "hints": []
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-E13",
    "pos": 213,
    "role": "exam_pool",
    "learning_set": null,
    "page_start": 23,
    "page_end": 23,
    "concept": "sy-g7-ar-u1-mizan-sarfi",
    "prompt": "ما الوزن الصرفي للفعل الرباعي المجرّد «زَخْرَفَ»؟",
    "origin": "BOOK_DERIVED",
    "difficulty": 2,
    "source_ref": "AR-LUGATI-G7-T1-P023",
    "opts": [
      "فَعْلَلَ",
      "فَعَلَ",
      "تَفَعَّلَ",
      "اِسْتَفْعَلَ"
    ],
    "correct": 1,
    "explain": "الإجابة الصحيحة هي «فَعْلَلَ»؛ لأن الوزن يحافظ على ترتيب الحروف الأصلية وما يطرأ عليها من زيادة.",
    "hints": []
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-E14",
    "pos": 214,
    "role": "exam_pool",
    "learning_set": null,
    "page_start": 23,
    "page_end": 23,
    "concept": "sy-g7-ar-u1-mizan-sarfi",
    "prompt": "ما الوزن الصرفي للاسم «دَرْب»؟",
    "origin": "BOOK_DERIVED",
    "difficulty": 2,
    "source_ref": "AR-LUGATI-G7-T1-P023",
    "opts": [
      "فَعْل",
      "فَعِيل",
      "فَاعِل",
      "مَفْعُول"
    ],
    "correct": 1,
    "explain": "الإجابة الصحيحة هي «فَعْل»؛ لأن الوزن يحافظ على ترتيب الحروف الأصلية وما يطرأ عليها من زيادة.",
    "hints": []
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-E15",
    "pos": 215,
    "role": "exam_pool",
    "learning_set": null,
    "page_start": 26,
    "page_end": 26,
    "concept": "sy-g7-ar-u1-shaer-watan",
    "prompt": "قال نزار قباني: «كلُّ حروف أبجديتي مقتلعةٌ حجرًا حجرًا من بيوت دمشق». ماذا يوحي هذا التعبير؟",
    "origin": "BOOK_DERIVED",
    "difficulty": 3,
    "source_ref": "AR-LUGATI-G7-T1-P026",
    "opts": [
      "أن لغته وشعره متجذران في دمشق وهويته",
      "أنه يريد هدم بيوت دمشق",
      "أنه لا يهتم باللغة",
      "أنه يصف مهنة البناء فقط"
    ],
    "correct": 1,
    "explain": "الإجابة الأنسب هي «أن لغته وشعره متجذران في دمشق وهويته»؛ فهي توافق معنى العبارة أو المفردة في النص ضمن هذا السياق.",
    "hints": []
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-E16",
    "pos": 216,
    "role": "exam_pool",
    "learning_set": null,
    "page_start": 30,
    "page_end": 30,
    "concept": "sy-g7-ar-u1-alif-layyina",
    "prompt": "لماذا كتبت الألف في الفعل «مشى» مقصورة؟",
    "origin": "BOOK_DERIVED",
    "difficulty": 1,
    "source_ref": "AR-LUGATI-G7-T1-P030",
    "opts": [
      "لأن مضارعه «يمشي» فيظهر أصلها الياء",
      "لأن مضارعه «يمشو»",
      "لأن الكلمة فوق ثلاثة أحرف",
      "لأنها سبقت بياء"
    ],
    "correct": 1,
    "explain": "الإجابة الصحيحة هي «لأن مضارعه «يمشي» فيظهر أصلها الياء»؛ وفق قاعدة رسم الألف اللينة وأصلها أو موقعها في الكلمة.",
    "hints": []
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-E17",
    "pos": 217,
    "role": "exam_pool",
    "learning_set": null,
    "page_start": 31,
    "page_end": 31,
    "concept": "sy-g7-ar-u1-alif-layyina",
    "prompt": "كلمة «مُرتضى» أكثر من ثلاثة أحرف ولم تسبق ألفها الأخيرة بياء. كيف ترسم الألف اللينة؟",
    "origin": "BOOK_DERIVED",
    "difficulty": 2,
    "source_ref": "AR-LUGATI-G7-T1-P031",
    "opts": [
      "مقصورة «ى»",
      "ممدودة «ا»",
      "همزة «أ»",
      "ياء «ي»"
    ],
    "correct": 1,
    "explain": "الإجابة الصحيحة هي «مقصورة «ى»»؛ وفق قاعدة رسم الألف اللينة وأصلها أو موقعها في الكلمة.",
    "hints": []
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-E18",
    "pos": 218,
    "role": "exam_pool",
    "learning_set": null,
    "page_start": 31,
    "page_end": 31,
    "concept": "sy-g7-ar-u1-alif-layyina",
    "prompt": "لماذا تُكتب الألف الأخيرة في «برايا» ممدودة؟",
    "origin": "BOOK_DERIVED",
    "difficulty": 2,
    "source_ref": "AR-LUGATI-G7-T1-P031",
    "opts": [
      "لأنها في غير الثلاثي وقد سبقت بياء",
      "لأن أصلها واو حتمًا",
      "لأنها فعل ثلاثي",
      "لأن ما قبلها مضموم"
    ],
    "correct": 1,
    "explain": "الإجابة الصحيحة هي «لأنها في غير الثلاثي وقد سبقت بياء»؛ وفق قاعدة رسم الألف اللينة وأصلها أو موقعها في الكلمة.",
    "hints": []
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-E19",
    "pos": 219,
    "role": "exam_pool",
    "learning_set": null,
    "page_start": 34,
    "page_end": 34,
    "concept": "sy-g7-ar-u1-opinion",
    "prompt": "يريد طالب أن يدعم رأيه: «التعاون في المدرسة مهم». أيُّ عبارةٍ تصلح برهانًا مباشرًا؟",
    "origin": "GENERATED_SIMILAR",
    "difficulty": 2,
    "source_ref": "AR-LUGATI-G7-T1-P034",
    "opts": [
      "لأن العمل الجماعي يساعدنا على إنجاز المهام وتبادل الخبرات",
      "لأن اختيار الألوان المفضلة يختلف من طالب إلى آخر",
      "لأن موعد بدء المدرسة صباحًا أمر ثابت في الجدول",
      "لأن السفر في العطلة قرار شخصي لا يتعلق بالعمل المدرسي"
    ],
    "correct": 1,
    "explain": "الإجابة الصحيحة هي «لأن العمل الجماعي يساعدنا على إنجاز المهام وتبادل الخبرات»؛ لأنها تطبق خطوات إبداء الرأي والتحدث بوضوح.",
    "hints": []
  },
  {
    "code": "MOH-AR7-U1-BL-20261001-E20",
    "pos": 220,
    "role": "exam_pool",
    "learning_set": null,
    "page_start": 34,
    "page_end": 34,
    "concept": "sy-g7-ar-u1-opinion",
    "prompt": "متحدثٌ يقف أمام الصف لكنه يثبت نبرة صوته في السؤال والتعجب والخبر. ما التحسين الأدق؟",
    "origin": "GENERATED_SIMILAR",
    "difficulty": 3,
    "source_ref": "AR-LUGATI-G7-T1-P034",
    "opts": [
      "ينوّع مستوى صوته ونبرته بما يناسب المعنى والأسلوب",
      "يتحدث أسرع من المعتاد",
      "يلغي الوقفات بين الجمل",
      "يتجنب أي تفاعل مع المستمعين"
    ],
    "correct": 1,
    "explain": "الإجابة الصحيحة هي «ينوّع مستوى صوته ونبرته بما يناسب المعنى والأسلوب»؛ لأنها تطبق خطوات إبداء الرأي والتحدث بوضوح.",
    "hints": []
  }
]
$json$::jsonb;
begin
  select id into v_workspace from public.workspaces where slug='family-learning-hub' limit 1;
  select id into v_curriculum from public.curricula where code='syrian-national' and is_active limit 1;
  select id into v_arabic from public.subjects where code='arabic' limit 1;
  select id into v_program from public.learning_programs where workspace_id=v_workspace and slug='syrian-g7-2026-2027' limit 1;

  if v_workspace is null or v_curriculum is null or v_arabic is null or v_program is null then
    raise exception 'SY_G7_ARABIC_U1_20261001_PREREQUISITES_MISSING';
  end if;

  select id into v_book from public.books
  where code='AR-LUGATI-G7-T1' and curriculum_id=v_curriculum and subject_id=v_arabic limit 1;
  if v_book is null then raise exception 'SY_G7_ARABIC_U1_20261001_BOOK_MISSING'; end if;

  select id into v_program_subject from public.program_subjects
  where program_id=v_program and subject_id=v_arabic limit 1;
  if v_program_subject is null then raise exception 'SY_G7_ARABIC_U1_20261001_PROGRAM_SUBJECT_MISSING'; end if;

  select id into v_unit from public.units
  where book_id=v_book and slug='unit-1-belonging-citizenship' limit 1;
  if v_unit is null then raise exception 'SY_G7_ARABIC_U1_20261001_UNIT_MISSING'; end if;

  if exists (select 1 from public.quizzes where workspace_id=v_workspace and slug='sy-g7-arabic-u1-baseline-20261001') then
    raise exception 'SY_G7_ARABIC_U1_20261001_QUIZ_ALREADY_EXISTS';
  end if;

  insert into public.quizzes(
    workspace_id,subject_id,book_id,slug,title,description,status,curriculum_id,
    unit_id,quiz_kind,delivery_config
  ) values (
    v_workspace,v_arabic,v_book,
    'sy-g7-arabic-u1-baseline-20261001',
    'اللغة العربية 7 — مراجعة الوحدة الأولى — 1 أكتوبر',
    'مراجعة تشخيصية لمحمد ضمن الوحدة الأولى: فهم ومفردات، المجرّد والمزيد، التعاون، الصحيح والمعتل، يا شام، الميزان الصرفي، شاعر ووطن، الألف اللينة، وإبداء الرأي.',
    'active',v_curriculum,v_unit,'review',
    jsonb_build_object(
      'learning',jsonb_build_object(
        'question_count',20,'set_count',2,'questions_per_set',10,
        'hints',true,'retry',true,'adaptive',false,'remediation',false,
        'instant_feedback',true,'progressive_hints',true
      ),
      'exam',jsonb_build_object(
        'question_count',20,'independent_question_pool',true,
        'hints',false,'retry',false,'instant_feedback',false,'show_results_after_submit',true
      ),
      'source_pages',jsonb_build_array(5,34),
      'baseline_reason','No submitted live Arabic assessment evidence was available at authoring time.'
    )
  ) returning id into v_quiz;

  insert into public.quiz_versions(
    workspace_id,quiz_id,version_no,state,instructions,settings,published_at,
    question_language,explanation_language,terminology_display_mode
  ) values (
    v_workspace,v_quiz,1,'published',
    'محمد: ابدأ بوضع التعلّم. الأسئلة العشرة الأولى هي المجموعة الأولى، ثم أكمل الأسئلة العشرة التالية بوصفها المجموعة الثانية. استخدم التلميحات عند الحاجة فقط. بعد إنهاء وضع التعلّم انتقل إلى وضع الامتحان؛ أسئلة الامتحان مختلفة ولا تظهر صحة الإجابة قبل التسليم.',
    jsonb_build_object(
      'two_mode_model',true,
      'learning_question_count',20,
      'learning_set_count',2,
      'learning_set_1_positions',jsonb_build_array(1,10),
      'learning_set_2_positions',jsonb_build_array(11,20),
      'exam_question_count',20,
      'learning_questions_distinct_from_exam',true,
      'question_standalone_policy','REQUIRED',
      'academic_gate','PASS',
      'academic_gate_candidate','mohammad_ar_g7_u1_baseline_20261001.json',
      'prior_package_exclusion','20260923144500_register_sy_g7_arabic_u1_review.sql'
    ),
    now(),'ar','ar','source_only'
  ) returning id into v_version;

  insert into public.program_quizzes(
    workspace_id,program_id,quiz_id,program_subject_id,availability,sort_order,metadata
  ) values (
    v_workspace,v_program,v_quiz,v_program_subject,'available',30,
    jsonb_build_object(
      'scope','الوحدة الأولى — PDF 5–34',
      'modes',jsonb_build_array('learning','exam'),
      'learning_question_count',20,
      'learning_sets',jsonb_build_array(10,10),
      'exam_question_count',20,
      'baseline_review',true
    )
  );

  for v_item in select value from jsonb_array_elements(v_items) loop
    select id into v_concept from public.learning_concepts
    where workspace_id=v_workspace and code=v_item->>'concept' limit 1;
    if v_concept is null then raise exception 'MISSING_CONCEPT: %', v_item->>'concept'; end if;

    insert into public.quiz_questions(
      workspace_id,quiz_version_id,position,question_type,prompt,origin,
      source_page_start,source_page_end,source_metadata,points,
      difficulty_level,max_attempts,remediation_after_attempt,adaptive_enabled,
      delivery_role,prompt_language,terminology_display_mode,question_code
    ) values (
      v_workspace,v_version,(v_item->>'pos')::integer,'single_choice',v_item->>'prompt','generated',
      (v_item->>'page_start')::integer,(v_item->>'page_end')::integer,
      jsonb_build_object(
        'source_type',v_item->>'origin',
        'source_ref',v_item->>'source_ref',
        'book_code','AR-LUGATI-G7-T1',
        'unit','الوحدة الأولى — الانتماء والمواطنة',
        'source_verified','Project Markdown + academic package QA',
        'standalone_question',true,
        'learning_set',case when v_item->>'role'='core' then (v_item->>'learning_set')::integer else null end,
        'baseline_review',true
      ),
      1,(v_item->>'difficulty')::integer,
      case when v_item->>'role'='core' then 4 else 1 end,
      case when v_item->>'role'='core' then 4 else 1 end,
      false,v_item->>'role','ar','source_only',v_item->>'code'
    ) returning id into v_question;

    v_i := 0;
    for v_option in select value from jsonb_array_elements_text(v_item->'opts') loop
      v_i := v_i + 1;
      insert into public.quiz_question_options(workspace_id,question_id,position,label,content)
      values(v_workspace,v_question,v_i,chr(64+v_i),v_option);
    end loop;

    insert into public.quiz_question_answer_keys(
      question_id,workspace_id,correct_answer,explanation,
      correct_explanation,final_incorrect_explanation,grading_config
    ) values (
      v_question,v_workspace,
      jsonb_build_object('option_position',(v_item->>'correct')::integer),
      v_item->>'explain',v_item->>'explain',v_item->>'explain','{}'::jsonb
    );

    if v_item->>'role'='core' then
      for v_hint in select value from jsonb_array_elements(v_item->'hints') loop
        insert into public.quiz_question_hints(
          workspace_id,question_id,hint_level,pedagogical_role,content,metadata,language,terminology_display_mode
        ) values (
          v_workspace,v_question,(v_hint->>'level')::integer,v_hint->>'role',v_hint->>'content',
          jsonb_build_object('decomposable',false),'ar','source_only'
        );
      end loop;
    end if;

    insert into public.quiz_question_concepts(workspace_id,question_id,concept_id,is_primary,weight)
    values(v_workspace,v_question,v_concept,true,1);
  end loop;

  if (select count(*) from public.quiz_questions where quiz_version_id=v_version and delivery_role='core') <> 20 then
    raise exception 'SY_G7_ARABIC_U1_20261001_LEARNING_COUNT_INVALID';
  end if;
  if (select count(*) from public.quiz_questions where quiz_version_id=v_version and delivery_role='exam_pool') <> 20 then
    raise exception 'SY_G7_ARABIC_U1_20261001_EXAM_COUNT_INVALID';
  end if;
  if (select count(*) from public.quiz_question_hints h join public.quiz_questions q on q.id=h.question_id where q.quiz_version_id=v_version) <> 80 then
    raise exception 'SY_G7_ARABIC_U1_20261001_HINT_COUNT_INVALID';
  end if;
  if exists (
    select prompt from public.quiz_questions where quiz_version_id=v_version group by prompt having count(*) > 1
  ) then raise exception 'SY_G7_ARABIC_U1_20261001_DUPLICATE_PROMPT'; end if;
end;
$migration$;