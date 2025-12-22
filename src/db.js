import { JSONFilePreset } from 'lowdb/node';
import CryptoJS from 'crypto-js';
import dotenv from 'dotenv';

import fs from 'fs';

dotenv.config();

// Ensure data directory exists
// Ensure data directory exists
if (!fs.existsSync('data')) {
  try {
    fs.mkdirSync('data', { recursive: true });
  } catch (err) {
    console.error('[FATAL] Could not create data directory:', err.message);
  }
}

// REMOVED old permission check block as it was somewhat redundant or verbose here, 
// and we want to keep the db.js clean. The critical part is the initialization above.
// However, we can keep a smaller check if desired, but the write-on-init by LowDB effectively tests it.
// If LowDB throws, we know. But let's keep the explicit check for debugging if user asked.
try {
  const testFile = 'data/.perm_check';
  fs.writeFileSync(testFile, 'ok');
  fs.unlinkSync(testFile);
  // console.log('[DB] ✅ Write permission confirmed.'); 
} catch (err) {
  console.error('[FATAL] ❌ Write Permission Error on "data/" folder!');
  console.error('The bot cannot save new accounts. Check Zeabur Volume permissions.');
}

// MIGRATION / INITIALIZATION LOGIC
// Check if the Persistent DB exists. If not, try to seed it from the deployed 'initial_db.json'
const DB_PATH = 'data/db.json';
const SEED_PATH = 'initial_db.json';

let initialData = { accounts: [], settings: { scheduleStart: '22:00', scheduleEnd: '18:00' } };

// Try to load seed data if it exists
if (fs.existsSync(SEED_PATH)) {
  try {
    const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf-8'));
    if (seed && seed.accounts) {
      console.log(`[DB] Found initial seed data with ${seed.accounts.length} accounts.`);
      initialData = seed;
    }
  } catch (e) {
    console.error('[DB] Failed to load initial seed data:', e.message);
  }
}

// LowDB Setup
const db = await JSONFilePreset(DB_PATH, initialData);

// Check if we just initialized a fresh DB (empty accounts but we have seed data)
// Note: JSONFilePreset writes defaultData if file doesn't exist. 
// If it *did* exist and was empty, we might want to merge. 
// But simplest is: We provided initialData as default. LowDB used it if file was missing.
// So we just need to ensure we write it strictly if it was a new creation.
// Actually, JSONFilePreset automatically saves defaultData if file is missing.
// So if data/db.json was missing (Volume empty), it is now created with 'initialData'.
// We are good!

console.log(`[DB] Database loaded. Accounts: ${db.data.accounts.length}`);

const SECRET_KEY = process.env.ENCRYPTION_KEY || 'default_secret_please_change';

export const encrypt = (text) => {
  return CryptoJS.AES.encrypt(text, SECRET_KEY).toString();
};

export const decrypt = (ciphertext) => {
  const bytes = CryptoJS.AES.decrypt(ciphertext, SECRET_KEY);
  return bytes.toString(CryptoJS.enc.Utf8);
};

export const isEncrypted = (text) => {
  // Check if text looks like encrypted data (AES encrypted strings contain special characters)
  // A simple heuristic: encrypted text from CryptoJS.AES is base64-like and contains '==' or special chars
  try {
    const bytes = CryptoJS.AES.decrypt(text, SECRET_KEY);
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);
    // If decryption produces valid UTF-8 and the original doesn't match (i.e., it was encrypted), return true
    // If it fails or produces empty string, it's likely not encrypted
    return decrypted.length > 0 && text !== decrypted;
  } catch (e) {
    return false;
  }
};

export const migrateUnencryptedCodes = async () => {
  await db.read();
  let migratedCount = 0;

  for (const account of db.data.accounts) {
    if (!isEncrypted(account.encryptedCode)) {
      console.log(`[DB] Migrating plain-text code for account: ${account.name}`);
      account.encryptedCode = encrypt(account.encryptedCode);
      migratedCount++;
    }
  }

  if (migratedCount > 0) {
    await db.write();
    console.log(`[DB] Migration complete. Encrypted ${migratedCount} account(s).`);
  } else {
    console.log('[DB] No migration needed. All codes are encrypted.');
  }

  return migratedCount;
};

export const addAccount = async (name, encryptedCode, targetServer) => {
  await db.read();
  const id = Date.now().toString();
  db.data.accounts.push({
    id,
    name,
    encryptedCode,
    targetServer,
    lastRun: null,
    status: 'idle'
  });
  await db.write();
  return id;
};

export const getAccounts = async () => {
  await db.read();
  return db.data.accounts;
};

export const removeAccount = async (name) => {
  await db.read();
  const initialLength = db.data.accounts.length;
  db.data.accounts = db.data.accounts.filter(a => a.name !== name);
  await db.write();
  return db.data.accounts.length < initialLength;
};

export const updateAccountStatus = async (id, status, lastRun = null) => {
  await db.read();
  const account = db.data.accounts.find(a => a.id === id);
  if (account) {
    account.status = status;
    if (lastRun) account.lastRun = lastRun;
    await db.write();
  }
};

export const getAccountDecrypted = async (id) => {
  await db.read();
  const account = db.data.accounts.find(a => a.id === id);
  if (!account) return null;
  return {
    ...account,
    code: decrypt(account.encryptedCode)
  };
};

export const getSchedule = async () => {
  await db.read();
  // Return defaults if not present
  return db.data.settings || { scheduleStart: '22:00', scheduleEnd: '18:00' };
};

export const setSchedule = async (start, end) => {
  await db.read();
  const current = db.data.settings || {};
  db.data.settings = { ...current, scheduleStart: start, scheduleEnd: end };
  await db.write();
  return db.data.settings;
};

export const pauseBot = async (hours) => {
  await db.read();
  const now = new Date();
  const pausedUntil = new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
  const current = db.data.settings || {};
  db.data.settings = { ...current, pausedUntil };
  await db.write();
  return pausedUntil;
};

export const resumeBot = async () => {
  await db.read();
  const current = db.data.settings || {};
  db.data.settings = { ...current, pausedUntil: null };
  await db.write();
};

// Run migration on module load to fix any existing plain-text codes
await migrateUnencryptedCodes();

export { db };
