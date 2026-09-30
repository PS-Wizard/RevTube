const CONFIG_VERSION_DOC = "config/version";

async function getConfigVersion(db) {
  try {
    const doc = await db.collection(CONFIG_VERSION_DOC).get();
    return doc.exists ? doc.data().version || 0 : 0;
  } catch {
    return 0;
  }
}

async function bumpConfigVersion(db) {
  try {
    const current = await getConfigVersion(db);
    await db.collection(CONFIG_VERSION_DOC).set({ version: current + 1 });
    return current + 1;
  } catch {
    return null;
  }
}

module.exports = { getConfigVersion, bumpConfigVersion };
