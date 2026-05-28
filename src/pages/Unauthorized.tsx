import { Link, useLocation } from "react-router-dom";

export function UnauthorizedPage() {
  const location = useLocation();
  return (
    <div className="max-w-xl mx-auto mt-10 bg-white border-2 border-black rounded p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
      <h2 className="text-lg font-black uppercase tracking-tight text-black">Unauthorized</h2>
      <p className="mt-2 text-sm text-slate-700">
        You don&apos;t have access to: <span className="font-bold">{location.pathname}</span>
      </p>
      <div className="mt-4 flex gap-3">
        <Link to="/" className="bg-indigo-600 text-white px-4 py-2 rounded font-black hover:bg-indigo-700 transition">
          Go Dashboard
        </Link>
      </div>
    </div>
  );
}

