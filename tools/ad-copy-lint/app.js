/* toolhub — ad-copy-lint 브라우저 번들. 도구 원본 소스를 그대로 임베드(수정 없음). */
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
// 표시·광고 금지표현 자가검증 린터 — 검증 코어(제품 본체, 결정론적·무의존성)
//
// 목적: 이미 쓴 광고 문구 초안을 붙여넣으면, 생성 도구가 못 잡는 '검사 가능한 위험 표현'을
//       업종별 근거 법령과 함께 확정적으로 짚어준다. marketing-copy(생성)의 역방향.
//
// 하지 않는 것(정직한 범위 · Munger 9대 안전장치):
//   - "합법/위법/통과"를 판정하지 않는다. 각 히트는 실증필요/심의대상/검토권고이며 최종 판단은 사용자·전문가·심의위 몫.
//   - 규칙 미포함 위반은 탐지되지 않는다(미탐 상존).
//   - 의료·건기식 효능 표현은 '위법'이 아니라 '사전심의 대상'으로만 라우팅한다.
//   - 의료(medical) 업종은 제57조① 매체 게재 시 사전심의가 법정 의무이고 제56조 금지 유형은 매체와 무관하므로 '미발견(✅)'을 부여하지 않는다.

const {
  FLAG,
  INDUSTRIES,
  INDUSTRY_LABEL,
  INDUSTRY_TERMS,
  NEGATION_TOKENS,
  NEGATION_WINDOW,
  QUOTE_OPENERS,
  QUOTE_CLOSERS,
  WORDLIST_BASIS_DATE,
} = require("./rules");

function normalize(text) {
  return String(text == null ? "" : text).replace(/\r\n?/g, "\n");
}

// 부정문 맥락 감지(안전장치 7): 매치 종료 직후 NEGATION_WINDOW 이내에 부정 토큰이 있으면 true.
// 예) "완치되지 않습니다" 의 '완치' 뒤 '않'.
// ★설계 결정: 억제(suppress)하지 않고 '주석(annotation)'만 붙인다. 법적 리스크 제품에서
//   과억제로 진짜 위반을 지우고 ✅(허위 안심)를 주는 것이 미탐보다 훨씬 위험하기 때문이다.
//   (code-review Finding 1 반영: "우리 제품이 최고! 과장 아니고" 같은 강조 어법이
//    12자 창에 걸려 '최고'가 통째로 사라지던 결함을 제거)
function isNegated(text, endPos) {
  const tail = text.slice(endPos, endPos + NEGATION_WINDOW);
  return NEGATION_TOKENS.some((tok) => tail.includes(tok));
}

// 인용·상호명 가능성(안전장치 7): 매치가 여는/닫는 따옴표·괄호 사이에 있으면 true.
// ★설계 결정: 강등(EVIDENCE→CHECK)하지 않고 '주석'만 붙인다(code-review Finding 3 반영:
//   따옴표로 감싸 심각도·집계를 낮추는 우회를 막기 위해 플래그는 원래대로 유지).
function isQuoted(text, start, end) {
  const before = text.slice(Math.max(0, start - 1), start);
  const after = text.slice(end, end + 1);
  return QUOTE_OPENERS.includes(before) && QUOTE_CLOSERS.includes(after);
}

// 업종 유효성(안전장치 6)
function isValidIndustry(industry) {
  return INDUSTRIES.includes(industry);
}

// 경계 오탐 방지(code-review Finding 2 반영): 특정 접두/접미가 붙으면 다른 단어이므로 건너뛴다.
//   notBefore: 매치 '직후'에 이 문자열이 오면 건너뜀(예: '1등'+'급'=1등급).
//   notAfter : 매치 '직전'에 이 문자열이 오면 건너뜀.
function boundarySkip(text, rule, start, end) {
  if (rule.notBefore && rule.notBefore.some((s) => text.startsWith(s, end))) return true;
  if (rule.notAfter && rule.notAfter.some((s) => text.slice(Math.max(0, start - s.length), start) === s))
    return true;
  return false;
}

// 표현 스캔(위치 기록) — 한 업종의 규칙집으로 초안을 훑는다.
function scan(text, industry) {
  const t = normalize(text);
  const rules = INDUSTRY_TERMS[industry];
  const raw = [];
  for (const rule of rules) {
    let from = 0;
    let idx;
    while ((idx = t.indexOf(rule.term, from)) !== -1) {
      const end = idx + rule.term.length;
      from = end;

      if (boundarySkip(t, rule, idx, end)) continue; // 파생어 오탐(1등급 등) 방지

      // 플래그는 원래대로 유지(강등·억제 없음). 맥락은 주석으로만 표시.
      const flagKey = rule.flag;
      const negatedContext = isNegated(t, end);
      const quotedContext = flagKey === "EVIDENCE" && isQuoted(t, idx, end);

      raw.push({
        match: rule.term,
        category: rule.category,
        flag: flagKey,
        mark: FLAG[flagKey].mark,
        flagLabel: FLAG[flagKey].label,
        action: FLAG[flagKey].action,
        law: rule.law,
        reason: rule.reason,
        suggest: rule.suggest,
        negatedContext,
        quotedContext,
        start: idx,
        end,
      });
    }
  }
  return raw;
}

// 중복 억제: (a) 같은 category·match 문자열 중복 제거,
//           (b) 구간이 겹치면 더 긴(구체적) 매치만 남긴다.
//               예: "최고의 병원"(구체) 이 "최고"(일반)를 흡수.
const FLAG_ORDER = { REVIEW: 0, EVIDENCE: 1, CHECK: 2 };

function dedupe(raw) {
  // 긴(구체) 매치 우선. 동일 길이 겹침이면 더 심각한 플래그를 남긴다(code-review Finding 5 tie-break).
  const sorted = raw.slice().sort((a, b) => {
    const lenDiff = (b.end - b.start) - (a.end - a.start);
    if (lenDiff !== 0) return lenDiff;
    return FLAG_ORDER[a.flag] - FLAG_ORDER[b.flag];
  });
  const accepted = [];
  const seenExact = new Set();
  for (const h of sorted) {
    const exact = h.category + "|" + h.match + "|" + h.start;
    if (seenExact.has(exact)) continue;
    const overlaps = accepted.some((x) => h.start < x.end && x.start < h.end);
    if (overlaps) continue;
    seenExact.add(exact);
    accepted.push(h);
  }
  return accepted;
}

// 위험도 순(REVIEW > EVIDENCE > CHECK), 그다음 원문 등장 순서로 정렬. (FLAG_ORDER는 dedupe 앞에 정의)
function sortForDisplay(hits) {
  return hits.slice().sort((a, b) => {
    if (a.flag !== b.flag) return FLAG_ORDER[a.flag] - FLAG_ORDER[b.flag];
    return a.start - b.start;
  });
}

// ── 통합 ───────────────────────────────────────────────────────
// status(안전장치 1·2·5):
//   "🔎 확인 필요 N건"        = 히트 존재
//   "✅ 규칙상 위험표현 미발견" = 히트 없음(전수검사 아님, 안전 보장 아님)
//   의료 업종은 히트 유무와 무관하게 항상 사전심의 대상 배너를 띄우고 ✅ 를 주지 않는다.
function lint(text, industry) {
  if (!isValidIndustry(industry)) {
    throw new Error(
      `업종(industry) 지정이 필요합니다. 다음 중 하나: ${INDUSTRIES.join(", ")} (안전장치: 업종별 규칙 혼용 금지)`
    );
  }

  const hits = sortForDisplay(dedupe(scan(text, industry)));
  const isMedical = industry === "medical";

  const counts = { REVIEW: 0, EVIDENCE: 0, CHECK: 0 };
  for (const h of hits) counts[h.flag]++;

  let status;
  if (isMedical) {
    // 안전장치 5: 의료는 미발견이어도 사전심의 대상. ✅ 부여 금지.
    status =
      hits.length > 0
        ? `⚖ 사전심의 대상 · 확인 필요 ${hits.length}건`
        : "⚖ 사전심의 대상 여부 확인 (게재 매체가 의료법 제57조①에 해당하면 게재 전 심의 의무)";
  } else if (hits.length > 0) {
    status = `🔎 확인 필요 ${hits.length}건`;
  } else {
    status = "✅ 규칙상 위험표현 미발견 (전수검사 아님 · 안전 보장 아님)";
  }

  return {
    industry,
    industryLabel: INDUSTRY_LABEL[industry],
    isMedical,
    status,
    hits,
    counts,
    meta: {
      length: normalize(text).trim().length,
      total: hits.length,
      wordlistBasisDate: WORDLIST_BASIS_DATE,
    },
  };
}

module.exports = {
  normalize,
  isNegated,
  isQuoted,
  isValidIndustry,
  scan,
  dedupe,
  sortForDisplay,
  lint,
};

};
__modules["render"] = function(module, exports, require){
"use strict";
// 표시·광고 금지표현 자가검증 린터 — 리포트 렌더링(텍스트)
//
// 법적 안전장치(반드시 유지 · Munger 9대):
//   (1) 판정어("합법/위법/통과") 출력 금지. 등급은 실증필요/심의대상/검토권고까지만.
//   (2) '미발견'은 '안전·게재가능'이 아님을 명시(전수검사 아님).
//   (3) 모든 리포트 머리/꼬리에 disclaimer(법률자문 아님 + 사전심의 대체 아님 + 미탐 고지).
//   (4) 각 항목에 근거 법령 병기.
//   (5) 의료·건기식 효능은 '사전심의 대상' 안내. 의료 업종은 상시 사전심의 배너.
//   (8) wordlist 기준일 명시.
//   (9) 효과지표("과징금 회피/승인율↑") 미주장.

const { FLAG } = require("./rules");

const DISCLAIMER_HEAD =
  "※ 본 도구는 법률자문이 아니라 참고용 자가점검 체크리스트입니다. 결과는 법적 판정·승인·심의 결과가 아닙니다.";

function disclaimerFoot(result) {
  const lines = [
    "─".repeat(64),
    "※ 안내",
    "  • 이 결과는 자가점검용이며 위법성 최종 판단·행정심의를 대체하지 않습니다.",
    "    게재 전 관할기관·심의위원회·변호사 확인을 받으세요.",
    "  • 규칙에 없는 표현은 탐지되지 않습니다(미탐 가능). ‘미발견(✅)’은 ‘안전·게재가능’ 보장이 아니라",
    "    ‘이 도구의 규칙에 걸린 표현이 없음’을 뜻합니다(전수검사 아님).",
    "  • ❗실증필요: 최상급·절대·비교 표현은 객관적 실증자료가 없으면 삭제를 검토하세요(표시광고법 제5조 실증제).",
    "  • ⚖심의대상: 의료·건강기능식품 효능 표현은 사전심의/자율심의 대상입니다(위법 판정 아님).",
    "  • 상호명·인용·부정문 맥락을 완전히 구분하지 못합니다. 각 항목은 ‘삭제 지시’가 아니라 ‘근거 확인 질문’입니다.",
    `  • wordlist 근거 기준일: ${result.meta.wordlistBasisDate}. 법령·고시 개정 시 결과가 부정확할 수 있습니다.`,
  ];
  if (result.isMedical) {
    lines.push(
      "  • [의료광고] 신문·정기간행물, 현수막·벽보·전단·교통수단 광고, 전광판, 일일 평균 이용자 10만 명 이상 인터넷 매체·SNS 등 의료법 제57조① 각 호 매체(시행령 제24조)에 게재하려면 게재 전 자율심의기구 사전심의가 법정 의무입니다.",
      "    그 밖의 매체여도 제56조 금지 유형은 똑같이 적용되므로 이 도구는 의료 업종에 ✅를 주지 않습니다. 이 도구는 사전심의를 대체하지 않습니다."
    );
  }
  return lines.join("\n");
}

function bar() {
  return "═".repeat(64);
}

function renderLintReport(result) {
  const lines = [];
  lines.push(bar());
  lines.push(`표시·광고 금지표현 자가검증 리포트  [업종: ${result.industryLabel}]`);
  lines.push(DISCLAIMER_HEAD);
  lines.push(bar());
  lines.push("");

  // 의료 업종 상시 배너(안전장치 5)
  if (result.isMedical) {
    lines.push("⚖ [의료광고] 의료법 제57조① 매체(신문·옥외광고물·전광판·이용자 10만 명 이상 인터넷 매체·SNS 등)에 게재하면 사전심의가 법정 의무입니다.");
    lines.push("");
  }

  lines.push(`종합: ${result.status}`);
  lines.push(
    `  · ⚖심의대상: ${result.counts.REVIEW}건   · ❗실증필요: ${result.counts.EVIDENCE}건   · ⚠️검토권고: ${result.counts.CHECK}건`
  );
  lines.push("");

  lines.push("[검출 표현]");
  if (result.hits.length === 0) {
    if (result.isMedical) {
      lines.push("  규칙에 걸린 표현은 없으나, 의료광고는 게재 매체에 따라 사전심의 대상이고 제56조 금지 유형은 매체와 무관하게 적용됩니다.");
    } else {
      lines.push("  ✅ 규칙에 걸린 위험 표현이 없습니다(안전 보장 아님, 미탐 가능).");
    }
  } else {
    for (const h of result.hits) {
      lines.push(`  ${h.mark} [${h.flagLabel}] "${h.match}"  (${h.category})`);
      lines.push(`      근거: ${h.law}`);
      lines.push(`      사유: ${h.reason}`);
      if (h.suggest) lines.push(`      ${h.action}: ${h.suggest}`);
      if (h.quotedContext)
        lines.push(`      참고: 인용·상호명일 수 있습니다 — 실제 광고 주장이면 근거 확인 필요(플래그 유지).`);
      if (h.negatedContext)
        lines.push(`      참고: 부정문 맥락일 수 있습니다 — 문맥을 확인하세요(오탐이면 무시).`);
    }
  }
  lines.push("");
  lines.push(disclaimerFoot(result));
  return lines.join("\n");
}

module.exports = { renderLintReport, DISCLAIMER_HEAD, disclaimerFoot };

};
__modules["rules"] = function(module, exports, require){
"use strict";
// 표시·광고 금지표현 자가검증 린터 — 규칙 데이터(SSOT, 결정론적·무의존성)
//
// 이 파일은 "검증 축"의 근거 데이터다. 우리가 임의로 만든 금지어가 아니라,
// 아래 공개 법령·정부 고시·업계 자율심의 기준에서 '광고에 쓰면 문제되는 표현'으로
// 분류되는 유형이다.
//
// ── 근거 법령/고시 (출처, 2026-07 확인 · WORDLIST_BASIS_DATE) ────────────
//  L_LABEL 「표시·광고의 공정화에 관한 법률」제3조(부당한 표시·광고 금지) +
//          「부당한 표시·광고행위의 유형 및 기준 지정고시」(공정위):
//          최상급·절대·무근거 비교 표현은 '실증책임'이 따른다(표시광고법 제5조 실증제).
//          → 시정명령·과징금.
//  L_COS  「화장품법」제13조(부당한 표시·광고 행위 등의 금지)·제4조(기능성화장품 심사),
//          식약처 「화장품 표시·광고 관리지침」·「화장품 표시·광고 실증에 관한 규정」:
//          의약품 오인(치료·재생), 질병 표현, 미인증 기능성(미백·주름·자외선차단) 표방 금지.
//          → 화장품법 위반 1년 이하 징역/1천만원 이하 벌금(제36~38조), 행정처분(영업정지).
//  L_FOOD 「식품등의 표시·광고에 관한 법률」제8조(부당한 표시·광고 금지):
//          질병 예방·치료 효능, 의약품 오인, 건강기능식품 아닌 일반식품의 기능성 표방 금지.
//          → 시정명령·영업정지·형사처벌. (식약처 부당표시 상시 모니터링)
//  L_MED  「의료법」제56조(의료광고 금지 유형)·제57조(의료광고 사전심의 의무):
//          제57조① 각 호 매체(신문·옥외광고물·전광판·시행령 제24조의 이용자 10만 명 이상 인터넷 매체·SNS)에
//          게재하는 의료광고는 자율심의기구 사전심의가 '법정 의무'(C420 감사: 모든 매체가 아니라 열거 매체 한정).
//          치료효과 보장·최상급·비교·환자 후기 등 금지. → 이 축은 '판정'하지 않고
//          '사전심의 대상'으로만 안내한다(아래 정직한 범위 참조).
//
//  집행 실재(확인): 식약처 온라인 부당광고 상시 모니터링·적발 다수(화장품·건기식 표시광고
//                  위반 적발·영업정지 사례), 화장품협회 광고 자문(유료) 운영.
//
// ── 정직한 범위(반드시 준수 · Munger Pre-Mortem 9대 안전장치) ─────────────
//  (1) "합법/위법/통과"를 판정하지 않는다. 출력은 위험도·행동안내(실증필요/심의대상/검토권고)뿐.
//  (2) '위험표현 미발견'은 '안전·게재가능'이 아니라 '이 규칙집에 걸린 표현이 없음'을 뜻한다(전수검사 아님).
//  (3) 모든 리포트에 disclaimer(법률자문 아님·최종판단/사전심의 대체 아님)를 상시 고지.
//  (4) 각 히트에 근거 법령·조항을 병기한다.
//  (5) 의료·건강기능식품 효능 표현은 '위법'이 아니라 '사전심의 대상'으로만 라우팅한다.
//      의료(medical) 업종은 열거 매체 사전심의 의무와 매체 무관 제56조 금지 유형 때문에 '미발견(✅)'조차 부여하지 않는다.
//  (6) 업종(general/cosmetic/food/medical) 선택을 강제한다. 미선택 시 실행을 거부한다.
//      wordlist·조항이 업종별로 다르므로 혼용을 금지한다.
//  (7) 오탐은 '삭제 지시'가 아니라 '근거(실증자료) 확인 질문'으로 프레이밍한다.
//      상호명·인용·부정문 맥락은 완전히 구분하지 못함을 명시한다.
//  (8) wordlist의 근거·기준일(WORDLIST_BASIS_DATE)을 명시하고, 법 개정 시 부정확할 수 있음을 고지한다.
//  (9) 효과지표("과징금 안 맞음/승인율↑" 등)를 일절 주장하지 않는다.

// wordlist 근거 기준일(안전장치 8). 법령·고시 개정 시 갱신 필요.
const WORDLIST_BASIS_DATE = "2026-07";

// 위험도 플래그(안전장치 1·5·7) — '적법/위법'이 아니라 '확인 필요 수준(행동)'이다.
//  EVIDENCE = 실증필요 : 최상급·절대·비교 → 객관적 실증자료가 없으면 삭제 검토(표시광고법 제5조).
//  REVIEW   = 심의대상 : 의료·건기식 효능·치료 표현 → 사전심의/자율심의로 라우팅(판정 아님).
//  CHECK    = 검토권고 : 맥락(인증·근거)에 따라 정당할 수 있음 → 근거 확인 질문.
const FLAG = {
  EVIDENCE: { key: "EVIDENCE", mark: "❗", label: "실증필요", action: "실증자료 확인" },
  REVIEW: { key: "REVIEW", mark: "⚖", label: "심의대상", action: "사전심의 확인" },
  CHECK: { key: "CHECK", mark: "⚠️", label: "검토권고", action: "근거 확인" },
};

// 업종 코드(안전장치 6)
const INDUSTRIES = ["general", "cosmetic", "food", "medical"];
const INDUSTRY_LABEL = {
  general: "일반 상품·서비스",
  cosmetic: "화장품",
  food: "식품·건강기능식품",
  medical: "의료(병의원)",
};

// ── 전 업종 공통: 최상급·절대·무근거 비교 표현(표시광고법 실증책임) ─────────
// term: 부분일치 문자열. 각 항목에 근거 법령·사유·대체표현(고정 매핑, 생성 아님) 병기.
const COMMON_TERMS = [
  { term: "최고", flag: "EVIDENCE", category: "최상급 표현", law: "표시광고법 제3조·제5조(실증제)", reason: "최상급 표현은 객관적 실증자료가 없으면 부당광고 소지", suggest: "구체적 사실·수치로 대체하거나 실증자료 확보", notBefore: ["령"] /* 최고령(oldest) 오탐 방지 */ },
  { term: "최상", flag: "EVIDENCE", category: "최상급 표현", law: "표시광고법 제3조·제5조", reason: "최상급 표현은 실증책임 대상", suggest: "객관적 근거 제시 또는 표현 완화" },
  { term: "최상급", flag: "EVIDENCE", category: "최상급 표현", law: "표시광고법 제3조·제5조", reason: "최상급 표현은 실증책임 대상", suggest: "객관적 근거 제시 또는 표현 완화" },
  { term: "1위", flag: "EVIDENCE", category: "순위·비교 표현", law: "표시광고법 제3조·제5조", reason: "'1위'는 조사 출처·기준·시점을 함께 표기하지 않으면 부당광고 소지", suggest: "출처·조사기관·기준·시점 병기(예: 'OO조사 2025년 매출 기준')", notBefore: ["원"] /* 제1위원회 오탐 방지 */ },
  { term: "1등", flag: "EVIDENCE", category: "순위·비교 표현", law: "표시광고법 제3조·제5조", reason: "순위 주장은 근거·출처 실증 필요", suggest: "출처·기준 병기", notBefore: ["급"] /* 1등급(등급표시) 오탐 방지 */ },
  { term: "업계 1위", flag: "EVIDENCE", category: "순위·비교 표현", law: "표시광고법 제3조·제5조", reason: "업계 순위 주장은 실증 필요", suggest: "출처·기준·시점 병기" },
  { term: "국내 유일", flag: "EVIDENCE", category: "유일성 표현", law: "표시광고법 제3조·제5조", reason: "'유일'은 반증 하나로 허위가 되는 절대표현", suggest: "'국내 유일' 대신 구체적 차별점 서술" },
  { term: "국내 최초", flag: "EVIDENCE", category: "유일성 표현", law: "표시광고법 제3조·제5조", reason: "'최초'는 실증 필요(선행 사례 존재 시 허위)", suggest: "근거·시점 명시 또는 표현 완화" },
  { term: "세계 최초", flag: "EVIDENCE", category: "유일성 표현", law: "표시광고법 제3조·제5조", reason: "'세계 최초'는 실증 필요", suggest: "근거·시점 명시 또는 표현 완화" },
  { term: "업계 최초", flag: "EVIDENCE", category: "유일성 표현", law: "표시광고법 제3조·제5조", reason: "'최초'는 실증 필요", suggest: "근거 명시 또는 완화" },
  { term: "유일한", flag: "EVIDENCE", category: "유일성 표현", law: "표시광고법 제3조·제5조", reason: "절대적 유일성 주장은 실증 필요", suggest: "구체적 차별점으로 대체" },
  { term: "완벽", flag: "EVIDENCE", category: "절대 표현", law: "표시광고법 제3조·제5조", reason: "'완벽'은 절대표현으로 실증·과장 소지", suggest: "구체적 사실로 대체" },
  { term: "100%", flag: "EVIDENCE", category: "절대 표현", law: "표시광고법 제3조·제5조", reason: "'100%'는 실증자료 없이 쓰면 부당광고 소지(예외: 성분 함량 등 사실 표기)", suggest: "무엇이 100%인지 근거·기준 명시" },
  { term: "무조건", flag: "EVIDENCE", category: "절대 표현", law: "표시광고법 제3조·제5조", reason: "'무조건' 보장류는 실증·과장 소지", suggest: "조건·범위 명시" },
  { term: "최저가", flag: "EVIDENCE", category: "가격 최상급", law: "표시광고법 제3조·제5조", reason: "'최저가'는 비교 시점·범위 실증 필요(변동 시 허위)", suggest: "'특가' 등으로 완화하거나 비교 기준 명시" },
  { term: "타사 대비", flag: "CHECK", category: "비교 표현", law: "표시광고법 제3조(부당비교)", reason: "비교광고는 객관적 근거·출처가 없으면 부당비교 소지", suggest: "비교 대상·기준·출처를 구체적으로 명시" },
  { term: "타사보다", flag: "CHECK", category: "비교 표현", law: "표시광고법 제3조(부당비교)", reason: "무근거 비교는 부당광고 소지", suggest: "비교 기준·출처 명시" },
];

// ── 화장품(cosmetic) ─────────────────────────────────────────────
const COSMETIC_TERMS = [
  // 의약품 오인 — 치료·재생 뉘앙스(원료 특성 한정 단서 없으면 문제)
  // 주의: 바 "재생"(bare) 은 재생지·재생에너지·재생목록 등 오탐이 많아 제외하고,
  //       구체 표현("세포 재생"·"피부 재생")만 규칙으로 둔다(정밀도 우선).
  { term: "세포 재생", flag: "REVIEW", category: "의약품 오인(치료·재생)", law: "화장품법 제13조", reason: "세포 재생은 의약품 효능 표방 소지", suggest: "화장품 인정 표현으로 대체(협회 자문 권장)" },
  { term: "피부 재생", flag: "CHECK", category: "의약품 오인(치료·재생)", law: "화장품법 제13조·표시광고 관리지침", reason: "'피부 재생'은 치료 뉘앙스 오인 소지", suggest: "'피부 컨디션 케어' 등으로 대체" },
  { term: "상처 치료", flag: "REVIEW", category: "질병·치료 표현", law: "화장품법 제13조", reason: "치료 표현은 화장품 범위를 벗어남(의약품 오인)", suggest: "표현 삭제·전문가 자문" },
  { term: "여드름 치료", flag: "REVIEW", category: "질병·치료 표현", law: "화장품법 제13조", reason: "질병 치료 표현은 의약품 오인", suggest: "'피지 관리' 등 인정 범위로 대체" },
  { term: "아토피", flag: "REVIEW", category: "질병·치료 표현", law: "화장품법 제13조·실증규정", reason: "질병명 언급은 의약품 오인 소지", suggest: "질병명 삭제·전문가 자문" },
  { term: "건선", flag: "REVIEW", category: "질병·치료 표현", law: "화장품법 제13조", reason: "질병명 언급은 의약품 오인 소지", suggest: "질병명 삭제" },
  { term: "항염", flag: "REVIEW", category: "의약품 오인", law: "화장품법 제13조", reason: "'항염'은 의약품적 효능 표현", suggest: "'진정에 도움' 등 인정 표현으로 대체" },
  { term: "살균", flag: "REVIEW", category: "의약품 오인", law: "화장품법 제13조", reason: "'살균·소독'은 의약외품/의약품 효능", suggest: "표현 삭제·전문가 자문" },
  { term: "소독", flag: "REVIEW", category: "의약품 오인", law: "화장품법 제13조", reason: "'소독'은 의약외품/의약품 효능", suggest: "표현 삭제" },
  { term: "항암", flag: "REVIEW", category: "질병·치료 표현", law: "화장품법 제13조", reason: "항암 표현은 명백한 의약품 오인", suggest: "표현 삭제" },
  { term: "튼살 완화", flag: "REVIEW", category: "질병·치료 표현", law: "화장품법 제13조", reason: "신체 변형·치료 뉘앙스 오인 소지", suggest: "인정 범위 표현으로 대체" },
  // 미인증 기능성 참칭 — 기능성화장품 심사·보고 없이 사용 시
  { term: "미백", flag: "CHECK", category: "기능성 표방", law: "화장품법 제4조·제13조", reason: "'미백'은 기능성화장품 심사·보고를 받은 경우에만 표방 가능", suggest: "기능성 심사·보고 여부 확인, 미보유 시 '피부 톤 케어' 등으로 대체" },
  { term: "주름 개선", flag: "CHECK", category: "기능성 표방", law: "화장품법 제4조·제13조", reason: "'주름 개선'은 기능성 인증 필요 표현", suggest: "기능성 인증 확인, 미보유 시 표현 완화" },
  { term: "자외선 차단", flag: "CHECK", category: "기능성 표방", law: "화장품법 제4조·제13조", reason: "자외선차단 기능성은 심사·보고 필요", suggest: "기능성 인증 확인" },
];

// ── 식품·건강기능식품(food) ───────────────────────────────────────
const FOOD_TERMS = [
  { term: "완치", flag: "REVIEW", category: "질병 치료·예방 표현", law: "식품표시광고법 제8조", reason: "질병 치료·완치 표현은 식품 광고에서 금지(사전심의/자율심의 대상)", suggest: "질병 관련 표현 삭제·자율심의 확인" },
  { term: "치료", flag: "REVIEW", category: "질병 치료·예방 표현", law: "식품표시광고법 제8조", reason: "질병 치료 표현은 식품에서 금지", suggest: "표현 삭제·자율심의 확인" },
  { term: "예방", flag: "REVIEW", category: "질병 치료·예방 표현", law: "식품표시광고법 제8조", reason: "질병 예방 효능 표현은 원칙적으로 금지(건기식도 심의 대상)", suggest: "인정 문구·자율심의 확인" },
  { term: "당뇨", flag: "REVIEW", category: "질병명 언급", law: "식품표시광고법 제8조", reason: "특정 질병명 연계 효능 표현은 금지 소지", suggest: "질병명 삭제·자율심의 확인" },
  { term: "고혈압", flag: "REVIEW", category: "질병명 언급", law: "식품표시광고법 제8조", reason: "질병명 연계 효능 표현 금지 소지", suggest: "질병명 삭제" },
  { term: "전립선", flag: "REVIEW", category: "질병명 언급", law: "식품표시광고법 제8조", reason: "질병·신체기관 연계 효능 표현 금지 소지", suggest: "질병명 삭제·자율심의 확인" },
  { term: "염증 완화", flag: "REVIEW", category: "의약품 오인", law: "식품표시광고법 제8조", reason: "'염증 완화'는 의약품적 효능 표현", suggest: "인정 문구로 대체" },
  { term: "면역력 강화", flag: "CHECK", category: "기능성 표방", law: "식품표시광고법 제8조", reason: "'면역력' 표현은 인정된 기능성 범위·자율심의 확인 필요(일반식품 금지)", suggest: "건강기능식품 인정 문구 여부 확인" },
  { term: "디톡스", flag: "CHECK", category: "의약품 오인", law: "식품표시광고법 제8조", reason: "'디톡스(독소 배출)'는 의약품적·과장 표현 소지", suggest: "표현 완화·자율심의 확인" },
  { term: "부작용 없", flag: "EVIDENCE", category: "안전성 단정", law: "식품표시광고법 제8조·표시광고법 제5조", reason: "'부작용 없음' 단정은 실증 불가·소비자 오인 소지", suggest: "단정 표현 삭제" },
  // 일반식품의 의약품 오인 형태
  { term: "먹는 약", flag: "REVIEW", category: "의약품 오인", law: "식품표시광고법 제8조", reason: "식품을 의약품처럼 표현", suggest: "표현 삭제" },
];

// ── 의료(medical) ─────────────────────────────────────────────────
// 안전장치 5: 의료 업종은 '판정' 대신 '사전심의 대상'으로만 라우팅한다.
// 아래 term 히트는 모두 REVIEW(심의대상)이며, 의료 업종은 히트가 없어도 ✅(미발견)를 주지 않는다.
const MEDICAL_TERMS = [
  { term: "완치", flag: "REVIEW", category: "치료효과 보장", law: "의료법 제56조·제57조(사전심의)", reason: "치료효과 보장·단정 표현은 의료광고 금지 유형(사전심의 대상)", suggest: "표현 삭제, 의료광고심의위 사전심의 필요" },
  { term: "부작용 없", flag: "REVIEW", category: "안전성 보장", law: "의료법 제56조·제57조", reason: "부작용 없음 단정은 금지 유형(사전심의 대상)", suggest: "단정 표현 삭제, 사전심의 필요" },
  { term: "100% 안전", flag: "REVIEW", category: "안전성 보장", law: "의료법 제56조·제57조", reason: "안전 단정은 금지 유형", suggest: "단정 표현 삭제, 사전심의 필요" },
  { term: "최고의 병원", flag: "REVIEW", category: "최상급 표현", law: "의료법 제56조·제57조", reason: "최상급 표현은 의료광고 금지 유형", suggest: "표현 삭제, 사전심의 필요" },
  // 주의: 바 "명의"(名醫/名義 동음이의)·바 "후기"(조선 후기·임신 후기 등)는 오탐이 커서 제외.
  //       환자 치료경험담은 구체 표현으로만 잡는다(정밀도 우선).
  { term: "치료 후기", flag: "REVIEW", category: "환자 치료경험담", law: "의료법 제56조·제57조", reason: "환자 치료경험담(후기)은 의료광고 금지 유형", suggest: "치료경험담 삭제, 사전심의 필요" },
  { term: "시술 후기", flag: "REVIEW", category: "환자 치료경험담", law: "의료법 제56조·제57조", reason: "환자 치료경험담(후기)은 의료광고 금지 유형", suggest: "치료경험담 삭제, 사전심의 필요" },
  { term: "환자 후기", flag: "REVIEW", category: "환자 치료경험담", law: "의료법 제56조·제57조", reason: "환자 치료경험담(후기)은 의료광고 금지 유형", suggest: "치료경험담 삭제, 사전심의 필요" },
  { term: "전후 사진", flag: "REVIEW", category: "치료 전후 비교", law: "의료법 제56조·제57조", reason: "치료 전후 비교는 심의 대상(오인 소지)", suggest: "사전심의 필요" },
  { term: "시술 효과", flag: "REVIEW", category: "치료효과 표현", law: "의료법 제56조·제57조", reason: "효과 표현은 사전심의 대상", suggest: "사전심의 필요" },
];

// ── 부정문 맥락(안전장치 7): 뒤따르는 이 표현이면 히트를 억제한다 ──────────
// '완치되지 않습니다', '1위가 아닙니다', '보장하지 못합니다' 등 표현이 뒤집힌 경우.
// 주의: '없음'은 '부작용 없음'처럼 오히려 금지 표현을 완성하므로 억제어에서 제외한다.
const NEGATION_TOKENS = ["않", "아니", "못하", "없지"];
const NEGATION_WINDOW = 12; // 매치 종료 후 이 글자수 이내에 부정 토큰이 있으면 억제

// 인용·상호명 가능성(안전장치 7): 매치가 따옴표/괄호로 감싸였으면 EVIDENCE→CHECK 강등.
const QUOTE_OPENERS = ["'", '"', "“", "‘", "「", "『", "《", "<"];
const QUOTE_CLOSERS = ["'", '"', "”", "’", "」", "』", "》", ">"];

const INDUSTRY_TERMS = {
  general: COMMON_TERMS,
  cosmetic: COMMON_TERMS.concat(COSMETIC_TERMS),
  food: COMMON_TERMS.concat(FOOD_TERMS),
  medical: COMMON_TERMS.concat(MEDICAL_TERMS),
};

module.exports = {
  WORDLIST_BASIS_DATE,
  FLAG,
  INDUSTRIES,
  INDUSTRY_LABEL,
  INDUSTRY_TERMS,
  COMMON_TERMS,
  COSMETIC_TERMS,
  FOOD_TERMS,
  MEDICAL_TERMS,
  NEGATION_TOKENS,
  NEGATION_WINDOW,
  QUOTE_OPENERS,
  QUOTE_CLOSERS,
};

};
window.__TOOL = {
  demo: "★단독★ 국내 유일, 업계 1위 최고의 제품!\n타사 대비 100% 완벽한 성능, 무조건 만족을 약속합니다.\n지금 최저가로 만나보세요.",
  run: function(input){
    var r = require("linter")["lint"](input, "general");
    return require("render")["renderLintReport"](r);
  }
};
})();
