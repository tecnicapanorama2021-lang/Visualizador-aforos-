import React from 'react';
import { Link, useLocation } from 'react-router-dom';

const Navbar = () => {
  const location = useLocation();
  const isActive = (path) => location.pathname === path;

  const linkClass = (path) =>
    `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
      isActive(path)
        ? 'bg-panorama-sky text-white'
        : 'text-slate-700 hover:bg-slate-100'
    }`;

  return (
    <nav className="flex items-center justify-between h-14 px-4 bg-white border-b border-slate-200 shadow-sm shrink-0">
      <Link to="/" className="font-semibold text-slate-800">
        Panorama Ingeniería
      </Link>
      <div className="flex items-center gap-1">
        <Link to="/" className={linkClass('/')}>
          Inicio
        </Link>
        <Link to="/blog" className={linkClass('/blog')}>
          Noticias
        </Link>
        <Link to="/PMT" className={linkClass('/PMT')}>
          PMT
        </Link>
        <Link to="/aforos" className={linkClass('/aforos')}>
          Aforos
        </Link>
      </div>
    </nav>
  );
};

export default Navbar;
