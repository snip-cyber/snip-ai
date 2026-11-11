const FINANCIAL_LABELS = [
"cash and cash equivalents at beginning and end of year",
"cash and cash equivalents",
"total comprehensive income",
"profit before tax",
"profit for the year",
"operating profit",
"total liabilities",
"total assets",
"net assets",
"revenue",
"turnover"
];

const MONTH_PATTERN =
"(?:January|February|March|April|May|June|July|August|September|October|November|December)";

function cleanLine(value) {
return String(value || "")
.replace(/\u00ad/g, "")
.replace(/[ \t]+/g, " ")
.trim();
}

function normalized(value) {
return cleanLine(value)
.toLowerCase()
.replace(/[’‘]/g, "'")
.replace(/[–—]/g, "-")
.replace(/\s+/g, " ");
}

function financialHeadingType(value) {
const text = normalized(value)
.replace(/[\r\n]+/g, " ")
.replace(/\s+/g, " ")
.trim();

if (/\b(?:reconciliation of net debt|net debt reconciliation)\b/i.test(text)) {
return "Reconciliation";
}

if (/\b(?:financial review|composition of group net debt)\b/i.test(text)) {
return "Financial review";
}

if (
/\b(?:consolidated|group)\s+(?:statement of financial position|balance sheet)(?:\s+continued)?\b/i.test(text)
) {
return "Primary consolidated statement of financial position";
}

if (
/\b(?:company|parent company)\s+(?:statement of financial position|balance sheet)(?:\s+continued)?\b/i.test(text)
) {
return "Primary company statement of financial position";
}

return "Other";
}

export function extractPageLines(items) {
const rows = [];
const fallback = [];

for (const item of Array.isArray(items) ? items : []) {
const text = cleanLine(item?.str);
if (!text) continue;

const x = Number(item?.transform?.[4]);
const y = Number(item?.transform?.[5]);

if (!Number.isFinite(x) || !Number.isFinite(y)) {
  fallback.push(text);
  continue;
}

let row = rows.find(candidate => Math.abs(candidate.y - y) < 1.5);

if (!row) {
  row = { y, items: [] };
  rows.push(row);
}

row.items.push({
  x,
  y,
  width: Number(item?.width) || 0,
  text
});

}

if (!rows.length) return fallback;

const positioned = rows
.sort((a, b) => b.y - a.y)
.flatMap(row => {
const items = row.items.sort((a, b) => a.x - b.x);
const joined = items
.map(item => item.text)
.join(" ")
.replace(/\s+/g, " ")
.trim();

  if (!joined) return [];

  let splitAt = -1;

  for (let i = 1; i < items.length; i += 1) {
    const previous = items[i - 1];
    const current = items[i];
    const gap =
      current.x - (previous.x + Math.max(0, Number(previous.width) || 0));

    // PDF columns are often separated by a large horizontal gap. The
    // previous conservative threshold missed short column fragments, causing
    // text from unrelated columns to be joined and then highlighted as one quote.
    if (gap < 55) continue;

    const left = items.slice(0, i).map(item => item.text).join(" ").trim();
    const right = items.slice(i).map(item => item.text).join(" ").trim();

    const leftWords = (left.match(/[\p{L}\p{N}]{2,}/gu) || []).length;
    const rightWords = (right.match(/[\p{L}\p{N}]{2,}/gu) || []).length;
    const rightMostlyNumeric = /^[\s£€$()\d,.%+\-–—]+$/.test(right);

    if (
      left.length >= 16 &&
      right.length >= 16 &&
      leftWords >= 2 &&
      rightWords >= 2 &&
      !rightMostlyNumeric
    ) {
      splitAt = i;
      break;
    }
  }

  if (splitAt < 0) return [joined];

  return [
    items.slice(0, splitAt).map(item => item.text).join(" ").replace(/\s+/g, " ").trim(),
    items.slice(splitAt).map(item => item.text).join(" ").replace(/\s+/g, " ").trim()
  ].filter(Boolean);
})
.filter(Boolean);

return fallback.length ? [...positioned, ...fallback] : positioned;
}

export function classifyFinancialSection(pageText) {
const lines = String(pageText || "")
.split(/\n+/)
.map(cleanLine)
.filter(Boolean);

if (!lines.length) return "Other";

// Explicit reconciliation headings take precedence over references to
// statements that may occur elsewhere on the same page.
const allText = lines.join(" ");
const topText = lines.slice(0, 24).join(" ");

if (/\b(?:reconciliation of net debt|net debt reconciliation)\b/i.test(topText)) {
return "Reconciliation";
}

if (/\b(?:financial review|composition of group net debt)\b/i.test(topText)) {
return "Financial review";
}

// PDF extraction can split a heading across multiple text items or lines.
// Check the page's opening lines as joined text instead of requiring the
// heading to occupy one perfectly extracted line.
const topSection = financialHeadingType(topText);

if (topSection.startsWith("Primary ")) {
return topSection;
}

// Some PDFs include introductory material before the statement heading.
// Only accept a primary-statement heading elsewhere when the page is not
// explicitly identified as a net-debt reconciliation.
const allSection = financialHeadingType(allText);

if (allSection.startsWith("Primary ")) {
return allSection;
}

return "Other";
}

function findHeadingIndex(lines, headingPattern) {
for (let i = 0; i < lines.length; i += 1) {
if (headingPattern.test(lines[i])) return i;

// Accommodate headings split into adjacent extracted lines.
if (i + 1 < lines.length) {
  const combined = `${lines[i]} ${lines[i + 1]}`;

  if (headingPattern.test(combined)) return i + 1;
}

}

return -1;
}

function periodHeader(lines, headingPattern) {
const headingIndex = findHeadingIndex(lines, headingPattern);
if (headingIndex < 0) return "";

return lines
.slice(headingIndex + 1, headingIndex + 10)
.filter(line =>
/\b20\d{2}\b|£m|€m|\bas at\b|\bended\b|\bweeks?\b/i.test(line) ||
new RegExp(`\\b${MONTH_PATTERN}\\b`, "i").test(line)
)
.join(" | ");
}

function periodsFromHeader(header) {
const years = [...String(header).matchAll(/\b20\d{2}\b/g)].map(match => match[0]);
const dates = [...String(header).matchAll(new RegExp(`\\b\\d{1,2}\\s+${MONTH_PATTERN}\\b`, "gi"))].map(match => match[0]);
const periods = [];
for (let index = 0; index < Math.min(years.length, dates.length); index += 1) periods.push(`${dates[index]} ${years[index]}`);
if (!periods.length) for (const year of years) periods.push(year);
return periods;
}


export function extractFinancialRowsFromItems(items, page, indexOffset = 0) {
  const lines = extractPageLines(items);
  const rows = extractFinancialRows(lines.join("\n"), page, indexOffset);
  if (!rows.length) return rows;

  const positioned = [];
  for (const item of Array.isArray(items) ? items : []) {
    const text = cleanLine(item?.str);
    const x = Number(item?.transform?.[4]);
    const y = Number(item?.transform?.[5]);
    if (!text || !Number.isFinite(x) || !Number.isFinite(y)) continue;

    let line = positioned.find(candidate => Math.abs(candidate.y - y) < 1.5);
    if (!line) {
      line = { y, items: [] };
      positioned.push(line);
    }
    line.items.push({ x, width: Number(item.width) || 0, text });
  }

  for (const line of positioned) {
    line.items.sort((a, b) => a.x - b.x);
    line.text = line.items.map(item => item.text).join(" ");
  }

  for (const row of rows) {
    const labelLine = positioned.find(line =>
      normalized(line.text).includes(row.label)
    );
    if (!labelLine) continue;

    const labelItem = labelLine.items.find(item =>
      normalized(item.text).includes(row.label)
    );
    if (!labelItem) continue;

    const headingLine = positioned.find(line =>
      /\b(?:consolidated|group|company|parent company)\s+(?:statement of financial position|balance sheet)\b/i.test(line.text)
    );
    if (!headingLine || headingLine.y <= labelLine.y) continue;

    const headerItems = positioned
      .filter(line => line.y > labelLine.y && line.y < headingLine.y)
      .flatMap(line => line.items);

    const datePattern = new RegExp(
      `\\b\\d{1,2}\\s+${MONTH_PATTERN}\\b`, "i"
    );
    const dates = headerItems.filter(item => datePattern.test(item.text));
    const years = headerItems.filter(item => /\b20\d{2}\b/.test(item.text));

    const columns = [];
    const usedYears = new Set();

    for (const date of dates) {
      const yearMatches = years
        .map((year, index) => ({
          year,
          index,
          distance: Math.abs(year.x - date.x)
        }))
        .filter(entry => !usedYears.has(entry.index))
        .sort((a, b) => a.distance - b.distance);

      if (!yearMatches.length || yearMatches[0].distance > 60) continue;

      const match = yearMatches[0];
      usedYears.add(match.index);
      const year = match.year.text.match(/\b20\d{2}\b/)[0];
      const dateText = date.text.match(datePattern)[0];

      columns.push({
        x: (date.x + match.year.x) / 2,
        period: `${dateText} ${year}`
      });
    }

    const numericItems = labelLine.items.filter(item => {
      if (item.x <= labelItem.x + labelItem.width) return false;
      const value = item.text.replace(/\s+/g, "");
      return /^(?:\(?-?\d[\d,]*(?:\.\d+)?\)?|[—–-])$/.test(value);
    });

    const valueGroups = [];
    for (const item of numericItems) {
      const previous = valueGroups[valueGroups.length - 1];
      if (previous && item.x - (previous.lastX + previous.lastWidth) <= 10) {
        previous.parts.push(item.text);
        previous.lastX = item.x;
        previous.lastWidth = item.width;
      } else {
        valueGroups.push({
          x: item.x,
          lastX: item.x,
          lastWidth: item.width,
          parts: [item.text]
        });
      }
    }

    const usedValues = new Set();
    const aligned = [];

    for (const column of columns.sort((a, b) => a.x - b.x)) {
      const matches = valueGroups
        .map((group, index) => ({
          group,
          index,
          distance: Math.abs(group.x - column.x)
        }))
        .filter(entry => !usedValues.has(entry.index))
        .sort((a, b) => a.distance - b.distance);

      if (!matches.length || matches[0].distance > 60) continue;

      const match = matches[0];
      usedValues.add(match.index);
      const value = match.group.parts.join("")
        .replace(/(\d)\s*\.\s*(\d)/g, "$1.$2");

      aligned.push({ period: column.period, value });
    }

    if (aligned.length) {
      row.coordinatePeriods = aligned.map(item => item.period);
      row.coordinateValues = aligned.map(item => item.value);
    }
  }

  return rows;
}

export function extractFinancialRows(pageText, page, indexOffset = 0) {
const lines = String(pageText || "")
.split(/\n+/)
.map(cleanLine)
.filter(Boolean);

const section = classifyFinancialSection(lines.join("\n"));

if (!section.startsWith("Primary ")) return [];

const headingPattern = section.includes("company")
? /\b(?:company|parent company)\s+(?:statement of financial position|balance sheet)(?:\s+continued)?\b/i
: /\b(?:consolidated|group)\s+(?:statement of financial position|balance sheet)(?:\s+continued)?\b/i;

const context = periodHeader(lines, headingPattern);
const rows = [];

for (const line of lines) {
const lineText = normalized(line);

const label = FINANCIAL_LABELS.find(candidate =>
  lineText === candidate || lineText.startsWith(`${candidate} `)
);

if (!label) continue;

const remainder = lineText.slice(label.length);

// Require a numeric or dash-like cell after the label.
if (!/[\d—–-]/.test(remainder)) continue;

const index = indexOffset + rows.length;

rows.push({
  id: `pdf-${page}-${index}`,
  index,
  label,
  text: line,
  page,
  section,
  periodContext: context
});

}

return rows;
}

function requestedFinancialLabel(question) {
const q = normalized(question);

if (
/\b(?:why|explain|definition|define|meaning|reconciliation|reconcile|movement|change|changed|caused|how did|what drove)\b/.test(q)
) {
return null;
}

return FINANCIAL_LABELS.find(label => q.includes(label)) || null;
}

export function isCashPositionLookup(question) {
return requestedFinancialLabel(question) === "cash and cash equivalents";
}

function requestedYear(question) {
return String(question || "").match(
/\b(?:FY|financial year|fiscal year|year ended|year ending|as at|for|in)?\s*(20\d{2})\b/i
)?.[1] || null;
}

function valuesFromRow(row) {
const start = normalized(row.text).indexOf(row.label) + row.label.length;
const tail = row.text.slice(start).replace(/(\d)\s*\.\s*(\d)/g, "$1.$2");

// Capture whole numeric cells, including thousands separators and decimals.
return [
...tail.matchAll(
/(?:\(\s*\d[\d,]*(?:\.\d+)?\s*\)|-?\s*\d[\d,]*(?:\.\d+)?|[—–-])/g
)
].map(match => match[0].replace(/\s+/g, "").trim());
}

function formatAnswer(value, header) {
if (!value) return null;
if (/^[—–-]$/.test(value)) return value;

const number = value.replace(/^\(/, "-").replace(/\)$/, "");

if (/£m\b/i.test(header)) return `£${number}m`;
if (/€m\b/i.test(header)) return `€${number}m`;
if (/\$m\b/i.test(header)) return `${number}m`;

return value;
}

export function selectPrimaryFinancialEvidence(question, rows) {
const label = requestedFinancialLabel(question);
if (!label) return null;

const candidates = (Array.isArray(rows) ? rows : [])
.filter(row => row.label === label)
.filter(row => row.section?.startsWith("Primary "));

if (!candidates.length) return null;

const wantsCompany = /\b(?:company|parent company|parent entity)\b/i.test(question);

const preferredSection = wantsCompany
? "Primary company statement of financial position"
: "Primary consolidated statement of financial position";

const preferred = candidates.filter(row => row.section === preferredSection);
let ranked = preferred.length ? preferred : candidates;

const periodsForRow = row =>
  Array.isArray(row.coordinatePeriods) &&
  row.coordinatePeriods.length > 0 &&
  row.coordinatePeriods.length === row.coordinateValues?.length
    ? row.coordinatePeriods
    : periodsFromHeader(row.periodContext);

const year = requestedYear(question);

if (year) {
const matchingYear = ranked.filter(row =>
periodsForRow(row).some(period => period.includes(year))
);

if (!matchingYear.length) return null;

ranked = matchingYear;

}

ranked.sort((a, b) => a.page - b.page || a.index - b.index);

const row = ranked[0];
const coordinateAligned =
  Array.isArray(row.coordinatePeriods) &&
  row.coordinatePeriods.length > 0 &&
  row.coordinatePeriods.length === row.coordinateValues?.length;

const periods = periodsForRow(row);
const years = periods
.map(period => period.match(/\b20\d{2}\b/)?.[0])
.filter(Boolean);

const values = coordinateAligned
  ? row.coordinateValues
  : valuesFromRow(row);

// Do not guess if the extracted period columns and numeric cells cannot
// be aligned reliably. Note numbers may appear before the actual values.
if (
!periods.length ||
values.length < periods.length ||
years.length !== periods.length
) {
return null;
}

const periodValues = coordinateAligned
  ? values
  : values.length === periods.length + 1
    ? values.slice(1)
    : values.slice(-periods.length);
const selectedYear = year || years[0] || null;
const valueIndex = selectedYear ? years.indexOf(selectedYear) : 0;

if (valueIndex < 0 || valueIndex >= periodValues.length) return null;

const period = periods[valueIndex] ||
(selectedYear ? `FY${selectedYear}` : null);

const answer = formatAnswer(
periodValues[valueIndex],
row.periodContext
);

if (!answer) return null;

return {
answer,
period,
sourceQuote: row.text,
row
};
}
