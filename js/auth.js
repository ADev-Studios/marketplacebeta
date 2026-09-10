/**
 * Firebase Auth: email/password + Google
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  updatePassword,
  updateProfile,
  deleteUser,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBMWELhjScAzABD5sRna_wIPgipXIGWs2A",
  authDomain: "adev-marketplace.firebaseapp.com",
  projectId: "adev-marketplace",
  storageBucket: "adev-marketplace.firebasestorage.app",
  messagingSenderId: "284211725673",
  appId: "1:284211725673:web:44e01af9abfc6ca64da9f8",
  measurementId: "G-BSCKRY98S0",
};

let app = null;
let auth = null;
let db = null;
let currentUser = null;
let authReady = false;
const authListeners = new Set();

/** Initialize Firebase (call once from shared.js). Resolves after the first auth state. */
export function initFirebase() {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);

    const ready = new Promise((resolve) => {
      onAuthStateChanged(auth, (user) => {
        currentUser = user;
        authReady = true;
        authListeners.forEach((fn) => fn(user));
        resolve(user);
      });
    });

    return ready;
  } catch (err) {
    console.error("[auth] Firebase init failed:", err);
    throw err;
  }
}

export function getAuthInstance() {
  return auth;
}

export function getDb() {
  return db;
}

export function getCurrentUser() {
  return currentUser;
}

export function onAuthChange(callback) {
  authListeners.add(callback);
  if (authReady) callback(currentUser);
  return () => authListeners.delete(callback);
}

export async function loginEmail(email, password) {
  if (!auth) throw new Error("Firebase not initialized.");
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function signupEmail(email, password, displayName) {
  if (!auth) throw new Error("Firebase not initialized.");
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (displayName) {
    await updateProfile(cred.user, { displayName });
  }
  return cred.user;
}

export async function loginGoogle() {
  if (!auth) throw new Error("Firebase not initialized.");
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export async function logout() {
  if (!auth) return;
  await signOut(auth);
}

export async function changePassword(currentPassword, newPassword) {
  if (!auth || !currentUser) throw new Error("Not signed in");
  const credential = EmailAuthProvider.credential(currentUser.email, currentPassword);
  await reauthenticateWithCredential(currentUser, credential);
  await updatePassword(currentUser, newPassword);
}

export async function updateUserProfile(data) {
  if (!auth || !currentUser) throw new Error("Not signed in");
  await updateProfile(currentUser, data);
}

export async function deleteAccount(password) {
  if (!auth || !currentUser) throw new Error("Not signed in");
  if (password && currentUser.email) {
    const credential = EmailAuthProvider.credential(currentUser.email, password);
    await reauthenticateWithCredential(currentUser, credential);
  }
  await deleteUser(currentUser);
}

/** Detect if running inside Electron */
export function isElectron() {
  return (
    typeof window !== "undefined" &&
    (window.process?.type === "renderer" ||
      navigator.userAgent.toLowerCase().includes("electron") ||
      !!window.electronAPI)
  );
}
