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
  itemType?: "FG" | "Reel" | "Others";
  typeName?: string;
  customer?: string;
  openLength?: number;
  openWidth?: number;
  opening?: number;
  receipt?: number;
  production?: number;
  invoiced?: number;
  balance?: number;
  gstRate?: number;
  
  // Technical Specifications
  noOfParts?: number;
  ups?: number;
  length?: number;
  breadth?: number;
  height?: number;
  ply?: number;
  flute?: string;
  part?: string;
  dieCutUps?: number;
  topPaperShade?: string;
  plateWeight?: number;
  gsmLeastCost?: number;
  l1?: number;
  f1?: number;
  l2?: number;
  f2?: number;
  l3?: number;
  f3?: number;
  b3?: number;
  backingPaperShade?: string;
  printingColour1?: string;
  printingColour2?: string;
  lOd?: number;
  wOd?: number;
  hOd?: number;
  flap?: number;
  deckleSize?: number;
  cuttingSize?: number;
  rate?: number;
  artwork?: string;
  spec?: string;

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

export interface ColorMaster {
  id: string;
  name: string;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface Machine {
  id: string;
  name: string;
  maxOutputPerHour?: number;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface ProductionProcessing {
  id: string;
  productionId: string;
  jobNo: string | number;
  machineId: string;
  machineName: string;
  qty: number;
  operatorId: string;
  operatorName: string;
  date: string;
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
  deviationAllowed?: number;
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
  status: "Pending PH" | "Pending Tally" | "Completed" | "Cancelled";
  
  // New production fields
  jobCardNo?: string | number;
  erpCode?: string | number;
  noOfParts?: number;
  ups?: number;
  length?: number;
  breadth?: number;
  height?: number;
  reelAsPerCalc?: number;
  reelActualWithTrimming?: number;
  cuttingWithTrimming?: number;
  ply?: number;
  idToOd?: string;
  flute?: string;
  takeUpFactor?: number;
  l1?: number;
  f1?: number;
  l2?: number;
  f2?: number;
  l3?: number;
  gsm?: number;
  sheetWeight?: number;
  plateWeight?: number;
  totalPaperWeight?: number;
  rate?: number;
  totalWeightOfSet?: number;
  realizationPerKg?: number;
  companyName?: string;
  actualPaperUsed?: number;
  avgWeight?: number;
  prodFromSheetPlant?: number;
  prodFromFFG?: number;
  wastage?: number;
  productionInMeter?: number;
  plannedProductionInMeter?: number;
  leastGsm?: number;
  fluteBatches?: string;
  erpCodeReel?: string;
  year?: number;
  month?: string;
  idToOd17?: number;

  phTimestamp?: string;
  phEmailId?: string;
  tallyTimestamp?: string;
  cancelTimestamp?: string;
  cancelEmailId?: string;
  cancelRemarks?: string;
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
  status: "Pending PH" | "Pending Tally" | "Completed" | "Cancelled";
  phTimestamp?: string;
  phEmailId?: string;
  tallyTimestamp?: string;
  updatedBy?: string;
  updateTimestamp?: string;
  productionId?: string;
  jobCardNo?: string | number;
}

export interface SampleRequest {
  id: string;
  timestamp: string;
  date: string;
  itemId: string;
  itemName: string;
  erp?: string | number;
  plannedQuantity: number;
  jobCardNo?: string | number;
  cancelTimestamp?: string;
  cancelBy?: string;
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
  invoiceId?: string;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface Invoice {
  id: string;
  invoiceNo: string;
  date: string;
  companyId: string;
  gstRate: number;
  totalBeforeGst: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalAfterGst: number;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface InvoiceLineItem {
  id: string;
  invoiceId: string;
  loadingSlipId: string;
  itemId: string;
  qty: number;
  rate: number;
  amount: number;
  gstRate: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface Setting {
  id: string;
  reelAsPerCalculation?: string;
  updatedBy?: string;
  updateTimestamp?: string;
}
