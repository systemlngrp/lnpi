/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { Layout } from "./components/Layout";
import { RequireAuth } from "./auth/RequireAuth";
import { LoginPage } from "./pages/Login";
import { UnauthorizedPage } from "./pages/Unauthorized";
import { ItemGroups } from "./pages/ItemGroups";
import { MaterialGroups } from "./pages/MaterialGroups";
import { LegacyItemsMaster } from "./pages/LegacyItemsMaster";
import { Materials } from "./pages/Materials";
import { IndentForm } from "./pages/IndentForm";
import { IndentDetail } from "./pages/IndentDetail";
import { IndentApproved, IndentCompleted, IndentPending, IndentRejected } from "./pages/IndentQueue";
import { PurchaseOrderPendingIndentLines } from "./pages/PurchaseOrderPendingIndentLines";
import { PurchaseOrderCreate } from "./pages/PurchaseOrderCreate";
import { PurchaseOrderAll, PurchaseOrderApproved, PurchaseOrderPendingApproval, PurchaseOrderRejected } from "./pages/PurchaseOrderList";
import { GateEntryForm } from "./pages/GateEntryForm";
import { GateEntryMaster } from "./pages/GateEntryMaster";
import { PendingMrr } from "./pages/PendingMrr";
import { PendingTallyEntry } from "./pages/PendingTallyEntry";
import { PendingDebitNote } from "./pages/PendingDebitNote";
import { MaterialIssueForm } from "./pages/MaterialIssueForm";
import { MaterialReturnForm } from "./pages/MaterialReturnForm";
import { MaterialIssueMaster } from "./pages/MaterialIssueMaster";
import { MaterialReturnMaster } from "./pages/MaterialReturnMaster";
import { PendingNonJobMaterialIssue } from "./pages/PendingNonJobMaterialIssue";
import { NonJobIssueMaster } from "./pages/NonJobIssueMaster";
import { PendingConsumptionTallyPosting } from "./pages/PendingConsumptionTallyPosting";
import { ReelIssueReturnForm } from "./pages/ReelIssueReturnForm";
import { DailyConsumptionIssueForm } from "./pages/DailyConsumptionIssueForm";
import { DailyConsumptionMaster } from "./pages/DailyConsumptionMaster";
import { Suppliers } from "./pages/Suppliers";
import { States } from "./pages/States";
import { Units } from "./pages/Units";
import { ColorMasters } from "./pages/ColorMasters";
import { GstRateMasters } from "./pages/GstRateMasters";
import { Companies } from "./pages/Companies";
import { Trucks } from "./pages/Trucks";
import { Machines } from "./pages/Machines";
import { RapcRangeMaster } from "./pages/RapcRangeMaster";
import { NpdMaster } from "./pages/NpdMaster";
import { PhpItemMaster } from "./pages/PhpItemMaster";
import { PlateItemMaster } from "./pages/PlateItemMaster";
import { MaterialInForm } from "./pages/MaterialInForm";
import { MrrApprovals } from "./pages/MrrApprovals";
import { MaterialInMaster } from "./pages/MaterialInMaster";
import { MaterialInItemMaster } from "./pages/MaterialInItemMaster";
import { ProductionForm } from "./pages/ProductionForm";
import { PendingProduction } from "./pages/PendingProduction";
import { ProductionPendingTally } from "./pages/ProductionPendingTally";
import { ProductionMaster } from "./pages/ProductionMaster";
import { PhpProductionMaster } from "./pages/PhpProductionMaster";
import { PhpProductionScheduling } from "./pages/PhpProductionScheduling";
import { PhpProductionSequencing } from "./pages/PhpProductionSequencing";
import { PhpProductionExecution } from "./pages/PhpProductionExecution";
import { PhpPlateProductionScheduling } from "./pages/PhpPlateProductionScheduling";
import { PhpPlateProductionSequencing } from "./pages/PhpPlateProductionSequencing";
import { PhpPlateProductionExecution } from "./pages/PhpPlateProductionExecution";
import { PlateProductionMaster } from "./pages/PlateProductionMaster";
import { PlateProductionScheduling } from "./pages/PlateProductionScheduling";
import { PlateProductionSequencing } from "./pages/PlateProductionSequencing";
import { PlateProductionExecution } from "./pages/PlateProductionExecution";
import { ProductionPendingConsumption, ProductionPendingFFG } from "./pages/ProductionStageQueue";
import { ProductionPlan } from "./pages/ProductionPlan";
import { PendingNpd } from "./pages/PendingNpd";
import { OperationDashboard } from "./pages/OperationDashboard";
import { PendingJobClosure } from "./pages/PendingJobClosure";
import { MachinePendingProcessing } from "./pages/MachinePendingProcessing";
import { ProductionProcessingForm } from "./pages/ProductionProcessingForm";
import { ProductionProcessingMaster } from "./pages/ProductionProcessingMaster";
import { ItemwiseLeastCost } from "./pages/ItemwiseLeastCost";
import { CanceledProductions } from "./pages/CanceledProductions";
import { SampleForm } from "./pages/SampleForm";
import { PendingSamples } from "./pages/PendingSamples";
import { SamplesProduced } from "./pages/SamplesProduced";
import { SampleMaster } from "./pages/SampleMaster";
import { Users } from "./pages/Users";
import { Services } from "./pages/Services";
import { PlantHeadUnified } from "./pages/PlantHeadUnified";
import { OrderForm } from "./pages/OrderForm";
import { OrdersPendingPH } from "./pages/OrdersPendingPH";
import { OrdersPendingScheduling } from "./pages/OrdersPendingScheduling";
import { OrdersMaster } from "./pages/OrdersMaster";
import { ScheduledOrdersMaster } from "./pages/ScheduledOrdersMaster";
import { UpcomingScheduledOrders } from "./pages/UpcomingScheduledOrders";
import { PendingDispatchPlanning } from "./pages/PendingDispatchPlanning";
import { PendingPhpPlanning, PendingPlatePlanning } from "./pages/PendingLinkedProductionPlanning";
import { DispatchPlansMaster } from "./pages/DispatchPlansMaster";
import { PendingLoading } from "./pages/PendingLoading";
import { LoadingMaster } from "./pages/LoadingMaster";
import { PhpLoadingMaster } from "./pages/PhpLoadingMaster";
import { PlateLoadingMaster } from "./pages/PlateLoadingMaster";
import { PendingPhpLoadingTallyPosting, PendingPlateLoadingTallyPosting } from "./pages/PendingLinkedLoadingTally";
import { PendingInvoicing } from "./pages/PendingInvoicing";
import { BillingPendingTally } from "./pages/BillingPendingTally";
import { InvoicesMaster } from "./pages/InvoicesMaster";
import { GatePassForm } from "./pages/GatePassForm";
import { GatePassMaster } from "./pages/GatePassMaster";
import { PendingReturnableItems } from "./pages/PendingReturnableItems";
import { CanceledOrders } from "./pages/CanceledOrders";
import { PlansProductionPlanning } from "./pages/PlansProductionPlanning";
import { PlansItems } from "./pages/PlansItems";
import { PlansProduction } from "./pages/PlansProduction";
import { PlansLoading } from "./pages/PlansLoading";
import { SettingsPage } from "./pages/Settings";
import { ErpWiseReelStockReport } from "./pages/ErpWiseReelStockReport";
import { ReelwiseStockReport } from "./pages/ReelwiseStockReport";
import { JobwiseReelConsumptionReport } from "./pages/JobwiseReelConsumptionReport";
import { EfficiencyReport } from "./pages/EfficiencyReport";
import { HitVsMissReport } from "./pages/HitVsMissReport";
import { RealizationReport } from "./pages/RealizationReport";
import { PaperRequirementReport } from "./pages/PaperRequirementReport";

function BlankPage({ title }: { title: string }) {
  return (
    <div className="bg-white p-6 rounded shadow-sm border border-black">
      <h2 className="text-xl font-bold text-black mb-4 uppercase">{title}</h2>
      <p className="text-black font-medium">This module is currently under construction.</p>
    </div>
  );
}

function HomeRedirect() {
  const { user } = useAuth();
  if (user?.role === "Operator") {
    return <Navigate to="/production/pending-machine-processing" replace />;
  }
  return <Navigate to="/operations-dashboard" replace />;
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/unauthorized" element={<UnauthorizedPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<HomeRedirect />} />
          <Route path="plant-head" element={<PlantHeadUnified />} />
          
          {/* Masters */}
          <Route path="masters/item-groups" element={<ItemGroups />} />
          <Route path="masters/material-groups" element={<MaterialGroups />} />
          <Route path="masters/items" element={<LegacyItemsMaster />} />
          <Route path="masters/materials" element={<Materials />} />
          <Route path="masters/suppliers" element={<Suppliers />} />
          <Route path="masters/states" element={<States />} />
          <Route path="masters/units" element={<Units />} />
          <Route path="masters/colors" element={<ColorMasters />} />
          <Route path="masters/gst-rates" element={<GstRateMasters />} />
          <Route path="masters/companies" element={<Companies />} />
          <Route path="masters/trucks" element={<Trucks />} />
          <Route path="masters/machines" element={<Machines />} />
          <Route path="masters/rapc-ranges" element={<RapcRangeMaster />} />
          <Route path="masters/npd" element={<NpdMaster />} />
          <Route path="masters/php-item-master" element={<PhpItemMaster />} />
          <Route path="masters/plate-item-master" element={<PlateItemMaster />} />
          <Route path="masters/users" element={<Users />} />
          <Route path="masters/services" element={<Services />} />
          <Route path="masters/settings" element={<SettingsPage />} />

          {/* Indent */}
          <Route path="indent/form" element={<IndentForm />} />
          <Route path="indent/view/:id" element={<IndentDetail />} />
          <Route path="indent/pending" element={<IndentPending />} />
          <Route path="indent/approved" element={<IndentApproved />} />
          <Route path="indent/completed" element={<IndentCompleted />} />
          <Route path="indent/rejected" element={<IndentRejected />} />

          {/* Purchase Orders */}
          <Route path="purchase-orders/pending-po" element={<Navigate to="/purchase-orders/pending-approval" replace />} />
          <Route path="purchase-orders/pending-indent-lines" element={<PurchaseOrderPendingIndentLines />} />
          <Route path="purchase-orders/create/:indentId" element={<PurchaseOrderCreate />} />
          <Route path="purchase-orders/all" element={<PurchaseOrderAll />} />
          <Route path="purchase-orders/pending-approval" element={<PurchaseOrderPendingApproval />} />
          <Route path="purchase-orders/approved" element={<PurchaseOrderApproved />} />
          <Route path="purchase-orders/rejected" element={<PurchaseOrderRejected />} />

          {/* Gate Entry */}
          <Route path="gate-entry/form" element={<GateEntryForm />} />
          <Route path="gate-entry/master" element={<GateEntryMaster />} />

          {/* Material Receipt */}
          <Route path="material-receipt/pending-mrr" element={<PendingMrr />} />
          <Route path="material-receipt/approvals" element={<MrrApprovals />} />
          <Route path="material-receipt/pending-tally" element={<PendingTallyEntry />} />
          <Route path="material-receipt/pending-debit-note" element={<PendingDebitNote />} />

          {/* Material Movement */}
          <Route path="material-movement/reel-issue-return" element={<ReelIssueReturnForm />} />
          <Route path="material-movement/daily-consumption" element={<DailyConsumptionIssueForm />} />
          <Route path="material-movement/daily-consumption-master" element={<DailyConsumptionMaster />} />
          <Route path="material-movement/issue" element={<MaterialIssueForm />} />
          <Route path="material-movement/issue-master" element={<MaterialIssueMaster />} />
          <Route path="material-movement/pending-non-job-issue" element={<PendingNonJobMaterialIssue />} />
          <Route path="material-movement/pending-consumption-tally" element={<PendingConsumptionTallyPosting />} />
          <Route path="material-movement/non-job-issue-master" element={<NonJobIssueMaster />} />
          <Route path="material-movement/return" element={<MaterialReturnForm />} />
          <Route path="material-movement/return-master" element={<MaterialReturnMaster />} />

          {/* Orders */}
          <Route path="orders/form" element={<OrderForm />} />
          <Route path="orders/pending-ph" element={<OrdersPendingPH />} />
          <Route path="orders/pending-scheduling" element={<OrdersPendingScheduling />} />
          <Route path="orders/master" element={<OrdersMaster />} />
          <Route path="orders/scheduled" element={<ScheduledOrdersMaster />} />
          <Route path="orders/canceled" element={<CanceledOrders />} />
          
          {/* Material In */}
          <Route path="material-in/form" element={<MaterialInForm />} />
          <Route path="material-in/master" element={<MaterialInMaster />} />
          <Route path="material-in/item-master" element={<MaterialInItemMaster />} />
          
          {/* Production */}
          <Route path="production/form" element={<ProductionForm />} />
          <Route path="production/pending" element={<PendingProduction />} />
          <Route path="production/pending-npd" element={<PendingNpd />} />
          <Route path="production/upcoming" element={<UpcomingScheduledOrders />} />
          <Route path="production/pending-consumption" element={<ProductionPendingConsumption />} />
          <Route path="production/pending-ffg" element={<ProductionPendingFFG />} />
          <Route path="production/pending-tally" element={<ProductionPendingTally />} />
          <Route path="production/pending-job-closure" element={<PendingJobClosure />} />
          <Route path="production/pending-machine-processing" element={<MachinePendingProcessing />} />
          <Route path="production/master" element={<ProductionMaster />} />
          <Route path="production/php/master" element={<PhpProductionMaster />} />
          <Route path="production/php/pending-planning" element={<PendingPhpPlanning />} />
          <Route path="production/php/scheduling" element={<PhpProductionScheduling />} />
          <Route path="production/php/pending-sequencing" element={<PhpProductionSequencing />} />
          <Route path="production/php/pending-production" element={<PhpProductionExecution />} />
          <Route path="production/php-plate/scheduling" element={<PhpPlateProductionScheduling />} />
          <Route path="production/php-plate/pending-sequencing" element={<PhpPlateProductionSequencing />} />
          <Route path="production/php-plate/pending-production" element={<PhpPlateProductionExecution />} />
          <Route path="production/plate/master" element={<PlateProductionMaster />} />
          <Route path="production/plate/pending-planning" element={<PendingPlatePlanning />} />
          <Route path="production/plate/scheduling" element={<PlateProductionScheduling />} />
          <Route path="production/plate/pending-sequencing" element={<PlateProductionSequencing />} />
          <Route path="production/plate/pending-production" element={<PlateProductionExecution />} />
          <Route path="production/plan" element={<ProductionPlan />} />
          <Route path="operations-dashboard" element={<OperationDashboard />} />
          <Route path="production-processing/form" element={<ProductionProcessingForm />} />
          <Route path="production-processing/master" element={<ProductionProcessingMaster />} />
          <Route path="production/least-cost" element={<ItemwiseLeastCost />} />
          <Route path="production/canceled" element={<CanceledProductions />} />

          {/* Samples */}
          <Route path="samples/form" element={<SampleForm />} />
          <Route path="samples/pending" element={<PendingSamples />} />
          <Route path="samples/produced" element={<SamplesProduced />} />
          <Route path="samples/master" element={<SampleMaster />} />
          
          {/* Dispatch */}
          <Route path="dispatch/pending-planning" element={<PendingDispatchPlanning />} />
          <Route path="dispatch/master" element={<DispatchPlansMaster />} />

          {/* Loading */}
          <Route path="loading/pending" element={<PendingLoading />} />
          <Route path="loading/master" element={<LoadingMaster />} />
          <Route path="loading/php/master" element={<PhpLoadingMaster />} />
          <Route path="loading/php/pending-tally" element={<PendingPhpLoadingTallyPosting />} />
          <Route path="loading/plate/master" element={<PlateLoadingMaster />} />
          <Route path="loading/plate/pending-tally" element={<PendingPlateLoadingTallyPosting />} />

          {/* Billing */}
          <Route path="billing/pending" element={<PendingInvoicing />} />
          <Route path="billing/pending-tally" element={<BillingPendingTally />} />
          <Route path="billing/master" element={<InvoicesMaster />} />

          {/* Gate Pass */}
          <Route path="gate-pass/form" element={<GatePassForm />} />
          <Route path="gate-pass/master" element={<GatePassMaster />} />
          <Route path="gate-pass/pending-returnable" element={<PendingReturnableItems />} />

          {/* Reports */}
          <Route path="reports/erp-wise-reel-stock" element={<ErpWiseReelStockReport />} />
          <Route path="reports/reelwise-stock" element={<ReelwiseStockReport />} />
          <Route path="reports/jobwise-reel-consumption" element={<JobwiseReelConsumptionReport />} />
          <Route path="reports/efficiency" element={<EfficiencyReport />} />
          <Route path="reports/hit-vs-miss" element={<HitVsMissReport />} />
          <Route path="reports/realization" element={<RealizationReport />} />
          <Route path="reports/paper-requirement" element={<PaperRequirementReport />} />

          {/* Documentation */}
          <Route path="plans/production-planning" element={<PlansProductionPlanning />} />
          <Route path="plans/production" element={<PlansProduction />} />
          <Route path="plans/items" element={<PlansItems />} />
          <Route path="plans/loading" element={<PlansLoading />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
