import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Navbar from './components/common/Navbar';
import HomePage from './pages/HomePage';
import BlogPage from './pages/BlogPage';
import PMTPage from './pages/PMTPage';
import AforosPage from './pages/AforosPage';

function App() {
  return (
    <Router>
      <div className="flex flex-col h-screen min-h-0 bg-slate-50 font-sans text-slate-900">
        <Navbar />
        <main className="flex-1 min-h-0 overflow-auto">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/blog" element={<BlogPage />} />
            <Route path="/PMT" element={<PMTPage />} />
            <Route path="/aforos" element={<AforosPage />} />
            <Route path="/aforos/analisis/:dimId" element={<AforosPage />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
