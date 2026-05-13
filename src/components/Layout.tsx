import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";

import { Menu } from "lucide-react";

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen w-full bg-slate-50 font-sans">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div 
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={() => setSidebarOpen(false)}
        />
      )}

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="bg-white shadow-sm relative z-10 border-b border-black">
          <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
             <div className="flex justify-between items-center h-8">
               <div className="flex items-center gap-4">
                 <button 
                    className="md:hidden p-2 -ml-2 text-black"
                    onClick={() => setSidebarOpen(true)}
                 >
                    <Menu size={20} />
                 </button>
               </div>
               <div className="flex items-center space-x-4">
                  <div className="h-8 w-8 rounded-full bg-black flex items-center justify-center text-white font-bold border border-black">
                    S
                  </div>
               </div>
             </div>
          </div>
        </header>
        <div className="flex-1 overflow-auto bg-white">
          <div className="mx-auto max-w-7xl py-6 px-4 sm:px-6 lg:px-8">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
