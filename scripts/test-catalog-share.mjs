import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Compile in memory so this check also works on Node versions without TS support.
const source = readFileSync(new URL("../server/catalogShare.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const { createRequire } = await import("node:module");
const compiled = { exports: {} };
new Function("require", "module", "exports", outputText)(createRequire(import.meta.url), compiled, compiled.exports);
const { buildCatalogShareHtml } = compiled.exports;

const id = "eaf646db-a06c-4840-b1a2-2cccd84614d4";
const store = { id: "store-1", name: "Mi tienda", slug: "tienda", status: "active", description: "Catalogo general", logo_url: "/logo.jpg" };
const product = { id, store_id: store.id, name: 'Cama & colchon "King"', description: "Descansa <bien>", is_active: true };
const nativeFetch = globalThis.fetch;
after(() => { globalThis.fetch = nativeFetch; });

async function preview({ query = "", products = [product], images = [], currentStore = store } = {}) {
  const requests = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const table = url.pathname.split("/").pop();
    requests.push(url);
    let rows = table === "stores" ? (currentStore ? [currentStore] : []) : table === "products" ? products : images;
    rows = rows.filter((row) => [...url.searchParams].every(([key, value]) => !value.startsWith("eq.") || String(row[key]) === value.slice(3)));
    if (url.searchParams.get("order") === "sort_order.asc") rows = [...rows].sort((a, b) => a.sort_order - b.sort_order);
    if (url.searchParams.has("limit")) rows = rows.slice(0, Number(url.searchParams.get("limit")));
    return new Response(JSON.stringify(rows), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const result = await buildCatalogShareHtml({ slug: "tienda", origin: "https://catalogo.example", query,
    env: { SUPABASE_URL: "https://database.example", SUPABASE_ANON_KEY: "test-key" } });
  return { ...result, requests };
}

test("product preview uses the first ordered image and escapes product metadata", async () => {
  const image = (url, sort_order) => ({ product_id: id, store_id: store.id, url, sort_order });
  const { html, status, requests } = await preview({ query: `?producto=${id}&mode=wholesale`, images: [image("/second.jpg", 1), image("https://images.example/first.jpg", 0)] });
  assert.equal(status, 200);
  assert.ok(html.includes('property="og:image" content="https://images.example/first.jpg"'));
  assert.ok(html.includes('property="og:title" content="Cama &amp; colchon &quot;King&quot;"'));
  assert.ok(html.includes('property="og:description" content="Descansa &lt;bien&gt;"'));
  assert.ok(html.includes(`property="og:url" content="https://catalogo.example/c/tienda?producto=${id}&amp;mode=wholesale"`));
  assert.ok(html.includes(`window.location.replace("/#/tienda?producto=${id}&mode=wholesale")`));
  assert.equal(requests[1].searchParams.get("store_id"), "eq.store-1");
  assert.equal(requests[1].searchParams.get("is_active"), "eq.true");
});

test("catalog links keep the store preview", async () => {
  const { html, requests } = await preview();
  assert.ok(html.includes('property="og:title" content="Mi tienda"'));
  assert.ok(html.includes('property="og:image" content="https://catalogo.example/logo.jpg"'));
  assert.equal(requests.length, 1);
});

test("products without photos retain the store image and product title", async () => {
  const { html } = await preview({ query: `?producto=${id}`, products: [{ ...product, description: null }] });
  assert.ok(html.includes('property="og:image" content="https://catalogo.example/logo.jpg"'));
  assert.ok(html.includes("Conoce Cama &amp; colchon"));
});

test("inactive, foreign, missing and invalid products never expose product metadata", async () => {
  for (const products of [[{ ...product, is_active: false }], [{ ...product, store_id: "other-store" }], []]) {
    const { html, requests } = await preview({ query: `?producto=${id}`, products });
    assert.ok(html.includes('property="og:title" content="Mi tienda"'));
    assert.equal(requests.length, 2);
  }
  const { html, requests } = await preview({ query: "?producto=invalid" });
  assert.ok(html.includes('property="og:title" content="Mi tienda"'));
  assert.equal(requests.length, 1);
});

test("unavailable stores do not query products", async () => {
  for (const currentStore of [null, { ...store, status: "inactive" }]) {
    const { status, requests } = await preview({ query: `?producto=${id}`, currentStore });
    assert.equal(status, 404);
    assert.equal(requests.length, 1);
  }
});

test("redirect query cannot terminate the script element", async () => {
  const { html } = await preview({ query: "?extra=</script><script>alert(1)</script>" });
  assert.equal((html.match(/<script>/g) || []).length, 1);
  assert.ok(html.includes("\\u003c/script>"));
});
