/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ItemGroups } from "./pages/ItemGroups";
import { Items } from "./pages/Items";
import { Suppliers } from "./pages/Suppliers";
import { Companies } from "./pages/Companies";
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
import { CanceledOrders } from "./pages/CanceledOrders";

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
          <Route path="masters/companies" element={<Companies />} />
          <Route path="masters/users" element={<Users />} />
          {/* Orders */}
          <Route path="orders/form" element={<OrderForm />} />
          <Route path="orders/pending-ph" element={<OrdersPendingPH />} />
          <Route path="orders/pending-scheduling" element={<OrdersPendingScheduling />} />
          <Route path="orders/master" element={<OrdersMaster />} />
          <Route path="orders/scheduled" element={<ScheduledOrdersMaster />} />
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
          
          {/* Consumption */}
          <Route path="consumption/form" element={<ConsumptionForm />} />
          <Route path="consumption/pending-ph" element={<ConsumptionPendingPH />} />
          <Route path="consumption/pending-tally" element={<ConsumptionPendingTally />} />
          <Route path="consumption/master" element={<ConsumptionMaster />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
