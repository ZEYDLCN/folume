import { DOMParser } from '@xmldom/xmldom';

import { acmGraph, clone, ieeeMl } from '@/testing/fixtures';

import { documentTables, safeSheetName, tableToCsv, tablesToXlsx } from './table';
import { unzip } from './zip';

const NOW = new Date(Date.UTC(2026, 9, 21, 12, 0, 0));
const parse = (xml: string) => {
  const problems: string[] = [];
  const dom = new DOMParser({ errorHandler: (_l: string, m: string) => problems.push(m) }).parseFromString(xml, 'text/xml');
  if (problems.length) throw new Error(problems.join('; '));
  return dom;
};

describe('tableToCsv', () => {
  it('writes one line per row, CRLF separated, quoting what needs it', () => {
    const csv = tableToCsv([['a', 'b,c', 'say "hi"'], ['line\nbreak', '', ' padded ']]);
    expect(csv).toBe('a,"b,c","say ""hi"""\r\n"line\nbreak",, padded \r\n');
  });

  it('can start with a byte order mark so Excel reads UTF-8 (Turkish letters) correctly', () => {
    const csv = tableToCsv([['Çağrı', 'ş']], { bom: true });
    expect(csv.startsWith('﻿')).toBe(true);
  });

  it('does not let a cell run as a formula in a spreadsheet', () => {
    const csv = tableToCsv([['=1+1', '+SUM(A1)', '-2', '@cmd', 'ok']], { safe: true });
    expect(csv).toBe("'=1+1,'+SUM(A1),-2,'@cmd,ok\r\n"); // a plain negative number stays a number
  });
});

describe('documentTables', () => {
  it('lists the tables that have readable cells, with a name from their caption and label', () => {
    const tables = documentTables(ieeeMl);
    expect(tables).toHaveLength(1);
    expect(tables[0].rows[0]).toEqual(['Model', 'Top-1 Accuracy', 'Top-1 Accuracy', 'Params (M)']);
    expect(tables[0].headerRows).toBe(1);
    expect(tables[0].name).toMatch(/^Table I\b/);
    expect(documentTables(acmGraph).map((t) => t.name.split(/[:\s]/)[0] + t.name.split(' ')[1])).toEqual(['Table2', 'Table1']);
  });

  it('skips a table that is only a picture', () => {
    const doc = clone(ieeeMl);
    doc.blocks.find((b) => b.type === 'table')!.table = null;
    expect(documentTables(doc)).toEqual([]);
  });
});

describe('safeSheetName', () => {
  it('fits Excel: at most 31 characters, none of []:*?/\\, never empty, unique within a workbook', () => {
    expect(safeSheetName('Table 1: a/b*c?[d]', new Set())).toBe('Table 1 a b c d');
    expect(safeSheetName('x'.repeat(50), new Set()).length).toBe(31);
    expect(safeSheetName('', new Set())).toBe('Sheet');
    const used = new Set<string>();
    expect([safeSheetName('T', used), safeSheetName('T', used), safeSheetName('t', used)]).toEqual(['T', 'T (2)', 't (3)']);
  });
});

describe('tablesToXlsx', () => {
  const tables = documentTables(acmGraph);
  const xlsx = tablesToXlsx(tables, NOW);
  const files = unzip(xlsx);
  const text = (n: string) => new TextDecoder().decode(files.get(n));

  it('is an Office Open XML workbook with the parts Excel and LibreOffice need', () => {
    for (const n of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) {
      expect(files.has(n)).toBe(true);
      parse(text(n));
    }
    const wb = parse(text('xl/workbook.xml'));
    expect(wb.getElementsByTagName('sheet').length).toBe(2);
    expect(text('[Content_Types].xml')).toContain('spreadsheetml.sheet.main+xml');
  });

  it('holds every cell of every table exactly, numbers as numbers and everything else as text', () => {
    tables.forEach((t, i) => {
      const dom = parse(text(`xl/worksheets/sheet${i + 1}.xml`));
      const rows = dom.getElementsByTagName('row');
      expect(rows.length).toBe(t.rows.length);
      t.rows.forEach((row, r) => {
        const cells = rows[r].getElementsByTagName('c');
        row.forEach((value, c) => {
          const cell = cells[c];
          const isNumber = /^-?(0|[1-9]\d*)(\.\d+)?$/.test(value);
          expect(cell.getAttribute('t') || null).toBe(isNumber ? null : 'inlineStr');
          const got = isNumber ? cell.getElementsByTagName('v')[0].textContent : cell.getElementsByTagName('t')[0].textContent;
          expect(got).toBe(value);
        });
      });
    });
  });

  it('keeps a value like 3e-4 or 007 as written, not as a number', () => {
    const odd = [{ name: 'odd', rows: [['3e-4', '007', '1,000', '0.5', '-7']], headerRows: 0 }];
    const dom = parse(new TextDecoder().decode(unzip(tablesToXlsx(odd, NOW)).get('xl/worksheets/sheet1.xml')));
    const cells = Array.from(dom.getElementsByTagName('c'));
    expect(cells.map((c) => c.getAttribute('t') || null)).toEqual(['inlineStr', 'inlineStr', 'inlineStr', null, null]);
  });

  it('survives text that would break XML, and is reproducible', () => {
    const rows = [['<b>&"\'', 'tab\there', 'ctl\u0001x']];
    const a = tablesToXlsx([{ name: 'x', rows, headerRows: 0 }], NOW);
    const dom = parse(new TextDecoder().decode(unzip(a).get('xl/worksheets/sheet1.xml')));
    expect(dom.getElementsByTagName('t')[0].textContent).toBe('<b>&"\'');
    expect(dom.getElementsByTagName('t')[2].textContent).toBe('ctlx');
    expect(tablesToXlsx([{ name: 'x', rows, headerRows: 0 }], NOW)).toEqual(a);
  });

  it('writes a header row in bold', () => {
    expect(text('xl/styles.xml')).toContain('<b/>');
    expect(text('xl/worksheets/sheet1.xml')).toMatch(/<row r="1"[^>]*>\s*<c r="A1" s="1"/);
  });

  it('needs at least one table', () => {
    expect(() => tablesToXlsx([], NOW)).toThrow(/no tables/i);
  });
});
