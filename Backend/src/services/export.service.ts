/* ===========================================================================
 * Export service — one reusable exporter for every report.
 * Takes report metadata (title, company header, filters, columns, rows,
 * totals) and produces PDF, Excel (.xlsx), CSV, Word (.docx) or a JSON
 * document the print view renders.
 * ==========================================================================*/
import ExcelJS from 'exceljs';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle } from 'docx';
import PDFDocument from 'pdfkit';
import { getPool } from '../db/pool';

export type ExportFormat = 'pdf' | 'xlsx' | 'csv' | 'docx' | 'print';

export interface ExportColumn {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date';
  width?: number;          // character width hint
}

export interface ExportReport {
  title: string;
  companyHeader?: string;   // defaults to settings.company_name + address
  filters?: Array<{ label: string; value: string }>;
  columns: ExportColumn[];
  rows: Array<Record<string, any>>;
  totals?: Record<string, any>;   // keyed by column key
  generatedBy?: string;
}

function fmt(value: any, type?: 'text' | 'number' | 'date'): string {
  if (value === null || value === undefined) return '';
  if (type === 'number') {
    const n = Number(value);
    return Number.isNaN(n) ? String(value) : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (type === 'date') {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
  }
  return String(value);
}

async function companyLines(): Promise<string[]> {
  const pool = await getPool();
  const r = await pool.request().query(`SELECT company_name, address, phone FROM dbo.settings WHERE id = 1`);
  if (r.recordset.length === 0) return [];
  const s = r.recordset[0];
  const lines = [s.company_name];
  if (s.address) lines.push(String(s.address));
  if (s.phone) lines.push(`Phone: ${s.phone}`);
  return lines;
}

export async function exportReport(report: ExportReport, format: ExportFormat): Promise<{ body: Buffer; contentType: string; filename: string }> {
  const safe = report.title.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').toLowerCase();
  const company = report.companyHeader ? [report.companyHeader] : await companyLines();

  if (format === 'csv') {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines: string[] = [];
    for (const c of company) lines.push(esc(c));
    lines.push(esc(report.title));
    if (report.filters?.length) lines.push(esc(report.filters.map((f) => `${f.label}: ${f.value}`).join(' | ')));
    lines.push('');
    lines.push(report.columns.map((c) => esc(c.label)).join(','));
    for (const row of report.rows) lines.push(report.columns.map((c) => esc(fmt(row[c.key], c.type))).join(','));
    if (report.totals) lines.push(report.columns.map((c) => esc(c.key in report.totals! ? fmt(report.totals![c.key], c.type) : '')).join(','));
    return { body: Buffer.from('﻿' + lines.join('\r\n'), 'utf8'), contentType: 'text/csv; charset=utf-8', filename: `${safe}.csv` };
  }

  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(report.title.slice(0, 31));
    let rowIdx = 1;
    for (const c of company) {
      ws.getCell(rowIdx, 1).value = c;
      ws.getCell(rowIdx, 1).font = { bold: true };
      rowIdx++;
    }
    ws.getCell(rowIdx, 1).value = report.title;
    ws.getCell(rowIdx, 1).font = { bold: true, size: 13 };
    rowIdx++;
    if (report.filters?.length) {
      ws.getCell(rowIdx, 1).value = report.filters.map((f) => `${f.label}: ${f.value}`).join('  |  ');
      rowIdx++;
    }
    rowIdx++;
    const headerRow = ws.getRow(rowIdx);
    report.columns.forEach((c, i) => {
      headerRow.getCell(i + 1).value = c.label;
      headerRow.getCell(i + 1).font = { bold: true };
      headerRow.getCell(i + 1).border = { bottom: { style: 'thin' } };
      ws.getColumn(i + 1).width = c.width ?? (c.type === 'number' ? 14 : Math.max(12, c.label.length + 4));
    });
    rowIdx++;
    for (const row of report.rows) {
      const r = ws.getRow(rowIdx);
      report.columns.forEach((c, i) => {
        const v = row[c.key];
        r.getCell(i + 1).value = c.type === 'number' ? Number(v) ?? 0 : fmt(v, c.type === 'date' ? 'date' : undefined);
        if (c.type === 'number') r.getCell(i + 1).numFmt = '#,##0.00';
      });
      rowIdx++;
    }
    if (report.totals) {
      const tr = ws.getRow(rowIdx);
      report.columns.forEach((c, i) => {
        if (c.key in report.totals!) {
          tr.getCell(i + 1).value = Number(report.totals![c.key]);
          tr.getCell(i + 1).numFmt = '#,##0.00';
          tr.getCell(i + 1).font = { bold: true };
        }
        if (i === 0) tr.getCell(i + 1).value = 'Total';
      });
      tr.getCell(1).font = { bold: true };
    }
    const buf = await wb.xlsx.writeBuffer();
    return { body: Buffer.from(buf), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: `${safe}.xlsx` };
  }

  if (format === 'docx') {
    const border = { style: BorderStyle.SINGLE, size: 2, color: '999999' };
    const mkCell = (text: string, bold = false) => new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text, bold, size: 18 })] })],
      borders: { top: border, bottom: border, left: border, right: border },
    });
    const header = new TableRow({ children: report.columns.map((c) => mkCell(c.label, true)) });
    const bodyRows = report.rows.map((row) => new TableRow({
      children: report.columns.map((c) => mkCell(fmt(row[c.key], c.type))),
    }));
    if (report.totals) {
      bodyRows.push(new TableRow({
        children: report.columns.map((c, i) => mkCell(i === 0 ? 'Total' : (c.key in report.totals! ? fmt(report.totals![c.key], c.type) : ''), true)),
      }));
    }
    const doc = new Document({
      sections: [{
        children: [
          ...company.map((c) => new Paragraph({ children: [new TextRun({ text: c, bold: c === company[0], size: c === company[0] ? 28 : 20 })] })),
          new Paragraph({ children: [new TextRun({ text: report.title, bold: true, size: 26 })], spacing: { before: 200, after: 100 } }),
          ...(report.filters?.length ? [new Paragraph({ children: [new TextRun({ text: report.filters.map((f) => `${f.label}: ${f.value}`).join('   '), italics: true, size: 18 })] })] : []),
          new Paragraph({ text: '', spacing: { after: 100 } }),
          new Table({ rows: [header, ...bodyRows], width: { size: 100, type: WidthType.PERCENTAGE } }),
        ],
      }],
    });
    const buf = await Packer.toBuffer(doc);
    return { body: Buffer.from(buf), contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', filename: `${safe}.docx` };
  }

  if (format === 'pdf') {
    const doc = new PDFDocument({ margin: 36, size: 'A4', layout: report.columns.length > 7 ? 'landscape' : 'portrait' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    const pageWidth = doc.page.width - 72;
    doc.font('Helvetica-Bold').fontSize(14).text(company[0] ?? '', { align: 'center' });
    doc.font('Helvetica').fontSize(9);
    for (const c of company.slice(1)) doc.text(c, { align: 'center' });
    doc.moveDown(0.3).font('Helvetica-Bold').fontSize(12).text(report.title, { align: 'center' });
    if (report.filters?.length) {
      doc.font('Helvetica').fontSize(8).text(report.filters.map((f) => `${f.label}: ${f.value}`).join('   '), { align: 'center' });
    }
    doc.moveDown(0.5);

    const totalW = pageWidth;
    const weights = report.columns.map((c) => c.width ?? (c.type === 'number' ? 12 : Math.max(10, c.label.length + 2)));
    const weightSum = weights.reduce((s, w) => s + w, 0);
    const colW = weights.map((w) => (w / weightSum) * totalW);
    const rowH = 14;

    const drawHeader = () => {
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(8);
      let x = 36;
      report.columns.forEach((c, i) => {
        doc.text(c.label, x + 2, y, { width: colW[i] - 4, align: c.type === 'number' ? 'right' : 'left', lineBreak: false });
        x += colW[i];
      });
      doc.moveTo(36, y + rowH - 3).lineTo(36 + totalW, y + rowH - 3).strokeColor('#444444').stroke();
      doc.y = y + rowH;
    };
    drawHeader();
    doc.font('Helvetica').fontSize(8);
    for (const row of report.rows) {
      if (doc.y > doc.page.height - 60) { doc.addPage(); drawHeader(); doc.font('Helvetica').fontSize(8); }
      const y = doc.y;
      let x = 36;
      report.columns.forEach((c, i) => {
        doc.text(fmt(row[c.key], c.type), x + 2, y, { width: colW[i] - 4, align: c.type === 'number' ? 'right' : 'left', lineBreak: false, ellipsis: true });
        x += colW[i];
      });
      doc.y = y + rowH;
    }
    if (report.totals) {
      const y = doc.y + 2;
      doc.moveTo(36, y).lineTo(36 + totalW, y).strokeColor('#444444').stroke();
      doc.font('Helvetica-Bold');
      let x = 36;
      report.columns.forEach((c, i) => {
        const v = i === 0 ? 'Total' : (c.key in report.totals! ? fmt(report.totals![c.key], c.type) : '');
        doc.text(v, x + 2, y + 3, { width: colW[i] - 4, align: c.type === 'number' ? 'right' : 'left', lineBreak: false });
        x += colW[i];
      });
      doc.y = y + rowH + 6;
    }
    doc.end();
    const buf = await done;
    return { body: buf, contentType: 'application/pdf', filename: `${safe}.pdf` };
  }

  // print — JSON for the client print view
  return {
    body: Buffer.from(JSON.stringify({ ...report, company, generatedAt: new Date().toISOString() }), 'utf8'),
    contentType: 'application/json',
    filename: `${safe}.json`,
  };
}
