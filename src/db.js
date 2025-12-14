import { JSONFilePreset } from 'lowdb/node';
import CryptoJS from 'crypto-js';
import dotenv from 'dotenv';

dotenv.config();

const defaultData = { accounts: [], settings: { scheduleStart: '10:00', scheduleEnd: '20:00' } };
const db = await JSONFilePreset('db.json', defaultData);

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
  return db.data.settings || { scheduleStart: '10:00', scheduleEnd: '20:00' };
};

export const setSchedule = async (start, end) => {
  await db.read();
  db.data.settings = { scheduleStart: start, scheduleEnd: end };
  await db.write();
  return db.data.settings;
};

// Run migration on module load to fix any existing plain-text codes
await migrateUnencryptedCodes();

export { db };
