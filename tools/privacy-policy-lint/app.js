/* toolhub — privacy-policy-lint 브라우저 번들. 도구 원본 소스를 그대로 임베드(수정 없음). */
(function(){
"use strict";
var __modules = {};
var __cache = {};
function require(name){
  var key = String(name).replace(/^\.\//, "").replace(/\.js$/, "");
  if (__cache[key]) return __cache[key].exports;
  var def = __modules[key];
  if (!def) throw new Error("module not found: " + name);
  var module = { exports: {} };
  __cache[key] = module;
  def(module, module.exports, require);
  return module.exports;
}
__modules["linter"] = function(module, exports, require){
"use strict";
//
// 개인정보처리방침 필수기재 존재검사 엔진 — 결정론·오프라인·무의존성.
//
// 핵심: 붙여넣은 처리방침 텍스트에서 법정 열거 항목의 "존재/미감지"만 판정한다.
//   존재검사 ≠ 내용검사. (제목/키워드가 있어도 내용이 비어 있을 수 있음 → false-green 배너로 상시 고지)

const { LIST_BASIS, MANDATORY, CONDITIONAL, FORMAL } = require("./rules");

// 공백을 제거해 "처리 목적" ↔ "처리목적" 표기차를 흡수하고, 영문은 소문자화한다.
// 가운뎃점(·)·괄호는 보존(패턴이 이를 그대로 담고 있음).
function normalize(text) {
  if (typeof text !== "string") return "";
  return text.replace(/\s+/g, "").toLowerCase();
}

// 정규화 텍스트에서 pattern 을 찾되, notBefore 에 속한 문자가 바로 앞에 오면 그 매치는 무시한다.
// (한국어는 word boundary 가 없어 substring 오탐이 잦음 — C227 교훈)
function matchPattern(haystack, pattern, notBefore) {
  if (!pattern) return false;
  let idx = haystack.indexOf(pattern);
  while (idx !== -1) {
    const prev = idx > 0 ? haystack[idx - 1] : "";
    if (!notBefore || notBefore.length === 0 || notBefore.indexOf(prev) === -1) {
      return true;
    }
    idx = haystack.indexOf(pattern, idx + 1);
  }
  return false;
}

// base 가 haystack 에 나타나고, 그 주변 ±window 안에 tokens 중 하나가 있으면 true.
// (전체 문서 co-occurrence 는 '행사방법' 등 흔한 토큰으로 오염되므로 '근접'을 요구한다)
function matchNear(haystack, base, tokens, window) {
  if (!base || !tokens || tokens.length === 0) return false;
  let idx = haystack.indexOf(base);
  while (idx !== -1) {
    const start = Math.max(0, idx - window);
    const end = idx + base.length + window;
    const region = haystack.slice(start, end);
    for (const t of tokens) {
      if (t && region.indexOf(t) !== -1) return true;
    }
    idx = haystack.indexOf(base, idx + 1);
  }
  return false;
}

// 한 항목(item)이 텍스트에 감지되는가.
//   - patterns: 하나라도 매치하면 감지(강매치)
//   - near: 근접 규칙 중 하나라도 만족하면 감지(약패턴의 假绿 방지)
function detectItem(haystack, item) {
  for (const p of item.patterns || []) {
    if (matchPattern(haystack, normalize(p))) return true;
  }
  for (const nr of item.near || []) {
    const tokens = (nr.tokens || []).map(normalize);
    if (matchNear(haystack, normalize(nr.base), tokens, nr.window || 12)) return true;
  }
  return false;
}

// 전체 검사. 입력 텍스트가 비었으면 명확히 알린다(경계 방어).
function lint(text) {
  const raw = typeof text === "string" ? text : "";
  const haystack = normalize(raw);
  const empty = haystack.length === 0;

  const mandatory = MANDATORY.map((item) => ({
    id: item.id,
    label: item.label,
    law: item.law,
    detected: empty ? false : detectItem(haystack, item),
  }));

  const conditional = CONDITIONAL.map((item) => ({
    id: item.id,
    label: item.label,
    law: item.law,
    trigger: item.trigger,
    isNew: !!item.isNew,
    detected: empty ? false : detectItem(haystack, item),
  }));

  const formal = FORMAL.map((item) => ({
    id: item.id,
    label: item.label,
    law: item.law,
    detected: empty ? false : detectItem(haystack, item),
  }));

  const mandatoryMissing = mandatory.filter((m) => !m.detected);
  const formalMissing = formal.filter((f) => !f.detected);
  // conditional 미감지는 "결함"이 아니라 "해당 시 확인" — 별도로 노출만 한다.
  const conditionalAbsent = conditional.filter((c) => !c.detected);

  return {
    basis: LIST_BASIS,
    empty,
    mandatory,
    conditional,
    formal,
    summary: {
      mandatoryTotal: mandatory.length,
      mandatoryMissing: mandatoryMissing.length,
      mandatoryMissingIds: mandatoryMissing.map((m) => m.id),
      formalMissing: formalMissing.length,
      conditionalAbsent: conditionalAbsent.length,
    },
  };
}

module.exports = { normalize, matchPattern, matchNear, detectItem, lint };

};
__modules["render"] = function(module, exports, require){
"use strict";
//
// 리포트 렌더러 — 정직성 경계를 여기서 강제한다.
//   - 판정어("위법", "불법", "과태료", "합법", "통과") 를 절대 출력하지 않는다(변호사법 경계).
//   - "감지됨"이 내용 충실을 보증하지 않는다는 false-green 배너를 상시 노출한다.
//   - 필수(항상) / 해당 시 필수(조건) / 형식 을 물리적으로 분리한다.

const DISCLAIMER = [
  "※ 본 도구는 「개인정보 보호법」·작성지침이 열거한 항목의 '형식적 존재 여부'만 자가점검합니다.",
  "※ 준수 여부나 법적 효력을 판정하지 않습니다. '감지됨'은 해당 제목·키워드가 텍스트에 있다는 뜻일 뿐,",
  "   내용이 충실히 작성되었음을 보증하지 않습니다(제목만 있고 내용이 비어도 감지됨으로 표시될 수 있음).",
  "※ 정확한 판단은 개인정보 보호 전문가·변호사 상담을 권장합니다. 이 도구는 항목을 대신 작성하지 않습니다.",
];

function mark(detected) {
  return detected ? "○ 감지됨" : "● 미감지";
}

function renderReport(result) {
  const lines = [];
  lines.push("개인정보처리방침 필수기재 항목 자가점검 (존재검사)");
  lines.push("기준: " + result.basis);
  lines.push("");

  if (result.empty) {
    lines.push("입력 텍스트가 비어 있습니다. 점검할 처리방침 본문을 넣어 주세요.");
    lines.push("");
    lines.push(...DISCLAIMER);
    return lines.join("\n");
  }

  // 1) 항상 필수
  lines.push("[1] 항상 포함되어야 하는 항목 (법정 필수)");
  for (const m of result.mandatory) {
    const tag = m.detected ? "" : "  → 검토권고: 필수 열거 항목이 텍스트에서 미감지되었습니다.";
    lines.push(`  ${mark(m.detected)}  ${m.label}  (${m.law})${tag}`);
  }
  lines.push("");

  // 2) 해당 시 필수 (미감지를 결함으로 보지 않음)
  lines.push("[2] 해당 시 포함되어야 하는 항목 (귀사가 해당 행위를 할 때만 필수 — 미감지는 결함 아님)");
  for (const c of result.conditional) {
    const newTag = c.isNew ? " [2024 개정 신설]" : "";
    if (c.detected) {
      lines.push(`  ○ 감지됨  ${c.label}  (${c.law})${newTag}`);
    } else {
      lines.push(`  - 미감지  ${c.label}  (${c.law})${newTag}`);
      lines.push(`      해당 시 확인: ${c.trigger} 관련 기재가 필요합니다.`);
    }
  }
  lines.push("");

  // 3) 형식 요건
  lines.push("[3] 형식 요건 (권고)");
  for (const f of result.formal) {
    const tag = f.detected ? "" : "  → 권고: 미감지";
    lines.push(`  ${mark(f.detected)}  ${f.label}${tag}`);
  }
  lines.push("");

  // 요약 — 판정어 없이 미감지 개수만.
  const s = result.summary;
  lines.push("[요약]");
  lines.push(
    `  항상 필수 ${s.mandatoryTotal}개 중 ${s.mandatoryMissing}개 미감지` +
      (s.mandatoryMissing > 0
        ? ` (${s.mandatoryMissingIds.join(", ")}) → 위 항목을 직접 확인하세요.`
        : " → 필수 항목 제목·키워드는 모두 감지되었습니다(내용 충실성은 별도 확인 필요).")
  );
  lines.push(`  형식 요건 미감지 ${s.formalMissing}개, 해당 시 필수 중 미감지 ${s.conditionalAbsent}개(정상일 수 있음).`);
  lines.push("");
  lines.push(...DISCLAIMER);

  return lines.join("\n");
}

module.exports = { renderReport, DISCLAIMER };

};
__modules["rules"] = function(module, exports, require){
"use strict";
//
// 개인정보처리방침 법정 필수기재 항목 존재검사 — 규칙(封闭清单)
//
// 근거: 「개인정보 보호법」 §30①, 같은 법 시행령 §31①,
//       개인정보보호위원회 「개인정보 처리방침 작성지침」(2025.4 개정) 목차.
//
// 이 파일이 이 제품의 유일한 진짜 순증(順增)이다:
//   (1) 항목 목록이 우리가 지어낸 게 아니라 "법이 명문으로 열거"한 封闭清单이고,
//   (2) '항상 필수(mandatory)' vs '해당 시 필수(conditional)' 를 물리적으로 분리한다.
//       — 이 분리 로직이 기존 press-release-lint(단일 필수요소 존재검사)와의 차이다.
//
// 정직성 경계(Munger Pre-Mortem 8조건):
//   - 존재검사만 한다(내용의 정확성·충실성 판정 금지 → false-green 배너로 상시 고지).
//   - 합법성/과태료/통과 여부를 판정하지 않는다(변호사법 경계 → render 에서 판정어 미출력).
//   - conditional 항목의 미감지는 결함(killer)이 아니라 "해당 시 확인"으로만 표시.
//   - 목록에 기준일·근거법령을 병기하고, 최근 개정 신설 항목(자동화된 결정)을 포함한다.

// 목록 기준(staleness honesty): 출력 상단에 항상 병기한다.
const LIST_BASIS =
  "개인정보 보호법 §30①·시행령 §31① + 개인정보보호위원회 「개인정보 처리방침 작성지침」(2025.4 개정) 기준. 법 개정 시 최신 조문을 직접 확인하세요.";

// 항상 필수(mandatory-always): 해당 여부와 무관하게 모든 처리방침에 포함되어야 하는 항목.
// 미감지 = "검토권고(필수 열거 항목 미감지)". summary 의 미감지 집계 대상.
const MANDATORY = [
  {
    id: "purpose",
    label: "개인정보의 처리 목적",
    law: "법 §30①1",
    patterns: [
      "처리목적",
      "수집목적",
      "이용목적",
      "수집·이용목적",
      "수집이용목적",
      "수집및이용목적",
      "수집·이용의목적",
    ],
  },
  {
    id: "retention",
    label: "개인정보의 처리 및 보유 기간",
    law: "법 §30①2",
    patterns: [
      "보유기간",
      "보유·이용기간",
      "보유및이용기간",
      "처리및보유기간",
      "보관기간",
      "보존기간", // 실무에서 매우 흔한 이형 (리뷰 MEDIUM 반영)
      "보유기한",
      "보존기한",
      "보유·이용및파기",
    ],
  },
  {
    id: "items",
    label: "처리하는 개인정보의 항목",
    law: "영 §31①",
    patterns: [
      "수집항목",
      "수집하는개인정보항목",
      "수집하는개인정보의항목",
      "처리하는개인정보의항목",
      "개인정보항목",
      "수집·이용항목",
      "수집하는항목",
    ],
  },
  {
    id: "destruction",
    label: "개인정보의 파기 절차 및 방법",
    law: "법 §30①3의2",
    // 리뷰 HIGH 2건 반영: bare '파기'는 '계약 파기'·'파기환송' 등에서 假绿을 낸다.
    // 합성 패턴(파기절차/파기방법 등)은 그대로 강매치하고,
    // bare '파기'는 근접(proximity) 규칙으로만 인정 — 파기 근처(±window)에 절차/방법/방식이 있을 때만.
    // (전체 문서 co-occurrence는 '행사방법' 등으로 오염되므로 근접이 필수)
    patterns: [
      "파기절차",
      "파기방법",
      "파기및절차",
      "파기하는절차",
      "파기방식",
      "파기하는방법",
    ],
    near: [{ base: "파기", tokens: ["절차", "방법", "방식"], window: 12 }],
  },
  {
    id: "rights",
    label: "정보주체와 법정대리인의 권리·의무 및 그 행사방법",
    law: "법 §30①4",
    patterns: [
      "정보주체의권리",
      "권리·의무및그행사방법",
      "권리·의무",
      "권리의무",
      "권리행사방법",
      "열람·정정·삭제",
      "열람정정삭제",
      "정정·삭제",
      "권리행사",
    ],
  },
  {
    id: "officer",
    label: "개인정보 보호책임자(성명·부서·연락처)",
    law: "법 §30①5·§31",
    patterns: [
      "개인정보보호책임자",
      "보호책임자",
      "개인정보관리책임자",
      "개인정보보호담당자",
      "cpo",
      "고충처리부서",
    ],
  },
  {
    id: "safety",
    label: "개인정보의 안전성 확보조치",
    law: "영 §31①",
    patterns: [
      "안전성확보조치",
      "안전성확보",
      "안전조치",
      "기술적·관리적",
      "기술적관리적",
      "기술적/관리적",
      "기술적및관리적",
    ],
  },
  {
    id: "remedy",
    label: "정보주체의 권익침해에 대한 구제방법",
    law: "영 §31①",
    patterns: [
      "권익침해",
      "구제방법",
      "개인정보분쟁조정위원회",
      "개인정보침해신고센터",
      "분쟁조정",
      "침해신고",
    ],
  },
];

// 해당 시 필수(conditional): 그 회사가 실제로 해당 행위를 할 때에만 필수.
// 미감지를 결함으로 보고하지 않는다 → "해당 시 확인" 안내만. (Munger F4: 오탐 노이즈 방지)
const CONDITIONAL = [
  {
    id: "thirdparty",
    label: "개인정보의 제3자 제공",
    law: "법 §30①3",
    trigger: "개인정보를 외부(제휴사·정부기관 등)에 제공한다면",
    patterns: ["제3자제공", "제삼자제공", "제3자에게제공", "제3자", "외부제공"],
  },
  {
    id: "consignment",
    label: "개인정보 처리의 위탁",
    law: "법 §30①3의3",
    trigger: "개인정보 처리를 외부업체에 위탁한다면(배송·결제·클라우드·고객센터 등)",
    patterns: ["처리위탁", "업무위탁", "위탁업체", "수탁자", "수탁업무", "재위탁", "위탁"],
  },
  {
    id: "cookie",
    label: "자동수집장치(쿠키 등)의 설치·운영 및 거부",
    law: "법 §30①6",
    trigger: "쿠키 등 자동수집장치를 사용한다면(대부분의 웹/앱 해당)",
    patterns: ["자동수집장치", "쿠키", "cookie", "접속정보파일", "자동으로수집"],
  },
  {
    id: "overseas",
    label: "개인정보의 국외 이전",
    law: "법 §28의8",
    trigger: "해외 서버·해외업체로 개인정보를 이전한다면",
    patterns: ["국외이전", "국외제공", "해외이전", "국외로이전", "해외로이전"],
  },
  {
    id: "pseudonym",
    label: "가명정보의 처리",
    law: "법 §28의2 등",
    trigger: "가명정보를 처리한다면",
    patterns: ["가명정보", "가명처리"],
  },
  {
    id: "sensitive",
    label: "민감정보·고유식별정보의 처리",
    law: "법 §23·§24",
    trigger: "건강·사상 등 민감정보나 주민등록번호 등 고유식별정보를 처리한다면",
    patterns: ["민감정보", "고유식별정보", "주민등록번호처리", "고유식별"],
  },
  {
    id: "cctv",
    label: "영상정보처리기기(CCTV)의 운영",
    law: "법 §25",
    trigger: "CCTV 등 고정형/이동형 영상정보처리기기를 운영한다면",
    patterns: ["영상정보처리기기", "cctv", "고정형영상정보", "이동형영상정보"],
  },
  {
    id: "autodecision",
    label: "자동화된 결정에 관한 사항",
    law: "법 §37의2(2024 신설)",
    trigger:
      "AI 등 완전히 자동화된 시스템으로 정보주체 권리·의무에 영향을 주는 결정을 한다면",
    patterns: [
      "자동화된결정",
      "자동화된의사결정",
      "완전히자동화된",
      "프로파일링",
      "자동화된시스템으로",
    ],
    isNew: true, // 2024 개정 신설 — 구(舊)템플릿 방침엔 대개 누락되어 있음(진짜 gap)
  },
  {
    id: "domesticagent",
    label: "국내대리인의 지정",
    law: "법 §31의2",
    trigger: "국내에 주소·영업소가 없는 국외사업자로서 국내대리인 지정 대상이라면",
    patterns: ["국내대리인"],
  },
  {
    id: "child",
    label: "만 14세 미만 아동의 개인정보 처리",
    law: "법 §22의2",
    trigger: "만 14세 미만 아동의 개인정보를 처리한다면",
    patterns: ["만14세미만", "14세미만", "아동의개인정보", "법정대리인의동의"],
  },
];

// 형식 요건(존재검사 가능) — 미감지는 결함이 아니라 "권고".
const FORMAL = [
  {
    id: "title",
    label: '"개인정보 처리방침" 명칭 사용',
    law: "작성지침",
    patterns: ["개인정보처리방침", "개인정보처리방침을", "개인정보처리방침은"],
  },
  {
    id: "effectivedate",
    label: "시행일 또는 최종 개정일 명시",
    law: "작성지침",
    patterns: ["시행일", "시행:", "최종개정", "개정일", "공고일", "시행일자", "부터시행", "부터적용"],
  },
  {
    id: "prevversion",
    label: "변경 시 이전 처리방침 게재/안내",
    law: "작성지침",
    patterns: ["이전개인정보처리방침", "이전버전", "개정이력", "변경이력", "이전처리방침", "변경전내용"],
  },
];

module.exports = { LIST_BASIS, MANDATORY, CONDITIONAL, FORMAL };

};
window.__TOOL = {
  demo: "개인정보 처리방침\n회사는 회원가입, 서비스 제공을 목적으로 개인정보를 처리합니다(처리목적).\n수집항목: 이메일, 이름. 보유기간은 회원 탈퇴 시까지입니다.\n정보주체는 열람·정정·삭제를 요구할 수 있습니다(권리행사).\n쿠키를 사용하여 접속정보를 수집합니다.\n본 방침은 2025년 1월 1일부터 시행합니다.",
  run: function(input){
    var r = require("linter")["lint"](input);
    return require("render")["renderReport"](r);
  }
};
})();
