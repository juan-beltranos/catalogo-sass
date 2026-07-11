import React from "react";

interface PaginatorProps {
    page: number;
    hasNext: boolean;
    hasPrev: boolean;
    loading?: boolean;
    onNext: () => void;
    onPrev: () => void;
    className?: string;
}

const Paginator: React.FC<PaginatorProps> = ({
    page,
    hasNext,
    hasPrev,
    loading = false,
    onNext,
    onPrev,
    className = "",
}) => {
    return (
        <div
            className={`flex items-center justify-between gap-2 border-t bg-white px-4 sm:px-6 py-3 ${className}`}
        >
            <div className="text-xs text-gray-500">
                Pagina <span className="font-semibold">{page}</span>
                {loading ? <span className="ml-2">Cargando...</span> : null}
            </div>

            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={onPrev}
                    disabled={!hasPrev || loading}
                    className="px-3 py-2 text-sm rounded border disabled:opacity-50"
                >
                    Anterior
                </button>

                <button
                    type="button"
                    onClick={onNext}
                    disabled={!hasNext || loading}
                    className="px-3 py-2 text-sm rounded border disabled:opacity-50"
                >
                    Siguiente
                </button>
            </div>
        </div>
    );
};

export default Paginator;
