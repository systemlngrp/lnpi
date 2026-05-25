import { Indent, IndentLine } from "../types";

export function getIndentLineOrderedQty(line: IndentLine) {
  return Number(line.orderedQty || 0);
}

export function getIndentLineCancelledQty(line: IndentLine) {
  return Number(line.cancelledQty || 0);
}

export function getIndentLineBalanceQty(line: IndentLine) {
  return Math.max(0, Number(line.qty || 0) - getIndentLineOrderedQty(line) - getIndentLineCancelledQty(line));
}

export function normalizeIndentLine(line: IndentLine): IndentLine {
  const orderedQty = getIndentLineOrderedQty(line);
  const cancelledQty = getIndentLineCancelledQty(line);
  return {
    ...line,
    orderedQty,
    cancelledQty,
    balanceQty: getIndentLineBalanceQty(line),
  };
}

export function summarizeIndentLines(lines: IndentLine[]) {
  const normalizedLines = lines.map(normalizeIndentLine);
  const totalIndentQty = normalizedLines.reduce((sum, line) => sum + Number(line.qty || 0), 0);
  const totalOrderedQty = normalizedLines.reduce((sum, line) => sum + Number(line.orderedQty || 0), 0);
  const totalCancelledQty = normalizedLines.reduce((sum, line) => sum + Number(line.cancelledQty || 0), 0);
  const totalBalanceQty = normalizedLines.reduce((sum, line) => sum + Number(line.balanceQty || 0), 0);

  return {
    normalizedLines,
    totalIndentQty,
    totalOrderedQty,
    totalCancelledQty,
    totalBalanceQty,
  };
}

export function withIndentTotals(indent: Indent, lines: IndentLine[]): Indent {
  const totals = summarizeIndentLines(lines);
  return {
    ...indent,
    totalIndentQty: totals.totalIndentQty,
    totalOrderedQty: totals.totalOrderedQty,
    totalCancelledQty: totals.totalCancelledQty,
    totalBalanceQty: totals.totalBalanceQty,
  };
}
