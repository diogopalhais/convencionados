import type { McdtCode, McdtTable } from "@sns-conv/schema";
import ExcelJS from "exceljs";

const SHEET_AREA = /^([A-Z])-/;
const CONV_CODE = /^\d{3,4}\.\d$/;
const SNS_CODE = /^\d{4,6}$/;

function cellText(v: ExcelJS.CellValue): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") {
    if ("richText" in v)
      return (
        v.richText
          .map((r) => r.text)
          .join("")
          .trim() || null
      );
    if ("result" in v)
      return v.result === undefined || v.result === null ? null : String(v.result).trim();
    if ("text" in v) return String(v.text).trim() || null;
    if (v instanceof Date) return null;
    return null;
  }
  const s = String(v).trim();
  return s === "" ? null : s;
}

function cellNumber(v: ExcelJS.CellValue): number | null {
  if (typeof v === "number") return v;
  const s = cellText(v);
  if (!s) return null;
  const n = Number(s.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Lê a "Tabela MCDT do Setor Convencionado" (xlsx da ACSS). Cada folha `X-Nome` é uma área.
 * Linhas de código: [SNS] [Conv.] [nota?] Descrição Preço. Linhas só com descrição são grupos.
 */
export async function parseMcdtTable(path: string, version: string): Promise<McdtTable> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const codes: McdtCode[] = [];
  const seen = new Set<string>();

  for (const ws of wb.worksheets) {
    const areaMatch = SHEET_AREA.exec(ws.name);
    if (!areaMatch?.[1] || ws.name.startsWith("Z-")) continue;
    // folhas antigas/duplicadas: "A-Análises prop09" coexiste com "A-Análises Clínicas (Nova)"
    if (/prop09/i.test(ws.name)) continue;
    const areaCode = areaMatch[1];
    let group: string | null = null;

    ws.eachRow((row) => {
      const cells: ExcelJS.CellValue[] = [];
      for (let c = 1; c <= Math.min(row.cellCount, 8); c++) cells.push(row.getCell(c).value);
      const texts = cells.map(cellText);
      const convIdx = texts.findIndex((t) => t !== null && CONV_CODE.test(t));
      if (convIdx === -1) {
        // linha de grupo: exatamente um texto não numérico, sem preço
        const nonEmpty = texts.filter((t): t is string => t !== null);
        if (nonEmpty.length === 1 && nonEmpty[0] && !/^Códigos|^SNS$|^TABELA/i.test(nonEmpty[0])) {
          group = nonEmpty[0];
        }
        return;
      }
      const convCode = texts[convIdx] as string;
      const snsCandidate =
        texts.slice(0, convIdx).find((t) => t !== null && SNS_CODE.test(t)) ?? null;
      let description: string | null = null;
      let price: number | null = null;
      for (let i = convIdx + 1; i < cells.length; i++) {
        const t = texts[i];
        if (t == null) continue;
        if (description === null) {
          if (/^[a-z]\)$/.test(t) || t.length < 3) continue; // notas tipo "c)"
          description = t;
          continue;
        }
        price = cellNumber(cells[i]);
        if (price !== null) break;
      }
      if (!description) return;
      const key = `${areaCode}:${convCode}`;
      if (seen.has(key)) return;
      seen.add(key);
      codes.push({
        convCode,
        snsCode: snsCandidate,
        areaCode,
        description,
        group,
        price,
        copay: null,
      });
    });
  }
  if (codes.length < 100)
    throw new Error(`Tabela MCDT com poucos códigos (${codes.length}); formato mudou?`);
  return { version, codes };
}
