import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { auth, db } from "../lib/firebase";

export async function signIn(email, password) {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    return { user: userCredential.user, error: null };
  } catch (error) {
    return { user: null, error: error.message };
  }
}

export async function register(email, password, name, role = "operator") {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    
    // Guardar información adicional en Firestore
    await setDoc(doc(db, "users", userCredential.user.uid), {
      email,
      name,
      role,
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString(),
    });

    return { user: userCredential.user, error: null };
  } catch (error) {
    return { user: null, error: error.message };
  }
}

export async function signOut() {
  try {
    await firebaseSignOut(auth);
    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
