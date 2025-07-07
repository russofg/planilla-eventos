/**
 * Servicio de tema oscuro/claro para la aplicación
 * Este archivo gestiona el cambio entre el tema claro y oscuro
 */

// Función para inicializar el tema basado en la preferencia guardada
function initializeTheme() {
  // Verificar si hay una preferencia guardada en localStorage
  if (localStorage.getItem("dark-mode") === "true") {
    document.documentElement.classList.add("dark");
    updateThemeIcon("☀️"); // Sol para modo oscuro
  } else {
    document.documentElement.classList.remove("dark");
    updateThemeIcon("🌙"); // Luna para modo claro
  }
}

// Función para actualizar el ícono del tema
function updateThemeIcon(icon) {
  const themeIcons = document.querySelectorAll("#theme-icon");
  themeIcons.forEach((el) => {
    if (el) el.textContent = icon;
  });
}

// Función para alternar el tema
function toggleTheme() {
  if (document.documentElement.classList.contains("dark")) {
    // Cambiar a tema claro
    document.documentElement.classList.remove("dark");
    localStorage.setItem("dark-mode", "false");
    updateThemeIcon("🌙"); // Luna para modo claro
  } else {
    // Cambiar a tema oscuro
    document.documentElement.classList.add("dark");
    localStorage.setItem("dark-mode", "true");
    updateThemeIcon("☀️"); // Sol para modo oscuro
  }
}

// Inicializar todos los botones de tema en todas las páginas
function setupThemeToggleButtons() {
  const themeToggleButtons = document.querySelectorAll("#theme-toggle");
  themeToggleButtons.forEach((button) => {
    if (button) {
      button.addEventListener("click", toggleTheme);
    }
  });
}

// Inicializar el tema al cargar la página
document.addEventListener("DOMContentLoaded", () => {
  initializeTheme();
  setupThemeToggleButtons();
});

// Exportar funciones para usar en otros módulos
export { initializeTheme, toggleTheme, updateThemeIcon };
