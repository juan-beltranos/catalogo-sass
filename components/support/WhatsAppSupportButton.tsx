import React from 'react';

const SUPPORT_PHONE = '573054764557';
const SUPPORT_MESSAGE = 'Hola, necesito ayuda con CatalogSaaS.';

const WhatsAppSupportButton: React.FC = () => {
  const supportUrl = `https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent(SUPPORT_MESSAGE)}`;

  return (
    <a
      href={supportUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Contactar soporte por WhatsApp"
      title="Soporte por WhatsApp"
      className="fixed right-4 sm:right-6 z-[60] flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg ring-1 ring-black/5 transition-transform duration-200 hover:scale-105 hover:bg-[#20bd5a] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#25D366]/40 active:scale-95"
      style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 32 32"
        className="h-8 w-8 fill-current"
      >
        <path d="M16.02 3A12.84 12.84 0 0 0 5.1 22.6L3 29l6.63-2.07A12.95 12.95 0 1 0 16.02 3Zm0 23.72c-2.1 0-4.14-.6-5.9-1.73l-.42-.26-3.93 1.23 1.28-3.82-.28-.44a10.56 10.56 0 1 1 9.25 5.02Zm5.8-7.9c-.32-.16-1.88-.93-2.17-1.04-.29-.11-.5-.16-.71.16-.21.32-.82 1.04-1 1.25-.19.21-.37.24-.69.08-.32-.16-1.34-.49-2.55-1.57a9.55 9.55 0 0 1-1.77-2.2c-.19-.32-.02-.49.14-.65.14-.14.32-.37.48-.56.16-.18.21-.32.32-.53.1-.21.05-.4-.03-.56-.08-.16-.71-1.72-.98-2.35-.26-.62-.52-.54-.71-.55h-.61c-.21 0-.56.08-.85.4-.29.32-1.11 1.09-1.11 2.65s1.14 3.07 1.3 3.28c.16.21 2.24 3.42 5.43 4.8.76.33 1.35.52 1.81.67.76.24 1.45.21 2 .13.61-.09 1.88-.77 2.15-1.51.26-.74.26-1.38.18-1.51-.08-.14-.29-.22-.61-.38Z" />
      </svg>
      <span className="sr-only">WhatsApp</span>
    </a>
  );
};

export default WhatsAppSupportButton;
