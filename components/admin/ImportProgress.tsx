import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export type ImportStatus = {
  status: "running" | "done" | "error";
  stage: string;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  detail?: string;
};

export const initialImportStatus = (): ImportStatus => ({
  status: "running", stage: "Leyendo archivo…", total: 0, created: 0, updated: 0, skipped: 0,
});

export default function ImportProgress({ progress, onClose }: { progress: ImportStatus; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const busy = progress.status === "running";
  const processed = progress.created + progress.updated + progress.skipped;
  // Finishing steps (ordering and refreshing) must complete before showing 100%.
  const percent = progress.status === "done" ? 100 : progress.total ? Math.min(99, Math.floor(processed / progress.total * 100)) : 0;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const root = document.getElementById("root");
    const wasInert = root?.inert ?? false;
    const previousOverflow = document.body.style.overflow;
    if (root) root.inert = true;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    return () => {
      if (root) root.inert = wasInert;
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    if (!busy) return;
    const initialUrl = window.location.href;
    const initialState = window.history.state;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const blockNavigation = (event: MouseEvent) => {
      if ((event.target as Element)?.closest?.("a[href]")) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    // HashRouter uses popstate. Keep its current route mounted while writes run.
    const keepRoute = (event: Event) => {
      if (window.location.href === initialUrl) return;
      event.stopImmediatePropagation();
      window.history.pushState(initialState, "", initialUrl);
      dialog.current?.focus();
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", blockNavigation, true);
    window.addEventListener("popstate", keepRoute, true);
    window.addEventListener("hashchange", keepRoute, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", blockNavigation, true);
      window.removeEventListener("popstate", keepRoute, true);
      window.removeEventListener("hashchange", keepRoute, true);
    };
  }, [busy]);

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/65 p-4">
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="import-progress-title" tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onClose();
          if (event.key !== "Tab") return;
          const targets = dialog.current?.querySelectorAll<HTMLElement>("button, summary");
          if (!targets?.length) { event.preventDefault(); dialog.current?.focus(); return; }
          const first = targets[0], last = targets[targets.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
            event.preventDefault(); last.focus();
          } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) {
            event.preventDefault(); first.focus();
          }
        }} className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl outline-none">
        <h2 id="import-progress-title" className="text-xl font-bold text-slate-900">
          {busy ? "Importando productos" : progress.status === "done" ? "Importación completada" : "Importación interrumpida"}
        </h2>
        <p className="mt-2 break-words text-sm text-slate-600" role="status" aria-live="polite">{progress.stage}</p>
        <div className="mt-5 flex justify-between text-sm font-semibold text-slate-800">
          <span>{progress.total ? `${processed} de ${progress.total} productos procesados` : "Preparando importación"}</span>
          <span>{percent}%</span>
        </div>
        <div role="progressbar" aria-label="Progreso de importación" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
          className="mt-2 h-3 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-indigo-600 transition-[width] duration-300" style={{ width: `${percent}%` }} />
        </div>
        <dl className="mt-5 grid grid-cols-3 gap-2 text-center text-sm">
          {[["Creados", progress.created], ["Actualizados", progress.updated], ["Omitidos", progress.skipped]].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-slate-50 p-3"><dt className="text-slate-500">{label}</dt><dd className="mt-1 text-xl font-bold text-slate-900">{value}</dd></div>
          ))}
        </dl>
        {busy ? <p className="mt-5 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Mantén esta pestaña abierta y espera a que termine. No recargues ni cierres la ventana: la importación se interrumpiría.</p>
          : <p className="mt-4 text-sm text-slate-600">{progress.status === "done" ? "Ya puedes continuar usando la tienda." : "Los productos guardados hasta este momento se conservan. Revisa el detalle antes de volver a importar."}</p>}
        {progress.detail && <details className="mt-4 text-sm"><summary className="cursor-pointer font-semibold">Ver detalle</summary><p className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-slate-600">{progress.detail}</p></details>}
        {!busy && <button type="button" onClick={onClose} className="mt-5 w-full rounded-xl bg-indigo-600 px-4 py-3 font-bold text-white">Cerrar</button>}
      </div>
    </div>, document.body,
  );
}
