import { Route, Routes } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { HomePage } from "@/pages/HomePage";
import { ItemDetailPage } from "@/pages/ItemDetailPage";
import { AboutPage } from "@/pages/AboutPage";

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/items/:slug" element={<ItemDetailPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}

function NotFound() {
  return (
    <div className="rounded-3xl border-2 border-dashed border-brand-200 bg-white/70 p-8 text-center shadow-sm">
      <p className="text-base font-bold text-slate-700">
        That page doesn’t exist.
      </p>
      <p className="mt-1 text-sm text-slate-500">
        Try heading back to the search.
      </p>
    </div>
  );
}
