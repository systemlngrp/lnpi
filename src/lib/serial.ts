export function getFinancialYear(dateStr?: string) {
  const date = dateStr ? new Date(dateStr) : new Date();
  if (isNaN(date.getTime())) return "XX-YY";

  const year = date.getFullYear();
  const month = date.getMonth(); // 0 is Jan, 3 is Apr

  if (month >= 3) {
    return `${year.toString().slice(-2)}-${(year + 1).toString().slice(-2)}`;
  } else {
    return `${(year - 1).toString().slice(-2)}-${year.toString().slice(-2)}`;
  }
}

export function getProductionJobPrefix(source?: "FG" | "PHP" | "PLATE") {
  if (source === "PHP") return "PHP";
  if (source === "PLATE") return "PLATE";
  return "PR";
}

export function generateTransactionNo(prefix: string, existingRecords: any[], dateStr: string = new Date().toISOString()) {
  const currentFy = getFinancialYear(dateStr);
  let maxNum = 0;

  for (const record of existingRecords) {
    const recDate = record.date || record.timestamp || new Date().toISOString();
    const recFy = getFinancialYear(recDate);
    if (recFy === currentFy && record.transactionNo) {
      // Handle prefix if exists (e.g., "MI/25-26/00001" or "25-26/00001")
      const parts = record.transactionNo.split('/');
      
      // Case 1: Prefix/FY/Num (length 3)
      if (parts.length === 3 && parts[1] === currentFy && parts[0] === prefix) {
        const num = parseInt(parts[2], 10);
        if (!isNaN(num) && num > maxNum) maxNum = num;
      }
      // Case 2: FY/Num (length 2) - original logic
      else if (parts.length === 2 && parts[0] === currentFy && !prefix) {
        const num = parseInt(parts[1], 10);
        if (!isNaN(num) && num > maxNum) maxNum = num;
      }
    }
  }

  const nextNumber = maxNum + 1;
  const paddedNumber = String(nextNumber).padStart(5, '0');
  
  return prefix ? `${prefix}/${currentFy}/${paddedNumber}` : `${currentFy}/${paddedNumber}`;
}

export function formatDate(dateStr: string) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}
