/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ItemGroups } from "./pages/ItemGroups";
import { Items } from "./pages/Items";
import { Suppliers } from "./pages/Suppliers";
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
import { ProductionPlan } from "./pages/ProductionPlan";
import { ProductionProcessingForm } from "./pages/ProductionProcessingForm";
import { ProductionProcessingMaster } from "./pages/ProductionProcessingMaster";
import { ItemwiseLeastCost } from "./pages/ItemwiseLeastCost";
import { CanceledProductions } from "./pages/CanceledProductions";
import { SampleForm } from "./pages/SampleForm";
import { PendingSamples } from "./pages/PendingSamples";
import { SamplesProduced } from "./pages/SamplesProduced";
import { SampleMaster } from "./pages/SampleMaster";
import { ConsumptionForm } from "./pages/ConsumptionForm";
import { ConsumptionPendingPH } from "./pages/ConsumptionPendingPH";
import { ConsumptionPendingTally } from "./pages/ConsumptionPendingTally";
import { ConsumptionMaster } from "./pages/ConsumptionMaster";
import { Users } from "./pages/Users";
import { Dashboard } from "./pages/Dashboard";
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
          <Route path="bulk-entry" element={<BulkEntry />} />
          <Route path="plant-head" element={<PlantHeadUnified />} />
          
          {/* Masters */}
          <Route path="masters/item-groups" element={<ItemGroups />} />
          <Route path="masters/items" element={<Items />} />
          <Route path="masters/suppliers" element={<Suppliers />} />
          <Route path="masters/colors" element={<ColorMasters />} />
          <Route path="masters/companies" element={<Companies />} />
          <Route path="masters/trucks" element={<Trucks />} />
          <Route path="masters/machines" element={<Machines />} />
          <Route path="masters/users" element={<Users />} />
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
          
          {/* Consumption */}
          <Route path="consumption/form" element={<ConsumptionForm />} />
          <Route path="consumption/pending-ph" element={<ConsumptionPendingPH />} />
          <Route path="consumption/pending-tally" element={<ConsumptionPendingTally />} />
          <Route path="consumption/master" element={<ConsumptionMaster />} />
          
          {/* Dispatch */}
          <Route path="dispatch/pending-planning" element={<PendingDispatchPlanning />} />
          <Route path="dispatch/master" element={<DispatchPlansMaster />} />

          {/* Loading */}
          <Route path="loading/pending" element={<PendingLoading />} />
          <Route path="loading/master" element={<LoadingMaster />} />

          {/* Billing */}
          <Route path="billing/pending" element={<PendingInvoicing />} />
          <Route path="billing/master" element={<InvoicesMaster />} />

          {/* Documentation */}
          <Route path="plans/production-planning" element={<PlansProductionPlanning />} />
          <Route path="plans/items" element={<PlansItems />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
