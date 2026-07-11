import React, { useState, useEffect } from "react";

export const ImageCarousel: React.FC<{ images: string[]; alt: string }> = ({ images, alt }) => {
    const [i, setI] = useState(0);
    
    useEffect(() => setI(0), [images?.join("|")]);

    if (!images.length) {
        return (
            <div className="aspect-square bg-gray-100 rounded-2xl flex items-center justify-center text-gray-400">
                <i className="fa-regular fa-image text-2xl" />
            </div>
        );
    }

    const prev = () => setI((p) => (p - 1 + images.length) % images.length);
    const next = () => setI((p) => (p + 1) % images.length);

    return (
        <div className="relative">
            <div className="relative aspect-square bg-gray-100 rounded-2xl overflow-hidden">
                <img
                    src={images[i]}
                    alt={alt}
                    className="relative z-10 h-full w-full object-contain"
                    loading="lazy"
                />
            </div>

            {images.length > 1 ? (
                <>
                    <button
                        type="button"
                        onClick={prev}
                        className="absolute left-3 top-1/2 -translate-y-1/2 z-20 h-10 w-10 rounded-full bg-white/90 border shadow-sm flex items-center justify-center hover:bg-white"
                        aria-label="Anterior"
                    >
                        <i className="fa-solid fa-chevron-left" />
                    </button>

                    <button
                        type="button"
                        onClick={next}
                        className="absolute right-3 top-1/2 -translate-y-1/2 z-20 h-10 w-10 rounded-full bg-white/90 border shadow-sm flex items-center justify-center hover:bg-white"
                        aria-label="Siguiente"
                    >
                        <i className="fa-solid fa-chevron-right" />
                    </button>

                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex gap-1.5">
                        {images.map((_, idx) => (
                            <button
                                key={idx}
                                type="button"
                                onClick={() => setI(idx)}
                                className={`h-2 w-2 rounded-full border ${idx === i ? "bg-white" : "bg-white/50"
                                    }`}
                                aria-label={`Ir a imagen ${idx + 1}`}
                            />
                        ))}
                    </div>
                </>
            ) : null}
        </div>

    );
};
