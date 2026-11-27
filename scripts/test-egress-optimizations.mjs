import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// No credentials, HTTP or hosted database: execute production modules with local doubles.
function loadModule(path, imports = {}) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8")
    .replaceAll("import.meta.env", "({})");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports, console, crypto, setTimeout,
    require(name) {
      if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
      return imports[name];
    },
  });
  return exports;
}
const plain = (value) => JSON.parse(JSON.stringify(value));
const { AsyncReadCache } = loadModule("../lib/asyncReadCache.ts");
const cache = new AsyncReadCache();
let calls = 0, finish;
const first = cache.getOrLoad("a", () => { calls++; return new Promise(resolve => { finish = resolve; }); });
const second = cache.getOrLoad("a", () => { throw new Error("Duplicate request"); });
assert.equal(first, second);
await Promise.resolve();
assert.equal(calls, 1);
finish(["result"]);
assert.equal(await first, await second);
assert.equal(await cache.getOrLoad("a", () => { throw new Error("Cache miss"); }), cache.get("a"));
await assert.rejects(cache.getOrLoad("failure", async () => { throw new Error("offline"); }));
assert.equal(await cache.getOrLoad("failure", async () => "recovered"), "recovered");
let finishOld;
const old = cache.getOrLoad("b", () => new Promise(resolve => { finishOld = resolve; }));
await Promise.resolve();
cache.delete("b");
await cache.getOrLoad("b", async () => "fresh");
finishOld("stale");
await old;
assert.equal(cache.get("b"), "fresh");
let finishUpdated;
const updating = cache.getOrLoad("c", () => new Promise(resolve => { finishUpdated = resolve; }));
await Promise.resolve();
cache.set("c", "inventory update");
finishUpdated("old inventory");
await updating;
assert.equal(cache.get("c"), "inventory update");
assert.equal(await cache.getOrLoad("another-store", async () => "separate"), "separate");
console.log("PASS concurrent reads, retries, invalidation, inventory updates and store isolation");

const queries = [];
const tables = {};
const client = {
  from(table) {
    const entry = { table, filters: [], orders: [], columns: "*" };
    queries.push(entry);
    const chain = {
      select(columns) { entry.columns = columns; return chain; },
      eq(field, value) { entry.filters.push(row => row[field] === value); return chain; },
      in(field, values) { entry.filters.push(row => values.includes(row[field])); return chain; },
      order(field, options = {}) { entry.orders.push([field, options.ascending !== false]); return chain; },
      range(from, to) { entry.range = [from, to]; return chain; },
      limit(value) { entry.limit = value; return chain; },
      then(resolve, reject) {
        let data = (tables[table] ?? []).filter(row => entry.filters.every(filter => filter(row)));
        data = [...data].sort((a, b) => {
          for (const [field, asc] of entry.orders) {
            if (a[field] !== b[field]) return (a[field] > b[field] ? 1 : -1) * (asc ? 1 : -1);
          }
          return 0;
        });
        if (entry.range) data = data.slice(entry.range[0], entry.range[1] + 1);
        if (entry.limit !== undefined) data = data.slice(0, entry.limit);
        data = data.slice(0, 1000).map(row => entry.columns === "*" ? { ...row }
          : Object.fromEntries(entry.columns.split(",").map(key => [key, row[key]])));
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return chain;
  },
};
const adapter = loadModule("../lib/supabaseFirestore.ts", { "./supabase": { supabase: client } });
const { collection, query, where, orderBy, limit, offset, getDocs } = adapter;
tables.products = [{ id: "product", store_id: "shop", name: "Café", base_price: 200, is_active: true },
  { id: "hidden", store_id: "shop", name: "Hidden", is_active: false },
  { id: "other", store_id: "other-shop", name: "Other", is_active: true }];
tables.product_images = [{ id: "image", product_id: "product", url: "https://example.test/image", r2_key: "media/key", sort_order: 1, unused_large_field: "x".repeat(5000) }];
tables.product_videos = [{ id: "video", product_id: "product", url: "https://example.test/video", r2_key: "media/video", sort_order: 1 }];
tables.product_options = [{ id: "option", product_id: "product", name: "Color", values: ["Rojo"], sort_order: 1 }];
tables.product_variants = Array.from({ length: 1205 }, (_, index) => ({
  id: `v${String(index).padStart(4, "0")}`, product_id: "product", title: "Rojo", sku: `SKU${index}`,
  price: index, stock: index, option_values: ["Rojo"], created_at: "2026-11-27", unused: "unused",
}));
const products = await getDocs(query(collection(client, "stores", "shop", "products"), where("isActive", "==", true)));
assert.equal(products.size, 1);
const product = products.docs[0].data();
assert.deepEqual(plain(product.images), [{ url: "https://example.test/image", publicId: "media/key", path: "media/key" }]);
assert.deepEqual(plain(product.videos), [{ url: "https://example.test/video", path: "media/video" }]);
assert.deepEqual(plain(product.options), [{ id: "option", name: "Color", values: ["Rojo"] }]);
assert.equal(product.variants.length, 1205);
assert.equal(product.variants.at(-1).sku, "SKU1204");
assert.equal(product.variants.at(-1).stock, 1204);
assert.deepEqual(plain(product.variants.at(-1).optionValues), ["Rojo"]);
assert.ok(queries.filter(q => q.table.startsWith("product_")).every(q => q.columns !== "*"));
assert.equal(queries.filter(q => q.table === "product_variants").length, 2);
console.log("PASS public filtering, product/media/options contracts and more than 1000 variants");

const inventory = loadModule("../helpers/inventory.ts");
const merges = loadModule("../hooks/useInventorySync.ts", { react: {}, "../helpers/inventory": inventory });
const original = [{ id: "product", stock: 3, trackStock: true, variants: [{ id: "v", stock: 2 }], name: "Original" }];
const unchanged = new Map([["product", { stock: 3, trackStock: true, variants: new Map([["v", 2]]) }]]);
assert.equal(merges.mergeInventoryList(original, unchanged), original);
const changed = merges.mergeInventoryList(original, new Map([["product", { stock: 1, trackStock: false, variants: new Map([["v", 0]]) }]]));
assert.notEqual(changed, original);
assert.equal(changed[0].stock, 1);
assert.equal(changed[0].trackStock, false);
assert.equal(changed[0].variants[0].stock, 0);
assert.equal(changed[0].name, "Original");
assert.equal(original[0].stock, 3);
console.log("PASS unchanged inventory keeps references; actual changes update without mutating products");

// Render the actual OrdersView with a minimal hooks runtime and exercise its paginator.
let slots = [], hookIndex = 0, effects = [], dirty = false, tree;
const hooks = {
  createElement(type, props, ...children) { return { type, props: { ...props, children } }; },
  useState(initial) {
    const index = hookIndex++;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], value => {
      const next = typeof value === "function" ? value(slots[index]) : value;
      if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; }
    }];
  },
  useRef(initial) { const index = hookIndex++; return slots[index] ??= { current: initial }; },
  useMemo(fn) { hookIndex++; return fn(); },
  useEffect(fn, deps) {
    const index = hookIndex++, previous = slots[index];
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
      previous?.cleanup?.();
      const effect = { deps };
      slots[index] = effect;
      effects.push(() => { effect.cleanup = fn(); });
    }
  },
};
hooks.default = hooks;
const user = { uid: "owner" };
const paginator = () => null;
const OrdersView = loadModule("../views/admin/OrdersView.tsx", {
  react: hooks,
  "@/lib/supabaseFirestore": adapter,
  "@/lib/supabase": { db: client, supabase: client },
  "@/lib/storeLookup": { getStoreForOwner: async () => ({ id: "shop" }) },
  "../../context/AuthContext": { useAuth: () => ({ user }) },
  "@/helpers": { formatCOP: String, formatDate: String, waTo: String },
  "@/components/catalog/Paginator": { default: paginator },
}).default;
tables.orders = Array.from({ length: 25 }, (_, index) => ({
  id: String(index + 1).padStart(4, "0"), store_id: "shop", created_at: "2026-11-27",
  status: index < 15 ? "new" : "confirmed", customer_name: `Customer ${index}`, subtotal: 100, total: 100,
}));
tables.order_items = [{ id: "item", order_id: "0025", product_id: "product", title: "Product", quantity: 2, unit_price: 50, total: 100 }];
tables.order_custom_fields = [{ order_id: "0025", field_key: "note", label: "Note", value: "Keep me" }];
function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object") return [];
  return [node, ...nodes(node.props?.children)];
}
async function settle() {
  for (let i = 0; i < 80; i++) {
    if (i === 0 || dirty) {
      dirty = false; hookIndex = 0; tree = OrdersView();
      for (const effect of effects.splice(0)) effect();
    }
    await Promise.resolve();
  }
}
const pagination = () => nodes(tree).find(node => node.type === paginator).props;
await settle();
assert.equal(pagination().page, 1);
assert.equal(pagination().hasPrev, false);
await pagination().onNext(); await settle(); assert.equal(pagination().page, 2);
await pagination().onNext(); await settle(); assert.equal(pagination().page, 3);
assert.equal(pagination().hasNext, false);
await pagination().onPrev(); await settle(); assert.equal(pagination().page, 2);
await pagination().onPrev(); await settle(); assert.equal(pagination().page, 1);
const select = nodes(tree).find(node => node.type === "select" && node.props.value === "all");
select.props.onChange({ target: { value: "new" } });
await settle();
assert.equal(pagination().page, 1);
await pagination().onNext(); await settle();
assert.equal(pagination().page, 2);
assert.equal(pagination().hasNext, false);
const orderQueries = queries.filter(q => q.table === "orders");
assert.ok(orderQueries.every(q => q.range && q.range[1] - q.range[0] === 10));
assert.deepEqual(orderQueries.slice(0, 5).map(q => q.range[0]), [0, 10, 20, 10, 0]);
assert.ok(orderQueries.every(q => q.orders.some(([field]) => field === "id")));
console.log("PASS real orders paginator: next/previous/last page/status filter, bounded queries and tied dates");

// Run the production search callback/effect with controlled network and timers.
// Extract AST statements so the test exercises that workflow without unrelated UI/checkout effects.
const catalogSource = readFileSync(new URL("../views/public/CatalogView.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("CatalogView.tsx", catalogSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = ast.statements.filter(ts.isVariableStatement)
  .flatMap(statement => [...statement.declarationList.declarations])
  .find(declaration => declaration.name.getText(ast) === "CatalogView").initializer;
const searchCallback = component.body.statements.find(statement => ts.isVariableStatement(statement)
  && statement.declarationList.declarations.some(declaration => declaration.name.getText(ast) === "fetchSearchProducts"));
const searchEffect = component.body.statements.find(statement => ts.isExpressionStatement(statement)
  && statement.getText(ast).includes("void fetchSearchProducts(store.id"));
assert.ok(searchCallback && searchEffect);
const fixture = `import {useCallback,useEffect,useState,useRef} from 'react';
  export default function Search() {
    const {store, search, catalogUnavailableReason} = inputs;
    const isSearching = search.trim().length > 0;
    const [searchProducts, setSearchProducts] = useState([]);
    const [searchLoaded, setSearchLoaded] = useState(false);
    const [searchLoading, setSearchLoading] = useState(false);
    const [queryError, setQueryError] = useState(null);
    const storeIdRef = useRef(null);
    ${searchCallback.getText(ast)}
    ${searchEffect.getText(ast)}
    return {searchProducts,searchLoaded,searchLoading,queryError};
  }`;
hooks.useCallback = (fn, deps) => {
  const index = hookIndex++, previous = slots[index];
  if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) slots[index] = { deps, fn };
  return slots[index].fn;
};
for (const slot of slots) slot?.cleanup?.();
slots = []; effects = []; dirty = false;
let nextTimer = 0;
const timers = new Map();
const searchCache = new AsyncReadCache();
const inputs = { store: { id: "shop", commerceRules: {} }, search: "c", catalogUnavailableReason: null };
let searchReads = 0, releaseSearch;
const searchExports = {};
vm.runInNewContext(ts.transpileModule(fixture, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  exports: searchExports, require: () => hooks, inputs, console,
  searchProductsCache: searchCache, publicSupabase: client, collection, query, where,
  getDocs: async ref => { searchReads++; await new Promise(resolve => { releaseSearch = resolve; }); return getDocs(ref); },
  sortProducts: items => items,
  window: {
    setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
  },
});
async function settleSearch() {
  for (let i = 0; i < 60; i++) {
    if (i === 0 || dirty) {
      dirty = false; hookIndex = 0; tree = searchExports.default();
      for (const effect of effects.splice(0)) effect();
    }
    await Promise.resolve();
  }
}
async function runTimers() {
  for (const [id, fn] of [...timers]) { timers.delete(id); fn(); }
  await settleSearch();
}
await settleSearch();
inputs.search = "ca"; await settleSearch();
inputs.search = "caf"; await settleSearch();
assert.equal(searchReads, 0);
await runTimers(); assert.equal(searchReads, 1);
inputs.search = "café"; await settleSearch(); await runTimers();
assert.equal(searchReads, 1);
releaseSearch(); await settleSearch();
assert.equal(tree.searchLoaded, true);
assert.equal(tree.searchLoading, false);
assert.equal(tree.searchProducts.length, 1);
assert.equal(tree.searchProducts[0].name, "Café");
inputs.search = "SKU1204"; await settleSearch(); await runTimers();
assert.equal(searchReads, 1);
assert.equal(tree.searchProducts[0].variants.at(-1).sku, "SKU1204");
inputs.search = ""; await settleSearch();
assert.equal(tree.searchLoaded, false);
assert.equal(tree.searchProducts.length, 0);
searchCache.delete("shop");
inputs.search = "again"; await settleSearch(); await runTimers();
assert.equal(searchReads, 2);
inputs.search = ""; await settleSearch(); releaseSearch(); await settleSearch();
assert.equal(tree.searchProducts.length, 0);
assert.equal(tree.searchLoading, false);
console.log("PASS real public search: fast typing, pending read sharing, cached variants and late response after clearing");
