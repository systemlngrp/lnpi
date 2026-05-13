export interface ItemGroup {
  id: string;
  name: string;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface Item {
  id: string;
  groupId: string;
  name: string;
  uom: string;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface MaterialLine {
  id: string;
  itemId: string;
  qty: number;
  uom: string;
  rate: number;
  value: number;
}

export interface Supplier {
  id: string;
  name: string;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface MaterialIn {
  id: string;
  transactionNo: string;
  timestamp: string;
  entryEmailId: string;
  date: string;
  invoiceNo: string;
  invDate: string;
  supplierId: string;
  totalAmount: number;
  lines: MaterialLine[];
  phTimestamp?: string;
  phEmailId?: string;
  accTimestamp?: string;
  accEmailId?: string;
  mdTimestamp?: string;
  mdEmailId?: string;
  tallyTimestamp?: string;
  status: "Pending PH" | "Pending Accounts" | "Pending MD" | "Pending Tally" | "Completed";
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface User {
  id: string;
  userId: string;
  name: string;
  mobile: string;
  email: string;
  password?: string;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface Production {
  id: string;
  transactionNo: string;
  date: string;
  itemId: string;
  qty: number;
  uom: string;
  remarks: string;
  status: "Pending PH" | "Pending Tally" | "Completed";
  phTimestamp?: string;
  phEmailId?: string;
  tallyTimestamp?: string;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface Consumption {
  id: string;
  transactionNo: string;
  date: string;
  itemId: string;
  qty: number;
  uom: string;
  remarks: string;
  status: "Pending PH" | "Pending Tally" | "Completed";
  phTimestamp?: string;
  phEmailId?: string;
  tallyTimestamp?: string;
  updatedBy?: string;
  updateTimestamp?: string;
}

