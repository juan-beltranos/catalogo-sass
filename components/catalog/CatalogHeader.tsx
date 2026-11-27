import React from "react";
import type { Store } from "@/interfaces";

type Props = {
  store: Store & {
    brandColor?: string;
    description?: string;
    instagram?: string;
    facebook?: string;
    email?: string;
    phone?: string;
    location?: string;
  };
  wholesale: boolean;
  cartCount: number;
  onShare: () => void;
  onCart: () => void;
};

const socialUrl = (network: string, value: string) =>
  /^https?:\/\//i.test(value) ? value : `https://${network}/${value.replace(/^@/, "")}`;

export function CatalogHeader({ store, wholesale, cartCount, onShare, onCart }: Props) {
  const brand = store.brandColor || "#111111";
  const description = store.description || store.address;
  const contacts = [
    { value: store.whatsapp, label: "WhatsApp", icon: "fa-brands fa-whatsapp", href: `https://wa.me/${String(store.whatsapp || "").replace(/\D/g, "")}` },
    { value: store.instagram, label: "Instagram", icon: "fa-brands fa-instagram", href: socialUrl("instagram.com", store.instagram || "") },
    { value: store.facebook, label: "Facebook", icon: "fa-brands fa-facebook", href: socialUrl("facebook.com", store.facebook || "") },
    { value: store.email, label: "Correo", icon: "fa-regular fa-envelope", href: `mailto:${store.email}` },
    { value: store.phone, label: "Llamar", icon: "fa-solid fa-phone", href: `tel:${store.phone}` },
  ].filter(contact => contact.value);

  return (
    <header className="catalog-header" style={{ "--catalog-brand": brand } as React.CSSProperties}>
      <div className="catalog-header__cover">
        {store.bannerUrl ? <img src={store.bannerUrl} alt="" className="catalog-header__banner" /> : null}
        <div className="catalog-header__shade" />
        <div className="catalog-header__cover-inner">
          <span className="catalog-header__eyebrow"><span /> {wholesale ? "Catálogo mayorista" : "Catálogo digital"}</span>
          <button type="button" onClick={onShare} className="catalog-header__share" aria-label="Compartir catálogo" title="Compartir catálogo">
            <i className="fa-solid fa-share-nodes" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="catalog-header__shell">
        <div className="catalog-header__panel">
          <div className="catalog-header__identity">
            <div className="catalog-header__logo">
              {store.logoUrl
                ? <img src={store.logoUrl} alt={`Logo de ${store.name}`} />
                : <span>{(store.name || "T").trim().slice(0, 1).toUpperCase()}</span>}
            </div>
            <span className={`catalog-header__status ${store.isActive ? "is-open" : "is-closed"}`}>
              <span /> {store.isActive ? "Abierto" : "Cerrado en este momento"}
            </span>
          </div>

          <div className="catalog-header__body">
            <div className="catalog-header__intro">
              <h1>{store.name}</h1>
              {description ? <p>{description}</p> : null}
            </div>
            <button type="button" onClick={onCart} className="catalog-header__cart">
              <i className="fa-solid fa-bag-shopping" aria-hidden="true" />
              <span>Ver mi carrito</span>
              <span className="catalog-header__count">{cartCount}</span>
            </button>
          </div>

          {contacts.length > 0 || store.location ? (
            <div className="catalog-header__footer">
              {contacts.length > 0 ? (
                <nav className="catalog-header__contacts" aria-label="Contactar a la tienda">
                  {contacts.map(contact => (
                    <a key={contact.label} href={contact.href} target={contact.href.startsWith("https:") ? "_blank" : undefined} rel={contact.href.startsWith("https:") ? "noopener noreferrer" : undefined} title={contact.label}>
                      <i className={contact.icon} aria-hidden="true" />
                      <span>{contact.label}</span>
                    </a>
                  ))}
                </nav>
              ) : null}
              {store.location ? <p className="catalog-header__location"><i className="fa-solid fa-location-dot" aria-hidden="true" />{store.location}</p> : null}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
