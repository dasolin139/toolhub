/* toolhub — ec-notice-lint 브라우저 번들. 도구 원본 소스를 그대로 임베드(수정 없음). */
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
// 전자상거래 법정 표시의무 존재검사 엔진 — 결정론·오프라인·무의존성.
//
// 핵심: 붙여넣은 쇼핑몰 하단(footer)·이용안내·약관 텍스트에서 법정 표시항목의 "존재/미감지"만 판정한다.
//   존재검사 ≠ 내용검사(제목·키워드가 있어도 내용이 부실할 수 있음 → false-green 배너로 상시 고지).
//   "미감지"는 "누락"이 아니다(붙여넣지 않은 별도 페이지에 있을 수 있음 → render 에서 봉인 문구).

const { LIST_BASIS, FOCUS_NOTE, CORE, IDENTITY, CONDITIONAL } = require("./rules");

// 공백 제거 + 소문자화로 표기차("전화 번호"↔"전화번호")를 흡수한다. 가운뎃점·괄호는 보존.
function normalize(text) {
  if (typeof text !== "string") return "";
  return text.replace(/\s+/g, "").toLowerCase();
}

// 정규화 텍스트에서 pattern 을 찾되, notBefore/notAfter 문자가 바로 앞/뒤에 오면 그 매치는 무시.
// (한국어는 word boundary 가 없어 substring 오탐이 잦음 — C227/C228 교훈.
//  예: '주소'는 '이메일주소'에서, '상호'는 '상호간'에서, '하자'는 '시작하자'에서 假绿 → 경계 필요)
function matchPattern(haystack, pattern, notBefore, notAfter) {
  if (!pattern) return false;
  let idx = haystack.indexOf(pattern);
  while (idx !== -1) {
    const prev = idx > 0 ? haystack[idx - 1] : "";
    const next = haystack[idx + pattern.length] || "";
    const okBefore = !notBefore || notBefore.length === 0 || notBefore.indexOf(prev) === -1;
    const okAfter = !notAfter || notAfter.length === 0 || notAfter.indexOf(next) === -1;
    if (okBefore && okAfter) return true;
    idx = haystack.indexOf(pattern, idx + 1);
  }
  return false;
}

// base 가 나타나고 그 ±window 안에 tokens 중 하나가 있으면 true.
// (전체 문서 co-occurrence 는 흔한 토큰으로 오염되므로 '근접'을 요구한다)
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

// 한 항목(라벨)이 텍스트에 감지되는가.
//   - patterns: 안전한 강(합성) 패턴 — 하나라도 매치하면 감지.
//   - guarded: bare(오탐 잦은) 패턴 — notBefore/notAfter 경계를 붙여야만 인정.
//   - near: base 근처 ±window 안에 tokens 가 있을 때만 인정(약패턴 假绿 방지).
function detectLabel(haystack, item) {
  for (const p of item.patterns || []) {
    if (matchPattern(haystack, normalize(p))) return true;
  }
  for (const g of item.guarded || []) {
    if (matchPattern(haystack, normalize(g.pattern), g.notBefore, g.notAfter)) return true;
  }
  for (const nr of item.near || []) {
    const tokens = (nr.tokens || []).map(normalize);
    if (matchNear(haystack, normalize(nr.base), tokens, nr.window || 8)) return true;
  }
  return false;
}

// 값(형식) 감지 — RAW 텍스트에서 valueRegex 로 판정하되, 반드시 라벨(valueAnchor) 근처에서만 본다.
// (전역 검색은 전화·주문번호·정부고시 호수 등 무관 숫자를 값으로 오인해 placeholder 경고를 억제한다 —
//  code-review F5/F6. matchNear 와 같은 '근접' 철학을 값 검사에도 적용.)
// 유효성(checksum/실재) 판정이 아니라 "라벨은 있으나 값이 비어 있는 placeholder 방치" 신호일 뿐이다(조건11).
function detectValue(raw, item) {
  if (!item.valueRegex) return null; // 값 검사 대상이 아님
  if (!item.valueAnchor) return item.valueRegex.test(raw);
  const flags = item.valueAnchor.flags.includes("g")
    ? item.valueAnchor.flags
    : item.valueAnchor.flags + "g";
  const re = new RegExp(item.valueAnchor.source, flags);
  let m;
  while ((m = re.exec(raw)) !== null) {
    const start = Math.max(0, m.index - 30);
    const end = m.index + m[0].length + 40;
    if (item.valueRegex.test(raw.slice(start, end))) return true;
    if (m.index === re.lastIndex) re.lastIndex++; // zero-length 매치 방어
  }
  return false;
}

// 한 층(list)을 검사해 항목 결과 배열을 만든다.
function scanList(raw, haystack, list, empty) {
  return list.map((item) => {
    const detected = empty ? false : detectLabel(haystack, item);
    const out = {
      id: item.id,
      label: item.label,
      law: item.law,
      detected,
    };
    if (item.trigger) out.trigger = item.trigger;
    if (item.valueRegex) {
      // 라벨이 감지된 경우에만 값 유무를 본다(라벨 없으면 값 논의 무의미).
      out.valueLabel = item.valueLabel;
      out.valuePresent = empty || !detected ? false : detectValue(raw, item);
    }
    return out;
  });
}

// 전체 검사.
function lint(text) {
  const raw = typeof text === "string" ? text : "";
  const haystack = normalize(raw);
  const empty = haystack.length === 0;

  const core = scanList(raw, haystack, CORE, empty);
  const identity = scanList(raw, haystack, IDENTITY, empty);
  const conditional = scanList(raw, haystack, CONDITIONAL, empty);

  const coreMissing = core.filter((c) => !c.detected);
  const identityMissing = identity.filter((i) => !i.detected);
  const conditionalAbsent = conditional.filter((c) => !c.detected);
  // 라벨은 있으나 형식에 맞는 값이 없는 항목(placeholder 방치 의심) — CORE/IDENTITY/CONDITIONAL 통틀어.
  const valueMissing = [...core, ...identity, ...conditional].filter(
    (x) => x.valueLabel && x.detected && x.valuePresent === false
  );

  return {
    basis: LIST_BASIS,
    focus: FOCUS_NOTE,
    empty,
    core,
    identity,
    conditional,
    summary: {
      coreTotal: core.length,
      coreMissing: coreMissing.length,
      coreMissingIds: coreMissing.map((c) => c.id),
      identityTotal: identity.length,
      identityMissing: identityMissing.length,
      identityMissingIds: identityMissing.map((i) => i.id),
      conditionalAbsent: conditionalAbsent.length,
      valueMissingIds: valueMissing.map((x) => x.id),
    },
  };
}

module.exports = { normalize, matchPattern, matchNear, detectLabel, detectValue, lint };

};
__modules["render"] = function(module, exports, require){
"use strict";
//
// 리포트 렌더러 — 정직성·성립 경계를 여기서 강제한다(Munger 12조건).
//   - 판정어("위법","불법","과태료","합법","통과","준수")를 절대 출력하지 않는다(변호사법 경계).
//   - false-green 배너: "감지됨"이 내용 충실을 보증하지 않음을 상시 고지.
//   - 검사범위 봉인(조건8): "미감지"를 "누락"으로 단정하지 않는다(별도 페이지에 있으면 무시).
//   - 청약철회(조건9): 존재만 확인, 기간·조건 적정성 미검증을 명시.
//   - 순증 focus(조건10): 기본 신원정보는 [참고](솔루션 자동표시), CORE=자유텍스트 거래조건층.

const DISCLAIMER = [
  "※ 본 도구는 전자상거래법 §10·§13 등이 요구하는 '표시항목의 형식적 존재 여부'만 자가점검합니다.",
  "※ 법적 효력이나 제재 해당 여부를 판정하지 않습니다. '감지됨'은 해당 키워드가 텍스트에 있다는 뜻일 뿐,",
  "   내용(예: 청약철회 기간·조건)이 법에 맞게 작성됐음을 보증하지 않습니다.",
  "※ 이 도구는 '붙여넣은 텍스트'만 봅니다. 미감지 항목이 이용약관·이용안내 등 별도 페이지에 있으면 무시하세요.",
  "   미감지는 '누락'의 단정이 아니라 '이 텍스트에서 감지 안 됨'입니다.",
  "※ 정확한 판단은 전자상거래 전문가·변호사 상담을 권장합니다. 이 도구는 항목을 대신 작성하지 않습니다.",
];

function markCore(detected) {
  return detected ? "○ 감지됨" : "● 미감지";
}

function valueNote(item) {
  // 라벨은 있으나 형식에 맞는 값이 없을 때만 안내(placeholder 방치 의심). 유효성 판정 아님.
  if (!item.valueLabel || !item.detected) return null;
  if (item.valuePresent === false) {
    return `      확인: 라벨은 감지됐으나 ${item.valueLabel}에 맞는 값이 이 텍스트에 없습니다 — 값이 비었는지(placeholder) 확인하세요.`;
  }
  return null;
}

function renderReport(result) {
  const lines = [];
  lines.push("전자상거래 법정 표시의무 항목 자가점검 (존재검사)");
  lines.push("기준: " + result.basis);
  lines.push("집중: " + result.focus);
  lines.push("");

  if (result.empty) {
    lines.push("입력 텍스트가 비어 있습니다. 점검할 쇼핑몰 하단(footer)·이용안내 텍스트를 넣어 주세요.");
    lines.push("");
    lines.push(...DISCLAIMER);
    return lines.join("\n");
  }

  // [1] CORE — 거래조건·소비자보호 표시(자유텍스트층, 검사 가치의 중심)
  lines.push("[1] 거래조건·소비자보호 표시 항목 (자유텍스트 — 실제로 잘 빠지는 층)");
  for (const c of result.core) {
    const tag = c.detected
      ? ""
      : "  → 검토권고: 이 텍스트에서 미감지(별도 페이지에 있으면 무시).";
    lines.push(`  ${markCore(c.detected)}  ${c.label}  (${c.law})${tag}`);
    if (c.id === "cancel" && c.detected) {
      lines.push("      참고: 존재만 확인합니다. 철회기간(예: 7일)·조건의 법적 적정성은 검증하지 않습니다.");
    }
    const vn = valueNote(c);
    if (vn) lines.push(vn);
  }
  lines.push("");

  // [2] IDENTITY — 기본 사업자 신원(솔루션 자동표시 가능 · 참고)
  lines.push("[2] 기본 사업자 신원 [참고 — 솔루션(카페24·아임웹 등)이 자동표시할 수 있는 항목]");
  for (const i of result.identity) {
    const tag = i.detected ? "" : "  → 참고: 이 텍스트에서 미감지(솔루션 자동표시 영역일 수 있음).";
    lines.push(`  ${markCore(i.detected)}  ${i.label}  (${i.law})${tag}`);
    const vn = valueNote(i);
    if (vn) lines.push(vn);
  }
  lines.push("");

  // [3] CONDITIONAL — 해당 시 필수(미감지는 결함 아님)
  lines.push("[3] 해당 시 표시해야 하는 항목 (귀사가 해당할 때만 필수 — 미감지는 결함 아님)");
  for (const c of result.conditional) {
    if (c.detected) {
      lines.push(`  ○ 감지됨  ${c.label}  (${c.law})`);
      const vn = valueNote(c);
      if (vn) lines.push(vn);
    } else {
      lines.push(`  - 미감지  ${c.label}  (${c.law})`);
      lines.push(`      해당 시 확인: ${c.trigger}.`);
    }
  }
  lines.push("");

  // [요약] — 판정어 없이 미감지 개수만.
  const s = result.summary;
  lines.push("[요약]");
  lines.push(
    `  거래조건 표시 ${s.coreTotal}개 중 ${s.coreMissing}개 미감지` +
      (s.coreMissing > 0
        ? ` (${s.coreMissingIds.join(", ")}) → 위 항목이 이 텍스트에 있는지 직접 확인하세요.`
        : " → 거래조건 표시 키워드는 모두 감지되었습니다(내용 충실성은 별도 확인 필요).")
  );
  lines.push(
    `  기본 신원 ${s.identityTotal}개 중 ${s.identityMissing}개 미감지(참고 — 솔루션 자동표시 영역일 수 있음).`
  );
  if (s.valueMissingIds.length > 0) {
    lines.push(
      `  값 미기재 의심 ${s.valueMissingIds.length}개 (${s.valueMissingIds.join(", ")}) → 라벨만 있고 실제 번호가 비었는지 확인.`
    );
  }
  lines.push(`  해당 시 필수 중 미감지 ${s.conditionalAbsent}개(귀사에 해당 없으면 정상).`);
  lines.push("");
  lines.push(...DISCLAIMER);

  return lines.join("\n");
}

module.exports = { renderReport, DISCLAIMER };

};
__modules["rules"] = function(module, exports, require){
"use strict";
//
// 전자상거래 법정 표시의무 항목 존재검사 — 규칙(封闭清单)
//
// 근거: 「전자상거래 등에서의 소비자보호에 관한 법률」(전자상거래법) §10(사업자의 정보 제공),
//       §13(신원·거래조건에 관한 정보의 제공), 같은 법 시행규칙 §7(초기화면 표시방법).
//
// 이 파일이 이 제품의 진짜 순증(順增)이다 — privacy-policy-lint(C228)의 "인접 린터"가 아닌 이유:
//   (1) 완전히 다른 법령·소관(공정거래위원회 vs 개인정보보호위원회), 필수항목 세트가 near-zero 중복.
//   (2) 우리가 검사 가치를 두는 곳은 "솔루션(카페24·아임웹 등)이 자동표시해 주는 기본 신원 6항목"이 아니라,
//       운영자가 자유텍스트로 직접 써야 해서 실제로 잘 빠지는 "거래조건 표시항목"(청약철회·교환/반품·배송·
//       결제안전·분쟁처리)의 존재다. → CORE 층이 검사항목의 과반. (Munger F2/F3a·조건10)
//   (3) '간이과세 신고면제 → 간이과세사업자 명시'라는 이 도메인 고유의 조건부 2-way 분기.
//
// 정직성·성립 경계(Munger Pre-Mortem 12조건, 특히 전자상거래 특유 8~12):
//   8. 검사범위 봉인: "누락"을 단정하지 않는다. 미감지는 "붙여넣은 텍스트에서 감지 안 됨(별도 페이지에
//      있으면 무시)"으로만 표현한다(footer만 붙여넣고 약관은 별 페이지인 假红 방지).
//   9. 청약철회는 "존재"만 확인. 철회기간(7일 등)·조건의 법적 적정성은 검증하지 않는다(변호사법 경계).
//  10. 免费替代 대비 순증 명시: 기본 신원정보는 "참고(솔루션 자동표시 가능)"로 강등, CORE=자유텍스트층.
//  11. 사업자등록번호·통신판매업 신고번호는 "존재+형식"만. 유효성(checksum/실재) 판정 금지.
//  12. 통신판매업 신고번호는 conditional(간이과세 등 신고면제 대상 존재) — mandatory로 강제하면 假红.
//   + 판정어(위법/불법/과태료/합법/통과/준수) 미출력, false-green 배너 상시, 한국어 근접매칭, zero-generation.

const LIST_BASIS =
  "전자상거래법 §10·§13 + 시행규칙 §7 기준. 통신판매업 신고번호는 간이과세자 등 신고면제 대상이 있어 '해당 시'로 분류. 법 개정 시 최신 조문을 직접 확인하세요.";

// 免费替代 대비 순증 고정(조건10): 이 도구의 집중 대상을 상단에 상시 고지한다.
const FOCUS_NOTE =
  "이 도구의 집중 대상 = 솔루션(카페24·아임웹·고도몰 등)이 자동표시로 커버하지 못하는 '자유텍스트 거래조건 항목'(청약철회·교환/반품·배송·결제안전·분쟁처리)의 존재. 기본 사업자 신원정보는 솔루션이 자동표시할 수 있어 [참고]로만 봅니다.";

// ── [CORE] 거래조건·소비자보호 표시 (자유텍스트층, gap 두꺼움 · 항상 필수) ──────────────
// 운영자가 직접 자유텍스트로 써야 하므로 실제로 잘 빠지는 층. 검사 가치의 중심.
// 미감지 = "검토권고(붙여넣은 텍스트에서 미감지)". summary 집계 대상.
const CORE = [
  {
    id: "cancel",
    label: "청약철회·환불(반품) 안내",
    law: "전상법 §13②·§17",
    // 조건9: 존재만 확인. 기간·조건 적정성은 검증 안 함(render 에서 명시).
    patterns: ["청약철회", "청약의철회", "환불", "반품·환불", "환불규정", "환불정책", "청약철회등"],
  },
  {
    id: "exchange",
    label: "교환·반품·A/S(하자 시 처리) 조건",
    law: "전상법 §13②",
    // 假绿 방지(F4): bare '교환'(포인트 교환)·'하자'(시작하자) 제거. 합성/근접으로만 인정.
    // '교환안내'는 '포인트 교환 안내'를 假绿하므로 강패턴에서 제외 — 반품(guarded)/근접으로만 인정.
    patterns: ["교환·반품", "교환및반품", "반품교환", "as안내", "a/s", "사후관리", "반품/교환", "교환/반품"],
    guarded: [{ pattern: "반품", notBefore: ["일"] }], // '일반품목'의 반품 차단
    near: [{ base: "교환", tokens: ["반품", "환불", "교체", "as"], window: 6 }],
  },
  {
    id: "delivery",
    label: "재화 공급(배송) 방법·시기",
    law: "전상법 §13②",
    patterns: ["배송", "배송방법", "배송기간", "재화의공급", "공급방법", "배송비", "배송정책", "발송"],
  },
  {
    id: "payment",
    label: "대금 결제·환급 방법",
    law: "전상법 §13②",
    patterns: ["결제방법", "대금결제", "지급방법", "결제수단", "대금환급", "환급방법", "결제및환급"],
  },
  {
    id: "dispute",
    label: "소비자 불만·분쟁처리(소비자상담) 안내",
    law: "전상법 §13②",
    // 假绿 방지(F3): 영어 bare 'consumer'(consumer electronics) 제거. 한국어 합성 패턴만.
    patterns: [
      "소비자불만",
      "분쟁처리",
      "소비자상담",
      "고객센터",
      "소비자피해보상",
      "불만처리",
      "소비자분쟁",
      "소비자보호",
      "분쟁조정",
    ],
  },
  {
    id: "terms",
    label: "이용약관(사이버몰 이용약관)",
    law: "전상법 §10①5",
    patterns: ["이용약관", "이용약관은", "서비스이용약관", "쇼핑몰이용약관", "약관동의"],
    // bare '약관'은 '개인정보처리방침 및 약관' 등에서 假绿을 낼 수 있어 근접으로만 보강.
    near: [{ base: "약관", tokens: ["이용", "동의", "쇼핑몰", "서비스"], window: 8 }],
  },
  {
    id: "bizverify",
    label: "사업자정보 확인(공정위) 페이지 연결/안내",
    law: "시행규칙 §7②",
    patterns: [
      "사업자정보확인",
      "사업자정보를확인",
      "ftc.go.kr",
      "공정거래위원회",
      "통신판매사업자정보",
      "사업자정보공개",
    ],
  },
];

// ── [IDENTITY] 기본 사업자 신원 (솔루션 자동표시 가능 · 참고 확인) ────────────────────
// 조건10: 검사항목 과반이 이 층이면 '상품등록 覆辙' → 그래서 [참고]로 강등하고 CORE 를 다수화.
// 여전히 법정 필수지만 솔루션이 대개 자동표시하므로 "참고 확인"으로만 노출한다.
const IDENTITY = [
  {
    id: "company",
    label: "상호 및 대표자 성명",
    law: "전상법 §10①1",
    // 假绿 방지(F2): bare '상호'(상호간/상호작용)·'성명'(공동성명) 강등. 합성/경계로만.
    patterns: ["대표자", "대표이사", "대표자성명", "법인명", "회사명", "상호명", "상호및", "대표성명"],
    guarded: [{ pattern: "상호", notAfter: ["간", "작", "보"] }], // 상호간/상호작용/상호보완 차단
  },
  {
    id: "address",
    label: "영업소 소재지 주소(소비자 불만 처리 주소)",
    law: "전상법 §10①2",
    // 假绿 방지(F1): bare '주소'(이메일 주소/홈페이지 주소) 강등. 합성 강패턴 + 경계.
    patterns: ["소재지", "영업소", "사업장주소", "본사주소", "소재지주소", "사업장소재지"],
    guarded: [{ pattern: "주소", notBefore: ["일", "지", "웹", "넷"] }], // 이메일/메일/홈페이지/웹/인터넷 주소 차단
  },
  {
    id: "contact",
    label: "전화번호·전자우편주소",
    law: "전상법 §10①3",
    patterns: ["전화번호", "전화", "연락처", "전자우편", "이메일", "email", "e-mail", "고객센터전화"],
  },
  {
    id: "bizno",
    label: "사업자등록번호",
    law: "전상법 §10①4",
    patterns: ["사업자등록번호", "사업자번호", "사업자등록"],
    // 조건11: 존재+형식만. 유효성(checksum) 판정 금지 — 값(형식) 감지는 placeholder(값 미기재) 신호로만.
    // 형식: 3-2-5, 하이픈 필수(F5: 하이픈 없는 10자리는 전화·주문번호와 충돌 → 假绿).
    // valueAnchor 근처(±window)에서만 값을 인정한다(전역 오탐 차단).
    valueRegex: /\d{3}\s*-\s*\d{2}\s*-\s*\d{5}/,
    valueAnchor: /사업자\s*(등록)?\s*번호|사업자\s*등록/,
    valueLabel: "사업자등록번호 형식(###-##-#####)",
  },
];

// ── [CONDITIONAL] 해당 시 필수 (미감지는 결함 아님 — "해당 시 확인"만) ──────────────────
const CONDITIONAL = [
  {
    id: "salesreg",
    label: "통신판매업 신고번호 + 신고기관명",
    law: "전상법 §13①3",
    // 조건12: 간이과세자 등 신고면제 대상이 있어 mandatory 로 강제하지 않는다.
    trigger:
      "통신판매업 신고 대상 사업자라면(간이과세·직전연도 거래 미달 등 면제 대상은 '간이과세사업자' 명시로 갈음)",
    patterns: ["통신판매업신고", "통신판매신고", "통신판매업신고번호", "신고번호"],
    // 라벨은 있으나 실제 신고번호 값이 없는 placeholder 방치 탐지(존재+형식). 유효성 판정 아님.
    // F6: 정부고시 '제2020-서울12호'(2번째 하이픈·지역 없음, 2자리)와 구분하려고 신고번호 고유형식을
    //   요구한다 — 제YYYY-[지역]-[일련 4~5자리]호. valueAnchor 근접까지 겹쳐 이중 방어.
    valueRegex: /제?\s*\d{4}\s*-\s*[가-힣A-Za-z0-9]+\s*-\s*\d{4,5}\s*호/,
    valueAnchor: /통신판매업?\s*신고\s*번호|신고\s*번호/,
    valueLabel: "신고번호 형식(제YYYY-지역-NNNN호)",
  },
  {
    id: "simpletax",
    label: "'간이과세사업자입니다' 명시(신고 면제 시)",
    law: "전상법 실무(신고면제 갈음)",
    trigger: "간이과세자 등으로 통신판매업 신고가 면제되어 신고번호가 없다면",
    patterns: ["간이과세", "간이과세사업자", "통신판매업신고면제", "신고면제"],
  },
  {
    id: "escrow",
    label: "구매안전서비스(에스크로) 가입 사실 표시",
    law: "전상법 §13②·§24",
    trigger: "선지급식 통신판매(무통장입금·현금결제 등)로 재화를 판매한다면",
    patterns: ["구매안전서비스", "에스크로", "escrow", "결제대금예치", "구매안전"],
  },
  {
    id: "hosting",
    label: "호스팅서비스 제공자 상호",
    law: "전상법 §10① 관련",
    trigger: "호스팅(서버)을 외부 업체에 위탁한다면(카페24·가비아·자체구축 외 등)",
    patterns: ["호스팅", "호스팅제공자", "호스팅사업자", "hosting", "호스팅서비스"],
  },
  {
    id: "privacylink",
    label: "개인정보처리방침 연결/안내",
    law: "개인정보보호법(별도)·실무 상시",
    trigger: "개인정보를 처리한다면(회원가입·주문 등 사실상 상시)",
    patterns: ["개인정보처리방침", "개인정보취급방침", "개인정보보호정책"],
  },
];

module.exports = { LIST_BASIS, FOCUS_NOTE, CORE, IDENTITY, CONDITIONAL };

};
window.__TOOL = {
  demo: "(주)예시상점 | 대표자 홍길동\n주소: 서울시 강남구 테헤란로 1 | 전화: 02-000-0000 | 이메일: help@example.com\n사업자등록번호: 123-45-67890\n배송: 결제 후 2~3일 내 발송합니다.\n이용약관 | 개인정보처리방침",
  run: function(input){
    var r = require("linter")["lint"](input);
    return require("render")["renderReport"](r);
  }
};
})();
