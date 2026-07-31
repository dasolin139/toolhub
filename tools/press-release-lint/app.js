/* toolhub — press-release-lint 브라우저 번들. 도구 원본 소스를 그대로 임베드(수정 없음). */
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
// 보도자료 린터 — 검증 코어 (제품의 본체, 결정론적·무의존성)
//
// 목적: 이미 쓴 보도자료(또는 골격)를 붙여넣으면 기자가 거르는 '검사 가능한 저수준 결함'을
//       확정적으로 잡아준다. 세 축: (1) 금지·지양 과장 표현, (2) 필수 요소 누락, (3) 리드/구조 신호.
//
// 하지 않는 것(정직한 범위): 앵글·시의성·뉴스 가치 판단은 편집자 영역이라 이 도구가 판단하지 않는다.
//   → 이 도구는 "기사화율을 높인다"고 주장하지 않는다. "저수준 실수 예방 + 구조 시간 절약"만 한다.

const {
  PUFFERY_TERMS,
  PUFFERY_EXCEPTIONS,
  EMAIL_RE,
  PHONE_RE,
  QUOTE_RE,
  DATE_RE,
  LEAD_MAX_CHARS,
  LEAD_MAX_SENTENCES,
} = require("./rules");

// 텍스트를 줄 단위로. 빈 줄은 문단 경계로 쓰인다.
function toLines(text) {
  return String(text == null ? "" : text).replace(/\r\n?/g, "\n").split("\n");
}

// 첫 번째 비어있지 않은 줄 = 제목 후보. 없으면 null.
function firstNonEmptyLine(text) {
  for (const ln of toLines(text)) {
    if (ln.trim() !== "") return ln.trim();
  }
  return null;
}

// 리드 문단 = 제목(첫 비어있지 않은 줄) 다음의 첫 문단(연속된 비어있지 않은 줄 묶음).
function extractLead(text) {
  const lines = toLines(text);
  let i = 0;
  // 제목 줄 스킵
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i < lines.length) i++; // 제목 한 줄 소비
  while (i < lines.length && lines[i].trim() === "") i++; // 제목 뒤 빈 줄 스킵
  const buf = [];
  while (i < lines.length && lines[i].trim() !== "") {
    buf.push(lines[i].trim());
    i++;
  }
  return buf.join(" ").trim();
}

// 문장 수 근사: 종결부호/한국어 종결어미 기준.
function countSentences(s) {
  const t = String(s).trim();
  if (t === "") return 0;
  const parts = t.split(/(?<=[.!?…])\s+|(?<=다\.)\s*/).filter((p) => p.trim() !== "");
  return Math.max(1, parts.length);
}

// 특정 표현이 예외(무해한 더 긴 단어)의 일부인지 확인.
function isException(text, idx, term) {
  for (const ex of PUFFERY_EXCEPTIONS) {
    const pos = ex.indexOf(term);
    if (pos === -1) continue;
    const start = idx - pos;
    if (start >= 0 && text.substr(start, ex.length) === ex) return true;
  }
  return false;
}

// 매치가 포함된 줄(문맥)을 돌려준다.
function lineContaining(lines, absoluteIdx, joinedText) {
  // joinedText 는 lines.join("\n") 이므로 인덱스로 줄을 역산.
  let acc = 0;
  for (const ln of lines) {
    const end = acc + ln.length;
    if (absoluteIdx <= end) return ln.trim();
    acc = end + 1; // "\n"
  }
  return "";
}

// ── 축 1: 금지·지양 과장 표현 ──────────────────────────────────
function checkPuffery(text) {
  const src = String(text == null ? "" : text);
  const lines = toLines(src);
  const joined = lines.join("\n");

  // 1) 모든 매치를 위치와 함께 수집(예외 제외).
  const hits = [];
  for (const rule of PUFFERY_TERMS) {
    let from = 0;
    while (true) {
      const idx = joined.indexOf(rule.term, from);
      if (idx === -1) break;
      from = idx + rule.term.length;
      if (isException(joined, idx, rule.term)) continue;
      hits.push({ rule, start: idx, end: idx + rule.term.length });
    }
  }

  // 2) 긴 표현 우선으로 정렬해, 더 긴 매치에 완전히 포함되는 짧은 매치는 제외
  //    (예: '업계 최초' 안의 '최초', '국내 1위' 안의 '1위' 를 중복 계수하지 않음).
  hits.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const claimed = []; // 채택된 [start,end) 구간
  const found = [];
  const seen = new Set(); // (term|line) 동일 줄 반복 제거
  for (const h of hits) {
    // 길이 내림차순으로 처리하므로 먼저 채택된 구간이 더 길다. 완전 포함뿐 아니라
    // 부분 겹침도 억제한다(예: '세계 최고' ∩ '최고의' → 긴 것만 계수).
    const overlaps = claimed.some((c) => h.start < c.end && c.start < h.end);
    if (overlaps) continue;
    claimed.push({ start: h.start, end: h.end });
    const ctx = lineContaining(lines, h.start, joined);
    const key = h.rule.term + "|" + ctx;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({
      term: h.rule.term,
      category: h.rule.category,
      reason: h.rule.reason,
      suggest: h.rule.suggest,
      context: ctx,
      start: h.start,
    });
  }
  // 문서 순서로 정렬해 출력 안정성 확보.
  found.sort((a, b) => a.start - b.start);
  return found;
}

// ── 축 2: 필수 요소 누락 ───────────────────────────────────────
// 각 항목: id, label, present(bool), severity, hint(누락 시 안내).
function checkRequired(text) {
  const src = String(text == null ? "" : text);
  const hasEmail = EMAIL_RE.test(src);
  const hasPhone = PHONE_RE.test(src);
  const hasQuote = QUOTE_RE.test(src);
  const title = firstNonEmptyLine(src);

  const items = [
    {
      id: "title",
      label: "제목",
      present: title !== null,
      severity: "high",
      hint: "첫 줄에 핵심 사실을 담은 제목이 필요합니다.",
    },
    {
      id: "contact",
      label: "담당자 연락처(전화 또는 이메일)",
      present: hasEmail || hasPhone,
      severity: "high",
      hint: "연락처가 없으면 기사화하려는 기자가 확인·문의할 방법이 없어 보도자료가 버려집니다(근거: CSV 행 56).",
    },
    {
      id: "quote",
      label: "직접 인용문",
      present: hasQuote,
      severity: "mid",
      hint: '대표·책임자의 직접 인용("…")은 보도자료 표준 구성 요소입니다. 없으면 인용문 자리를 채우세요.',
    },
  ];

  return {
    items,
    hasEmail,
    hasPhone,
  };
}

// ── 축 3: 리드/구조 신호 ───────────────────────────────────────
function checkStructure(text) {
  const src = String(text == null ? "" : text);
  const lead = extractLead(src);
  const leadChars = lead.length;
  const leadSentences = countSentences(lead);
  const leadHasDate = DATE_RE.test(lead);

  const signals = [];
  if (lead === "") {
    signals.push({
      level: "high",
      message: "리드 문단(제목 다음 첫 문단)이 비어 있습니다. 핵심 5W1H를 첫 문단에 두괄식으로 배치하세요.",
    });
  } else {
    if (leadChars > LEAD_MAX_CHARS) {
      signals.push({
        level: "mid",
        message: `리드가 ${leadChars}자로 깁니다(권장 ${LEAD_MAX_CHARS}자 이내). 핵심만 남기고 세부는 본문으로 내리세요(역피라미드).`,
      });
    }
    if (leadSentences > LEAD_MAX_SENTENCES) {
      signals.push({
        level: "mid",
        message: `리드가 ${leadSentences}문장입니다(권장 ${LEAD_MAX_SENTENCES}문장 이내). 리드는 짧게.`,
      });
    }
    if (!leadHasDate) {
      signals.push({
        level: "info",
        message: "리드에서 시점(When: 날짜·'이번 주' 등)이 감지되지 않았습니다. 언제 일어난 일인지 확인하세요.",
      });
    }
  }

  return { lead, leadChars, leadSentences, leadHasDate, signals };
}

// 리드 5W1H 자가 점검 체크리스트(자동 판정 불가 항목 — 정직하게 '사람이 확인').
// 우리가 확정적으로 잡는 것은 When(날짜) 힌트뿐. 나머지는 지어내지 않고 사용자에게 확인을 요청한다.
const FIVE_W_ONE_H = [
  { key: "who", label: "누가(Who)", auto: false },
  { key: "what", label: "무엇을(What)", auto: false },
  { key: "when", label: "언제(When)", auto: true }, // 날짜 정규식으로만 힌트 제공
  { key: "where", label: "어디서(Where)", auto: false },
  { key: "why", label: "왜(Why)", auto: false },
  { key: "how", label: "어떻게(How)", auto: false },
];

// 전체 린트: 세 축을 모아 요약 점수(결함 개수)와 함께 돌려준다.
function lint(text) {
  const puffery = checkPuffery(text);
  const required = checkRequired(text);
  const structure = checkStructure(text);

  const missingRequired = required.items.filter((i) => !i.present);
  const highIssues =
    missingRequired.filter((i) => i.severity === "high").length +
    structure.signals.filter((s) => s.level === "high").length;
  const midIssues =
    puffery.length +
    missingRequired.filter((i) => i.severity === "mid").length +
    structure.signals.filter((s) => s.level === "mid").length;

  const clean = highIssues === 0 && midIssues === 0;

  return {
    puffery,
    required,
    structure,
    fiveWOneH: FIVE_W_ONE_H,
    summary: {
      pufferyCount: puffery.length,
      missingRequiredCount: missingRequired.length,
      highIssues,
      midIssues,
      clean,
    },
  };
}

module.exports = {
  lint,
  checkPuffery,
  checkRequired,
  checkStructure,
  extractLead,
  firstNonEmptyLine,
  countSentences,
  FIVE_W_ONE_H,
};

};
__modules["render"] = function(module, exports, require){
"use strict";
// 보도자료 린터 — 마크다운 렌더 (검증 결과 우선, 결정론적)
//
// 출력 구조는 '검증(linter)'이 주(主)다. 골격은 부(副)로, --scaffold 일 때만 덧붙는다.

const { lint } = require("./linter");
const { buildSkeleton } = require("./skeleton");

const SEV_MARK = { high: "🔴", mid: "🟡", info: "🔵" };

function renderLintReport(text, meta = {}) {
  const r = lint(text);
  const out = [];

  const title = meta.title || "보도자료 검증 리포트";
  out.push(`# ${title}`);
  out.push("");

  // 결론 배너
  if (r.summary.clean) {
    out.push("✅ 검사 가능한 저수준 결함이 발견되지 않았습니다. (과장 표현·필수 요소·리드 구조 기준)");
  } else {
    const bits = [];
    if (r.summary.highIssues > 0) bits.push(`🔴 필수/구조 결함 ${r.summary.highIssues}건`);
    if (r.summary.pufferyCount > 0) bits.push(`🟡 지양 표현 ${r.summary.pufferyCount}건`);
    const midOnly = r.summary.midIssues - r.summary.pufferyCount;
    if (midOnly > 0) bits.push(`🟡 기타 ${midOnly}건`);
    out.push(`⚠️ 발견: ${bits.join(" · ")}`);
  }
  out.push("");
  out.push("> 이 도구가 잡는 것: **검사 가능한 저수준 실수**(과장 표현·필수 요소 누락·리드 구조).");
  out.push("> 이 도구가 못 잡는 것: **앵글·시의성·뉴스 가치**(편집자 판단 영역). 기사화율을 보장하지 않습니다.");
  out.push("");

  // 축 2: 필수 요소 (killer) — 가장 위에
  out.push("## 1. 필수 요소 검증");
  out.push("| 요소 | 상태 | 비고 |");
  out.push("|------|:----:|------|");
  for (const it of r.required.items) {
    const mark = it.present ? "✅" : SEV_MARK[it.severity] || "🟡";
    const note = it.present ? "" : it.hint;
    out.push(`| ${it.label} | ${mark} | ${note} |`);
  }
  out.push("");

  // 축 1: 금지·지양 과장 표현
  out.push("## 2. 지양 표현(과장·최상급) 검출");
  if (r.puffery.length === 0) {
    out.push("검출된 지양 표현이 없습니다.");
  } else {
    out.push("_실증 자료 없이 쓰면 부당광고 소지가 있거나 기자가 걸러내는 표현입니다._");
    out.push("");
    out.push("| 표현 | 유형 | 이유 | 대체 방향 |");
    out.push("|------|------|------|-----------|");
    for (const p of r.puffery) {
      out.push(`| \`${p.term}\` | ${p.category} | ${p.reason} | ${p.suggest} |`);
    }
  }
  out.push("");

  // 축 3: 리드/구조
  out.push("## 3. 리드·구조 신호");
  if (r.structure.signals.length === 0) {
    out.push(`리드 ${r.structure.leadChars}자 · ${r.structure.leadSentences}문장 — 특이 신호 없음.`);
  } else {
    for (const s of r.structure.signals) {
      out.push(`- ${SEV_MARK[s.level] || "•"} ${s.message}`);
    }
  }
  out.push("");

  // 5W1H 자가 점검(정직: 대부분 사람이 확인)
  out.push("## 4. 리드 5W1H 자가 점검");
  out.push("_When(시점)만 자동 감지하며, 나머지는 지어내지 않고 사람이 확인합니다._");
  for (const f of r.fiveWOneH) {
    if (f.key === "when") {
      out.push(`- ${f.label}: ${r.structure.leadHasDate ? "리드에서 시점 표현 감지됨 ✅" : "리드에서 시점 표현 미감지 — 확인 필요 🔵"}`);
    } else {
      out.push(`- ${f.label}: 사람 확인 필요 ☐`);
    }
  }
  out.push("");

  out.push("---");
  out.push("_검증 대상 텍스트는 입력값 그대로이며, 없는 사실·인용을 지어내지 않습니다._");
  out.push("_근거: 표시·광고의 공정화에 관한 법률(최상급 실증 원칙) + 보도자료 작성 통념 + 고객 발언 CSV 행 56·57._");

  return { markdown: out.join("\n") + "\n", lint: r };
}

// --scaffold 모드: 골격을 만들고, 그 골격을 다시 린트해서 무엇을 채워야 하는지 보여준다(도그푸딩).
function renderScaffold(fields = {}, meta = {}) {
  const skeleton = buildSkeleton(fields);
  const out = [];
  out.push(`# 보도자료 골격 (비계)`);
  out.push("");
  out.push("> 골격은 보조 도구입니다. 핵심은 아래 검증입니다. 사실이 없는 칸은 `_(작성)_` 로 두었습니다.");
  out.push("");
  out.push("```");
  out.push(skeleton);
  out.push("```");
  out.push("");
  const report = renderLintReport(skeleton, { title: "골격 자체 검증(무엇을 채워야 하나)" });
  out.push(report.markdown);
  return { markdown: out.join("\n"), skeleton, lint: report.lint };
}

module.exports = { renderLintReport, renderScaffold, SEV_MARK };

};
__modules["rules"] = function(module, exports, require){
"use strict";
// 보도자료 린터 — 규칙 데이터 (결정론적, 무의존성)
//
// 이 파일은 "검증 축"의 근거 데이터다. 우리가 임의로 만든 금지어 목록이 아니라,
// 아래 공개 근거로 '실증 없이 쓰면 문제되는 표현' / '보도자료 필수 요소'로 분류되는 유형이다.
//
// 근거(출처):
//  - 「표시·광고의 공정화에 관한 법률」제3조: 배타성·최상급(최초/최고/유일/1위 등) 표현은
//     객관적 실증 자료 없이 사용하면 부당한 표시·광고가 될 수 있다. → 실증 없는 최상급은 '지양' 유형.
//  - 보도자료 작성 실무 통념(뉴스와이어 등 배포사 작성 가이드에서 공통으로 '지양'으로 안내):
//     검증 불가한 주관적 과장 수식어는 기자가 걸러내며 기사화에 불리하다.
//  - 역피라미드/리드 작성 통념: 핵심(5W1H)을 첫 문단(리드)에 두괄식으로, 리드는 짧게.
//  - CSV 고객 발언 근거: 행 57(초보 담당자 "제목을 광고처럼 써도 되는지 판단 어려움"),
//     행 56(연락처·구조 실수로 기사화 실패).
//
// 우리의 순증은 "골격 생성"이 아니라 이 검증(linter)이다. 골격은 검사 대상 비계일 뿐이다.

// ── 금지·지양 표현 사전 ────────────────────────────────────────
// 각 항목: term(표현), category(유형), reason(왜 지양인지), suggest(대체 방향).
// 여기 담긴 term 은 위 근거상 '실증 필요' 또는 '검증 불가 주관' 으로 분류되는 유형만 넣는다.
const PUFFERY_TERMS = [
  // 배타성·순위 최상급 — 실증 자료 없이 쓰면 표시광고법상 부당광고 소지
  { term: "세계 최초", category: "배타성 최상급", reason: "실증 자료 없이는 부당광고 소지, 기자가 걸러냄", suggest: "출시 시점·근거를 함께 명시하거나 '국내에 처음 선보이는' 등 확인 가능한 사실로" },
  { term: "국내 최초", category: "배타성 최상급", reason: "실증 자료 없이는 부당광고 소지", suggest: "근거 자료를 함께 제시하거나 사실 관계로 서술" },
  { term: "업계 최초", category: "배타성 최상급", reason: "'업계' 범위가 모호해 검증 어려움", suggest: "구체 범위·출처를 명시" },
  { term: "최초", category: "배타성 최상급", reason: "실증 없는 '최초'는 부당광고 소지", suggest: "무엇을 기준으로 최초인지 근거를 붙이거나 삭제" },
  { term: "세계 최고", category: "배타성 최상급", reason: "검증 불가한 최상급", suggest: "수치·수상·인증 등 객관 근거로 대체" },
  { term: "국내 최고", category: "배타성 최상급", reason: "검증 불가한 최상급", suggest: "객관 근거로 대체" },
  { term: "업계 1위", category: "배타성 최상급", reason: "출처·기준 없는 순위는 부당광고 소지", suggest: "조사 기관·기준·시점을 명시" },
  { term: "국내 1위", category: "배타성 최상급", reason: "출처·기준 없는 순위", suggest: "조사 출처를 명시" },
  { term: "1위", category: "배타성 최상급", reason: "출처 없는 순위 표현", suggest: "'○○ 조사 기준 1위'처럼 출처를 명시" },
  { term: "유일", category: "배타성 최상급", reason: "'유일'은 실증 없이는 부당광고 소지", suggest: "차별점을 사실로 기술" },
  { term: "최고의", category: "주관적 과장", reason: "검증 불가한 주관 평가", suggest: "구체적 강점·수치로 대체" },
  { term: "최상", category: "주관적 과장", reason: "검증 불가한 주관 평가", suggest: "구체적 사실로 대체" },
  { term: "국내 최대", category: "배타성 최상급", reason: "규모 최상급은 근거 필요", suggest: "규모 수치·출처를 명시" },
  // 절대·완전 표현 — 검증 불가
  { term: "100%", category: "절대 표현", reason: "예외 없는 단정은 검증 불가", suggest: "측정 조건·범위를 함께 명시" },
  { term: "완벽", category: "절대 표현", reason: "검증 불가한 절대 표현", suggest: "구체적 성능·범위로 대체" },
  { term: "전무후무", category: "절대 표현", reason: "검증 불가한 과장", suggest: "삭제 또는 사실로 대체" },
  { term: "무조건", category: "절대 표현", reason: "예외 없는 단정", suggest: "조건을 명시" },
  // 주관적 과장 수식어 — 기자가 걸러내는 홍보성 형용사
  { term: "혁신적", category: "주관적 과장", reason: "검증 불가한 홍보성 수식", suggest: "무엇이 어떻게 달라졌는지 사실로 서술" },
  { term: "획기적", category: "주관적 과장", reason: "검증 불가한 홍보성 수식", suggest: "구체적 변화·수치로 대체" },
  { term: "압도적", category: "주관적 과장", reason: "검증 불가한 비교 과장", suggest: "비교 수치·출처를 제시" },
  { term: "독보적", category: "주관적 과장", reason: "검증 불가한 배타성 수식", suggest: "차별점을 사실로 기술" },
  { term: "초격차", category: "주관적 과장", reason: "홍보성 유행어, 검증 불가", suggest: "격차를 수치로 제시" },
  { term: "놀라운", category: "주관적 과장", reason: "주관적 감탄 수식", suggest: "삭제 또는 사실로 대체" },
  { term: "꿈의", category: "주관적 과장", reason: "홍보성 수식", suggest: "삭제 또는 사실로 대체" },
];

// 최상급 term 이 더 긴 무해한 단어의 일부일 때 오탐을 막는 예외 접두/접미.
// 예: "최대한", "최고령", "최고치", "최소" 는 과장 표현이 아니다.
const PUFFERY_EXCEPTIONS = [
  "최대한", "최고령", "최고치", "최댓값", "최솟값", "최고급 원단", // 문맥상 무해 예시
];

// ── 필수 요소 검출 패턴 ────────────────────────────────────────
// 보도자료 표준 구성: 제목 → 리드(5W1H) → 역피라미드 본문 → 인용문 → 담당자 정보(보일러플레이트).
// 아래는 결정론적으로 '존재 여부'를 확인할 수 있는 요소만 검사한다(품질 판단은 하지 않는다).
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
// 전화: 02/0xx 지역번호·010 휴대폰(구분자 선택) 또는 15xx~19xx 대표번호(구분자 필수).
// 앞뒤로 숫자가 이어지면 매치하지 않는다((?<!\d)…(?!\d)) — '회원수 12345678명', 사업자번호,
// '12345678원' 같은 일반 숫자열을 전화로 오탐해 '연락처 있음'으로 잘못 판정하는 것을 막는다(핵심 검사 보호).
// 대표번호 분기는 구분자를 필수로 요구해 '15000000원' 같은 8자리 숫자열 오탐을 배제한다.
const PHONE_RE = /(?<!\d)(0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}|1[5-9]\d{2}[-\s]\d{4})(?!\d)/;
// 직접 인용문: 한글 큰따옴표 “…” 또는 일반 큰따옴표 "…" (내용 있는 인용).
const QUOTE_RE = /[“"][^”"]{5,}[”"]/;
// 날짜/시점 표현(리드의 When 힌트).
const DATE_RE = /(\d{4}\s*년|\d{1,2}\s*월\s*\d{1,2}\s*일|\d{1,2}\s*월|오늘|어제|내일|이번\s*(주|달|분기)|최근|지난\s*(주|달|해|\d))/;

// 리드(첫 문단) 권장 상한 — 통념상 리드는 짧게(2~3문장). 넘으면 역피라미드 약화 신호.
const LEAD_MAX_CHARS = 300;
const LEAD_MAX_SENTENCES = 3;

module.exports = {
  PUFFERY_TERMS,
  PUFFERY_EXCEPTIONS,
  EMAIL_RE,
  PHONE_RE,
  QUOTE_RE,
  DATE_RE,
  LEAD_MAX_CHARS,
  LEAD_MAX_SENTENCES,
};

};
__modules["skeleton"] = function(module, exports, require){
"use strict";
// 보도자료 골격 생성 — 비계(scaffolding), 결정론적·지어내지 않음.
//
// 주의: 이건 제품의 '본체'가 아니다. 제품은 linter(검증)다. 골격은 검사 대상을 만드는 비계일 뿐이다.
// ChatGPT·무료 템플릿이 초안 생성은 더 잘하므로, 여기서는 '표준 구조 자리표시자'만 제공하고
// 사실이 없는 칸은 절대 지어내지 않고 `_(작성)_` 로 남긴다.

const PLACEHOLDER = "_(작성)_";

function v(x) {
  const s = x == null ? "" : String(x).trim();
  return s === "" ? PLACEHOLDER : s;
}

// 5W1H + 인용/조직/연락처 입력 → 표준 보도자료 골격(제목→리드→역피라미드→인용문→담당자).
// 값이 없으면 placeholder. 사실을 만들어내지 않는다.
function buildSkeleton(fields = {}) {
  const {
    org, // 발표 주체(회사/기관)
    who, // 누가 (없으면 org 로 대체 시도)
    what, // 무엇을
    when, // 언제
    where, // 어디서
    why, // 왜
    how, // 어떻게
    quote, // 대표 인용문(직접 인용할 실제 발언)
    quotePerson, // 인용 발화자
    contactName,
    contactPhone,
    contactEmail,
    title, // 있으면 그대로, 없으면 placeholder
  } = fields;

  const subject = (who && String(who).trim()) || (org && String(org).trim()) || PLACEHOLDER;

  const out = [];

  // 제목
  out.push(`[제목] ${v(title)}`);
  out.push("");

  // 리드: 확보된 사실만 문장으로 잇고, 빈 칸은 placeholder 로. (지어내지 않음)
  const leadParts = [];
  leadParts.push(subject);
  if (when && String(when).trim()) leadParts.push(String(when).trim());
  if (where && String(where).trim()) leadParts.push(String(where).trim());
  leadParts.push(`${v(what)}${what && String(what).trim() ? "" : "을(를)"} 발표했다`);
  out.push(`[리드] ${leadParts.join(" ")}.`);
  out.push(`  · 확인 필요(5W1H): 누가=${v(who || org)} / 언제=${v(when)} / 어디서=${v(where)} / 무엇을=${v(what)} / 왜=${v(why)} / 어떻게=${v(how)}`);
  out.push("");

  // 본문(역피라미드): 중요도 높은 순으로 배치할 자리.
  out.push("[본문 — 역피라미드 순서]");
  out.push(`  1. 배경/맥락: ${v(why)}`);
  out.push(`  2. 세부 내용: ${v(how)}`);
  out.push(`  3. 특징/차별점: ${PLACEHOLDER}  (과장 표현 대신 사실·수치로)`);
  out.push(`  4. 의미/기대효과: ${PLACEHOLDER}`);
  out.push(`  5. 향후 계획: ${PLACEHOLDER}`);
  out.push("");

  // 인용문: 실제 발언이 없으면 만들지 않고 자리만.
  if (quote && String(quote).trim()) {
    const person = v(quotePerson);
    out.push(`[인용문] ${person}은(는) "${String(quote).trim()}"라고 말했다.`);
  } else {
    out.push(`[인용문] ${PLACEHOLDER} — 대표·책임자의 실제 발언을 직접 인용("…")으로. 발언이 없으면 지어내지 마세요.`);
  }
  out.push("");

  // 보일러플레이트(회사 소개)
  out.push(`[회사 소개] ${v(org)}은(는) ${PLACEHOLDER}하는 기업이다. (사실 기반 1~2문장)`);
  out.push("");

  // 담당자 정보
  out.push("[담당자 정보]");
  out.push(`  · 담당자: ${v(contactName)}`);
  out.push(`  · 전화: ${v(contactPhone)}`);
  out.push(`  · 이메일: ${v(contactEmail)}`);

  return out.join("\n");
}

module.exports = { buildSkeleton, PLACEHOLDER };

};
window.__TOOL = {
  demo: "업계 최초, 세계 최고의 혁신적 AI 솔루션 출시\n\n다솔린은 이번에 업계 최초로 100% 완벽한 AI 솔루션을 선보였다. 이 획기적이고 압도적인 제품은 국내 1위의 성능을 자랑하며, 놀라운 사용자 경험을 제공하는 독보적 서비스로, 앞으로 시장을 완전히 바꿀 것으로 기대되며 관련 업계의 뜨거운 관심을 받고 있어 향후 행보가 주목된다.\n\n회사는 지속적으로 서비스를 개선할 계획이다.",
  run: function(input){
    var o = require("render")["renderLintReport"](input, {});
    return (o && typeof o === "object" && "markdown" in o) ? o.markdown : String(o);
  }
};
})();
