import React from "react";

const HomeView: React.FC = () => {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 via-white to-white">
      {/* Top glow */}
      <div className="pointer-events-none absolute inset-x-0 top-[-120px] h-[320px] bg-gradient-to-r from-indigo-200/40 via-purple-200/30 to-pink-200/30 blur-3xl" />

      <main className="relative">
        {/* HERO */}
        <section className="px-4 pt-14 pb-10 sm:pt-20 sm:pb-14">
          <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
            {/* Left */}
            <div className="max-w-xl">
              <div className="inline-flex items-center gap-2 rounded-full border bg-white/70 backdrop-blur px-3 py-1 text-xs font-bold text-gray-700 shadow-sm">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Catálogos + pedidos por WhatsApp
              </div>

              <h1 className="mt-5 text-4xl sm:text-5xl font-black tracking-tight text-gray-900">
                Crea un catálogo digital{" "}
                <span className="text-indigo-600">profesional</span> en minutos.
              </h1>

              <p className="mt-4 text-base sm:text-lg text-gray-600 leading-relaxed">
                Publica productos con variantes, fotos y precios. Recibe pedidos con carrito y envíalos a WhatsApp
                automáticamente. Todo optimizado para móvil.
              </p>

              <div className="mt-7 flex flex-col sm:flex-row gap-3">
                <button className="inline-flex items-center justify-center gap-2 bg-indigo-600 text-white px-6 py-3 rounded-xl font-extrabold hover:bg-indigo-700 active:scale-[0.99] transition shadow-sm">
                  Empezar ahora
                  <i className="fa-solid fa-arrow-right text-sm" />
                </button>

                <button className="inline-flex items-center justify-center gap-2 border border-gray-200 bg-white px-6 py-3 rounded-xl font-extrabold text-gray-800 hover:bg-gray-50 active:scale-[0.99] transition">
                  Ver demo
                  <i className="fa-regular fa-circle-play" />
                </button>
              </div>

              {/* Trust row */}
              <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-gray-500">
                <div className="inline-flex items-center gap-2">
                  <i className="fa-solid fa-check text-emerald-600" />
                  Sin código
                </div>
                <div className="inline-flex items-center gap-2">
                  <i className="fa-solid fa-check text-emerald-600" />
                  Mobile-first
                </div>
                <div className="inline-flex items-center gap-2">
                  <i className="fa-solid fa-check text-emerald-600" />
                  Carrito + WhatsApp
                </div>
              </div>
            </div>

            {/* Right: mock / preview */}
            <div className="lg:justify-self-end w-full">
              <div className="relative rounded-3xl border border-gray-100 bg-white shadow-xl overflow-hidden">
                <div className="p-4 border-b bg-white/70 backdrop-blur flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-red-400" />
                  <div className="h-3 w-3 rounded-full bg-yellow-400" />
                  <div className="h-3 w-3 rounded-full bg-green-400" />
                  <div className="ml-3 text-xs font-bold text-gray-500">Vista previa del catálogo</div>
                </div>

                <div className="p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-10 w-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-black">
                        M
                      </div>
                      <div className="min-w-0">
                        <div className="font-extrabold text-gray-900 truncate">Mi Tienda</div>
                        <div className="text-xs text-gray-500 truncate">Catálogo • Pedidos por WhatsApp</div>
                      </div>
                    </div>

                    <div className="inline-flex items-center gap-2 rounded-full bg-indigo-600 text-white px-3 py-2 text-xs font-extrabold">
                      <i className="fa-solid fa-cart-shopping" />
                      Carrito
                      <span className="bg-white text-indigo-700 rounded-full px-2 py-0.5 text-[10px] font-black">
                        3
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 flex gap-2 overflow-hidden">
                    {["Todo", "Ropa", "Calzado", "Accesorios"].map((x, idx) => (
                      <div
                        key={x}
                        className={`shrink-0 px-3 py-2 rounded-full text-xs font-extrabold border ${idx === 0 ? "bg-indigo-600 text-white border-indigo-600" : "bg-white border-gray-200 text-gray-700"
                          }`}
                      >
                        {x}
                      </div>
                    ))}
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-3">
                    {[1, 2, 3, 4].map((n) => (
                      <div key={n} className="rounded-2xl border border-gray-100 overflow-hidden">
                        <div className="aspect-square bg-gradient-to-br from-gray-100 to-gray-50" />
                        <div className="p-3">
                          <div className="h-3 w-24 bg-gray-200 rounded" />
                          <div className="mt-2 h-3 w-16 bg-indigo-200 rounded" />
                          <div className="mt-3 h-9 w-full bg-indigo-600 rounded-xl" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* bottom subtle gradient */}
                <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-white to-transparent pointer-events-none" />
              </div>
            </div>
          </div>
        </section>

        {/* STATS */}
        <section className="px-4 pb-6 sm:pb-10">
          <div className="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { k: "Setup", v: "5 min", i: "fa-solid fa-stopwatch" },
              { k: "Conversión", v: "+WhatsApp", i: "fa-brands fa-whatsapp" },
              { k: "Diseño", v: "Responsive", i: "fa-solid fa-mobile-screen" },
            ].map((x) => (
              <div
                key={x.k}
                className="bg-white border border-gray-100 rounded-2xl p-4 flex items-center gap-3 shadow-sm"
              >
                <div className="h-11 w-11 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-700">
                  <i className={x.i} />
                </div>
                <div>
                  <div className="text-xs font-bold text-gray-500 uppercase">{x.k}</div>
                  <div className="text-lg font-black text-gray-900">{x.v}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* BENEFITS */}
        <section className="px-4 py-10 sm:py-14">
          <div className="max-w-6xl mx-auto">
            <div className="max-w-2xl">
              <h2 className="text-2xl sm:text-3xl font-black text-gray-900">
                Todo lo que necesitas para vender con un catálogo moderno
              </h2>
              <p className="mt-2 text-gray-600">
                Menos fricción para tus clientes, más orden para tu negocio.
              </p>
            </div>

            <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
              <Feature
                icon="fa-solid fa-bolt"
                title="Rápido de publicar"
                desc="Crea categorías, sube productos e imágenes. Lista tu tienda en minutos."
                tone="indigo"
              />
              <Feature
                icon="fa-solid fa-layer-group"
                title="Variantes y fotos"
                desc="Colores/tallas con precios y stock. Carrusel para ver todas las imágenes."
                tone="purple"
              />
              <Feature
                icon="fa-solid fa-shield-halved"
                title="Confiable y escalable"
                desc="Datos protegidos y estructura lista para crecer con tu negocio."
                tone="emerald"
              />
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section className="px-4 pb-24 sm:pb-20">
          <div className="max-w-6xl mx-auto">
            <div className="bg-white border border-gray-100 rounded-3xl p-6 sm:p-10 shadow-sm">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <h3 className="text-xl sm:text-2xl font-black text-gray-900">Cómo funciona</h3>
                  <p className="text-gray-600 mt-1">Tres pasos simples para empezar a vender.</p>
                </div>
                <button className="hidden sm:inline-flex items-center justify-center gap-2 bg-indigo-600 text-white px-5 py-3 rounded-xl font-extrabold hover:bg-indigo-700 transition">
                  Crear mi catálogo
                  <i className="fa-solid fa-arrow-right text-sm" />
                </button>
              </div>

              <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
                <Step n="1" title="Configura tu tienda" desc="Nombre, logo, WhatsApp y link público." />
                <Step n="2" title="Crea productos" desc="Precios, variantes, stock e imágenes optimizadas." />
                <Step n="3" title="Recibe pedidos" desc="Carrito + WhatsApp + registro de pedidos." />
              </div>
            </div>
          </div>
        </section>

        {/* Mobile sticky CTA */}
        <div className="sm:hidden fixed bottom-4 left-1/2 -translate-x-1/2 w-[92%] max-w-md z-50">
          <button className="w-full bg-indigo-600 text-white rounded-2xl py-3 font-extrabold shadow-2xl active:scale-[0.99] transition">
            Empezar ahora
          </button>
        </div>
      </main>
    </div>
  );
};

function Feature({
  icon,
  title,
  desc,
  tone,
}: {
  icon: string;
  title: string;
  desc: string;
  tone: "indigo" | "purple" | "emerald";
}) {
  const toneMap: Record<string, string> = {
    indigo: "bg-indigo-50 text-indigo-700 border-indigo-100",
    purple: "bg-purple-50 text-purple-700 border-purple-100",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-100",
  };

  return (
    <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 hover:shadow-md transition">
      <div className={`h-12 w-12 rounded-2xl border flex items-center justify-center ${toneMap[tone]}`}>
        <i className={icon} />
      </div>
      <h4 className="mt-4 text-lg font-black text-gray-900">{title}</h4>
      <p className="mt-2 text-gray-600 text-sm leading-relaxed">{desc}</p>
    </div>
  );
}

function Step({ n, title, desc }: { n: string; title: string; desc: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-gray-50/40 p-5">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-xl bg-indigo-600 text-white font-black flex items-center justify-center">
          {n}
        </div>
        <div className="font-extrabold text-gray-900">{title}</div>
      </div>
      <p className="mt-3 text-sm text-gray-600">{desc}</p>
    </div>
  );
}

export default HomeView;
