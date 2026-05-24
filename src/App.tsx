/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ItemGroups } from "./pages/ItemGroups";
import { MaterialGroups } from "./pages/MaterialGroups";
import { Items } from "./pages/Items";
import { Materials } from "./pages/Materials";
import { IndentForm } from "./pages/IndentForm";
import { IndentDetail } from "./pages/IndentDetail";
import { IndentApproved, IndentCompleted, IndentPending, IndentRejected } from "./pages/IndentQueue";
import { PurchaseOrderPending } from "./pages/PurchaseOrderPending";
import { PurchaseOrderCreate } from "./pages/PurchaseOrderCreate";
import { PurchaseOrderAll, PurchaseOrderApproved, PurchaseOrderPendingApproval, PurchaseOrderRejected } from "./pages/PurchaseOrderList";
import { GateEntryForm } from "./pages/GateEntryForm";
import { GateEntryMaster } from "./pages/GateEntryMaster";
import { PendingMrr } from "./pages/PendingMrr";
import { MaterialIssueForm } from "./pages/MaterialIssueForm";
import { MaterialReturnForm } from "./pages/MaterialReturnForm";
import { Suppliers } from "./pages/Suppliers";
import { States } from "./pages/States";
import { ColorMasters } from "./pages/ColorMasters";
import { Companies } from "./pages/Companies";
import { Trucks } from "./pages/Trucks";
import { Machines } from "./pages/Machines";
import { MaterialInForm } from "./pages/MaterialInForm";
import { PendingPHApproval } from "./pages/PendingPHApproval";
import { PendingAccountsApproval } from "./pages/PendingAccountsApproval";
import { PendingMDApproval } from "./pages/PendingMDApproval";
import { PendingTallyEntry } from "./pages/PendingTallyEntry";
import { MaterialInMaster } from "./pages/MaterialInMaster";
import { MaterialInItemMaster } from "./pages/MaterialInItemMaster";
import { ProductionForm } from "./pages/ProductionForm";
import { PendingProduction } from "./pages/PendingProduction";
import { ProductionPendingPH } from "./pages/ProductionPendingPH";
import { ProductionPendingTally } from "./pages/ProductionPendingTally";
import { ProductionMaster } from "./pages/ProductionMaster";
import { ProductionPendingConsumption, ProductionPendingFFG } from "./pages/ProductionStageQueue";
import { ProductionPlan } from "./pages/ProductionPlan";
import { ProductionProcessingForm } from "./pages/ProductionProcessingForm";
import { ProductionProcessingMaster } from "./pages/ProductionProcessingMaster";
import { ItemwiseLeastCost } from "./pages/ItemwiseLeastCost";
import { CanceledProductions } from "./pages/CanceledProductions";
import { SampleForm } from "./pages/SampleForm";
import { PendingSamples } from "./pages/PendingSamples";
import { SamplesProduced } from "./pages/SamplesProduced";
import { SampleMaster } from "./pages/SampleMaster";
import { Users } from "./pages/Users";
import { Dashboard } from "./pages/Dashboard";
import { DeliveryBook } from "./pages/DeliveryBook";
import { BulkEntry } from "./pages/BulkEntry";
import { PlantHeadUnified } from "./pages/PlantHeadUnified";
import { OrderForm } from "./pages/OrderForm";
import { OrdersPendingPH } from "./pages/OrdersPendingPH";
import { OrdersPendingScheduling } from "./pages/OrdersPendingScheduling";
import { OrdersMaster } from "./pages/OrdersMaster";
import { ScheduledOrdersMaster } from "./pages/ScheduledOrdersMaster";
import { UpcomingScheduledOrders } from "./pages/UpcomingScheduledOrders";
import { PendingDispatchPlanning } from "./pages/PendingDispatchPlanning";
import { DispatchPlansMaster } from "./pages/DispatchPlansMaster";
import { PendingLoading } from "./pages/PendingLoading";
import { LoadingMaster } from "./pages/LoadingMaster";
import { PendingInvoicing } from "./pages/PendingInvoicing";
import { InvoicesMaster } from "./pages/InvoicesMaster";
import { CanceledOrders } from "./pages/CanceledOrders";
import { PlansProductionPlanning } from "./pages/PlansProductionPlanning";
import { PlansItems } from "./pages/PlansItems";
import { PlansProduction } from "./pages/PlansProduction";
import { SettingsPage } from "./pages/Settings";
import { ErpWiseReelStockReport } from "./pages/ErpWiseReelStockReport";

function BlankPage({ title }: { title: string }) {
  return (
    <div className="bg-white p-6 rounded shadow-sm border border-black">
      <h2 className="text-xl font-bold text-black mb-4 uppercase">{title}</h2>
      <p className="text-black font-medium">This module is currently under construction.</p>
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="delivery-book" element={<DeliveryBook />} />
          <Route path="bulk-entry" element={<BulkEntry />} />
          <Route path="plant-head" element={<PlantHeadUnified />} />
          
          {/* Masters */}
          <Route path="masters/item-groups" element={<ItemGroups />} />
          <Route path="masters/material-groups" element={<MaterialGroups />} />
          <Route path="masters/items" element={<Items />} />
          <Route path="masters/materials" element={<Materials />} />
          <Route path="masters/suppliers" element={<Suppliers />} />
          <Route path="masters/states" element={<States />} />
          <Route path="masters/colors" element={<ColorMasters />} />
          <Route path="masters/companies" element={<Companies />} />
          <Route path="masters/trucks" element={<Trucks />} />
          <Route path="masters/machines" element={<Machines />} />
          <Route path="masters/users" element={<Users />} />
          <Route path="masters/settings" element={<SettingsPage />} />

          {/* Indent */}
          <Route path="indent/form" element={<IndentForm />} />
          <Route path="indent/view/:id" element={<IndentDetail />} />
          <Route path="indent/pending" element={<IndentPending />} />
          <Route path="indent/approved" element={<IndentApproved />} />
          <Route path="indent/completed" element={<IndentCompleted />} />
          <Route path="indent/rejected" element={<IndentRejected />} />

          {/* Purchase Orders */}
          <Route path="purchase-orders/pending-po" element={<PurchaseOrderPending />} />
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

          {/* Material Movement */}
          <Route path="material-movement/issue" element={<MaterialIssueForm />} />
          <Route path="material-movement/return" element={<MaterialReturnForm />} />

          {/* Orders */}
          <Route path="orders/form" element={<OrderForm />} />
          <Route path="orders/pending-ph" element={<OrdersPendingPH />} />
          <Route path="orders/pending-scheduling" element={<OrdersPendingScheduling />} />
          <Route path="orders/master" element={<OrdersMaster />} />
          <Route path="orders/scheduled" element={<ScheduledOrdersMaster />} />
          <Route path="orders/upcoming" element={<UpcomingScheduledOrders />} />
          <Route path="orders/canceled" element={<CanceledOrders />} />
          
          {/* Material In */}
          <Route path="material-in/form" element={<MaterialInForm />} />
          <Route path="material-in/pending-ph" element={<PendingPHApproval />} />
          <Route path="material-in/pending-accounts" element={<PendingAccountsApproval />} />
          <Route path="material-in/pending-md" element={<PendingMDApproval />} />
          <Route path="material-in/pending-tally" element={<PendingTallyEntry />} />
          <Route path="material-in/master" element={<MaterialInMaster />} />
          <Route path="material-in/item-master" element={<MaterialInItemMaster />} />
          
          {/* Production */}
          <Route path="production/form" element={<ProductionForm />} />
          <Route path="production/pending" element={<PendingProduction />} />
          <Route path="production/pending-ph" element={<ProductionPendingPH />} />
          <Route path="production/pending-consumption" element={<ProductionPendingConsumption />} />
          <Route path="production/pending-ffg" element={<ProductionPendingFFG />} />
          <Route path="production/pending-tally" element={<ProductionPendingTally />} />
          <Route path="production/master" element={<ProductionMaster />} />
          <Route path="production/plan" element={<ProductionPlan />} />
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

          {/* Billing */}
          <Route path="billing/pending" element={<PendingInvoicing />} />
          <Route path="billing/master" element={<InvoicesMaster />} />

          {/* Reports */}
          <Route path="reports/erp-wise-reel-stock" element={<ErpWiseReelStockReport />} />

          {/* Documentation */}
          <Route path="plans/production-planning" element={<PlansProductionPlanning />} />
          <Route path="plans/production" element={<PlansProduction />} />
          <Route path="plans/items" element={<PlansItems />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
