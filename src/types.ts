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
  erp?: number;
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

export interface Company {
  id: string;
  name: string;
  contactPerson?: string;
  contactNumber?: string;
  email?: string;
  address?: string;
  district?: string;
  state?: string;
  gstNo?: string;
  updatedBy?: string;
  updateTimestamp?: string;
}

export type POType = "Verbal" | "Ref No.";

export interface Order {
  id: string;
  orderNo?: string;
  orderDate: string;
  companyId: string;
  poNumber?: string;
  erpCode?: string | number;
  itemId: string;
  qty: number;
  rate?: number;
  orderBy?: string;
  poType?: POType;
  remarks?: string;
  status?: "Pending PH" | "Approved" | "Pending Scheduling" | "Scheduled" | "Cancelled";
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface OrderSchedule {
  id: string;
  orderId: string;
  scheduledDate: string;
  qty?: number;
  producedQty?: number;
  canceledQty?: number;
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
  scheduleId?: string;
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

export interface Truck {
  id: string;
  truckNo: string;
  driverName: string;
  mobileNo: string;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface DispatchPlan {
  id: string;
  scheduleId: string;
  orderId: string;
  truckId: string;
  plannedQty: number;
  loadedQty?: number;
  canceledQty?: number;
  status: "Planned" | "Dispatched";
  date: string;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface LoadingSlipLine {
  dispatchPlanId: string;
  loadedQty: number;
}

export interface LoadingSlip {
  id: string;
  slipNo: string;
  date: string;
  truckId: string;
  lines: LoadingSlipLine[];
  updatedBy?: string;
  updateTimestamp?: string;
}
