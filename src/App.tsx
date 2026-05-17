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
    <div className="rounded-2xl border border-white/5 bg-slate-900/40 p-6 text-center text-sm text-slate-400">
      That page doesn’t exist.
    </div>
  );
}
