// public/auth.js
import { db, auth } from "./firebase.config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged, // Para detectar cambios en el estado de autenticación
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  doc,
  setDoc,
  serverTimestamp, // Para guardar la fecha de creación del usuario
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const registerForm = document.getElementById("register-form");
const loginForm = document.getElementById("login-form");
const errorMessageDiv = document.getElementById("error-message");

// --- Lógica de Registro ---
if (registerForm) {
  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorMessageDiv.textContent = ""; // Limpiar errores previos

    const email = registerForm.email.value;
    const password = registerForm.password.value;
    const confirmPassword = registerForm["confirm-password"].value;

    if (password !== confirmPassword) {
      errorMessageDiv.textContent = "Las contraseñas no coinciden.";
      return;
    }
    if (password.length < 6) {
      errorMessageDiv.textContent =
        "La contraseña debe tener al menos 6 caracteres.";
      return;
    }

    try {
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );
      const user = userCredential.user;

      // Guardar información adicional del usuario en Firestore (con rol por defecto 'operator')
      await setDoc(doc(db, "users", user.uid), {
        email: user.email,
        role: "operator", // Rol por defecto para nuevos registros
        createdAt: serverTimestamp(),
      });

      // Usuario registrado y datos guardados:
      // Redirigir al usuario a la página principal (index.html) después del registro
      window.location.href = "index.html";
    } catch (error) {
      // Mostrar mensajes de error más amigables
      if (error.code === "auth/email-already-in-use") {
        errorMessageDiv.textContent =
          "Este correo electrónico ya está registrado.";
      } else if (error.code === "auth/weak-password") {
        errorMessageDiv.textContent = "La contraseña es demasiado débil.";
      } else {
        errorMessageDiv.textContent =
          "Error al registrar el usuario. Inténtalo de nuevo.";
      }
    }
  });
}

// --- Lógica de Inicio de Sesión ---
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorMessageDiv.textContent = ""; // Limpiar errores previos

    const email = loginForm.email.value;
    const password = loginForm.password.value;

    try {
      const userCredential = await signInWithEmailAndPassword(
        auth,
        email,
        password
      );
      // Usuario inició sesión:
      // Redirigir al usuario a la página principal (index.html) después del login
      window.location.href = "index.html";
    } catch (error) {
      // Mostrar mensajes de error más amigables
      if (
        error.code === "auth/user-not-found" ||
        error.code === "auth/wrong-password" ||
        error.code === "auth/invalid-credential"
      ) {
        errorMessageDiv.textContent =
          "Correo electrónico o contraseña incorrectos.";
      } else {
        errorMessageDiv.textContent =
          "Error al iniciar sesión. Inténtalo de nuevo.";
      }
    }
  });
}

// --- Observador de Estado de Autenticación (Opcional aquí, más útil en main.js) ---
// onAuthStateChanged(auth, (user) => {
//   if (user) {
//     // El usuario está autenticado
//     // Podrías redirigir desde aquí si el usuario ya está logueado y visita login/register
//     // if (window.location.pathname.includes('login.html') || window.location.pathname.includes('register.html')) {
//     //    window.location.href = 'index.html';
//   } else {
//     // El usuario no está autenticado
//     // Si estamos en index.html y no hay usuario, redirigir a login
//     // if (!window.location.pathname.includes('login.html') && !window.location.pathname.includes('register.html')) {
//     //    window.location.href = 'login.html';
//   }
// });
