export interface ItemGroup {
  id: string;
  name: string;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface MaterialGroup {
  id: string;
  name: string;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface Material {
  id: string;
  type: "Reel" | "Other";
  erpCode?: string | number;
  name: string;
  uom?: string;
  materialGroupId?: string;
  color?: string | null;
  size?: number;
  gsm?: number;
  bf?: number;
  openingQty?: number;
  openingRate?: number;
  openingValue?: number;
  remarks?: string;
  active?: "Yes" | "No";
  tallyStock?: number | null;
  tallyTimestamp?: string;
  tallyMaterialId?: string;
  tallySyncRemark?: string;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface RapcRange {
  id: string;
  from: number;
  to: number;
  rapcRange: number;
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
  consumable?: boolean | string | number | null;
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
  rapc?: number;
  internalUps?: number;
  internalRapc?: number;
  
  // Technical Specifications
  noOfParts?: number;
  ups?: number;
  length?: number;
  breadth?: number;
  height?: number;
  ply?: number;
  flute?: string;
  takeUpFactor?: number;
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

  // Tally sync fields (populated by tally_npd_stock_sync.py)
  tallyStock?: number | null;
  TallySalesQty?: number | null;
  TallyMFJQty?: number | null;
  tallySalesQty?: number | null;
  tallyMFJQty?: number | null;
  tallyTimestamp?: string | null;

  updatedBy?: string;
  updateTimestamp?: string;
}

export interface MaterialLine {
  id: string;
  itemId: string;
  itemName?: string;
  npdId?: string;
  lineType?: "Material" | "Service";
  serviceId?: string;
  serviceName?: string;
  sourceGatePassId?: string;
  sourceGatePassNo?: string;
  sourceGatePassLineId?: string;
  sourceGatePassItemDescription?: string;
  qty: number;
  uom: string;
  poId?: string;
  poNo?: string;
  poLineId?: string;
  poRate?: number;
  invoiceCurrency?: InvoiceCurrency;
  exchangeRate?: number;
  invoiceQty?: number;
  invoiceRate?: number;
  invoiceRateUsd?: number;
  invoiceValue?: number;
  invoiceValueUsd?: number;
  actualQty?: number;
  actualValue?: number;
  actualValueUsd?: number;
  rate: number;
  value: number;
  gstRate?: number;
  cgstRate?: number;
  sgstRate?: number;
  igstRate?: number;
  taxableAmount?: number;
  gstAmount?: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  totalAmount?: number;
}

export interface MaterialInPackingSlip {
  id: string;
  materialInId: string;
  materialLineId: string;
  materialId: string;
  supplierReelNo?: string;
  ourReelNo: string;
  weightKg: number;
  supplierPoNo?: string;
  ourPoId?: string;
  ourPoNo?: string;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface MaterialIssue {
  id: string;
  issueNo: string;
  consumptionTransactionNo?: string;
  date: string;
  issueType: "Job" | "Without Job" | "General";
  productionId?: string;
  jobNo?: string;
  remarks?: string;
  notApplicable?: "Yes" | "No" | string;
  tallyTimestamp?: string;
  tallyPostingStatus?: string;
  tallyVoucherNo?: string;
  tallyVoucherDate?: string;
  tallyVoucherType?: string;
  tallyVoucherId?: string;
  tallyPostedBy?: string;
  tallyPostingRemark?: string;
  tallyPostingError?: string;
  tallyLastAttemptAt?: string;
  tallyPostingAttemptCount?: number;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface MaterialIssueLine {
  id: string;
  materialIssueId: string;
  materialId: string;
  qty: number;
  uom: string;
  lastPurchaseRate?: number;
  openingRate?: number;
  rate?: number;
  amount?: number;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface MaterialIssueReelLine {
  id: string;
  materialIssueId: string;
  materialIssueLineId: string;
  materialId: string;
  packingSlipId: string;
  ourReelNo: string;
  weightKg: number;
  productionId: string;
  jobNo: string;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface MaterialReturn {
  id: string;
  returnNo: string;
  date: string;
  returnType: "Job" | "General";
  productionId?: string;
  jobNo?: string;
  remarks?: string;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface MaterialReturnLine {
  id: string;
  materialReturnId: string;
  materialId: string;
  qty: number;
  uom: string;
  lastPurchaseRate?: number;
  openingRate?: number;
  rate?: number;
  amount?: number;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface MaterialReturnReelLine {
  id: string;
  materialReturnId: string;
  materialReturnLineId: string;
  materialId: string;
  packingSlipId: string;
  ourReelNo: string;
  weightKg: number;
  productionId: string;
  jobNo: string;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface PhysicalStockSession {
  id: string;
  sessionNo: string;
  sessionName: string;
  fy: string;
  status: "Open" | "Closed" | string;
  startedAt: string;
  startedBy?: string;
  closedAt?: string;
  closedBy?: string;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface StockTakerLog {
  id: string;
  sessionId?: string;
  sessionNo?: string;
  sessionName?: string;
  timestamp: string;
  reelNo: string;
  mrrNo: string;
  erp: string;
  supplierName: string;
  systemAvailableWeight: number;
  physicalWeight: number;
  variance: number;
  updatedBy?: string;
  updateTimestamp?: string;
}
export interface Indent {
  id: string;
  indentNo?: string;
  requestedBy: string;
  requisitionDate: string;
  requiredDate: string;
  indentType: "Reel" | "Other";
  status: "Pending" | "Approved" | "Completed" | "Rejected";
  totalIndentQty?: number;
  totalOrderedQty?: number;
  totalCancelledQty?: number;
  totalBalanceQty?: number;
  approvedTimestamp?: string;
  approvedBy?: string;
  completedTimestamp?: string;
  completedBy?: string;
  rejectedTimestamp?: string;
  rejectedBy?: string;
  rejectedRemarks?: string;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface IndentLine {
  id: string;
  indentId: string;
  erpCode?: string | number;
  materialId: string;
  uom?: string;
  qty: number;
  targetDeliveryDate?: string;
  orderedQty?: number;
  cancelledQty?: number;
  balanceQty?: number;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface PurchaseOrder {
  id: string;
  poNo: string;
  indentId: string;
  supplierId: string;
  poDate: string;
  requiredDate: string;
  totalQty: number;
  totalAmount: number;
  taxableAmount?: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  roundOff?: number;
  grandTotal?: number;
  remarks?: string;
  status: "Pending Approval" | "Approved" | "Rejected";
  approvedBy?: string;
  approvedTimestamp?: string;
  rejectedBy?: string;
  rejectedTimestamp?: string;
  rejectedRemarks?: string;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface PurchaseOrderLine {
  id: string;
  purchaseOrderId: string;
  indentLineId: string;
  materialId: string;
  erpCode?: string | number;
  uom?: string;
  qty: number;
  rate: number;
  amount: number;
  gstRate?: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  lineTotal?: number;
  targetDeliveryDate?: string;
  cancelledQty?: number;
  cancelReason?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface GateEntry {
  id: string;
  gateEntryNo?: string;
  date: string;
  supplierId: string;
  purpose?: "Material Receipt" | "Returnable Receipt";
  invoiceNo: string;
  invoiceValue: number;
  truckNo: string;
  sourceGatePassId?: string;
  sourceGatePassNo?: string;
  mrrId?: string;
  mrrDate?: string;
  mrrNo?: string;
  status?: "Active" | "Cancelled";
  cancelReason?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface GateEntryPhoto {
  id: string;
  gateEntryId: string;
  photo: string;
  slotNo: number;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface Supplier {
  id: string;
  name: string;
  contactPerson?: string;
  contactNumber?: string;
  email?: string;
  gstNo?: string;
  gstSupplyType?: "INTRA_STATE" | "INTER_STATE";
  stateId?: string;
  district?: string;
  pinCode?: string;
  address?: string;
  active?: "Yes" | "No";
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface StateMaster {
  id: string;
  name: string;
  active?: "Yes" | "No";
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface UnitMaster {
  id: string;
  name: string;
  active?: "Yes" | "No";
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface ColorMaster {
  id: string;
  name: string;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface GstRateMaster {
  id: string;
  name: string;
  rate: number;
  active?: "Yes" | "No";
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface ExpenseMaster {
  id: string;
  name: string;
  type?: "Monthly" | "Daily";
  updatedBy?: string;
  updateTimestamp?: string;
}
export interface Machine {
  id: string;
  name: string;
  maxOutputPerHour?: number;
  uom?: string;
  assignedOperatorIds?: string[];
  assignedOperatorNames?: string[];
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface ProductionProcessing {
  id: string;
  productionId: string;
  jobNo: string | number;
  machineId: string;
  machineName: string;
  shift?: "Day" | "Night";
  qty: number;
  operatorId: string;
  operatorName: string;
  date: string;
  updatedBy?: string;
  updateTimestamp?: string;
  itemName?: string;
  erp?: string | number;
  boxType?: string;
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
  gstSupplyType?: "INTRA_STATE" | "INTER_STATE";
  deviationAllowed?: number;
  toleranceAllowed?: number;
  pin?: string;
  npdHostingerSync?: string;
  salesPerson?: string;
  gstType?: string;
  panNo?: string;
  paymentTerms?: string;
  openingBalance?: number;
  overdues?: number;
  target?: number;
  reffPerson?: string;
  priority?: string;
  followupFrequency?: string;
  autoEmail?: string;
  followupApproval?: string;
  active?: "Yes" | "No";
  updatedBy?: string;
  updateTimestamp?: string;
}

export type POType = "Verbal" | "Ref No.";
export type InvoiceCurrency = "INR" | "USD";
export type OrderItemSource = "FG" | "PHP" | "PLATE" | "MATERIAL";

export interface Order {
  id: string;
  orderNo?: string;
  orderDate: string;
  companyId: string;
  poNumber?: string;
  erpCode?: string | number;
  itemId: string;
  itemSource?: OrderItemSource;
  npdId?: string;
  qty: number;
  rate?: number;
  orderAmount?: number;
  orderBy?: string;
  poType?: POType;
  remarks?: string;
  status?: "Pending PH" | "Approved" | "Pending Scheduling" | "Scheduled" | "Cancelled";
  approvedTimestamp?: string;
  approvedEmail?: string;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface OrderSchedule {
  id: string;
  scheduleNo?: string;
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
  mrrType?: "Reel" | "Others" | "Rejection In" | "FG Purchase" | "Service Return";
  gateEntryId?: string;
  gateEntryNo?: string;
  sourceGatePassId?: string;
  sourceGatePassNo?: string;
  timestamp: string;
  entryEmailId: string;
  date: string;
  invoiceNo: string;
  invDate: string;
  supplierId: string;
  invoiceCurrency?: InvoiceCurrency;
  exchangeRate?: number;
  totalPoValue?: number;
  totalInvoiceValue?: number;
  totalInvoiceValueUsd?: number;
  totalActualValue?: number;
  totalActualValueUsd?: number;
  totalCgst?: number;
  totalSgst?: number;
  totalIgst?: number;
  totalInvoiceValueAfterGst?: number;
  insurance?: number;
  otherCharges?: number;
  expenseCGST?: number;
  expenseSGST?: number;
  expenseIGST?: number;
  roundOff?: number;
  totalAmount: number;
  lines: MaterialLine[];
  phTimestamp?: string;
  phEmailId?: string;
  plant_head_remark?: string;
  accTimestamp?: string;
  accEmailId?: string;
  accounts_remark?: string;
  debitNote?: string;
  debitNoteDate?: string;
  debitNoteAmount?: number;
  debitTallySync?: string;
  debitTallyTimestamp?: string;
  debitRemarkTally?: string;
  creditTallySync?: string;
  creditTallyTimestamp?: string;
  creditRemarkTally?: string;
  mdTimestamp?: string;
  mdEmailId?: string;
  md_approval_remark?: string;
  tallyTimestamp?: string;
  tallySyncRemark?: string;
  status: "Pending PH" | "Pending Accounts" | "Pending MD" | "Pending Tally" | "Completed";
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface User {
  id: string;
  userId: string;
  name: string;
  mobile: string;
  email?: string;
  password?: string;
  designation?: string;
  role?: "Admin" | "Employee" | "Operator";
  status?: "Active" | "Inactive";
  menuAccess?: string[];
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface Production {
  id: string;
  transactionNo: string;
  date: string;
  scheduleId?: string;
  itemId: string;
  itemSource?: OrderItemSource;
  parentProductionId?: string;
  npdId?: string;
  qty: number;
  uom: string;
  remarks: string;
  status: "Pending PH" | "Pending Consumption" | "Pending FFG" | "Pending Tally" | "Completed" | "Cancelled";
  
  // New production fields
  jobCardNo?: string | number;
  shift?: string;
  category?: string;
  masterErp?: string | number;
  erpCode?: string | number;
  setsPerBox?: number;
  noOfParts?: number;
  requiredQty?: number;
  planningId?: string;
  scheduledDate?: string;
  plannedQty?: number;
  methodology?: string;
  jobType?: string;
  sequence?: string | number;
  jobCompletionTimeOutput?: string | number;
  productionOutputQty?: number;
  noOfHolesInPhp?: number;
  fluteType?: string;
  ups?: number;
  length?: number;
  breadth?: number;
  height?: number;
  reelAsPerCalc?: number;
  noOfUpsInCuttingForPlates?: number;
  reelActualWithTrimming?: number;
  cuttingWithTrimming?: number;
  ply?: number;
  idToOd?: string;
  flute?: string;
  takeUpFactor?: number;
  top?: number;
  l1?: number;
  f1?: number;
  l2?: number;
  f2?: number;
  l3?: number;
  gsm?: number;
  boardGsmReq?: number;
  brustingStrengthReq?: number;
  color1?: string;
  color2?: string;
  printingColor?: string;
  weightPerPcSetReq?: number;
  paperRequiredNos?: number;
  topPaperWeightKg?: number;
  linerWeightKg?: number;
  totalJobWeight?: number;
  sheetWeight?: number;
  plateWeight?: number;
  totalPaperWeight?: number;
  rate?: number;
  totalWeightOfSet?: number;
  realizationPerKg?: number;
  companyName?: string;
  actualPaperUsed?: number;
  paperNotRequired?: boolean;
  paperNotRequiredReason?: string;
  avgWeight?: number;
  prodFromSheetPlant?: number;
  prodFromFFG?: number;
  phpScheduledJobId?: string;
  plateScheduledJobId?: string;
  wastage?: number;
  productionInMeter?: number;
  plannedProductionInMeter?: number;
  leastGsm?: number;
  fluteBatches?: string;
  erpCodeReel?: string;
  lineRequiredNos?: number;
  year?: number;
  month?: string;
  idToOd17?: number;

	  phTimestamp?: string;
	  phEmailId?: string;
  ffgTimestamp?: string;
	  tallyTimestamp?: string;
  tallyPostingStatus?: string;
  tallyVoucherNo?: string;
  tallyVoucherDate?: string;
  tallyVoucherId?: string;
  tallyPostedBy?: string;
  tallyPostingRemark?: string;
  tallyPostingError?: string;
  tallyLastAttemptAt?: string;
  tallyPostingAttemptCount?: number;
	  closeBy?: string;
	  closeDate?: string;
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
  npdId?: string;
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
  npdId?: string;
  itemName: string;
  erp?: string | number;
  plannedQuantity: number;
  jobCardNo?: string | number;
  cancelTimestamp?: string;
  cancelBy?: string;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface BoardLineQcCheck {
  id: string;
  timestamp: string;
  bqcNo?: string;
  jobNo: string | number;
  partyName: string;
  itemName: string;
  checkNo: string | number;
  standard?: string;
  flapHeightFlapOperatorSide?: string;
  flapHeightFlapDriveSide?: string;
  cuttingSizeRequired?: number | "";
  cuttingSizeMm?: number | "";
  column19?: string;
  boardGsm?: number | "";
  typeOfFlute?: string;
  boardThickness?: number | "";
  moisture?: number | "";
  sheetWeightGrams?: number | "";
  column20?: string;
  boardlineRemarks?: string;
  qcPerson: string;
  whatsapp?: string;
  erp?: string | number;
  heightOd?: number | "";
  flap?: number | "";
  ply?: number | "";
  width?: number | "";
  length?: number | "";
  part?: string;
  flapMinDs?: number | "";
  flapMaxDs?: number | "";
  systemAutoCorrection1?: string;
  systemAutoCorrection2?: string;
  systemAutoCorrection3?: string;
  systemAutoCorrection4?: string;
  systemAutoCorrection5?: string;
  flapAchievedOs?: number | "";
  heightAchievedOs?: number | "";
  flapLAchievedOs?: number | "";
  flapAchievedDs?: number | "";
  heightAchievedDs?: number | "";
  flapLAchievedDs?: number | "";
  previousCustomerComplaintWarning?: string;
  photo?: string;
  printingArtwork?: string;
  planQty?: number | "";
  samplingPlanQty?: number | "";
  samplingCheckNo?: string;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface PrintingQcCheck {
  id: string;
  timestamp: string;
  pqcNo?: string;
  jobNo: string | number;
  partyName: string;
  itemName: string;
  erp?: string | number;
  checkNo: string | number;
  standardBoxSize?: string;
  boxSizeAchieved?: string;
  lengthId?: number | "";
  widthId?: number | "";
  heightId?: number | "";
  boardThicknessBefore?: number | "";
  boardThickness?: number | "";
  csStandard?: number | "";
  csAchieved?: number | "";
  bsStandard?: number | "";
  bsAchieved?: number | "";
  boxWeightGrams?: number | "";
  operatorName?: string;
  printingColor1Standard?: string;
  colour1Actual?: string;
  printingColour2Standard?: string;
  colour2Actual?: string;
  qcPerson: string;
  whatsapp?: string;
  lengthSpec?: number | "";
  widthSpec?: number | "";
  heightSpec?: number | "";
  qcMasterCsSpec?: number | "";
  npdSheetCsSpec?: number | "";
  qcMasterBsSpec?: number | "";
  npdSheetBsSpec?: number | "";
  systemAutoCorrection1?: string;
  standardArtwork?: string;
  systemAutoCorrection2?: string;
  systemAutoCorrection3?: string;
  lotNoPrinted?: string;
  previousCustomerComplaintWarning?: string;
  photo?: string;
  column40?: string;
  column41?: string;
  column42?: string;
  column43?: string;
  planQty?: number | "";
  samplingPlanQty?: number | "";
  samplingCheckNo?: string;
  updatedBy?: string;
  updateTimestamp?: string;
}

export type TruckLiveStatus = "EMPTY" | "LOADING" | "IN-TRANSIT" | "REPORTED TO PARTY" | "UNLOADING" | "RETURNING" | "BILL PENDING" | "NOT UNLOADED" | "REJECTED";

export interface Truck {
  id: string;
  truckNo: string;
  driverName: string;
  mobileNo: string;
  truckType?: "Internal" | "External" | string;
  driverLoginId?: string;
  driverPassword?: string;
  liveStatus?: TruckLiveStatus | string;
  statusUpdatedAt?: string;
  statusUpdatedBy?: string;
  partyName?: string;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface TruckStatusLog {
  id: string;
  truckId: string;
  truckNo: string;
  liveStatus: TruckLiveStatus | string;
  statusUpdatedAt: string;
  statusUpdatedBy: string;
  updateSource: "System" | "TruckDriver" | "PublicDriver" | "AppVehicleUpdate" | string;
  sourceRefType?: string;
  sourceRefId?: string;
  invoiceNo?: string;
  partyName?: string;
  driverName?: string;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface DispatchPlan {
  id: string;
  planNo?: string;
  scheduleId: string;
  orderId: string;
  productionId?: string;
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
  jobNos?: Array<string | number>;
  allocations?: LoadingSlipAllocation[];
  companyId?: string;
  itemId?: string;
  itemName?: string;
  companyName?: string;
  erpCode?: string;
  masterErp?: string;
  itemSource?: OrderItemSource;
  rate?: number;
  gstRate?: number;
  uom?: string;
}

export type LoadingSlipAllocation =
  | {
      sourceType: "job";
      jobId: string;
      jobNo: string;
      qty: number;
    }
  | {
      sourceType: "opening_stock";
      sourceRef: "FG Stock" | "PHP Stock" | "PLATE Stock" | "MATERIAL Stock";
      qty: number;
    };

export interface PackingDetail {
  extra?: number;
  bundles: number;
  packSize: number;
  quantity: number;
}

export interface LinkedLoadingDetail {
  source: Extract<OrderItemSource, "PHP" | "PLATE">;
  itemId: string;
  itemName: string;
  companyName?: string;
  erpCode?: string;
  masterErp?: string;
  setsPerBox: number;
  requiredQty: number;
  packingDetails?: PackingDetail[];
  extraItemsQty?: number;
}

export interface LoadingSlip {
  id: string;
  slipNo: string;
  date: string;
  truckId: string;
  truckNo?: string;
  lines: LoadingSlipLine[];
  loadingSource?: "DISPATCH_PLAN" | "DIRECT";
  companyId?: string;
  companyName?: string;
  fgLoadingId?: string;
  phpConsumptionTransactionNo?: string;
  plateConsumptionTransactionNo?: string;
  phpDetails?: LinkedLoadingDetail[];
  plateDetails?: LinkedLoadingDetail[];
  status?: "Active" | "Cancelled";
  cancelReason?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  invoiceId?: string;
  invoiceNo?: string;
  packingDetails?: PackingDetail[];
  extraItemsQty?: number;
  tallyTimestamp?: string;
  tallyPostingStatus?: string;
  tallyPostingError?: string;
  tallyPostingAttemptCount?: number;
  tallyLastAttemptAt?: string;
  tallyVoucherNo?: string;
  tallyVoucherDate?: string;
  tallyVoucherType?: string;
  tallyPostedBy?: string;
  tallyPostingRemark?: string;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface MaterialVisit {
  id: string;
  visitNo: string;
  date: string;
  supplierId: string;
  visitorName: string;
  purpose: string;
  status: "Pending" | "In-Progress" | "Completed" | "Cancelled";
  remarks?: string;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface Invoice {
  id: string;
  invoiceNo: string;
  date: string;
  companyId: string;
  destination?: string;
  transporter?: string;
  gstRate: number;
  totalBeforeGst: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalAfterGst: number;
  otherCharges?: number;
  otherChargesGstRate?: number | null;
  otherChargesCgst?: number;
  otherChargesSgst?: number;
  otherChargesIgst?: number;
  roundOff: number;
  tallyTimestamp?: string;
  tallyBy?: string;
  tallySyncRemark?: string;
  tallyInvNo?: string;
  tallyInvDate?: string;
  tallyInvId?: string;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface InvoiceLineItem {
  id: string;
  invoiceId: string;
  loadingSlipId: string;
  itemId: string;
  itemSource?: OrderItemSource;
  npdId?: string;
  qty: number;
  rate: number;
  amount: number;
  gstRate: number;
  cgst: number;
  sgst: number;
  igst: number;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface GatePassLine {
  id: string;
  itemId?: string;
  itemName: string;
  itemDescription?: string;
  qty: number;
  uom?: string;
  rate: number;
  amount: number;
  loadingSlipIds: string[];
  loadingSlipNos: string[];
  remarks?: string;
}

export interface GatePass {
  id: string;
  gatePassNo: string;
  date: string;
  gatePassType?: "Non-Returnable" | "Returnable";
  invoiceId?: string;
  invoiceNo?: string;
  companyId?: string;
  companyName?: string;
  recipientId?: string;
  recipientName?: string;
  recipientType?: "Supplier" | "Customer" | "Unknown";
  sentByUserId?: string;
  sentByUserName?: string;
  truckId?: string;
  truckNo?: string;
  loadingSlipIds: string[];
  loadingSlipNos: string[];
  remarks?: string;
  clearOffReason?: string;
  clearedOffAt?: string;
  clearedOffBy?: string;
  totalQty: number;
  totalAmount: number;
  lines: GatePassLine[];
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface Service {
  id: string;
  name: string;
  active?: "Yes" | "No";
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface Setting {
  id: string;
  reelAsPerCalculation?: string;
  flapAsPerCalculation?: string;
  cuttingSizeAsPerCalculation?: string;
  gsmAsPerCalculation?: string;
  allowInvoiceTallyEdit?: string;
  allowInvoiceTallyEditUsers?: string;
  productionFormVisibleColumns?: string;
  poMandatoryMrrTypes?: string;
  realizationPerKgTargets?: string;
  invoiceNumberSeries?: string;
  mandatoryMachinesByType?: string;
  designations?: string;
  organizationName?: string;
  organizationAddress?: string;
  organizationGstDetails?: string;
  organizationLogo?: string;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface FixedMonthlyExpenseLine {
  id: string;
  expenseName: string;
  amount: number;
}

export interface FixedDailyExpense {
  id: string;
  date: string;
  lines: FixedMonthlyExpenseLine[];
  totalAmount: number;
  updatedBy?: string;
  updateTimestamp?: string;
}
export interface FixedMonthlyExpense {
  id: string;
  fy: string;
  month: number;
  monthName: string;
  lines: FixedMonthlyExpenseLine[];
  totalAmount: number;
  updatedBy?: string;
  updateTimestamp?: string;
}

export interface AuditDashboardSnapshot {
  id: string;
  dateFrom: string;
  dateTo: string;
  invoiceValueTally: number;
  consumptionValueTally: number;
  manufacturingValueTally?: number;
  saleValueTally: number;
  debitNoteTally: number;
  npdStockValueTally?: number;
  reelStockValueTally?: number;
  reelStockQtyTally?: number;
  invoiceCountTally?: number;
  consumptionCountTally?: number;
  manufacturingCountTally?: number;
  saleCountTally?: number;
  debitNoteCountTally?: number;
  npdStockCountTally?: number;
  reelStockCountTally?: number;
  reelStockQtyCountTally?: number;
  updatedBy?: string;
  updateTimestamp?: string;
}
export interface OperationDashboardMetricCard {
  id: string;
  label: string;
  value: number | null;
  format?: "number" | "currency" | "percent";
  unit?: string;
  note?: string;
  decimals?: number;
  status?: "ready" | "unavailable";
}

export interface OperationDashboardMetricGroup {
  id: string;
  title: string;
  cards: OperationDashboardMetricCard[];
}

export interface OperationDashboardSummary {
  rangeLabel: string;
  comparisonLabel: string;
  groups: OperationDashboardMetricGroup[];
}

