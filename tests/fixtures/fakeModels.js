// tests/fixtures/fakeModels.js
// In-memory Mongoose-model fakes for the Phase 4 learning tests (and future
// suites that exercise Mongoose-backed routes without a database).
//
// All models created with makeFakeModel() share ONE document store keyed by
// model name and reachable via getFakeDocs(name) — reset per test with
// resetFakeStore(). The supported operation surface mirrors exactly what the
// learning controllers use: findOne / find().sort().toArray() / findById /
// create / updateOne($set,$push,$addToSet,$pull,$inc) / countDocuments /
// findOneAndUpdate(upsert). Filter values are compared with String() equality
// whenever either side is an object — so ObjectId vs "hex string" matches.

import { vi } from "vitest";
import { ObjectId } from "mongodb";

export function resetFakeStore() {
  globalThis.__fakeModelStore = {};
}

export function getFakeDocs(name) {
  const store = globalThis.__fakeModelStore || (globalThis.__fakeModelStore = {});
  if (!store[name]) store[name] = [];
  return store[name];
}

function valueEquals(a, b) {
  const aObj = a !== null && typeof a === "object";
  const bObj = b !== null && typeof b === "object";
  if (aObj || bObj) return String(a) === String(b);
  return a === b;
}

function matches(doc, filter = {}) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === "$or") return value.some((sub) => matches(doc, sub));
    if (key === "$and") return value.every((sub) => matches(doc, sub));

    const fieldVal = doc[key];

    const testOne = (v) => {
      if (v instanceof RegExp) {
        if (Array.isArray(fieldVal)) return fieldVal.some((el) => v.test(String(el ?? "")));
        return v.test(String(fieldVal ?? ""));
      }
      return valueEquals(fieldVal, v);
    };

    if (value instanceof RegExp) return testOne(value);

    if (value && typeof value === "object" && !Array.isArray(value) && value.$in) {
      return value.$in.some(testOne);
    }
    if (value && typeof value === "object" && !Array.isArray(value) && value.$nin) {
      return !value.$nin.some(testOne);
    }
    return valueEquals(fieldVal, value);
  });
}

function setPath(doc, path, value) {
  const parts = String(path).split(".");
  let target = doc;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (target[parts[i]] === null || target[parts[i]] === undefined) target[parts[i]] = {};
    target = target[parts[i]];
  }
  target[parts[parts.length - 1]] = value;
}

function applyUpdate(doc, update = {}) {
  // Plain (operator-less) updates behave like Mongoose: wrap in $set.
  if (!Object.keys(update).some((k) => k.startsWith("$"))) {
    for (const [key, value] of Object.entries(update)) setPath(doc, key, value);
    return;
  }
  if (update.$set) {
    for (const [key, value] of Object.entries(update.$set)) setPath(doc, key, value);
  }
  if (update.$push) {
    for (const [key, value] of Object.entries(update.$push)) {
      if (!Array.isArray(doc[key])) doc[key] = [];
      if (value && typeof value === "object" && Array.isArray(value.$each)) doc[key].push(...value.$each);
      else doc[key].push(value);
    }
  }
  if (update.$addToSet) {
    for (const [key, value] of Object.entries(update.$addToSet)) {
      if (!Array.isArray(doc[key])) doc[key] = [];
      if (!doc[key].some((item) => valueEquals(item, value))) doc[key].push(value);
    }
  }
  if (update.$pull) {
    for (const [key, condition] of Object.entries(update.$pull)) {
      doc[key] = (doc[key] || []).filter((item) => !valueEquals(item, condition));
    }
  }
  if (update.$inc) {
    for (const [key, value] of Object.entries(update.$inc)) {
      doc[key] = (Number(doc[key]) || 0) + value;
    }
  }
  if (update.$setOnInsert) {
    for (const [key, value] of Object.entries(update.$setOnInsert)) {
      if (doc[key] === undefined) setPath(doc, key, value);
    }
  }
}

function applySort(arr, spec) {
  const entries = Object.entries(spec || {});
  if (entries.length === 0) return arr;
  return [...arr].sort((a, b) => {
    for (const [key, dir] of entries) {
      const rawA = a[key];
      const rawB = b[key];
      if (rawA === rawB) continue;
      if (rawA === undefined || rawA === null) return 1;
      if (rawB === undefined || rawB === null) return -1;
      // Dates (and date-like strings) compare chronologically — String(Date)
      // would sort by weekday name, which is wrong.
      const av = rawA instanceof Date ? rawA.getTime() : rawA;
      const bv = rawB instanceof Date ? rawB.getTime() : rawB;
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av) < String(bv)
            ? -1
            : 1;
      return dir < 0 ? -cmp : cmp;
    }
    return 0;
  });
}

function insertDoc(name, data = {}) {
  const doc = { ...data };
  if (!doc._id) doc._id = new ObjectId();
  if (!doc.createdAt) doc.createdAt = new Date();
  doc.updatedAt = new Date();
  getFakeDocs(name).push(doc);
  return doc;
}

/**
 * Chainable query object: sort/skip/limit/select/project/lean compose in call
 * order; awaiting it (or calling toArray/exec) resolves the items. `catch` is
 * provided so `Model.find().lean().catch(fn)` works like a real promise chain.
 */
function chainQuery(getItems) {
  const state = { items: null, offset: 0, cap: Infinity };
  const lazy = () => {
    if (state.items === null) state.items = getItems();
    return state.items;
  };
  const obj = {
    sort(spec) {
      state.items = applySort(lazy(), spec);
      return obj;
    },
    skip(n) {
      lazy();
      state.offset = n || 0;
      return obj;
    },
    limit(n) {
      lazy();
      state.cap = n ?? Infinity;
      return obj;
    },
    select() {
      return obj;
    },
    project() {
      return obj;
    },
    lean() {
      return obj;
    },
    exec() {
      return obj.toArray();
    },
    toArray() {
      return Promise.resolve(lazy().slice(state.offset, state.offset + state.cap));
    },
    then(onF, onR) {
      return obj.toArray().then(onF, onR);
    },
    catch(onR) {
      return obj.toArray().catch(onR);
    },
  };
  return obj;
}

/** In-memory stand-in for one Mongoose model. */
export function makeFakeModel(name) {
  const model = vi.fn((data) => Promise.resolve(insertDoc(name, data)));

  model.findOne = vi.fn((filter = {}) => {
    const exec = async () => getFakeDocs(name).find((d) => matches(d, filter)) ?? null;
    // Thenable + chainable so both `await Model.findOne(f)` and
    // `await Model.findOne(f).lean()` / `.select().lean()` behave.
    const q = {
      select: () => q,
      lean: () => q,
      sort: () => q,
      exec,
      then: (onF, onR) => exec().then(onF, onR),
      catch: (onR) => exec().catch(onR),
    };
    return q;
  });

  model.find = vi.fn((filter = {}) =>
    chainQuery(() => getFakeDocs(name).filter((d) => matches(d, filter))),
  );

  model.findById = vi.fn(async (id) => getFakeDocs(name).find((d) => String(d._id) === String(id)) ?? null);

  model.create = vi.fn(async (data) => insertDoc(name, data));

  // Minimal aggregation: supports [{$match}, {$group:{_id, field:{$sum:"$path"}}}]
  // — exactly what services/creditService.js uses for balance sums.
  model.aggregate = vi.fn((pipeline = []) => {
    const exec = async () => {
      let rows = [...getFakeDocs(name)];
      for (const stage of pipeline) {
        if (stage.$match) rows = rows.filter((d) => matches(d, stage.$match));
        if (stage.$group) {
          const accSpec = { ...stage.$group };
          delete accSpec._id;
          const row = {};
          if (typeof stage.$group._id === "string") row._id = stage.$group._id;
          else row._id = null;
          for (const [field, spec] of Object.entries(accSpec)) {
            if (spec && typeof spec === "object" && spec.$sum !== undefined) {
              const path = String(spec.$sum).replace(/^\$/, "");
              row[field] = rows.reduce((sum, d) => sum + (Number(d[path]) || 0), 0);
            }
          }
          rows = [row];
        }
      }
      return rows;
    };
    return { exec, toArray: exec, then: (a, b) => exec().then(a, b), catch: (r) => exec().catch(r) };
  });

  model.updateOne = vi.fn(async (filter = {}, update = {}, opts = {}) => {
    const doc = getFakeDocs(name).find((d) => matches(d, filter));
    if (!doc) {
      if (!opts.upsert) return { matchedCount: 0, modifiedCount: 0 };
      const inserted = insertDoc(name, {});
      applyUpdate(inserted, update);
      return { matchedCount: 1, modifiedCount: 1, upsertedId: inserted._id };
    }
    applyUpdate(doc, update);
    doc.updatedAt = new Date();
    return { matchedCount: 1, modifiedCount: 1 };
  });

  model.countDocuments = vi.fn(async (filter = {}) => getFakeDocs(name).filter((d) => matches(d, filter)).length);

  model.findOneAndUpdate = vi.fn(async (filter = {}, update = {}, opts = {}) => {
    const doc = getFakeDocs(name).find((d) => matches(d, filter));
    if (!doc) {
      if (!opts.upsert) return null;
      const inserted = insertDoc(name, {});
      applyUpdate(inserted, update);
      return opts.new === false ? null : inserted;
    }
    applyUpdate(doc, update);
    return opts.new === false ? null : doc;
  });

  return model;
}

/**
 * Raw-driver-style db for config/db.js's getDB() — serves the SAME store so
 * middleware that reads users via the driver (verifyToken) sees the docs the
 * Mongoose User fake wrote.
 */
export function makeFakeRawDb() {
  return {
    collection: (name) => ({
      findOne: async (filter = {}) => getFakeDocs(name).find((d) => matches(d, filter)) ?? null,
      find: (filter = {}) =>
        chainQuery(() => getFakeDocs(name).filter((d) => matches(d, filter))),
      insertOne: async (doc) => {
        const inserted = insertDoc(name, doc);
        return { acknowledged: true, insertedId: inserted._id };
      },
      updateOne: async (filter = {}, update = {}) => {
        const doc = getFakeDocs(name).find((d) => matches(d, filter));
        if (!doc) return { matchedCount: 0, modifiedCount: 0 };
        applyUpdate(doc, update);
        return { matchedCount: 1, modifiedCount: 1 };
      },
      deleteOne: async (filter = {}) => {
        const docs = getFakeDocs(name);
        const idx = docs.findIndex((d) => matches(d, filter));
        if (idx < 0) return { deletedCount: 0 };
        docs.splice(idx, 1);
        return { deletedCount: 1 };
      },
      countDocuments: async (filter = {}) => getFakeDocs(name).filter((d) => matches(d, filter)).length,
    }),
  };
}
