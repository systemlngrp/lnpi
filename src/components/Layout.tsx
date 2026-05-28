import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useAuth } from "../auth/AuthContext";

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const location = useLocation();
  const { user, hasAccess, logout } = useAuth();

  useEffect(() => {
    const saved = window.localStorage.getItem("layout-sidebar-collapsed");
    setSidebarCollapsed(saved === "true");
  }, []);

  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem("layout-sidebar-collapsed", String(next));
      return next;
    });
  };

  if (user && !hasAccess(location.pathname)) {
    return <Navigate to="/unauthorized" replace />;
  }

  const avatar = (user?.name || user?.userId || "U").trim().slice(0, 1).toUpperCase();

  return (
    <div className="flex h-screen w-full bg-slate-50 font-sans">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        isCollapsed={sidebarCollapsed}
      />
      
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div 
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={() => setSidebarOpen(false)}
        />
      )}

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="bg-white shadow-sm relative z-10 border-b border-black">
          <div className="w-full px-3 py-3 sm:px-4 lg:px-5">
             <div className="flex justify-between items-center h-8">
               <div className="flex items-center gap-4">
                 <button 
                    className="md:hidden p-2 -ml-2 text-black"
                    onClick={() => setSidebarOpen(true)}
                 >
                    <Menu size={20} />
                 </button>
                 <button
                    className="hidden md:inline-flex items-center justify-center rounded border border-black bg-white p-2 text-black hover:bg-slate-100 transition"
                    onClick={toggleSidebarCollapsed}
                    title={sidebarCollapsed ? "Expand menu" : "Collapse menu"}
                 >
                    {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
                 </button>
               </div>
               <div className="flex items-center space-x-4">
                  {user && (
                    <div className="hidden sm:flex flex-col items-end leading-tight">
                      <div className="text-[11px] font-black text-black">{user.name}</div>
                      <div className="text-[10px] font-bold text-slate-600">{user.role}</div>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => logout()}
                    className="hidden sm:inline-flex items-center rounded border border-black bg-white px-3 py-1.5 text-[11px] font-black text-black hover:bg-slate-100 transition"
                    title="Logout"
                  >
                    Logout
                  </button>
                  <div className="h-8 w-8 rounded-full bg-black flex items-center justify-center text-white font-bold border border-black">
                    {avatar}
                  </div>
               </div>
             </div>
          </div>
        </header>
        <div className="flex-1 overflow-auto bg-white">
          <div className="w-full py-4 px-2 sm:px-3 lg:px-4">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
