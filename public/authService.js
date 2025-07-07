import { auth } from "./firebase.config.js";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  doc,
  setDoc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "./firebase.config.js";
import { showSuccessToast, showErrorToast } from "./notifications.js";

// Constantes para el manejo de errores
const AUTH_ERROR_MESSAGES = {
  "auth/email-already-in-use":
    "El correo electrónico ya está en uso por otra cuenta.",
  "auth/invalid-email": "El correo electrónico no es válido.",
  "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
  "auth/user-not-found": "No existe usuario con este correo electrónico.",
  "auth/wrong-password": "Contraseña incorrecta.",
  "auth/too-many-requests":
    "Demasiados intentos fallidos. Inténtalo más tarde.",
  "auth/user-disabled": "Esta cuenta ha sido deshabilitada.",
  "auth/operation-not-allowed": "Operación no permitida.",
  "auth/popup-closed-by-user": "Inicio de sesión cancelado.",
  "auth/expired-action-code": "El código de acción ha expirado.",
  "auth/invalid-action-code": "El código de acción no es válido.",
  "auth/requires-recent-login":
    "Esta operación requiere un inicio de sesión reciente.",
  "auth/account-exists-with-different-credential":
    "Ya existe una cuenta con este correo electrónico.",
};

// Variables para el seguimiento de intentos fallidos
const failedAttempts = {};
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_TIME = 15 * 60 * 1000; // 15 minutos en milisegundos

// Variable para el usuario actual
let currentUser = null;

// Función para iniciar sesión con validación de intentos
export async function signIn(email, password) {
  try {
    // Validar entrada
    if (!email || !password) {
      throw new Error("Email y contraseña son requeridos");
    }

    if (!isValidEmail(email)) {
      throw new Error("Formato de email no válido");
    }

    // Verificar si el usuario está bloqueado
    if (isUserLocked(email)) {
      const remainingTime = getRemainingLockTime(email);
      throw new Error(
        `Cuenta temporalmente bloqueada. Intenta de nuevo en ${Math.ceil(
          remainingTime / 60000
        )} minutos.`
      );
    }

    const userCredential = await signInWithEmailAndPassword(
      auth,
      email,
      password
    );
    currentUser = userCredential.user;

    // Resetear intentos fallidos al iniciar sesión exitosamente
    resetFailedAttempts(email);

    return userCredential.user;
  } catch (error) {
    console.error("Error en inicio de sesión:", error);

    // Incrementar intentos fallidos si es error de autenticación
    if (
      error.code === "auth/wrong-password" ||
      error.code === "auth/user-not-found"
    ) {
      incrementFailedAttempts(email);
    }

    const errorMessage = AUTH_ERROR_MESSAGES[error.code] || error.message;
    throw new Error(errorMessage);
  }
}

// Función para registrar nuevo usuario con validación
export async function register(email, password, name, role = "operator") {
  try {
    // Validar entrada
    if (!email || !password || !name) {
      throw new Error("Todos los campos son requeridos");
    }

    if (!isValidEmail(email)) {
      throw new Error("Formato de email no válido");
    }

    if (!isStrongPassword(password)) {
      throw new Error(
        "La contraseña debe tener al menos 8 caracteres, incluyendo una letra mayúscula, una minúscula, un número y un carácter especial"
      );
    }

    const userCredential = await createUserWithEmailAndPassword(
      auth,
      email,
      password
    );

    // Actualizar el perfil del usuario con el nombre
    await updateProfile(userCredential.user, { displayName: name });

    // Guardar información adicional en Firestore
    await setDoc(doc(db, "users", userCredential.user.uid), {
      email: email,
      name: name,
      role: role,
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString(),
    });

    currentUser = userCredential.user;
    return userCredential.user;
  } catch (error) {
    const errorMessage = AUTH_ERROR_MESSAGES[error.code] || error.message;
    throw new Error(errorMessage);
  }
}

// Función para cerrar sesión
export async function signOut() {
  try {
    await firebaseSignOut(auth);
    currentUser = null;
    return true;
  } catch (error) {
    throw new Error("Error al cerrar sesión");
  }
}

// Función para restablecer contraseña
export async function resetPassword(email) {
  try {
    if (!email) {
      throw new Error("Email requerido");
    }

    if (!isValidEmail(email)) {
      throw new Error("Formato de email no válido");
    }

    await sendPasswordResetEmail(auth, email);
    return true;
  } catch (error) {
    const errorMessage = AUTH_ERROR_MESSAGES[error.code] || error.message;
    throw new Error(errorMessage);
  }
}

// Función para obtener el usuario actual
export function getCurrentUser() {
  return currentUser || auth.currentUser;
}

// Función para verificar si un usuario es administrador
export async function isUserAdmin(userId) {
  try {
    const userRef = doc(db, "users", userId);
    const userDoc = await getDoc(userRef);
    return userDoc.exists() && userDoc.data().role === "admin";
  } catch (error) {
    return false;
  }
}

// Función para actualizar el usuario en Firestore después de iniciar sesión
export async function updateUserLoginTimestamp(userId) {
  try {
    const userRef = doc(db, "users", userId);
    await setDoc(
      userRef,
      { lastLogin: new Date().toISOString() },
      { merge: true }
    );
  } catch (error) {}
}

// Función para configurar el listener de cambios en la autenticación
export function setupAuthListener(onAuthChange) {
  return onAuthStateChanged(auth, async (user) => {
    currentUser = user;

    // Sincronizar con el estado global en config.js
    const { setCurrentUser } = await import("./config.js");
    setCurrentUser(user);

    if (user) {
      // Actualizar timestamp de último inicio de sesión
      await updateUserLoginTimestamp(user.uid);

      // Mostrar el contenido principal y ocultar el prompt de login
      const mainContent = document.getElementById("main-content");
      const loginPrompt = document.getElementById("login-prompt");

      if (mainContent) mainContent.style.display = "block";
      if (loginPrompt) loginPrompt.style.display = "none";

      // Actualizar el email del usuario en la UI
      const userEmailElement = document.getElementById("user-email");
      if (userEmailElement && user.email) {
        userEmailElement.textContent = user.email;
      }
    } else {
      // Ocultar contenido principal y mostrar prompt de login si no hay redirección
      const mainContent = document.getElementById("main-content");
      const loginPrompt = document.getElementById("login-prompt");

      if (mainContent) mainContent.style.display = "none";
      if (loginPrompt) loginPrompt.style.display = "block";
    }

    if (typeof onAuthChange === "function") {
      onAuthChange(user);
    }
  });
}

// Funciones de utilidad para validación
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function isStrongPassword(password) {
  // Mínimo 8 caracteres, al menos una letra mayúscula, una minúscula, un número y un carácter especial
  const passwordRegex =
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  return passwordRegex.test(password);
}

// Funciones para control de intentos fallidos
function incrementFailedAttempts(email) {
  const normalizedEmail = email.toLowerCase();

  if (!failedAttempts[normalizedEmail]) {
    failedAttempts[normalizedEmail] = {
      count: 0,
      lastAttempt: Date.now(),
      lockedUntil: null,
    };
  }

  failedAttempts[normalizedEmail].count += 1;
  failedAttempts[normalizedEmail].lastAttempt = Date.now();

  // Bloquear si se excede el máximo de intentos
  if (failedAttempts[normalizedEmail].count >= MAX_FAILED_ATTEMPTS) {
    failedAttempts[normalizedEmail].lockedUntil = Date.now() + LOCKOUT_TIME;
    //   `Usuario ${normalizedEmail} bloqueado por ${LOCKOUT_TIME / 60000} minutos`
    // );
  }
}

function resetFailedAttempts(email) {
  const normalizedEmail = email.toLowerCase();
  if (failedAttempts[normalizedEmail]) {
    delete failedAttempts[normalizedEmail];
  }
}

function isUserLocked(email) {
  const normalizedEmail = email.toLowerCase();
  if (
    !failedAttempts[normalizedEmail] ||
    !failedAttempts[normalizedEmail].lockedUntil
  ) {
    return false;
  }

  // Verificar si ya pasó el tiempo de bloqueo
  if (Date.now() > failedAttempts[normalizedEmail].lockedUntil) {
    delete failedAttempts[normalizedEmail];
    return false;
  }

  return true;
}

function getRemainingLockTime(email) {
  const normalizedEmail = email.toLowerCase();
  if (
    !failedAttempts[normalizedEmail] ||
    !failedAttempts[normalizedEmail].lockedUntil
  ) {
    return 0;
  }

  return Math.max(0, failedAttempts[normalizedEmail].lockedUntil - Date.now());
}

// Función para cambiar contraseña
export async function changePassword(currentPassword, newPassword) {
  try {
    const user = getCurrentUser();
    if (!user) {
      throw new Error("Usuario no autenticado");
    }

    if (!isStrongPassword(newPassword)) {
      throw new Error(
        "La nueva contraseña debe tener al menos 8 caracteres, incluyendo una letra mayúscula, una minúscula, un número y un carácter especial"
      );
    }

    // Reautenticar al usuario antes de cambiar la contraseña
    const credential = EmailAuthProvider.credential(
      user.email,
      currentPassword
    );
    await reauthenticateWithCredential(user, credential);

    // Cambiar la contraseña
    await updatePassword(user, newPassword);
    return true;
  } catch (error) {
    const errorMessage = AUTH_ERROR_MESSAGES[error.code] || error.message;
    throw new Error(errorMessage);
  }
}
