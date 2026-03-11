import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom"
import { AuthProvider, useAuth } from "./contexts/AuthContext"
import Layout from "./components/layout/Layout"
import Dashboard from "./pages/Dashboard"
import CalendarView from "./pages/CalendarView"
import Events from "./pages/Events"
import Expenses from "./pages/Expenses"
import Settings from "./pages/Settings"
import Admin from "./pages/Admin"

// Protected Route Component
function PrivateRoute({ children }) {
  const { currentUser } = useAuth();
  return currentUser ? children : <Navigate to="/login" />;
}

import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { signIn } from "./services/authService"

// Login page component
function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    
    const { user, error: authError } = await signIn(email, password);
    
    if (authError) {
      setError("Credenciales incorrectas o error de conexión.");
      setLoading(false);
    } else {
      navigate("/");
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-[var(--background)]">
      <div className="glass-card p-8 rounded-2xl w-full max-w-md">
        <h1 className="text-2xl font-bold mb-2 text-center bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">Planilla Premium</h1>
        <p className="text-gray-400 text-center mb-6">Inicia sesión para continuar</p>
        
        {error && <div className="bg-red-500/10 border border-red-500/50 text-red-500 text-sm p-3 rounded-xl mb-4 text-center">{error}</div>}
        
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Correo Electrónico</label>
            <input 
              type="email" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[var(--primary)] transition-colors"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Contraseña</label>
            <input 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[var(--primary)] transition-colors"
              required
            />
          </div>
          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-[var(--primary)] hover:bg-blue-600 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors shadow-lg shadow-blue-500/25 mt-4"
          >
            {loading ? "Cargando..." : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  )
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
            <Route index element={<Dashboard />} />
            <Route path="calendar" element={<CalendarView />} />
            <Route path="events" element={<Events />} />
            <Route path="expenses" element={<Expenses />} />
            <Route path="settings" element={<Settings />} />
            <Route path="admin" element={<Admin />} />
          </Route>
        </Routes>
      </Router>
    </AuthProvider>
  )
}

export default App
