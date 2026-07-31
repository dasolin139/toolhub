/* toolhub — job-posting-lint 브라우저 번들. 도구 원본 소스를 그대로 임베드(수정 없음). */
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
// 채용공고 자가검증 린터 — 검증 코어(제품 본체, 결정론적·무의존성)
//
// 목적: 이미 쓴 채용공고 초안을 붙여넣으면, 생성 도구가 못 잡는 '검사 가능한 저수준 결함'을
//       확정적으로 짚어준다. 축:
//   (B, 핵심) 차별·개인정보 요구 표현 후보 검출 + 근거 법령 병기
//   (A)       완결성 체크리스트(권장·관행 — 법정 필수 아님)
//   (C)       급여 표기 품질
//
// 하지 않는 것(정직한 범위):
//   - "합법/위법"을 판정하지 않는다. 각 히트는 후보·검토 권고이며 최종 판단은 사용자·전문가 몫.
//   - 규칙 미포함 위반은 탐지되지 않는다(미탐 상존). 맥락(BFOQ)이 필요한 항목은 ⚠️로만 표기.
//   - 채용공고엔 사경제 기준 법정 필수 기재항목이 사실상 없다(그건 근로계약서 소관). '법정 필수'라 주장하지 않는다.

const {
  GRADE,
  DISCRIMINATION_TERMS,
  DISCRIMINATION_TERM_EXCEPTIONS,
  DISCRIMINATION_PATTERNS,
  COMPLETENESS_SECTIONS,
  SALARY_VAGUE_TERMS,
  SALARY_AMOUNT_RE,
} = require("./rules");

function normalize(text) {
  return String(text == null ? "" : text).replace(/\r\n?/g, "\n");
}

// 예외 표현("학력 무관" 등)이 걸린 위치를 미리 표시해, 그 구간 안의 term 히트는 무시한다.
function exceptionRanges(text) {
  const ranges = [];
  for (const ex of DISCRIMINATION_TERM_EXCEPTIONS) {
    let from = 0;
    let idx;
    while ((idx = text.indexOf(ex, from)) !== -1) {
      ranges.push([idx, idx + ex.length]);
      from = idx + ex.length;
    }
  }
  return ranges;
}

function inRanges(pos, endPos, ranges) {
  for (const [s, e] of ranges) {
    if (pos >= s && endPos <= e) return true;
  }
  return false;
}

// ── 축 B: 차별·개인정보 요구 표현 검출 ─────────────────────────
// 반환: [{ match, category, grade, law, reason, suggest, bfoq }]
function checkDiscrimination(text) {
  const t = normalize(text);
  const exRanges = exceptionRanges(t);
  const raw = []; // { match, category, grade, law, reason, suggest, bfoq, start, end }

  // 1) 사전(term) 매칭 — 전 위치 스캔(위치 기록)
  for (const rule of DISCRIMINATION_TERMS) {
    let from = 0;
    let idx;
    while ((idx = t.indexOf(rule.term, from)) !== -1) {
      const end = idx + rule.term.length;
      from = end;
      if (inRanges(idx, end, exRanges)) continue; // "학력 무관" 등 예외 구간
      raw.push({
        match: rule.term,
        category: rule.category,
        grade: rule.grade,
        law: rule.law,
        reason: rule.reason,
        suggest: rule.suggest,
        bfoq: !!rule.bfoq,
        start: idx,
        end,
      });
    }
  }

  // 2) 정규식(수치) 매칭(위치 기록)
  for (const p of DISCRIMINATION_PATTERNS) {
    const re = new RegExp(p.re.source, p.re.flags.includes("g") ? p.re.flags : p.re.flags + "g");
    let m;
    while ((m = re.exec(t)) !== null) {
      const matched = m[0];
      const start = m.index;
      const end = start + matched.length;
      if (m.index === re.lastIndex) re.lastIndex++; // zero-width 방지
      if (inRanges(start, end, exRanges)) continue;
      raw.push({
        match: matched.trim(),
        category: p.category,
        grade: p.grade,
        law: p.law,
        reason: p.reason,
        suggest: p.suggest,
        bfoq: p.grade === GRADE.WARN,
        start,
        end,
      });
    }
  }

  // 중복 억제: (a) 같은 category·match 문자열 중복 제거,
  //           (b) 같은 category 안에서 텍스트 구간이 겹치면 더 긴(구체적) 매치만 남긴다.
  //               예: "키 165cm 이상"(구체) 이 "165cm 이상"(일반)을 흡수.
  raw.sort((a, b) => (b.end - b.start) - (a.end - a.start)); // 긴 매치 우선
  const accepted = [];
  const seenExact = new Set();
  for (const h of raw) {
    const exact = h.category + "|" + h.match;
    if (seenExact.has(exact)) continue;
    const overlaps = accepted.some(
      (x) => x.category === h.category && h.start < x.end && x.start < h.end
    );
    if (overlaps) continue;
    seenExact.add(exact);
    accepted.push(h);
  }

  // 표시용 정리: 위치 필드 제거 + BLOCK 먼저, 그다음 WARN, 원문 등장 순서
  accepted.sort((a, b) =>
    a.grade === b.grade ? a.start - b.start : a.grade === GRADE.BLOCK ? -1 : 1
  );
  return accepted.map(({ start, end, ...rest }) => rest);
}

// ── 축 A: 완결성 체크리스트(권장·관행) ─────────────────────────
// 반환: [{ key, label, present }]
function checkCompleteness(text) {
  const t = normalize(text);
  return COMPLETENESS_SECTIONS.map((sec) => ({
    key: sec.key,
    label: sec.label,
    present: sec.any.some((kw) => t.toLowerCase().includes(kw.toLowerCase())),
  }));
}

// ── 축 C: 급여 표기 품질 ───────────────────────────────────────
// 반환: [{ code, grade, message, suggest }]
function checkSalary(text) {
  const t = normalize(text);
  const out = [];
  const hasSalarySection = COMPLETENESS_SECTIONS.find((s) => s.key === "급여").any
    .some((kw) => t.toLowerCase().includes(kw.toLowerCase()));
  const hasAmount = SALARY_AMOUNT_RE.test(t);
  const vagueHit = SALARY_VAGUE_TERMS.find((v) => t.includes(v));

  if (hasSalarySection && !hasAmount && vagueHit) {
    out.push({
      code: "SALARY_VAGUE",
      grade: GRADE.WARN,
      message: `급여가 '${vagueHit}' 등으로만 표기되어 구체 금액이 없습니다(구직자 지원율 저하 요인).`,
      suggest: "연봉·월급 범위(예: 3,000~3,600만원)를 제시하면 지원율이 높아집니다.",
    });
  } else if (hasSalarySection && !hasAmount) {
    out.push({
      code: "SALARY_NO_AMOUNT",
      grade: GRADE.WARN,
      message: "급여 항목은 있으나 구체 금액 신호가 없습니다.",
      suggest: "가능하면 급여 범위를 숫자로 제시하세요.",
    });
  }
  return out;
}

// ── 통합 ───────────────────────────────────────────────────────
// status:
//   "❌ 수정 권고"  = 금지표현 후보(❌) 존재
//   "⚠️ 검토 권고"  = 경고(⚠️ 차별 후보/완결성 누락/급여 품질) 존재
//   "✅ 특이사항 없음" = 우리 규칙 미적중(적법 보장 아님)
function lint(text) {
  const discrimination = checkDiscrimination(text);
  const completeness = checkCompleteness(text);
  const salary = checkSalary(text);

  const missing = completeness.filter((c) => !c.present);
  const hasBlock = discrimination.some((d) => d.grade === GRADE.BLOCK);
  const hasWarn =
    discrimination.some((d) => d.grade === GRADE.WARN) ||
    missing.length > 0 ||
    salary.length > 0;

  let status;
  if (hasBlock) status = "❌ 수정 권고";
  else if (hasWarn) status = "⚠️ 검토 권고";
  else status = "✅ 특이사항 없음";

  return {
    status,
    discrimination,
    completeness,
    missing,
    salary,
    meta: {
      length: normalize(text).trim().length,
      blockCount: discrimination.filter((d) => d.grade === GRADE.BLOCK).length,
      warnCount:
        discrimination.filter((d) => d.grade === GRADE.WARN).length +
        missing.length +
        salary.length,
    },
  };
}

module.exports = {
  normalize,
  checkDiscrimination,
  checkCompleteness,
  checkSalary,
  lint,
};

};
__modules["render"] = function(module, exports, require){
"use strict";
// 채용공고 자가검증 린터 — 리포트 렌더링(텍스트)
//
// 법적 안전장치(반드시 유지):
//   - 판정어("합법/위법/적법") 출력 금지. 등급은 후보·검토 권고까지만.
//   - 모든 리포트 머리/꼬리에 disclaimer(법률자문 아님 + 미탐 고지).
//   - 각 차별 항목에 근거 법령 병기.

const DISCLAIMER_HEAD =
  "※ 본 도구는 법률자문이 아니라 참고용 자가점검 체크리스트입니다. 결과는 법적 판정이 아닙니다.";
const DISCLAIMER_FOOT = [
  "─".repeat(60),
  "※ 안내",
  "  • 이 결과는 자가점검용이며 법적 판단·보증이 아닙니다. 최종 판단은 노무사·변호사 자문을 받으세요.",
  "  • 규칙에 포함되지 않은 표현은 탐지되지 않습니다(미탐 가능). ✅ 는 '문제없음 보장'이 아니라",
  "    '이 도구의 규칙에 걸린 표현이 없음'을 뜻합니다.",
  "  • ⚠️ 항목은 직무상 진정직업자격(BFOQ) 등 정당 사유가 있을 수 있으니 맥락을 확인하세요.",
  "  • 근거 법령·집행: 고용상 연령차별금지법 제4조의4, 남녀고용평등법 제7조, 채용절차법 제4조의3",
  "    (각 500만원 이하 벌금/과태료). 고용노동부 온라인 공고 상시 모니터링·익명신고 운영.",
].join("\n");

function bar() {
  return "═".repeat(60);
}

function renderLintReport(result) {
  const lines = [];
  lines.push(bar());
  lines.push("채용공고 자가검증 리포트");
  lines.push(DISCLAIMER_HEAD);
  lines.push(bar());
  lines.push("");
  lines.push(`종합: ${result.status}`);
  lines.push(
    `  · 금지표현 후보(❌): ${result.meta.blockCount}건   · 검토 권고(⚠️): ${result.meta.warnCount}건`
  );
  lines.push("");

  // 축 B — 차별·개인정보 요구 표현
  lines.push("[1] 차별·개인정보 요구 표현 (핵심)");
  if (result.discrimination.length === 0) {
    lines.push("  ✅ 규칙에 걸린 차별성 표현 후보가 없습니다(문제없음 보장 아님, 미탐 가능).");
  } else {
    for (const d of result.discrimination) {
      lines.push(`  ${d.grade} "${d.match}"  [${d.category}]`);
      lines.push(`      근거: ${d.law}`);
      lines.push(`      사유: ${d.reason}`);
      if (d.suggest) lines.push(`      권고: ${d.suggest}`);
      if (d.bfoq) lines.push(`      참고: 직무상 진정직업자격 등 예외 가능 — 맥락 확인 필요.`);
    }
  }
  lines.push("");

  // 축 A — 완결성 체크리스트(권장)
  lines.push("[2] 완결성 체크리스트 (권장·관행 — 법정 필수 아님)");
  for (const c of result.completeness) {
    lines.push(`  ${c.present ? "✅" : "⚠️"} ${c.label}${c.present ? "" : " — 누락"}`);
  }
  if (result.missing.length > 0) {
    lines.push(
      `  → 누락 ${result.missing.length}건. 누락은 법 위반이 아니라 구직자 신뢰·지원율 저하 요인입니다.`
    );
  }
  lines.push("");

  // 축 C — 급여 표기 품질
  lines.push("[3] 급여 표기 품질");
  if (result.salary.length === 0) {
    lines.push("  ✅ 급여 표기에 특이 품질 이슈가 없습니다.");
  } else {
    for (const s of result.salary) {
      lines.push(`  ${s.grade} ${s.message}`);
      if (s.suggest) lines.push(`      권고: ${s.suggest}`);
    }
  }
  lines.push("");
  lines.push(DISCLAIMER_FOOT);
  return lines.join("\n");
}

module.exports = { renderLintReport, DISCLAIMER_HEAD, DISCLAIMER_FOOT };

};
__modules["rules"] = function(module, exports, require){
"use strict";
// 채용공고 자가검증 린터 — 규칙 데이터(SSOT, 결정론적·무의존성)
//
// 이 파일은 "검증 축"의 근거 데이터다. 우리가 임의로 만든 금지어가 아니라,
// 아래 공개 법령·정부지침에서 '채용공고에 쓰면 문제되는 표현'으로 분류되는 유형이다.
//
// ── 근거 법령(출처, 2026-07 확인) ─────────────────────────────
//  L_AGE  「고용상 연령차별금지 및 고령자고용촉진에 관한 법률」제4조의4(모집·채용 연령차별 금지)
//         → 제23조의3: 500만원 이하 벌금(형사).
//  L_SEX  「남녀고용평등과 일·가정 양립 지원에 관한 법률」제7조(모집·채용):
//         남녀차별 금지 + 직무와 무관한 용모·키·체중 등 신체조건, 미혼조건 요구 금지
//         → 제37조: 500만원 이하 벌금(형사).
//  L_PRIV 「채용절차의 공정화에 관한 법률」제4조의3(출신지역 등 개인정보 요구 금지):
//         용모·키·체중, 출신지역, 혼인여부, 재산, 직계존비속·형제자매의 학력·직업·재산
//         → 제17조: 500만원 이하 과태료.
//  L_FALSE「채용절차법」제4조(거짓 채용광고 금지) → 5년 이하 징역/2천만원 이하 벌금;
//         채용광고 불리 변경 → 500만원 이하 과태료. (사실검증이 필요해 자동 탐지 대상 아님 — 안내만)
//
//  집행 실재: 고용노동부 온라인 채용공고 상시 모니터링 + 익명신고(최대 500만원 과태료),
//            워크넷 등록 시 차별표현 자동 반려. 실증 판례: 신한카드 성비조작(2023-08-10)
//            → 법인 및 인사팀장 각 벌금 500만원 확정(pressian 보도).
//
// ── 정직한 범위(반드시 준수) ──────────────────────────────────
//  이 도구는 "합법/위법"을 판정하지 않는다. 각 히트는 '금지표현 후보' 또는 '검토 권고'라는
//  정보제공이며, 근거 법령 조항을 함께 제시해 사용자·전문가가 최종 판단하게 한다.
//  wordlist·정규식은 원리적으로 불완전하므로 '미탐(놓침)'이 항상 존재한다(리포트에 상시 고지).
//  직무상 진정직업자격(BFOQ)이 있을 수 있는 항목(성별·연령 하한·학력·종교·거주지 등)은
//  자동으로 '후보(❌)'가 아니라 '검토 권고(⚠️)'로 강등한다(맥락 무시 과탐 방지).

// 등급 의미
//  "❌" = 금지표현 후보(삭제·수정 검토 권고, 위법 확정 아님)
//  "⚠️" = 검토 권고(맥락에 따라 정당할 수 있음 / 품질 이슈)
const GRADE = { BLOCK: "❌", WARN: "⚠️", OK: "✅" };

// ── 축 B: 차별·개인정보 요구 표현 사전(핵심 순증) ───────────────
// 각 항목: term(부분일치 표현), category, grade, law(근거 조항), reason, suggest.
// bfoq=true 는 직무상 진정직업자격 예외 가능 → grade 는 WARN 로 둔다.
const DISCRIMINATION_TERMS = [
  // 성별 — 직무상 진정직업자격 예외가 있을 수 있어 WARN(맥락확인)
  { term: "남자만", category: "성별 조건", grade: GRADE.WARN, bfoq: true, law: "남녀고용평등법 제7조", reason: "성별을 자격으로 요구하는 표현 후보(직무상 진정직업자격 예외 가능)", suggest: "직무 수행에 필요한 역량으로 대체" },
  { term: "여자만", category: "성별 조건", grade: GRADE.WARN, bfoq: true, law: "남녀고용평등법 제7조", reason: "성별을 자격으로 요구하는 표현 후보(직무상 진정직업자격 예외 가능)", suggest: "직무 수행에 필요한 역량으로 대체" },
  { term: "남성만", category: "성별 조건", grade: GRADE.WARN, bfoq: true, law: "남녀고용평등법 제7조", reason: "성별 한정 표현 후보", suggest: "직무 기준으로 대체" },
  { term: "여성만", category: "성별 조건", grade: GRADE.WARN, bfoq: true, law: "남녀고용평등법 제7조", reason: "성별 한정 표현 후보", suggest: "직무 기준으로 대체" },
  { term: "남성 우대", category: "성별 조건", grade: GRADE.WARN, bfoq: true, law: "남녀고용평등법 제7조", reason: "성별 우대 표현 후보", suggest: "직무 기준으로 대체" },
  { term: "여성 우대", category: "성별 조건", grade: GRADE.WARN, bfoq: true, law: "남녀고용평등법 제7조", reason: "성별 우대 표현 후보", suggest: "직무 기준으로 대체" },
  { term: "남직원", category: "성별 조건", grade: GRADE.WARN, bfoq: true, law: "남녀고용평등법 제7조", reason: "성별 지정 모집 표현 후보", suggest: "'직원'으로 대체" },
  { term: "여직원", category: "성별 조건", grade: GRADE.WARN, bfoq: true, law: "남녀고용평등법 제7조", reason: "성별 지정 모집 표현 후보", suggest: "'직원'으로 대체" },
  { term: "군필 우대", category: "성별 조건", grade: GRADE.WARN, bfoq: true, law: "남녀고용평등법 제7조", reason: "병역은 사실상 남성 우대로 성차별 소지(직무 관련 예외 가능)", suggest: "직무 관련 요건으로 한정하거나 삭제" },
  { term: "군필자 우대", category: "성별 조건", grade: GRADE.WARN, bfoq: true, law: "남녀고용평등법 제7조", reason: "병역은 사실상 남성 우대로 성차별 소지", suggest: "직무 관련 요건으로 한정하거나 삭제" },

  // 용모·신체 — 직무무관 신체조건, BFOQ 거의 없음 → BLOCK
  { term: "용모 단정", category: "용모·신체 조건", grade: GRADE.BLOCK, bfoq: false, law: "남녀고용평등법 제7조·채용절차법 제4조의3", reason: "직무무관 용모 조건 요구 금지 대상 후보", suggest: "직무에 필요한 역량·자격으로 대체" },
  { term: "용모단정", category: "용모·신체 조건", grade: GRADE.BLOCK, bfoq: false, law: "남녀고용평등법 제7조·채용절차법 제4조의3", reason: "직무무관 용모 조건 요구 금지 대상 후보", suggest: "직무에 필요한 역량·자격으로 대체" },
  { term: "훈훈한 외모", category: "용모·신체 조건", grade: GRADE.BLOCK, bfoq: false, law: "남녀고용평등법 제7조·채용절차법 제4조의3", reason: "직무무관 외모 조건 요구 후보", suggest: "삭제" },
  { term: "외모 단정", category: "용모·신체 조건", grade: GRADE.BLOCK, bfoq: false, law: "남녀고용평등법 제7조·채용절차법 제4조의3", reason: "직무무관 외모 조건 요구 후보", suggest: "삭제" },

  // 혼인·가족 — 직무무관, BLOCK
  { term: "미혼", category: "혼인·가족 상황", grade: GRADE.BLOCK, bfoq: false, law: "남녀고용평등법 제7조·채용절차법 제4조의3", reason: "미혼조건 요구·혼인여부 개인정보 요구 후보", suggest: "삭제" },
  { term: "기혼", category: "혼인·가족 상황", grade: GRADE.BLOCK, bfoq: false, law: "남녀고용평등법 제7조·채용절차법 제4조의3", reason: "혼인여부 조건·개인정보 요구 후보", suggest: "삭제" },
  { term: "결혼 여부", category: "혼인·가족 상황", grade: GRADE.BLOCK, bfoq: false, law: "채용절차법 제4조의3", reason: "혼인여부 개인정보 요구 후보", suggest: "삭제" },
  { term: "부모 직업", category: "혼인·가족 상황", grade: GRADE.BLOCK, bfoq: false, law: "채용절차법 제4조의3", reason: "직계존비속의 직업 개인정보 요구 금지 후보", suggest: "삭제" },
  { term: "가족 재산", category: "혼인·가족 상황", grade: GRADE.BLOCK, bfoq: false, law: "채용절차법 제4조의3", reason: "직계존비속의 재산 개인정보 요구 금지 후보", suggest: "삭제" },

  // 출신지역·재산 — 채용절차법 제4조의3, BLOCK
  { term: "출신지역", category: "출신지역·개인정보", grade: GRADE.BLOCK, bfoq: false, law: "채용절차법 제4조의3", reason: "출신지역 개인정보 요구 금지 후보", suggest: "삭제" },
  { term: "본적", category: "출신지역·개인정보", grade: GRADE.BLOCK, bfoq: false, law: "채용절차법 제4조의3", reason: "본적(출신지) 개인정보 요구 후보", suggest: "삭제" },

  // 장애·건강 — 장애인차별금지 소지, 맥락 있으므로 WARN
  { term: "신체 건강한", category: "장애·건강 조건", grade: GRADE.WARN, bfoq: true, law: "장애인차별금지법·남녀고용평등법 제7조", reason: "장애 배제로 읽힐 수 있는 표현 후보(직무상 건강요건은 예외 가능)", suggest: "직무 수행에 필요한 구체 요건으로 대체" },
  { term: "신체건강한", category: "장애·건강 조건", grade: GRADE.WARN, bfoq: true, law: "장애인차별금지법·남녀고용평등법 제7조", reason: "장애 배제로 읽힐 수 있는 표현 후보", suggest: "직무 수행에 필요한 구체 요건으로 대체" },
  { term: "장애 없", category: "장애·건강 조건", grade: GRADE.WARN, bfoq: true, law: "장애인차별금지법", reason: "장애 배제 표현 후보", suggest: "직무 수행에 필요한 구체 요건으로 대체" },

  // 종교 — 종교기관 등 BFOQ 가능 → WARN
  { term: "기독교인", category: "종교 조건", grade: GRADE.WARN, bfoq: true, law: "남녀고용평등법 취지·국가인권위 채용차별 지침", reason: "종교 조건 후보(종교기관 등 예외 가능)", suggest: "직무 관련 요건인지 검토" },
  { term: "천주교", category: "종교 조건", grade: GRADE.WARN, bfoq: true, law: "국가인권위 채용차별 지침", reason: "종교 조건 후보(예외 가능)", suggest: "직무 관련 요건인지 검토" },

  // 연령 대용어(proxy) — 수치 없는 나이 암시, 맥락 있어 WARN
  { term: "젊고 활기찬", category: "연령 대용 표현", grade: GRADE.WARN, bfoq: false, law: "고용상 연령차별금지법 제4조의4", reason: "'젊은' 은 연령을 우회 지정하는 표현 후보", suggest: "'적극적인', '성장 의지가 있는' 등 연령 중립 표현으로" },
  { term: "젊은 감각", category: "연령 대용 표현", grade: GRADE.WARN, bfoq: false, law: "고용상 연령차별금지법 제4조의4", reason: "연령 우회 지정 표현 후보", suggest: "연령 중립 표현으로" },
  { term: "젊은 인재", category: "연령 대용 표현", grade: GRADE.WARN, bfoq: false, law: "고용상 연령차별금지법 제4조의4", reason: "연령 우회 지정 표현 후보", suggest: "연령 중립 표현으로" },

  // 직무무관 학력 — 일부 직무 정당 → WARN
  { term: "대졸 이상", category: "학력 조건", grade: GRADE.WARN, bfoq: true, law: "국가인권위 채용차별 지침", reason: "직무와 무관한 학력 하한은 차별 소지(직무 관련 시 정당)", suggest: "직무 수행에 학력이 필요한지 검토, 필요 없으면 '학력 무관'" },
];

// term 이 무해한 더 긴 단어의 일부일 때 오탐 방지용 예외.
// 예: "미혼모 지원" 문맥, "기혼자 복지" 안내는 조건 요구가 아님 — 단, 보수적으로 최소만 둔다.
const DISCRIMINATION_TERM_EXCEPTIONS = [
  "종교 무관", "성별 무관", "연령 무관", "학력 무관", "나이 무관",
];

// ── 축 B: 정규식 패턴(연령 수치·신체 수치) ─────────────────────
// grade BLOCK = 명백 후보, WARN = 정당 사유 가능.
const DISCRIMINATION_PATTERNS = [
  // 상한 연령: "35세 이하/미만" — 상한 설정은 정당 사유 드묾 → BLOCK (\d{1,3}: 100세대 표시 잘림 방지)
  { re: /\d{1,3}\s*세\s*(이하|미만)/g, category: "연령 상한 제한", grade: GRADE.BLOCK, law: "고용상 연령차별금지법 제4조의4", reason: "연령 상한 설정은 모집·채용 연령차별 후보", suggest: "연령 요건 삭제, 필요 역량으로 대체" },
  // 하한 연령: "18세 이상" — 법정 최저연령 등 정당 가능 → WARN
  { re: /\d{1,3}\s*세\s*이상/g, category: "연령 하한 제한", grade: GRADE.WARN, law: "고용상 연령차별금지법 제4조의4", reason: "연령 하한은 법정 최저연령 등 정당 사유 시만 허용", suggest: "청소년 보호 등 법적 근거가 있는지 검토" },
  // 연령 범위: "20~30세", "20 ~ 30 세" → BLOCK
  { re: /\d{2}\s*[~∼〜\-–]\s*\d{2}\s*세/g, category: "연령 범위 제한", grade: GRADE.BLOCK, law: "고용상 연령차별금지법 제4조의4", reason: "연령 범위 지정은 연령차별 후보", suggest: "연령 요건 삭제" },
  // 연령대(틸드형): "20~30대" → BLOCK
  { re: /\d{2}\s*[~∼〜\-–]\s*\d{2}\s*대(?![a-zA-Z0-9])/g, category: "연령대 지정", grade: GRADE.BLOCK, law: "고용상 연령차별금지법 제4조의4", reason: "특정 연령대 지정은 연령차별 후보", suggest: "연령 요건 삭제" },
  // 연령대(붙임형): "2030대", "2030세대", "4050세대" → BLOCK ("2030 대회/대학" 오탐 방지: 대는 무공백·비한글경계)
  { re: /(2030|3040|4050|2040|2050|3050)\s*세대|(2030|3040|4050|2040|2050|3050)대(?![가-힣A-Za-z0-9])/g, category: "연령대 지정", grade: GRADE.BLOCK, law: "고용상 연령차별금지법 제4조의4", reason: "특정 연령대(2030세대 등) 지정은 연령차별 후보", suggest: "연령 요건 삭제" },
  // 출생연도 제한: "1995년 이후 출생", "1995년 이후 출생자"
  { re: /(19|20)\d{2}\s*년\s*(이후|이전)\s*출?생/g, category: "출생연도 제한", grade: GRADE.BLOCK, law: "고용상 연령차별금지법 제4조의4", reason: "출생연도 제한은 연령차별 후보", suggest: "연령 요건 삭제" },
  // "1995년생" 형태
  { re: /(19|20)\d{2}\s*년생/g, category: "출생연도 제한", grade: GRADE.BLOCK, law: "고용상 연령차별금지법 제4조의4", reason: "출생연도 지정은 연령차별 후보", suggest: "연령 요건 삭제" },
  // 신장: "키 170cm 이상", "신장 170 이상" — 반드시 '키/신장' 접두어 요구.
  //  (접두어 없는 bare cm 는 제품스펙·적재규격 등 무관 수치를 ❌로 오탐하므로 제거함.)
  { re: /(키|신장)\s*\d{2,3}\s*(cm|센치|센티)?\s*(이상|이하)/g, category: "신장 조건", grade: GRADE.BLOCK, law: "채용절차법 제4조의3·남녀고용평등법 제7조", reason: "직무무관 신장 조건 요구 후보", suggest: "삭제" },
  // 체중: "체중 60kg 이하", "몸무게 60kg 이하"
  { re: /(체중|몸무게)\s*\d{2,3}\s*(kg|킬로)?\s*(이상|이하)/g, category: "체중 조건", grade: GRADE.BLOCK, law: "채용절차법 제4조의3·남녀고용평등법 제7조", reason: "직무무관 체중 조건 요구 후보", suggest: "삭제" },
];

// ── 축 A: 완결성 체크리스트(권장·관행, 법정 의무 아님) ──────────
// 주의: 채용공고(광고)에는 사경제 기준 '법정 필수 기재사항'이 사실상 없다.
//       (근로조건 명시 의무는 「근로기준법」제17조의 '근로계약서' 소관이지 공고가 아니다.)
//       따라서 아래는 '구직자 신뢰·지원율' 관점의 권장 항목이며, 누락은 위법이 아니라 품질 이슈다.
const COMPLETENESS_SECTIONS = [
  { key: "담당업무", label: "담당업무·직무 내용", any: ["담당업무", "직무", "주요 업무", "주요업무", "하는 일", "업무 내용", "업무내용", "job", "role", "직무기술", "포지션"] },
  { key: "자격요건", label: "자격요건·우대사항", any: ["자격요건", "자격 요건", "지원 자격", "지원자격", "필수 요건", "우대사항", "우대 사항", "경력", "requirement"] },
  { key: "근무조건", label: "근무조건(장소·시간·형태)", any: ["근무지", "근무 지", "근무시간", "근무 시간", "근무형태", "근무 형태", "근무요일", "정규직", "계약직", "인턴", "근무 장소", "근무장소", "재택"] },
  { key: "급여", label: "급여·보상", any: ["급여", "연봉", "월급", "시급", "임금", "보수", "salary", "페이", "시간당"] },
  { key: "접수방법", label: "접수 방법·마감", any: ["접수", "지원 방법", "지원방법", "지원 방식", "마감", "기한", "제출", "이력서", "지원서", "apply"] },
];

// ── 축 C: 급여 표기 품질 ───────────────────────────────────────
// 급여 섹션은 있으나 실제 금액 신호 없이 '회사내규/협의' 만 있는 경우 = 구직자 이탈 유발(품질).
const SALARY_VAGUE_TERMS = ["회사내규", "회사 내규", "내규에 따", "추후 협의", "면접 후 결정", "면접후 결정", "협의 후 결정", "협의후 결정", "협의 결정", "추후 결정"];
// 실제 금액 신호(숫자 + 화폐/급여 단위)로 '구체 급여 있음'을 판정.
//  한글 단위(억·천만·천·만)는 ASCII 단어경계 \b 가 성립하지 않으므로 \b 를 쓰지 않는다.
//  단위 앵커가 있어 전화번호/날짜/인원("010…","2025년","5명","3년")은 금액으로 오인하지 않는다.
const SALARY_AMOUNT_RE = /\d[\d,\.]*\s*(억|천만|천|만원|만 원|만|원|k|K)/;

module.exports = {
  GRADE,
  DISCRIMINATION_TERMS,
  DISCRIMINATION_TERM_EXCEPTIONS,
  DISCRIMINATION_PATTERNS,
  COMPLETENESS_SECTIONS,
  SALARY_VAGUE_TERMS,
  SALARY_AMOUNT_RE,
};

};
window.__TOOL = {
  demo: "[채용] 마케팅 팀원 모집\n\n35세 이하의 젊고 활기찬 미혼 여직원을 모집합니다. 용모 단정한 분 우대.\n키 165cm 이상, 서울 거주자만 지원 가능.\n급여: 회사내규에 따름.",
  run: function(input){
    var r = require("linter")["lint"](input);
    return require("render")["renderLintReport"](r);
  }
};
})();
