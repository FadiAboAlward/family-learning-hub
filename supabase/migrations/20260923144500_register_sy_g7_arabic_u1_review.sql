-- Register Mohammad's Grade 7 Arabic Unit 1 practice package.
-- Source: AR-LUGATI-G7-T1 (Syrian curriculum, first term).
-- Delivery invariant for this package:
--   Learning Mode: 10 core questions with hints/instant feedback.
--   Exam Mode: 20 distinct exam_pool questions, no hints before submit.
-- The printable 20-question paper is a separate delivery artifact and is
-- intentionally not duplicated into either online pool.
-- Academic source QA: vocabulary answers stay source-exact; e.g. «رغد» = «طيب».
-- Exact-head QA branch is synchronized with current main.
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
  v_hint text;
  v_i integer;
  v_paper_quiz uuid;
  v_paper_version uuid;
  v_paper_question uuid;
  v_paper_concept uuid;
  v_paper_item jsonb;
  v_paper_option text;
  v_paper_i integer;
  v_paper_map jsonb := '{}'::jsonb;
  v_paper_canonical jsonb;
  v_paper_hash text;
  v_paper_model_code text := 'MOH-AR7-U1-CONT-20260923';
  v_paper_quiz_slug text := 'sy-g7-arabic-u1-cont-paper-20260923';
  v_paper_package jsonb := $paperjson$
[
  {
    "n": 1,
    "code": "Q-20260923601",
    "page_start": 18,
    "page_end": 24,
    "concept": "sy-g7-ar-u1-ya-sham",
    "prompt": "ما معنى كلمة «البَيْن» في درس «يا شام»؟",
    "opts": [
      "اللقاء",
      "الفراق",
      "الهدوء",
      "الأمان"
    ],
    "correct": 2,
    "explain": "«البَيْن» في سياق الدرس يعني الفراق."
  },
  {
    "n": 2,
    "code": "Q-20260923602",
    "page_start": 18,
    "page_end": 24,
    "concept": "sy-g7-ar-u1-ya-sham",
    "prompt": "ما الفكرة الأقرب إلى المعنى العام لقصيدة «يا شام»؟",
    "opts": [
      "وصف الطبيعة فقط",
      "مكانة الوطن في قلب المغترب وحنينه إليه",
      "الحديث عن التجارة",
      "الدعوة إلى السفر"
    ],
    "correct": 2,
    "explain": "تدور القصيدة حول تعلق المغترب بوطنه وحنينه إلى الشام."
  },
  {
    "n": 3,
    "code": "Q-20260923603",
    "page_start": 18,
    "page_end": 24,
    "concept": "sy-g7-ar-u1-ya-sham",
    "prompt": "في قول الشاعر: «أخفيتُ شوقي فازدادتْ مراجله»، ماذا حدث للشوق؟",
    "opts": [
      "اختفى تماماً",
      "تحوّل إلى فرح",
      "ازداد اشتعالاً",
      "نسيه الشاعر"
    ],
    "correct": 3,
    "explain": "إخفاء الشوق لم يطفئه، بل جعله أشد اشتعالاً."
  },
  {
    "n": 4,
    "code": "Q-20260923604",
    "page_start": 18,
    "page_end": 24,
    "concept": "sy-g7-ar-u1-ya-sham",
    "prompt": "أي عبارة تدل بوضوح على شدّة تعلّق الشاعر بدمشق؟",
    "opts": [
      "أراها في يقظتي وفي حلمي",
      "أحب السفر إلى مدن كثيرة",
      "لا أفكر في الماضي",
      "أفضل الصمت دائماً"
    ],
    "correct": 1,
    "explain": "رؤيتها في اليقظة والحلم تدل على عمق تعلقه بها."
  },
  {
    "n": 5,
    "code": "Q-20260923605",
    "page_start": 22,
    "page_end": 24,
    "concept": "sy-g7-ar-u1-mizan-sarfi",
    "prompt": "ما الوزن الصرفي للفعل الثلاثي المجرّد «كتب»؟",
    "opts": [
      "فَعَلَ",
      "فَعْلَلَ",
      "تَفَعَّلَ",
      "اِسْتَفْعَلَ"
    ],
    "correct": 1,
    "explain": "الفعل الثلاثي المجرّد يوزن على «فَعَلَ» مع مطابقة الحركات."
  },
  {
    "n": 6,
    "code": "Q-20260923606",
    "page_start": 22,
    "page_end": 24,
    "concept": "sy-g7-ar-u1-mizan-sarfi",
    "prompt": "ما الوزن الصرفي للفعل الرباعي المجرّد «زلزل»؟",
    "opts": [
      "فَعَلَ",
      "فَعْلَلَ",
      "أَفْعَلَ",
      "تَفَعْلَلَ"
    ],
    "correct": 2,
    "explain": "الفعل الرباعي المجرّد يوزن على «فَعْلَلَ»."
  },
  {
    "n": 7,
    "code": "Q-20260923607",
    "page_start": 22,
    "page_end": 24,
    "concept": "sy-g7-ar-u1-mizan-sarfi",
    "prompt": "ما الوزن الصرفي للفعل «تبعثر»؟",
    "opts": [
      "فَعَلَ",
      "فَعْلَلَ",
      "تَفَعْلَلَ",
      "اِسْتَفْعَلَ"
    ],
    "correct": 3,
    "explain": "«بعثر» رباعي مجرّد على فَعْلَلَ، ومع زيادة التاء يصبح «تَفَعْلَلَ»."
  },
  {
    "n": 8,
    "code": "Q-20260923608",
    "page_start": 22,
    "page_end": 24,
    "concept": "sy-g7-ar-u1-mizan-sarfi",
    "prompt": "ما الوزن الصرفي للاسم «حديث»؟",
    "opts": [
      "فَعِيل",
      "فَعْل",
      "مَفْعُول",
      "فَاعِل"
    ],
    "correct": 1,
    "explain": "«حديث» على وزن «فَعِيل»."
  },
  {
    "n": 9,
    "code": "Q-20260923609",
    "page_start": 22,
    "page_end": 24,
    "concept": "sy-g7-ar-u1-mizan-sarfi",
    "prompt": "ما الوزن الصرفي للاسم «شوق»؟",
    "opts": [
      "فَعْل",
      "فَعِيل",
      "فُعُول",
      "مِفْعَال"
    ],
    "correct": 1,
    "explain": "«شوق» على وزن «فَعْل»."
  },
  {
    "n": 10,
    "code": "Q-20260923610",
    "page_start": 22,
    "page_end": 24,
    "concept": "sy-g7-ar-u1-mizan-sarfi",
    "prompt": "أي كلمة على وزن «فاعل» مشتقة من الفعل «رسم»؟",
    "opts": [
      "مرسوم",
      "رسّام",
      "راسم",
      "مرسم"
    ],
    "correct": 3,
    "explain": "اسم الفاعل من الفعل الثلاثي «رسم» هو «راسم» على وزن «فاعل»."
  },
  {
    "n": 11,
    "code": "Q-20260923611",
    "page_start": 29,
    "page_end": 33,
    "concept": "sy-g7-ar-u1-alif-layyina",
    "prompt": "ما الألف اللينة؟",
    "opts": [
      "ألف متحركة دائماً",
      "ألف ساكنة مفتوح ما قبلها",
      "همزة في أول الكلمة",
      "ياء مشددة"
    ],
    "correct": 2,
    "explain": "الألف اللينة ألف ساكنة مفتوح ما قبلها."
  },
  {
    "n": 12,
    "code": "Q-20260923612",
    "page_start": 29,
    "page_end": 33,
    "concept": "sy-g7-ar-u1-alif-layyina",
    "prompt": "لماذا كتبت الألف في «عصا» ممدودة (ا)؟",
    "opts": [
      "لأن أصلها واو",
      "لأن أصلها ياء",
      "لأنها فوق ثلاثة أحرف",
      "لأنها سبقت بياء"
    ],
    "correct": 1,
    "explain": "أصل ألف «عصا» واو، لذلك ترسم ممدودة."
  },
  {
    "n": 13,
    "code": "Q-20260923613",
    "page_start": 29,
    "page_end": 33,
    "concept": "sy-g7-ar-u1-alif-layyina",
    "prompt": "لماذا كتبت الألف في «فتى» مقصورة (ى)؟",
    "opts": [
      "لأن أصلها واو",
      "لأن أصلها ياء",
      "لأنها سبقت بألف",
      "لأن الكلمة رباعية"
    ],
    "correct": 2,
    "explain": "أصل ألف «فتى» ياء، لذلك ترسم مقصورة."
  },
  {
    "n": 14,
    "code": "Q-20260923614",
    "page_start": 29,
    "page_end": 33,
    "concept": "sy-g7-ar-u1-alif-layyina",
    "prompt": "لماذا كتبت الألف في الفعل «سقى» مقصورة (ى)؟",
    "opts": [
      "لأن مضارعه يسقي فيظهر أصلها الياء",
      "لأن مضارعه يسقو",
      "لأن الكلمة فوق ثلاثة أحرف",
      "لأنها اسم"
    ],
    "correct": 1,
    "explain": "مضارع «سقى» هو «يسقي»، فيظهر أن أصل الألف ياء."
  },
  {
    "n": 15,
    "code": "Q-20260923615",
    "page_start": 29,
    "page_end": 33,
    "concept": "sy-g7-ar-u1-alif-layyina",
    "prompt": "لماذا كتبت الألف في الفعل «غدا» ممدودة (ا)؟",
    "opts": [
      "لأن أصلها ياء",
      "لأن التاء تكشف أصلها الواو: غدوتُ",
      "لأنها سبقت بياء",
      "لأنها فوق ثلاثة أحرف"
    ],
    "correct": 2,
    "explain": "عند إسناد الفعل نقول «غدوتُ»، فتظهر الواو أصل الألف."
  },
  {
    "n": 16,
    "code": "Q-20260923616",
    "page_start": 29,
    "page_end": 33,
    "concept": "sy-g7-ar-u1-alif-layyina",
    "prompt": "لماذا كتبت الألف في «استولى» مقصورة (ى)؟",
    "opts": [
      "لأنها ثلاثية وأصلها واو",
      "لأنها فوق ثلاثة أحرف ولم تسبق بياء",
      "لأنها سبقت بياء",
      "لأنها اسم ثلاثي"
    ],
    "correct": 2,
    "explain": "في غير الثلاثي تكتب الألف اللينة مقصورة إذا لم تسبق بياء."
  },
  {
    "n": 17,
    "code": "Q-20260923617",
    "page_start": 29,
    "page_end": 33,
    "concept": "sy-g7-ar-u1-alif-layyina",
    "prompt": "لماذا كتبت الألف في «بقايا» ممدودة (ا)؟",
    "opts": [
      "لأنها فوق ثلاثة أحرف وقد سبقت بياء",
      "لأن أصلها واو",
      "لأنها فعل",
      "لأنها ثلاثية"
    ],
    "correct": 1,
    "explain": "في غير الثلاثي تكتب ممدودة إذا سبقتها ياء."
  },
  {
    "n": 18,
    "code": "Q-20260923618",
    "page_start": 33,
    "page_end": 35,
    "concept": "sy-g7-ar-u1-opinion",
    "prompt": "ما الترتيب الصحيح لخطوات إبداء الرأي؟",
    "opts": [
      "البرهان ثم الرأي ثم الفكرة",
      "تحليل الفكرة ثم الرأي الشخصي ثم البرهان",
      "الرأي ثم التحية ثم الخاتمة",
      "الفكرة ثم الحفظ ثم الإلقاء"
    ],
    "correct": 2,
    "explain": "يبدأ إبداء الرأي بتحليل الفكرة، ثم عرض الرأي الشخصي، ثم تدعيمه بالبرهان."
  },
  {
    "n": 19,
    "code": "Q-20260923619",
    "page_start": 33,
    "page_end": 35,
    "concept": "sy-g7-ar-u1-opinion",
    "prompt": "أيّ مما يأتي من صفات المتحدّث الناجح؟",
    "opts": [
      "التحدث بنبرة واحدة دائماً",
      "رفع الصوت بلا سبب",
      "تغيير مستوى الصوت وفق المعنى",
      "تجنّب التفاعل مع الآخرين"
    ],
    "correct": 3,
    "explain": "المتحدث الناجح ينوّع مستوى صوته بما يلائم المعنى والموقف."
  },
  {
    "n": 20,
    "code": "Q-20260923620",
    "page_start": 25,
    "page_end": 29,
    "concept": "sy-g7-ar-u1-shaer-watan",
    "prompt": "في قول نزار قباني عن دمشق إن «ياسمينها أصبح جزءاً من دورته الدموية»، ما الذي يعبّر عنه هذا القول؟",
    "opts": [
      "تعلّق عميق بالوطن",
      "رفض المدينة",
      "رأي علمي في النبات",
      "رغبة في السفر بعيداً"
    ],
    "correct": 1,
    "explain": "التعبير يصوّر ارتباطاً وجدانياً عميقاً بدمشق والوطن."
  }
]
$paperjson$::jsonb;
  v_items jsonb := $json$
[
  {
    "code": "Q-20260923401",
    "pos": 1,
    "role": "core",
    "page_start": 5,
    "page_end": 5,
    "concept": "sy-g7-ar-u1-flag-reading",
    "prompt": "في عبارة: «العَلَمُ رمزٌ يجتمع حوله أبناءُ الوطن». ما القيمة الأقرب التي يعبّر عنها هذا المعنى؟",
    "opts": [
      "حبّ العزلة والابتعاد عن الناس",
      "الانتماء إلى الوطن واحترام رموزه",
      "إهمال شؤون المجتمع",
      "رفض العمل مع الآخرين"
    ],
    "correct": 2,
    "explain": "العَلَم من رموز الوطن، والالتفاف حوله يدل على الانتماء واحترام الوطن ورموزه.",
    "hints": [
      "فكّر فيما يمثّله العَلَم لأبناء البلد.",
      "استبعد الخيارات التي تدعو إلى العزلة أو الإهمال.",
      "المعنى يرتبط بالانتماء واحترام رموز الوطن."
    ]
  },
  {
    "code": "Q-20260923402",
    "pos": 2,
    "role": "core",
    "page_start": 6,
    "page_end": 6,
    "concept": "sy-g7-ar-u1-flag-reading",
    "prompt": "في مفردات درس «عَلَمُ بلادي»، ما معنى كلمة «مُسبِغ»؟",
    "opts": [
      "حزين",
      "مسرع",
      "منقطع",
      "موسّع"
    ],
    "correct": 4,
    "explain": "«مُسبِغ» تعني موسّع؛ أي مفيض الشيء ومكثره.",
    "hints": [
      "الكلمة وردت في وصف نشر الحب.",
      "ابحث عن معنى يدل على الامتداد والكثرة.",
      "المعنى هو: موسّع."
    ]
  },
  {
    "code": "Q-20260923403",
    "pos": 3,
    "role": "core",
    "page_start": 9,
    "page_end": 9,
    "concept": "sy-g7-ar-u1-mujarrad-mazid",
    "prompt": "الفعل «ارتفعَ» فعلٌ مزيد. ما فعله المجرّد؟",
    "opts": [
      "رَفَعَ",
      "رَفُعَ",
      "ترفّعَ",
      "استرفعَ"
    ],
    "correct": 1,
    "explain": "نردّ «ارتفع» إلى حروفه الأصلية فنحصل على «رَفَعَ».",
    "hints": [
      "احذف أحرف الزيادة من «ارتفع».",
      "الأصل يتكوّن من ثلاثة أحرف: ر، ف، ع.",
      "الفعل المجرّد هو «رَفَعَ»."
    ]
  },
  {
    "code": "Q-20260923404",
    "pos": 4,
    "role": "core",
    "page_start": 9,
    "page_end": 9,
    "concept": "sy-g7-ar-u1-mujarrad-mazid",
    "prompt": "ما نوع الفعل «زلزلَ» من حيث المجرّد والمزيد؟",
    "opts": [
      "مزيد بحرف",
      "مجرّد ثلاثي",
      "مجرّد رباعي",
      "مزيد بحرفين"
    ],
    "correct": 3,
    "explain": "حروف «زلزل» الأربعة أصلية، لذلك هو فعل مجرّد رباعي.",
    "hints": [
      "عدّ الحروف الأصلية في الماضي.",
      "لا يمكن حذف حرف مع بقاء لفظ الفعل ومعناه.",
      "أربعة أحرف أصلية تعني: مجرّد رباعي."
    ]
  },
  {
    "code": "Q-20260923405",
    "pos": 5,
    "role": "core",
    "page_start": 10,
    "page_end": 10,
    "concept": "sy-g7-ar-u1-mujarrad-mazid",
    "prompt": "الفعل «استعذبَ» مشتقّ من «عَذُبَ». بعدد كم من الأحرف زيد؟",
    "opts": [
      "حرف واحد",
      "ثلاثة أحرف",
      "حرفان",
      "لم يُزَد عليه شيء"
    ],
    "correct": 2,
    "explain": "زاد على الجذر «عذب» الأحرف: الألف والسين والتاء، فهو مزيد بثلاثة أحرف.",
    "hints": [
      "قارن «استعذب» بـ«عذب».",
      "حدّد الأحرف الموجودة في «استـ» قبل الجذر.",
      "الزيادة: ا، س، ت = ثلاثة أحرف."
    ]
  },
  {
    "code": "Q-20260923406",
    "pos": 6,
    "role": "core",
    "page_start": 12,
    "page_end": 13,
    "concept": "sy-g7-ar-u1-cooperation-reading",
    "prompt": "قال الشاعر في نص «التعاون»: «أنا ما خُلِقتُ كي أعيشَ بمفردي». ما الفكرة التي يدلّ عليها هذا المعنى؟",
    "opts": [
      "الإنسان يحتاج إلى الآخرين والتعاون معهم",
      "الإنسان ينجح أكثر إذا عاش منعزلاً",
      "السعادة تتحقق بالمال وحده",
      "العمل الجماعي يضعف المجتمع"
    ],
    "correct": 1,
    "explain": "يرفض الشاعر العيش منفرداً ويؤكد حاجة الإنسان إلى التواصل والتعاون مع الآخرين.",
    "hints": [
      "ركّز على عبارة «ما خُلِقتُ كي أعيشَ بمفردي».",
      "ما عكس العيش منفرداً؟",
      "الفكرة هي الحاجة إلى الآخرين والتعاون معهم."
    ]
  },
  {
    "code": "Q-20260923407",
    "pos": 7,
    "role": "core",
    "page_start": 12,
    "page_end": 13,
    "concept": "sy-g7-ar-u1-cooperation-reading",
    "prompt": "ما معنى كلمة «زاخر» في مفردات نص «التعاون»؟",
    "opts": [
      "ضيق",
      "فارغ",
      "بعيد",
      "ممتلئ"
    ],
    "correct": 4,
    "explain": "«زاخر» تعني ممتلئ.",
    "hints": [
      "استحضر وصف البحر في النص.",
      "الكلمة تدل على الكثرة والامتلاء.",
      "المعنى: ممتلئ."
    ]
  },
  {
    "code": "Q-20260923408",
    "pos": 8,
    "role": "core",
    "page_start": 15,
    "page_end": 15,
    "concept": "sy-g7-ar-u1-sahih-mutal",
    "prompt": "أيُّ الأفعال الآتية فعلٌ صحيح؛ أي خلت حروفه الأصلية من أحرف العلة؟",
    "opts": [
      "وعدَ",
      "قالَ",
      "صنعَ",
      "رمى"
    ],
    "correct": 3,
    "explain": "حروف «صنع» الأصلية هي ص، ن، ع، وليس فيها ألف أو واو أو ياء؛ لذا فهو صحيح.",
    "hints": [
      "أحرف العلة هي الألف والواو والياء.",
      "افحص الحروف الأصلية لكل فعل.",
      "«صنع» لا يحتوي حرف علة أصلياً."
    ]
  },
  {
    "code": "Q-20260923409",
    "pos": 9,
    "role": "core",
    "page_start": 16,
    "page_end": 16,
    "concept": "sy-g7-ar-u1-sahih-mutal",
    "prompt": "الفعل «قامَ» من حيث موقع حرف العلة هو:",
    "opts": [
      "معتل مثال",
      "معتل أجوف",
      "معتل ناقص",
      "صحيح سالم"
    ],
    "correct": 2,
    "explain": "أصل «قام» هو «قوم»، وحرف العلة في وسط الفعل؛ لذلك هو معتل أجوف.",
    "hints": [
      "انظر إلى موضع حرف العلة في أصل الفعل.",
      "حرف العلة ليس في البداية ولا في النهاية.",
      "ما كان حرف العلة في وسطه يسمى أجوف."
    ]
  },
  {
    "code": "Q-20260923410",
    "pos": 10,
    "role": "core",
    "page_start": 16,
    "page_end": 16,
    "concept": "sy-g7-ar-u1-sahih-mutal",
    "prompt": "الفعل «وصلَ» من حيث موقع حرف العلة هو:",
    "opts": [
      "صحيح مضعّف",
      "معتل أجوف",
      "معتل ناقص",
      "معتل مثال"
    ],
    "correct": 4,
    "explain": "الواو حرف علة في أول «وصل»، لذلك هو معتل مثال.",
    "hints": [
      "أول حرف في الفعل هو الواو.",
      "المعتل الذي يبدأ بحرف علة له اسم خاص.",
      "يسمى: المعتل المثال."
    ]
  },
  {
    "code": "Q-20260923501",
    "pos": 201,
    "role": "exam_pool",
    "page_start": 6,
    "page_end": 6,
    "concept": "sy-g7-ar-u1-flag-reading",
    "prompt": "ما معنى «الرَّواح» كما ورد في مفردات درس «عَلَمُ بلادي»؟",
    "opts": [
      "الوقوف بلا حركة",
      "السير في الصباح الباكر فقط",
      "السير من زوال الشمس إلى الليل",
      "العودة من السفر بعد سنوات"
    ],
    "correct": 3,
    "explain": "الرواح هو السير من زوال الشمس إلى الليل."
  },
  {
    "code": "Q-20260923502",
    "pos": 202,
    "role": "exam_pool",
    "page_start": 6,
    "page_end": 6,
    "concept": "sy-g7-ar-u1-flag-reading",
    "prompt": "ما معنى الفعل «ترشفُ»؟",
    "opts": [
      "تشربُ",
      "تكتبُ",
      "تسمعُ",
      "تجري"
    ],
    "correct": 1,
    "explain": "«ترشف» تعني تشرب."
  },
  {
    "code": "Q-20260923503",
    "pos": 203,
    "role": "exam_pool",
    "page_start": 6,
    "page_end": 6,
    "concept": "sy-g7-ar-u1-flag-reading",
    "prompt": "المعنى المقصود من «الطِّماح» في مفردات الدرس هو:",
    "opts": [
      "الصمت",
      "الحزن والانكسار",
      "السرعة",
      "الرِّفعة والشموخ"
    ],
    "correct": 4,
    "explain": "الطِّماح هو الارتفاع، والمقصود في السياق الرفعة والشموخ."
  },
  {
    "code": "Q-20260923504",
    "pos": 204,
    "role": "exam_pool",
    "page_start": 6,
    "page_end": 8,
    "concept": "sy-g7-ar-u1-flag-reading",
    "prompt": "في قول الشاعر عن العَلَم: «يا مُسبغَ الحبِّ على الأرضِ وِشاحاً»، ما الصورة الفكرية الأقرب؟",
    "opts": [
      "العَلَم مجرد قطعة قماش بلا دلالة",
      "العَلَم ينشر معنى الحب والانتماء في الوطن",
      "العَلَم يدعو إلى الانعزال",
      "العَلَم يرمز إلى الخوف"
    ],
    "correct": 2,
    "explain": "يصور الشاعر العلم ناشراً للحب والانتماء على أرض الوطن."
  },
  {
    "code": "Q-20260923505",
    "pos": 205,
    "role": "exam_pool",
    "page_start": 10,
    "page_end": 10,
    "concept": "sy-g7-ar-u1-mujarrad-mazid",
    "prompt": "الفعل «أشرقَ» مأخوذ من «شرقَ». ما نوعه من حيث الزيادة؟",
    "opts": [
      "مزيد بثلاثة أحرف",
      "مزيد بحرفين",
      "مزيد بحرف واحد",
      "مجرّد رباعي"
    ],
    "correct": 3,
    "explain": "زِيدت الهمزة على «شرق»، لذلك «أشرق» مزيد بحرف واحد."
  },
  {
    "code": "Q-20260923506",
    "pos": 206,
    "role": "exam_pool",
    "page_start": 10,
    "page_end": 10,
    "concept": "sy-g7-ar-u1-mujarrad-mazid",
    "prompt": "الفعل «تطلَّعَ» مأخوذ من «طلعَ». ما نوعه من حيث الزيادة؟",
    "opts": [
      "مجرّد ثلاثي",
      "مزيد بحرف واحد",
      "مزيد بثلاثة أحرف",
      "مزيد بحرفين"
    ],
    "correct": 4,
    "explain": "«تطلّع» على وزن تفعّل، وفيه زيادة التاء والتضعيف؛ فهو مزيد بحرفين."
  },
  {
    "code": "Q-20260923507",
    "pos": 207,
    "role": "exam_pool",
    "page_start": 10,
    "page_end": 10,
    "concept": "sy-g7-ar-u1-mujarrad-mazid",
    "prompt": "الفعل «استعملَ» مأخوذ من «عملَ». ما نوعه من حيث الزيادة؟",
    "opts": [
      "مزيد بثلاثة أحرف",
      "مزيد بحرف واحد",
      "مزيد بحرفين",
      "مجرّد رباعي"
    ],
    "correct": 1,
    "explain": "زِيدت الألف والسين والتاء على «عمل»، فهو مزيد بثلاثة أحرف."
  },
  {
    "code": "Q-20260923508",
    "pos": 208,
    "role": "exam_pool",
    "page_start": 10,
    "page_end": 10,
    "concept": "sy-g7-ar-u1-mujarrad-mazid",
    "prompt": "الفعل «كلَّفَ» مأخوذ من «كلفَ». ما نوعه من حيث الزيادة؟",
    "opts": [
      "مزيد بحرفين",
      "مزيد بحرف واحد",
      "مزيد بثلاثة أحرف",
      "مجرّد رباعي"
    ],
    "correct": 2,
    "explain": "التضعيف في «كلّف» يمثل زيادة حرف، لذلك هو مزيد بحرف واحد."
  },
  {
    "code": "Q-20260923509",
    "pos": 209,
    "role": "exam_pool",
    "page_start": 9,
    "page_end": 10,
    "concept": "sy-g7-ar-u1-mujarrad-mazid",
    "prompt": "أيُّ الأفعال الآتية فعلٌ مجرّد رباعي؟",
    "opts": [
      "استغفرَ",
      "أكرمَ",
      "انطلقَ",
      "بعثرَ"
    ],
    "correct": 4,
    "explain": "حروف «بعثر» الأربعة أصلية، فهو مجرّد رباعي."
  },
  {
    "code": "Q-20260923510",
    "pos": 210,
    "role": "exam_pool",
    "page_start": 9,
    "page_end": 10,
    "concept": "sy-g7-ar-u1-mujarrad-mazid",
    "prompt": "أيُّ الأفعال الآتية فعلٌ مجرّد ثلاثي؟",
    "opts": [
      "نظرَ",
      "تعلّمَ",
      "استخرجَ",
      "أكرمَ"
    ],
    "correct": 1,
    "explain": "«نظر» ثلاثة أحرف أصلية من دون زيادة، فهو مجرّد ثلاثي."
  },
  {
    "code": "Q-20260923511",
    "pos": 211,
    "role": "exam_pool",
    "page_start": 12,
    "page_end": 14,
    "concept": "sy-g7-ar-u1-cooperation-reading",
    "prompt": "في معنى قول الشاعر: «بالحبِّ نصنعُ ما نشاءُ من العُلا وتذوبُ فيه فوارقُ الطبقات»، ما أثر المحبة؟",
    "opts": [
      "تمنع الناس من العمل",
      "تزيد العزلة بين أفراد المجتمع",
      "تقوّي التعاون وتخفّف الفوارق بين الناس",
      "تجعل النجاح مستحيلاً"
    ],
    "correct": 3,
    "explain": "يربط الشاعر المحبة بالتعاون وتجاوز الفوارق بين الناس."
  },
  {
    "code": "Q-20260923512",
    "pos": 212,
    "role": "exam_pool",
    "page_start": 12,
    "page_end": 14,
    "concept": "sy-g7-ar-u1-cooperation-reading",
    "prompt": "في معنى العبارة «أيادٍ تشاركُ في بناءِ الآتي»، إلى ماذا تشير المشاركة؟",
    "opts": [
      "العيش بعيداً عن المجتمع",
      "الإسهام الجماعي في بناء المستقبل",
      "الاعتماد على فرد واحد فقط",
      "ترك العمل للآخرين"
    ],
    "correct": 2,
    "explain": "المشاركة تعني أن أفراد المجتمع يتعاونون في صنع المستقبل."
  },
  {
    "code": "Q-20260923513",
    "pos": 213,
    "role": "exam_pool",
    "page_start": 13,
    "page_end": 13,
    "concept": "sy-g7-ar-u1-cooperation-reading",
    "prompt": "أيُّ الكلمات الآتية تنتمي أكثر إلى مجال الإحساس كما في درس «التعاون»؟",
    "opts": [
      "هَوًى",
      "حجر",
      "طبقات",
      "جزء"
    ],
    "correct": 1,
    "explain": "«هوى» تعبّر عن شعور ومحبة، فهي من مجال الإحساس."
  },
  {
    "code": "Q-20260923514",
    "pos": 214,
    "role": "exam_pool",
    "page_start": 12,
    "page_end": 12,
    "concept": "sy-g7-ar-u1-cooperation-reading",
    "prompt": "ما معنى كلمة «رغد» في مفردات نص «التعاون»؟",
    "opts": [
      "مظلمٌ وحزين",
      "شديدٌ وصعب",
      "قليلٌ ونادر",
      "طيب"
    ],
    "correct": 4,
    "explain": "«رغد» تعني: طيب."
  },
  {
    "code": "Q-20260923515",
    "pos": 215,
    "role": "exam_pool",
    "page_start": 16,
    "page_end": 17,
    "concept": "sy-g7-ar-u1-sahih-mutal",
    "prompt": "ما نوع الفعل «سألَ» من أنواع الفعل الصحيح؟",
    "opts": [
      "صحيح سالم",
      "صحيح مهموز",
      "صحيح مضعّف",
      "معتل مثال"
    ],
    "correct": 2,
    "explain": "في «سأل» همزة أصلية، لذلك هو فعل صحيح مهموز."
  },
  {
    "code": "Q-20260923516",
    "pos": 216,
    "role": "exam_pool",
    "page_start": 16,
    "page_end": 17,
    "concept": "sy-g7-ar-u1-sahih-mutal",
    "prompt": "ما نوع الفعل «مدَّ» من أنواع الفعل الصحيح؟",
    "opts": [
      "صحيح سالم",
      "صحيح مهموز",
      "صحيح مضعّف",
      "معتل أجوف"
    ],
    "correct": 3,
    "explain": "«مدّ» فيه حرف أصلي مضعّف، فهو صحيح مضعّف."
  },
  {
    "code": "Q-20260923517",
    "pos": 217,
    "role": "exam_pool",
    "page_start": 16,
    "page_end": 17,
    "concept": "sy-g7-ar-u1-sahih-mutal",
    "prompt": "ما نوع الفعل «جلسَ» من أنواع الفعل الصحيح؟",
    "opts": [
      "معتل ناقص",
      "صحيح مهموز",
      "صحيح مضعّف",
      "صحيح سالم"
    ],
    "correct": 4,
    "explain": "حروف «جلس» خالية من الهمزة والتضعيف وحروف العلة، فهو صحيح سالم."
  },
  {
    "code": "Q-20260923518",
    "pos": 218,
    "role": "exam_pool",
    "page_start": 16,
    "page_end": 17,
    "concept": "sy-g7-ar-u1-sahih-mutal",
    "prompt": "الفعل «وعدَ» من حيث موقع حرف العلة هو:",
    "opts": [
      "معتل مثال",
      "معتل أجوف",
      "معتل ناقص",
      "صحيح سالم"
    ],
    "correct": 1,
    "explain": "حرف العلة في أول «وعد»، لذلك هو معتل مثال."
  },
  {
    "code": "Q-20260923519",
    "pos": 219,
    "role": "exam_pool",
    "page_start": 16,
    "page_end": 17,
    "concept": "sy-g7-ar-u1-sahih-mutal",
    "prompt": "الفعل «باعَ» من حيث موقع حرف العلة هو:",
    "opts": [
      "معتل مثال",
      "معتل أجوف",
      "معتل ناقص",
      "صحيح مهموز"
    ],
    "correct": 2,
    "explain": "حرف العلة في وسط الفعل، لذلك «باع» معتل أجوف."
  },
  {
    "code": "Q-20260923520",
    "pos": 220,
    "role": "exam_pool",
    "page_start": 16,
    "page_end": 17,
    "concept": "sy-g7-ar-u1-sahih-mutal",
    "prompt": "الفعل «رمى» من حيث موقع حرف العلة هو:",
    "opts": [
      "معتل أجوف",
      "معتل مثال",
      "معتل ناقص",
      "صحيح مضعّف"
    ],
    "correct": 3,
    "explain": "حرف العلة في آخر الفعل، لذلك «رمى» معتل ناقص."
  }
]
$json$::jsonb;
begin
  select id into v_workspace
  from public.workspaces
  where slug='family-learning-hub'
  limit 1;

  select id into v_curriculum
  from public.curricula
  where code='syrian-national' and is_active
  limit 1;

  select id into v_arabic
  from public.subjects
  where code='arabic'
  limit 1;

  select id into v_program
  from public.learning_programs
  where workspace_id=v_workspace
    and slug='syrian-g7-2026-2027'
  limit 1;

  if v_workspace is null or v_curriculum is null or v_arabic is null or v_program is null then
    raise exception 'SY_G7_ARABIC_U1_PREREQUISITES_MISSING';
  end if;

  select id into v_book
  from public.books
  where code='AR-LUGATI-G7-T1'
    and curriculum_id=v_curriculum
    and subject_id=v_arabic
  limit 1;

  if v_book is null then
    insert into public.books(
      subject_id,code,title,grade_level,school_year,language,pdf_pages,
      source_metadata,curriculum_id,source_kind
    ) values (
      v_arabic,
      'AR-LUGATI-G7-T1',
      'اللغة العربية - الصف السابع الأساسي - الفصل الأول',
      7,
      '2025-2026',
      'ar',
      99,
      jsonb_build_object(
        'assigned_student','Mohammad',
        'visual_book_url','https://docs.google.com/presentation/d/10MfzOzHaCW3AtbTEUnSxcHylgptiIjMhc8rfjCVPVOw/edit',
        'visual_page_mapping','PDF page = Google Slides slide, 1:1',
        'academic_year_on_cover','2025-2026',
        'edition_check_date','2026-09-01',
        'edition_status','2025-2026 cover edition; no distinct 2026-2027 cover verified',
        'question_standalone_policy','REQUIRED'
      ),
      v_curriculum,
      'textbook'
    )
    returning id into v_book;
  end if;

  insert into public.program_subjects(
    workspace_id,program_id,subject_id,display_name,sort_order,metadata
  ) values (
    v_workspace,v_program,v_arabic,'اللغة العربية',20,
    jsonb_build_object('book_code','AR-LUGATI-G7-T1','term',1)
  )
  on conflict (program_id,subject_id) do update
  set display_name=excluded.display_name,
      sort_order=excluded.sort_order,
      metadata=excluded.metadata,
      updated_at=now();

  select id into v_program_subject
  from public.program_subjects
  where program_id=v_program and subject_id=v_arabic
  limit 1;

  insert into public.program_books(
    workspace_id,program_id,book_id,program_subject_id,is_required,sort_order,metadata
  )
  select
    v_workspace,v_program,v_book,v_program_subject,true,20,
    jsonb_build_object(
      'source_year','2025-2026',
      'term',1,
      'self_contained_questions',true
    )
  where not exists (
    select 1 from public.program_books
    where workspace_id=v_workspace and program_id=v_program and book_id=v_book
  );

  select id into v_unit
  from public.units
  where book_id=v_book and slug='unit-1-belonging-citizenship'
  limit 1;

  if v_unit is null then
    insert into public.units(book_id,slug,title,sort_order,metadata)
    values(
      v_book,
      'unit-1-belonging-citizenship',
      'الوحدة الأولى — الانتماء والمواطنة',
      1,
      jsonb_build_object('pdf_page_start',3,'pdf_page_end',35)
    )
    returning id into v_unit;
  end if;

  insert into public.learning_concepts(
    workspace_id,subject_id,curriculum_id,code,title,description,grade_level,metadata
  ) values
    (
      v_workspace,v_arabic,v_curriculum,
      'sy-g7-ar-u1-flag-reading',
      'عَلَمُ بلادي — فهم ومفردات',
      'فهم المعاني والمفردات والقيم الواردة في درس عَلَمُ بلادي.',
      7,
      jsonb_build_object('book_code','AR-LUGATI-G7-T1','pdf_pages',jsonb_build_array(5,6,7,8))
    ),
    (
      v_workspace,v_arabic,v_curriculum,
      'sy-g7-ar-u1-mujarrad-mazid',
      'المجرّد والمزيد',
      'تمييز الفعل المجرّد من المزيد وتحديد عدد أحرف الزيادة ورد الفعل إلى مجرّده.',
      7,
      jsonb_build_object('book_code','AR-LUGATI-G7-T1','pdf_pages',jsonb_build_array(9,10,11))
    ),
    (
      v_workspace,v_arabic,v_curriculum,
      'sy-g7-ar-u1-cooperation-reading',
      'التعاون — فهم ومفردات',
      'فهم الأفكار والقيم والمفردات في نص التعاون.',
      7,
      jsonb_build_object('book_code','AR-LUGATI-G7-T1','pdf_pages',jsonb_build_array(12,13,14))
    ),
    (
      v_workspace,v_arabic,v_curriculum,
      'sy-g7-ar-u1-sahih-mutal',
      'الفعل الصحيح والمعتل',
      'تمييز الفعل الصحيح والمعتل وأنواع كل منهما.',
      7,
      jsonb_build_object('book_code','AR-LUGATI-G7-T1','pdf_pages',jsonb_build_array(15,16,17))
    )
  on conflict (workspace_id,code) do update
  set title=excluded.title,
      description=excluded.description,
      curriculum_id=excluded.curriculum_id,
      grade_level=excluded.grade_level,
      metadata=excluded.metadata,
      updated_at=now();

  if exists (
    select 1
    from public.quizzes
    where workspace_id=v_workspace and slug='sy-g7-arabic-u1-foundations-20260923-a'
  ) then
    raise exception 'SY_G7_ARABIC_U1_QUIZ_ALREADY_EXISTS';
  end if;

  insert into public.quizzes(
    workspace_id,subject_id,book_id,slug,title,description,status,curriculum_id,
    unit_id,quiz_kind,delivery_config
  ) values (
    v_workspace,
    v_arabic,
    v_book,
    'sy-g7-arabic-u1-foundations-20260923-a',
    'اللغة العربية 7 — الوحدة الأولى — تدريب 23 سبتمبر',
    'تدريب لمحمد من نطاق عَلَمُ بلادي والمجرّد والمزيد والتعاون والفعل الصحيح والمعتل. وضع التعلّم 10 أسئلة، ووضع الامتحان 20 سؤالاً مستقلاً.',
    'active',
    v_curriculum,
    v_unit,
    'review',
    jsonb_build_object(
      'learning',jsonb_build_object(
        'question_count',10,
        'hints',true,
        'retry',true,
        'adaptive',false,
        'remediation',false,
        'instant_feedback',true,
        'progressive_hints',true
      ),
      'exam',jsonb_build_object(
        'question_count',20,
        'independent_question_pool',true,
        'hints',false,
        'retry',false,
        'instant_feedback',false,
        'show_results_after_submit',true
      ),
      'source_pages',jsonb_build_array(5,17)
    )
  )
  returning id into v_quiz;

  insert into public.quiz_versions(
    workspace_id,quiz_id,version_no,state,instructions,settings,published_at,
    question_language,explanation_language,terminology_display_mode
  ) values (
    v_workspace,
    v_quiz,
    1,
    'published',
    'محمد: ابدأ بوضع التعلّم. اقرأ السؤال بنفسك واستخدم التلميحات فقط عند الحاجة. بعد إنهاء الأسئلة العشرة انتقل إلى وضع الامتحان؛ أسئلة الامتحان مختلفة ولا تظهر إجاباتها قبل التسليم.',
    jsonb_build_object(
      'two_mode_model',true,
      'learning_question_count',10,
      'exam_question_count',20,
      'learning_questions_distinct_from_exam',true,
      'paper_questions_distinct_from_online',true,
      'paper_model_code','MOH-AR7-U1-CONT-20260923',
      'paper_quiz_slug','sy-g7-arabic-u1-cont-paper-20260923',
      'paper_scope','الوحدة الأولى — متابعة الصفحات 18–35',
      'paper_artifact','Mohammad_AR_G7_Unit1_Continuation_Paper_20Q_20260923.pdf',
      'paper_artifact_url','https://drive.google.com/file/d/1u14SZc57gHeAPA8PP2dyWnu1MF9W6QHS/view?usp=drivesdk',
      'paper_artifact_sha256','3ab145006f1809d873fb4bfd9a5df5f66fcffc72dd7143f9a7c11db51b6036e6'
    ),
    now(),
    'ar',
    'ar',
    'source_only'
  )
  returning id into v_version;

  insert into public.program_quizzes(
    workspace_id,program_id,quiz_id,program_subject_id,availability,sort_order,metadata
  ) values (
    v_workspace,v_program,v_quiz,v_program_subject,'available',20,
    jsonb_build_object(
      'scope','الوحدة الأولى: عَلَمُ بلادي، المجرّد والمزيد، التعاون، الصحيح والمعتل',
      'modes',jsonb_build_array('learning','exam','paper'),
      'paper_question_count',20,
      'paper_model_code','MOH-AR7-U1-CONT-20260923',
      'paper_quiz_slug','sy-g7-arabic-u1-cont-paper-20260923',
      'paper_artifact_url','https://drive.google.com/file/d/1u14SZc57gHeAPA8PP2dyWnu1MF9W6QHS/view?usp=drivesdk'
    )
  )
  on conflict (program_id,quiz_id) do update
  set program_subject_id=excluded.program_subject_id,
      availability='available',
      sort_order=excluded.sort_order,
      metadata=excluded.metadata,
      updated_at=now();

  for v_item in select value from jsonb_array_elements(v_items) loop
    select id into v_concept
    from public.learning_concepts
    where workspace_id=v_workspace
      and code=v_item->>'concept'
    limit 1;

    if v_concept is null then
      raise exception 'MISSING_CONCEPT: %', v_item->>'concept';
    end if;

    insert into public.quiz_questions(
      workspace_id,quiz_version_id,position,question_type,prompt,origin,
      source_page_start,source_page_end,source_metadata,points,
      difficulty_level,max_attempts,remediation_after_attempt,adaptive_enabled,
      delivery_role,prompt_language,terminology_display_mode,question_code
    ) values (
      v_workspace,
      v_version,
      (v_item->>'pos')::integer,
      'single_choice',
      v_item->>'prompt',
      'generated',
      (v_item->>'page_start')::integer,
      (v_item->>'page_end')::integer,
      jsonb_build_object(
        'source_type','GENERATED_SIMILAR',
        'book_code','AR-LUGATI-G7-T1',
        'unit','الوحدة الأولى — الانتماء والمواطنة',
        'source_verified','Project AI-ready Markdown',
        'standalone_question',true
      ),
      1,
      case when v_item->>'role'='exam_pool' then 2 else 1 end,
      case when v_item->>'role'='core' then 4 else 1 end,
      case when v_item->>'role'='core' then 4 else 1 end,
      false,
      v_item->>'role',
      'ar',
      'source_only',
      v_item->>'code'
    )
    returning id into v_question;

    v_i := 0;
    for v_option in select value from jsonb_array_elements_text(v_item->'opts') loop
      v_i := v_i + 1;
      insert into public.quiz_question_options(
        workspace_id,question_id,position,label,content
      ) values (
        v_workspace,v_question,v_i,chr(64+v_i),v_option
      );
    end loop;

    insert into public.quiz_question_answer_keys(
      question_id,workspace_id,correct_answer,explanation,
      correct_explanation,final_incorrect_explanation,grading_config
    ) values (
      v_question,
      v_workspace,
      jsonb_build_object('option_position',(v_item->>'correct')::integer),
      v_item->>'explain',
      v_item->>'explain',
      v_item->>'explain',
      '{}'::jsonb
    );

    if v_item ? 'hints' then
      v_i := 0;
      for v_hint in select value from jsonb_array_elements_text(v_item->'hints') loop
        v_i := v_i + 1;
        insert into public.quiz_question_hints(
          workspace_id,question_id,hint_level,pedagogical_role,
          content,metadata,language,terminology_display_mode
        ) values (
          v_workspace,
          v_question,
          v_i,
          case v_i when 1 then 'nudge' when 2 then 'guide' else 'strong_guide' end,
          v_hint,
          '{}'::jsonb,
          'ar',
          'source_only'
        );
      end loop;
    end if;

    insert into public.quiz_question_concepts(
      workspace_id,question_id,concept_id,is_primary,weight
    ) values (
      v_workspace,v_question,v_concept,true,1
    );
  end loop;


  -- Register the already-approved, already-sent 20-question continuation paper
  -- as an immutable paper-only quiz version. Keeping it in a separate quiz
  -- prevents its questions from entering the online Learning or Exam pools.
  insert into public.learning_concepts(
    workspace_id,subject_id,curriculum_id,code,title,description,grade_level,metadata
  ) values
    (
      v_workspace,v_arabic,v_curriculum,
      'sy-g7-ar-u1-ya-sham',
      'يا شام — فهم ومفردات',
      'فهم المعنى العام والمفردات ودلالات التعلّق بالوطن في قصيدة يا شام.',
      7,
      jsonb_build_object('book_code','AR-LUGATI-G7-T1','pdf_page_start',18,'pdf_page_end',24)
    ),
    (
      v_workspace,v_arabic,v_curriculum,
      'sy-g7-ar-u1-mizan-sarfi',
      'الميزان الصرفي',
      'وزن الأفعال والأسماء الثلاثية والرباعية والمزيدة.',
      7,
      jsonb_build_object('book_code','AR-LUGATI-G7-T1','pdf_page_start',22,'pdf_page_end',24)
    ),
    (
      v_workspace,v_arabic,v_curriculum,
      'sy-g7-ar-u1-shaer-watan',
      'شاعر ووطن — نزار قباني',
      'فهم دلالات ارتباط الشاعر بدمشق والوطن.',
      7,
      jsonb_build_object('book_code','AR-LUGATI-G7-T1','pdf_page_start',25,'pdf_page_end',29)
    ),
    (
      v_workspace,v_arabic,v_curriculum,
      'sy-g7-ar-u1-alif-layyina',
      'الألف اللينة',
      'تمييز رسم الألف اللينة في الكلمات الثلاثية وفوق الثلاثية.',
      7,
      jsonb_build_object('book_code','AR-LUGATI-G7-T1','pdf_page_start',29,'pdf_page_end',33)
    ),
    (
      v_workspace,v_arabic,v_curriculum,
      'sy-g7-ar-u1-opinion',
      'إبداء الرأي',
      'خطوات إبداء الرأي وصفات المتحدث الناجح.',
      7,
      jsonb_build_object('book_code','AR-LUGATI-G7-T1','pdf_page_start',33,'pdf_page_end',35)
    )
  on conflict (workspace_id,code) do update
  set title=excluded.title,
      description=excluded.description,
      curriculum_id=excluded.curriculum_id,
      grade_level=excluded.grade_level,
      metadata=excluded.metadata,
      updated_at=now();

  if exists (
    select 1 from public.quizzes
    where workspace_id=v_workspace and slug=v_paper_quiz_slug
  ) then
    raise exception 'SY_G7_ARABIC_U1_PAPER_QUIZ_ALREADY_EXISTS';
  end if;

  if exists (
    select 1 from public.quiz_versions
    where workspace_id=v_workspace
      and settings->'paper_exam'->>'paper_model_code'=v_paper_model_code
  ) then
    raise exception 'SY_G7_ARABIC_U1_PAPER_MODEL_ALREADY_EXISTS';
  end if;

  insert into public.quizzes(
    workspace_id,subject_id,book_id,slug,title,description,status,curriculum_id,
    unit_id,quiz_kind,delivery_config
  ) values (
    v_workspace,
    v_arabic,
    v_book,
    v_paper_quiz_slug,
    'اللغة العربية 7 — الوحدة الأولى — ورقة متابعة 23 سبتمبر',
    'النسخة الخلفية المطابقة للورقة المطبوعة ذات 20 سؤالاً والمستقلة عن أسئلة Learning وExam.',
    'active',
    v_curriculum,
    v_unit,
    'review',
    jsonb_build_object(
      'paper_only',true,
      'paper_model_code',v_paper_model_code,
      'question_count',20
    )
  )
  returning id into v_paper_quiz;

  insert into public.quiz_versions(
    workspace_id,quiz_id,version_no,state,instructions,settings,published_at,
    question_language,explanation_language,terminology_display_mode
  ) values (
    v_workspace,
    v_paper_quiz,
    1,
    'published',
    'نسخة خلفية ثابتة للورقة المطبوعة MOH-AR7-U1-CONT-20260923. لا تستخدم كـLearning أو Exam تفاعلي.',
    '{}'::jsonb,
    now(),
    'ar',
    'ar',
    'source_only'
  )
  returning id into v_paper_version;

  for v_paper_item in select value from jsonb_array_elements(v_paper_package) loop
    select id into v_paper_concept
    from public.learning_concepts
    where workspace_id=v_workspace
      and code=v_paper_item->>'concept'
    limit 1;

    if v_paper_concept is null then
      raise exception 'MISSING_PAPER_CONCEPT: %', v_paper_item->>'concept';
    end if;

    insert into public.quiz_questions(
      workspace_id,quiz_version_id,position,question_type,prompt,origin,
      source_page_start,source_page_end,source_metadata,points,
      difficulty_level,max_attempts,remediation_after_attempt,adaptive_enabled,
      delivery_role,prompt_language,terminology_display_mode,question_code
    ) values (
      v_workspace,
      v_paper_version,
      (v_paper_item->>'n')::integer,
      'single_choice',
      v_paper_item->>'prompt',
      'generated',
      (v_paper_item->>'page_start')::integer,
      (v_paper_item->>'page_end')::integer,
      jsonb_build_object(
        'source_type','GENERATED_SIMILAR',
        'book_code','AR-LUGATI-G7-T1',
        'paper_only',true,
        'paper_model_code',v_paper_model_code,
        'source_verified','Project source + approved printed artifact',
        'standalone_question',true
      ),
      1,
      2,
      1,
      1,
      false,
      'core',
      'ar',
      'source_only',
      v_paper_item->>'code'
    )
    returning id into v_paper_question;

    v_paper_i := 0;
    for v_paper_option in
      select value from jsonb_array_elements_text(v_paper_item->'opts')
    loop
      v_paper_i := v_paper_i + 1;
      insert into public.quiz_question_options(
        workspace_id,question_id,position,label,content
      ) values (
        v_workspace,v_paper_question,v_paper_i,chr(64+v_paper_i),v_paper_option
      );
    end loop;

    insert into public.quiz_question_answer_keys(
      question_id,workspace_id,correct_answer,explanation,
      correct_explanation,final_incorrect_explanation,grading_config
    ) values (
      v_paper_question,
      v_workspace,
      jsonb_build_object('option_position',(v_paper_item->>'correct')::integer),
      v_paper_item->>'explain',
      v_paper_item->>'explain',
      v_paper_item->>'explain',
      '{}'::jsonb
    );

    insert into public.quiz_question_concepts(
      workspace_id,question_id,concept_id,is_primary,weight
    ) values (
      v_workspace,v_paper_question,v_paper_concept,true,1
    );

    v_paper_map := v_paper_map || jsonb_build_object(
      (v_paper_item->>'n'),
      jsonb_build_object(
        'question_id',v_paper_question,
        'question_code',v_paper_item->>'code',
        'option_positions',jsonb_build_object('A',1,'B',2,'C',3,'D',4)
      )
    );
  end loop;

  update public.quiz_versions
  set settings=jsonb_build_object(
    'paper_exam',jsonb_build_object(
      'paper_model_code',v_paper_model_code,
      'paper_page_count',2,
      'paper_question_count',20,
      'paper_question_map',v_paper_map,
      'paper_hash_algorithm','sha256',
      'paper_hash_basis','canonical-runtime-package-v1',
      'source_book_code','AR-LUGATI-G7-T1',
      'source_pdf_page_start',18,
      'source_pdf_page_end',35,
      'approved_artifact','Mohammad_AR_G7_Unit1_Continuation_Paper_20Q_20260923.pdf',
      'approved_artifact_url','https://drive.google.com/file/d/1u14SZc57gHeAPA8PP2dyWnu1MF9W6QHS/view?usp=drivesdk',
      'approved_artifact_sha256','3ab145006f1809d873fb4bfd9a5df5f66fcffc72dd7143f9a7c11db51b6036e6',
      'approved_at','2026-09-23T15:38:49+03:00',
      'approval_note','Existing two-page black-and-white paper previously generated and sent to Mohammad; recovered from the original sent Gmail attachment before backend registration.',
      'layout',jsonb_build_object(
        'page_size','A4',
        'orientation','portrait',
        'columns_per_page',2,
        'direction','rtl',
        'print_mode','black_and_white',
        'questions_per_page',10
      ),
      'online_question_sets_distinct',true
    )
  )
  where workspace_id=v_workspace and id=v_paper_version;

  v_paper_canonical := public.flh_paper_exam_runtime_package(v_workspace,v_paper_version);
  if v_paper_canonical is null or jsonb_array_length(v_paper_canonical) <> 20 then
    raise exception 'SY_G7_ARABIC_U1_PAPER_CANONICAL_PACKAGE_INVALID';
  end if;

  v_paper_hash := encode(
    extensions.digest(convert_to(v_paper_canonical::text,'UTF8'),'sha256'),
    'hex'
  );

  update public.quiz_versions
  set settings=jsonb_set(
    jsonb_set(
      jsonb_set(
        settings,
        '{paper_exam,paper_canonical_package}',
        v_paper_canonical,
        true
      ),
      '{paper_exam,paper_content_hash}',
      to_jsonb(v_paper_hash),
      true
    ),
    '{paper_exam,paper_runtime_content_hash}',
    to_jsonb(v_paper_hash),
    true
  )
  where workspace_id=v_workspace and id=v_paper_version;
end;
$migration$;