
import React from 'react';
import { Outlet, Link } from 'react-router-dom';

const PublicLayout: React.FC = () => {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white border-b border-gray-200">
        <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="text-2xl font-bold text-indigo-600">
            CatalogSaaS
          </Link>
          <div className="flex gap-4">
            <Link to="/" className="text-gray-600 hover:text-gray-900">Inicio</Link>
            <Link 
              to="/admin" 
              className="bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-indigo-700 transition-colors"
            >
              Panel Admin
            </Link>
          </div>
        </nav>
      </header>

      <main className="flex-grow">
        <Outlet />
      </main>

      <footer className="bg-white border-t border-gray-200 py-8">
        <div className="max-w-7xl mx-auto px-4 text-center text-gray-500 text-sm">
          &copy; {new Date().getFullYear()} CatalogSaaS MVP. Todos los derechos reservados.
        </div>
      </footer>
    </div>
  );
};

export default PublicLayout;
