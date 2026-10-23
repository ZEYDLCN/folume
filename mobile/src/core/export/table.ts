/** Tables as CSV and as an Excel workbook (.xlsx): the cells exactly as the converter read them. */
import type { Document } from '../types';
import { esc } from './paperShared';
import { zipStore } from './zip';

export interface SheetTable {
  name: string;
  rows: string[][];
  headerRows: number;
}

/** CSV with CRLF line ends. `bom` helps Excel read UTF-8; `safe` stops a cell from being run as a formula. */
export function tableToCsv(rows: string[][], opts: { bom?: boolean; safe?: boolean } = {}): string {
  const cell = (raw: string) => {
    let v = raw;
    if (opts.safe && /^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v)) v = `'${v}`;
    return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const body = rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
  return (opts.bom ? '﻿' : '') + body;
}

/** Tables of a paper that have readable cells; the name comes from the caption ("Table 2"). */
export function documentTables(doc: Document): SheetTable[] {
  const byId = new Map(doc.blocks.map((b) => [b.id, b]));
  const out: SheetTable[] = [];
  for (const b of doc.blocks) {
    if (b.type !== 'table' || !b.table || !b.table.rows.length) continue;
    const cap = b.caption_id ? byId.get(b.caption_id)?.text.replace(/\s+/g, ' ').trim() : '';
    const label = b.number ? `Table ${b.number}` : `Table ${out.length + 1}`;
    const short = cap ? cap.replace(/^(?:table|tab\.)\s*[IVXLC\d]+[.:]?\s*/i, '') : '';
    out.push({ name: short ? `${label} ${short}` : label, rows: b.table.rows, headerRows: b.table.header_rows });
  }
  return out;
}

/** An Excel sheet name: at most 31 characters, none of `[]:*?/\`, never empty, unique (case-insensitively). */
export function safeSheetName(raw: string, used: Set<string>): string {
  let name = raw.replace(/[[\]:*?/\\]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31).trim() || 'Sheet';
  let n = 1;
  let candidate = name;
  while (used.has(candidate.toLowerCase())) {
    n += 1;
    const suffix = ` (${n})`;
    candidate = `${name.slice(0, 31 - suffix.length)}${suffix}`;
  }
  name = candidate;
  used.add(name.toLowerCase());
  return name;
}

const colName = (i: number) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const isNumber = (v: string) => /^-?(0|[1-9]\d*)(\.\d+)?$/.test(v);

function sheetXml(t: SheetTable): string {
  const rows = t.rows
    .map((row, r) => {
      const style = r < t.headerRows ? ' s="1"' : '';
      const cells = row
        .map((v, c) => {
          const ref = `${colName(c)}${r + 1}`;
          if (isNumber(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
          return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  const frozen = t.headerRows > 0 ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${t.headerRows}" topLeftCell="A${t.headerRows + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${frozen}<sheetData>${rows}</sheetData></worksheet>`;
}

/** One sheet per table. Plain numbers are numbers; anything else (3e-4, 007, 1,000) stays text exactly as written. */
export function tablesToXlsx(tables: SheetTable[], when: Date = new Date()): Uint8Array {
  if (!tables.length) throw new Error('no tables to write');
  const used = new Set<string>();
  const names = tables.map((t) => safeSheetName(t.name, used));
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  return zipStore(
    [
      {
        name: '[Content_Types].xml',
        data: `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${tables.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
      },
      {
        name: '_rels/.rels',
        data: `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      },
      {
        name: 'xl/workbook.xml',
        data: `${head}<workbook xmlns="${NS}" xmlns:r="${R}"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
      },
      {
        name: 'xl/_rels/workbook.xml.rels',
        data: `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${tables.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${tables.length + 1}" Type="${R}/styles" Target="styles.xml"/></Relationships>`,
      },
      {
        name: 'xl/styles.xml',
        data: `${head}<styleSheet xmlns="${NS}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`,
      },
      ...tables.map((t, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(t) })),
    ],
    when,
  );
}
