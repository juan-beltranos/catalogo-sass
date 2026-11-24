import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import * as XLSX from "xlsx";
import ts from "typescript";

// Exercise the actual migration against PostgreSQL, without touching production data.
const db = new PGlite();
const id = () => crypto.randomUUID();
const store = id(), owner = id(), product = id(), variantProduct = id(), variant = id(), kit = id();
let passed = 0;
const check = (name, fn) => Promise.resolve().then(fn).then(() => { passed++; console.log(`PASS ${name}`); });
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const stock = (pid = product) => scalar("select stock from products where id=$1", [pid]);
const item = (pid, quantity, vid = null) => ({ product_id: pid, variant_id: vid, quantity, title: "Producto", unit_price: 100, total: 100 * quantity });
const order = (oid = id()) => ({ id: oid, customer_name: "Cliente", customer_phone: "3001234567", address: "Prueba",
  customer_fields: [], shipping_cost: 0, original_subtotal: 100, discount: 0, subtotal: 100, total: 100 });
const place = (items, row = order(), coupon = null) => db.query("select place_order_with_inventory($1,$2,$3,'[]',$4)", [store, row, items, coupon]).then(() => row.id);
const status = (oid, value) => db.query("update orders set status=$2::order_status where id=$1", [oid, value]);

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    create type discount_type as enum ('percent','fixed','amount');
    create type order_status as enum ('new','confirmed','preparing','delivered','cancelled');
    create table stores(id uuid primary key,owner_id uuid,status text default 'active');
    create table categories(id uuid primary key,store_id uuid,name text);
    create table products(id uuid primary key default gen_random_uuid(),store_id uuid references stores(id) on delete cascade,
      category_id uuid,category_ids uuid[] default '{}',name text,sku text,description text,base_price numeric,wholesale_price numeric,
      discount_type discount_type,discount_value numeric,is_active boolean default true,allow_cash_on_delivery boolean default true,
      stock integer default 0,sort_order integer default 0,created_at timestamptz default now(),updated_at timestamptz default now());
    create table product_variants(id uuid primary key default gen_random_uuid(),product_id uuid references products(id),store_id uuid,
      title text,sku text,price numeric,stock integer default 0,option_values jsonb,created_at timestamptz,updated_at timestamptz);
    create table product_images(id uuid default gen_random_uuid(),product_id uuid,store_id uuid,url text,r2_key text,sort_order int,created_at timestamptz);
    create table product_videos(like product_images);
    create table product_options(product_id uuid,store_id uuid,name text,values jsonb,sort_order int);
    create table clients(id uuid primary key default gen_random_uuid(),store_id uuid,name text,phone text,address text,custom_fields jsonb,
      orders_count int default 0,total_spent numeric default 0,last_order_at timestamptz,created_at timestamptz,updated_at timestamptz);
    create unique index clients_store_phone_unique on clients(store_id,phone) where nullif(phone,'') is not null;
    create table orders(id uuid primary key,store_id uuid,client_id uuid,status order_status,source text,customer_name text,customer_phone text,
      address text,delivery_method text,shipping_cost numeric,original_subtotal bigint,discount bigint,subtotal numeric,total numeric,
      applied_rules jsonb,notes text,created_at timestamptz default now(),updated_at timestamptz default now());
    create table product_kits(id uuid primary key,store_id uuid,name text,price numeric,active boolean default true);
    create table product_kit_items(kit_id uuid,store_id uuid,product_id uuid,quantity int);
    create table order_items(id uuid primary key default gen_random_uuid(),order_id uuid references orders(id) on delete cascade,store_id uuid,
      product_id uuid,kit_id uuid,variant_id uuid,title text,sku text,quantity int,unit_price numeric,total numeric);
    create table order_custom_fields(order_id uuid references orders(id) on delete cascade,store_id uuid,field_key text,label text,value text);
    create table coupons(id uuid primary key,store_id uuid,active boolean default true,used_count int default 0,usage_limit int,updated_at timestamptz);
  `);
  await db.query("insert into stores(id,owner_id) values($1,$2)", [store, owner]);
  await db.query("insert into products(id,store_id,name,base_price,stock) values($1,$3,'Simple',100,10),($2,$3,'Variantes',100,0)", [product, variantProduct, store]);
  await db.query("insert into product_variants(id,product_id,store_id,title,stock) values($1,$2,$3,'Rojo',5)", [variant, variantProduct, store]);
  await db.exec(await fs.readFile(new URL("../supabase/migrations/20261123135050_unified_product_inventory.sql", import.meta.url), "utf8"));
  await db.exec(await fs.readFile(new URL("../supabase/migrations/20261123203000_scale_product_variant_sync.sql", import.meta.url), "utf8"));
  await db.exec("grant usage on schema public,auth to service_role; grant all on all tables in schema public to service_role;");
  await check("migración activa inventarios existentes con unidades", async () => {
    assert.equal(await scalar("select count(*)::int from products where track_stock"), 2);
  });
  await db.exec("set role service_role");
  const first = await place([item(product, 3)]);
  await check("venta descuenta stock y registra cliente una sola vez", async () => {
    assert.equal(await stock(), 7); assert.equal(await scalar("select orders_count from clients"), 1);
  });
  await place([item(product, 3)], order(first));
  await check("reintento es idempotente", async () => { assert.equal(await stock(), 7); assert.equal(await scalar("select orders_count from clients"), 1); });
  await check("insuficiencia revierte todo el pedido", async () => {
    await assert.rejects(place([item(product, 8)]), /Stock insuficiente/);
    assert.equal(await stock(), 7); assert.equal(await scalar("select count(*)::int from orders"), 1);
  });
  await check("líneas duplicadas se validan sumadas", async () => {
    await assert.rejects(place([item(product, 4), item(product, 4)]), /Stock insuficiente/); assert.equal(await stock(), 7);
  });
  await check("fallo tardío revierte inventario, pedido y cliente", async () => {
    await assert.rejects(place([item(product, 1)], order(), id()), /Cupón/);
    assert.equal(await stock(), 7); assert.equal(await scalar("select orders_count from clients"), 1);
  });
  await status(first, "cancelled"); await status(first, "cancelled");
  await check("cancelación repone una sola vez", async () => assert.equal(await stock(), 10));
  await status(first, "confirmed"); await status(first, "delivered");
  await check("reactivación descuenta; entrega no duplica", async () => assert.equal(await stock(), 7));
  await db.query("update products set stock=1 where id=$1", [product]);
  await status(first, "cancelled");
  await db.query("update products set stock=0 where id=$1", [product]);
  await check("reactivación sin existencias conserva estado cancelado", async () => {
    await assert.rejects(status(first, "confirmed"), /Stock insuficiente/);
    assert.equal(await scalar("select status::text from orders where id=$1", [first]), "cancelled");
  });
  await check("agotado no se interpreta como ilimitado", async () => { await assert.rejects(place([item(product, 1)]), /Stock insuficiente/); });
  await db.query("update products set track_stock=false where id=$1", [product]);
  const unlimited = await place([item(product, 100)]);
  await status(unlimited, "cancelled");
  await check("sin control permite venta y no inventa stock al cancelar", async () => assert.equal(await stock(), 0));
  const variantOrder = await place([item(variantProduct, 2, variant)]);
  await check("variante descuenta su propio stock", async () => {
    assert.equal(await scalar("select stock from product_variants where id=$1", [variant]), 3); assert.equal(await stock(variantProduct), 0);
  });
  await check("no permite omitir variante", async () => { await assert.rejects(place([item(variantProduct, 1)]), /Selecciona una variante/); });
  await check("variante ajena no permite venta", async () => { await assert.rejects(place([item(product, 1, variant)]), /Variante no disponible/); });
  await db.query("insert into product_kits values($1,$2,'Kit',100,true)", [kit, store]);
  await db.query("insert into product_kit_items values($1,$2,$3,2)", [kit, store, product]);
  await db.query("update products set stock=10,track_stock=true where id=$1", [product]);
  const kitOrder = await place([{ kit_id: kit, quantity: 2, unit_price: 100, total: 200 }]);
  await check("kit descuenta unidades de sus componentes", async () => assert.equal(await stock(), 6));
  await db.query("update product_kit_items set quantity=9 where kit_id=$1", [kit]);
  await status(kitOrder, "cancelled");
  await check("cancelación de kit respeta componentes originales", async () => assert.equal(await stock(), 10));
  await check("kit y producto directo comparten disponibilidad", async () => {
    await assert.rejects(place([{kit_id:kit,quantity:1,unit_price:100,total:100},item(product,2)]), /Stock insuficiente/);
    assert.equal(await stock(),10);
  });
  await check("cantidades inválidas rechazadas", async () => { for(const qty of [0,-1,1.5]) await assert.rejects(place([item(product,qty)]), /Cantidad inválida/); });
  await db.query("delete from orders where id=$1", [variantOrder]);
  await check("eliminar pedido activo devuelve inventario", async () => assert.equal(await scalar("select stock from product_variants where id=$1", [variant]),5));
  await db.exec("reset role");
  await db.query("select set_config('test.uid',$1,false)", [owner]);
  const expected = { stock: 0, trackStock: true, variants: [{ id: variant, stock: 5 }] };
  const saveProduct = (p) => db.query("select save_product_full($1,$2,$3,'[]','[]','[]',$4)", [variantProduct,store,p,p.variants]);
  await saveProduct({name:"Editado",price:100,stock:0,trackStock:true,expectedInventory:expected,variants:[{id:variant,title:"Rojo",price:100,stock:5}]});
  await check("edición conserva identificador de variante", async () => assert.equal(await scalar("select id::text from product_variants"),variant));
  const manyVariants = Array.from({length: 500}, (_, index) => ({title:`Variante ${index + 1}`,price:100 + index,stock:index,optionValues:[String(index + 1)]}));
  await db.query("select sync_product_children($1,$2,null,null,null,$3)", [variantProduct,store,manyVariants]);
  await check("sincroniza cientos de variantes en una operacion", async () => {
    assert.equal(await scalar("select count(*)::int from product_variants where product_id=$1", [variantProduct]), 500);
  });
  await db.query("select sync_product_children($1,$2,null,null,null,$3)", [variantProduct,store,[{id:variant,title:"Rojo",price:100,stock:5}]]);
  await place([item(variantProduct,1,variant)]);
  await check("formulario obsoleto no sobrescribe unidades vendidas", async () => {
    await assert.rejects(saveProduct({name:"Obsoleto",price:100,stock:0,trackStock:true,expectedInventory:expected,variants:[{id:variant,title:"Rojo",price:100,stock:5}]}), /inventario cambió/);
    assert.equal(await scalar("select stock from product_variants where id=$1",[variant]),4);
  });
  await db.query("update products set stock=1 where id=$1",[product]);
  const competing=await Promise.allSettled([place([item(product,1)]),place([item(product,1)])]);
  await check("dos ventas de la última unidad: solo una aceptada",async()=>{
    assert.equal(competing.filter(x=>x.status==='fulfilled').length,1); assert.equal(await stock(),0);
  });
  await db.exec("set role anon");
  await check("visitante no puede ejecutar RPC ni alterar movimientos",async()=>{
    await assert.rejects(place([item(product,1)]),/permission denied/);
    await assert.rejects(db.query('select * from order_inventory'),/permission denied/);
  });
  await db.exec("reset role");
  const source=await fs.readFile(new URL('../helpers/inventory.ts',import.meta.url),'utf8');
  const helper=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText).toString('base64'));
  await check("Excel conserva 0 y rechaza fracciones, negativos y desbordes",()=>{
    assert.equal(helper.parseStock('0'),0); assert.equal(helper.parseStock('10'),10);
    for(const value of ['',-1,1.2,'abc','1,5',2147483648]) assert.throws(()=>helper.parseStock(value));
    assert.equal(helper.availableStock({trackStock:true,stock:0}),0);
    assert.equal(helper.availableStock({trackStock:false,stock:0}),undefined);
  });
  await check("exportación XLSX e importación conservan inventario y protección ante ventas",()=>{
    const original={stock:0,trackStock:true,variants:[{id:variant,stock:4}]};
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet([helper.exportInventoryFields(original)]),'Productos');
    const restored=XLSX.read(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});
    const row=XLSX.utils.sheet_to_json(restored.Sheets.Productos,{defval:''})[0];
    const parsed=helper.parseInventoryFields(row);
    assert.equal(parsed.stock,0); assert.equal(parsed.trackStock,true);
    assert.deepEqual(parsed.expectedInventory,helper.inventorySnapshot(original));
    assert.equal(helper.parseInventoryFields({Stock:'', 'Controlar stock':''}).stock,undefined);
    assert.equal(helper.parseInventoryFields({Stock:0}).trackStock,true);
    assert.equal(helper.parseInventoryFields({Stock:5,'Controlar stock':'No'}).trackStock,false);
    assert.throws(()=>helper.parseInventoryFields({'Controlar stock':'quizás'}));
  });
  await check("reactiva productos ocultos con inventario real, con y sin control y con variantes", async () => {
    for (const tracked of [false, true]) {
      for (const pid of [product, variantProduct]) {
        await db.query("update products set is_active=false,stock=7,track_stock=$2 where id=$1", [pid, tracked]);
        const row = (await db.query(`select p.*, coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'stock',v.stock))
          from product_variants v where v.product_id=p.id),'[]') as product_variants from products p where p.id=$1`, [pid])).rows[0];
        const adminInventory = helper.syncedInventory(row, false);
        assert.equal(adminInventory.stock, 7);
        assert.equal(adminInventory.trackStock, tracked);
        const publicInventory = helper.syncedInventory(row);
        assert.equal(publicInventory.stock, 0);
        assert.equal(publicInventory.trackStock, true);
        const variants = row.product_variants.map(v => ({id:v.id,stock:adminInventory.variants.get(v.id),title:'Rojo',price:100}));
        const snapshot = helper.inventorySnapshot({...adminInventory, variants});
        await db.query("select save_product_full($1,$2,$3,'[]','[]','[]',$4)", [pid,store,
          {name:'Visible nuevamente',price:100,isActive:true,stock:adminInventory.stock,trackStock:tracked,expectedInventory:snapshot},variants]);
        assert.equal(await scalar("select is_active from products where id=$1",[pid]),true);
        assert.equal(await stock(pid),7);
        if (variants.length) {
          assert.equal(variants[0].stock,4);
          assert.equal(publicInventory.variants.get(variants[0].id),0);
        }
      }
    }
  });
  console.log(`${passed} comprobaciones correctas.`);
} finally { await db.close(); }
