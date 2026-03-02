const DB_NAME = "pricewriter_offline";
const DB_VERSION = 2; // bump version to rebuild schema

export function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;

      // Rebuild stores to avoid issues where ItemID isn't globally unique
      if (db.objectStoreNames.contains("items")) db.deleteObjectStore("items");
      if (db.objectStoreNames.contains("meta")) db.deleteObjectStore("meta");

      const store = db.createObjectStore("items", { keyPath: "_pk" });
      store.createIndex("bySupplier", "SupplierName", { unique: false });
      store.createIndex("byRange", "Range", { unique: false });
      store.createIndex("bySupplierRange", ["SupplierName","Range"], { unique: false });

      db.createObjectStore("meta", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getMeta(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("meta", "readonly");
    const req = tx.objectStore("meta").get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : null);
    req.onerror = () => reject(req.error);
  });
}

export async function setMeta(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("meta", "readwrite");
    tx.objectStore("meta").put({ key, value });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAll(db){
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(["items","meta"],"readwrite");
    tx.objectStore("items").clear();
    tx.objectStore("meta").clear();
    tx.oncomplete=()=>resolve(true);
    tx.onerror=()=>reject(tx.error);
  });
}

export async function bulkPutItems(db, items){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("items","readwrite");
    const store=tx.objectStore("items");
    for(const it of items){
      if (!it._pk) continue;
      store.put(it);
    }
    tx.oncomplete=()=>resolve(true);
    tx.onerror=()=>reject(tx.error);
  });
}

export async function countItems(db){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("items","readonly");
    const req=tx.objectStore("items").count();
    req.onsuccess=()=>resolve(req.result||0);
    req.onerror=()=>reject(req.error);
  });
}

export async function getItem(db, pk){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("items","readonly");
    const req=tx.objectStore("items").get(pk);
    req.onsuccess=()=>resolve(req.result||null);
    req.onerror=()=>reject(req.error);
  });
}

export async function listBySupplierRange(db, supplierName, rangeValue, limit=5000){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("items","readonly");
    const idx=tx.objectStore("items").index("bySupplierRange");
    const keyRange = IDBKeyRange.only([supplierName, rangeValue]);
    const out=[];
    idx.openCursor(keyRange).onsuccess=(e)=>{
      const cur=e.target.result;
      if(cur){
        out.push(cur.value);
        if(out.length>=limit){ resolve(out); return; }
        cur.continue();
      }else{
        resolve(out);
      }
    };
    tx.onerror=()=>reject(tx.error);
  });
}

export async function listBySupplier(db, supplierName, limit=5000){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("items","readonly");
    const idx=tx.objectStore("items").index("bySupplier");
    const keyRange = IDBKeyRange.only(supplierName);
    const out=[];
    idx.openCursor(keyRange).onsuccess=(e)=>{
      const cur=e.target.result;
      if(cur){
        out.push(cur.value);
        if(out.length>=limit){ resolve(out); return; }
        cur.continue();
      }else{
        resolve(out);
      }
    };
    tx.onerror=()=>reject(tx.error);
  });
}
