// 駐警交班後對一般檢視者遮蔽自由文字；原文保留供主管與稽核使用。
const SURNAMES = new Set([...`陳林黃張李王吳劉蔡楊許鄭謝郭洪邱曾廖賴徐周葉蘇莊呂江何蕭羅高潘簡朱鍾游詹胡施沈余趙盧梁顏柯翁魏方孫戴杜宋范傅曹彭董白田石嚴顧韓馬程唐袁夏秦韋陶尹毛雷溫孔金姚龔熊姜梅阮樊倪易古康卓黎章涂連藍伍穆凌史侯任駱關`]);
const COMPOUND_SURNAMES = new Set(['歐陽', '司馬', '上官', '諸葛', '夏侯', '尉遲', '皇甫', '公孫', '慕容', '令狐']);
const NOT_GIVEN_NAMES = new Set(['先生', '小姐', '女士', '警員', '隊員', '人員', '民眾', '市場', '公司', '單位', '大樓', '設備', '正常', '交接', '報案', '車禍', '竊盜', '巡邏', '主任', '主管', '車主']);
const SENTENCE_PARTICLES = new Set([...`於在向與及因由後前和跟的了將被又其等`]);
const NAME_CONTEXT = /(?:姓名|當事人|車主|駕駛|報案人|被害人|傷者|民眾|竊嫌|嫌疑人|失主|住戶|訪客|行人|司機|涉事者|聯絡人)[：:\s]*$/u;
const HAN = /^\p{Script=Han}{1,4}$/u;
const ID_NUMBER = /(?<![A-Za-z0-9])[A-Z][12]\d{8}(?![A-Za-z0-9])/giu;
const PHONE_NUMBER = /(?<![A-Za-z0-9])(?:09\d{2}[- ]?\d{3}[- ]?\d{3}|0[2-8][- ]?\d{3,4}[- ]?\d{4})(?![A-Za-z0-9])/gu;
const SEGMENTER = new Intl.Segmenter('zh-Hant', { granularity: 'word' });

type Span = { start: number; end: number; replacement: string };
function maskedName(name: string) {
  const letters = [...name];
  return letters.length === 2 ? `${letters[0]}O` : `${letters[0]}${'O'.repeat(letters.length - 2)}${letters.at(-1)}`;
}

export function maskGuardName(name: string): string { return maskedName(name); }
export function maskGuardIdNumber(value: string): string {
  return value.length > 5 ? `${value.slice(0, 5)}${'*'.repeat(value.length - 5)}` : '*'.repeat(value.length);
}
export function maskGuardPhone(value: string): string {
  const digits = [...value].filter(char => /\d/.test(char)).length;
  let seen = 0;
  return [...value].map(char => {
    if (!/\d/.test(char)) return char;
    seen += 1;
    return seen <= Math.min(3, digits - 2) || seen > digits - 2 ? char : '*';
  }).join('');
}

export function maskGuardPersonalData(input: string): string {
  if (!input) return input;
  const spans: Span[] = [];
  for (const match of input.matchAll(ID_NUMBER)) {
    spans.push({ start: match.index, end: match.index + match[0].length, replacement: `${match[0].slice(0, 5)}*****` });
  }
  for (const match of input.matchAll(PHONE_NUMBER)) {
    if (!spans.some(span => match.index < span.end && match.index + match[0].length > span.start)) {
      spans.push({ start: match.index, end: match.index + match[0].length, replacement: maskGuardPhone(match[0]) });
    }
  }
  const words = [...SEGMENTER.segment(input)]
    .map(part => ({ value: part.segment, start: part.index, end: part.index + part.segment.length }));
  for (let i = 0; i < words.length; i++) {
    const current = words[i];
    const next = words[i + 1];
    const third = words[i + 2];
    let end = current.end;
    let name = current.value;
    if (name.length === 1 && SURNAMES.has(name) && next?.start === end && HAN.test(next.value)
      && next.value.length <= 2 && !NOT_GIVEN_NAMES.has(next.value)) {
      name += next.value; end = next.end;
      if (next.value.length === 1 && third?.start === end && third.value.length === 1
        && HAN.test(third.value) && !SENTENCE_PARTICLES.has(third.value)) {
        name += third.value; end = third.end;
      }
    } else if (COMPOUND_SURNAMES.has(name) && next?.start === end && HAN.test(next.value)
      && next.value.length <= 2) {
      name += next.value; end = next.end;
      if (next.value.length === 1 && third?.start === end && third.value.length === 1
        && HAN.test(third.value) && !SENTENCE_PARTICLES.has(third.value)) {
        name += third.value; end = third.end;
      }
    } else if (name.length >= 3 && name.length <= 4 && HAN.test(name)
      && (SURNAMES.has(name[0]) || COMPOUND_SURNAMES.has(name.slice(0, 2)))) {
      // 分詞器已辨識出完整姓名。
    } else if (name.length === 2 && HAN.test(name) && SURNAMES.has(name[0])
      && NAME_CONTEXT.test(input.slice(Math.max(0, current.start - 12), current.start))) {
      // 二字姓名只在前文有姓名語境時辨識，降低地名誤判。
    } else continue;
    if (NOT_GIVEN_NAMES.has(name) || spans.some(span => current.start < span.end && end > span.start)) continue;
    spans.push({ start: current.start, end, replacement: maskedName(name) });
    if (end !== current.end) i += end === third?.end ? 2 : 1;
  }
  return spans.sort((a, b) => b.start - a.start).reduce((value, span) =>
    value.slice(0, span.start) + span.replacement + value.slice(span.end), input);
}

export function maskGuardReportFields<T extends Record<string, unknown>>(row: T): T {
  const masked = { ...row } as Record<string, unknown>;
  const persons = Array.isArray(row.incidents) ? row.incidents.flatMap(incident =>
    incident && typeof incident === 'object' && Array.isArray(incident.persons) ? incident.persons : []) : [];
  const maskText = (value: string) => {
    let result = value;
    for (const person of persons) {
      if (!person || typeof person !== 'object') continue;
      for (const [field, masker] of [['name', maskGuardName], ['id_number', maskGuardIdNumber], ['phone', maskGuardPhone]] as const) {
        const raw = person[field];
        if (typeof raw === 'string' && raw.length >= 2) result = result.split(raw).join(masker(raw));
      }
    }
    return maskGuardPersonalData(result);
  };
  for (const field of ['substitute_note', 'duty_summary', 'important_notes', 'note']) {
    if (typeof masked[field] === 'string') masked[field] = maskText(masked[field]);
  }
  if (Array.isArray(row.incidents)) masked.incidents = row.incidents.map(incident => {
    if (!incident || typeof incident !== 'object') return incident;
    const copy = { ...incident } as Record<string, unknown>;
    for (const field of ['location', 'category', 'description', 'action', 'reported_to']) {
      if (typeof copy[field] === 'string') copy[field] = maskText(copy[field]);
    }
    if (Array.isArray(copy.persons)) copy.persons = copy.persons.map(person => person && typeof person === 'object' ? {
      ...person,
      name: typeof person.name === 'string' ? maskGuardName(person.name) : '',
      id_number: typeof person.id_number === 'string' ? maskGuardIdNumber(person.id_number) : '',
      phone: typeof person.phone === 'string' ? maskGuardPhone(person.phone) : '',
    } : person);
    return copy;
  });
  if (Array.isArray(row.items)) masked.items = row.items.map(item => {
    if (!item || typeof item !== 'object') return item;
    const copy = { ...item } as Record<string, unknown>;
    for (const field of ['name', 'condition', 'note']) {
      if (typeof copy[field] === 'string') copy[field] = maskText(copy[field]);
    }
    return copy;
  });
  return masked as T;
}
